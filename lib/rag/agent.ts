import { retrieve, type RetrievedChunk } from "./retriever";
import { isParallelMcpEnabled, searchWithParallelMcp } from "@/lib/parallelMcp";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

// ── Public types ───────────────────────────────────────────────────────────────

export interface AgentConfig {
  aiProvider: "ollama" | "openrouter" | "gemini";
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaEmbedModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  embeddingProvider?: "ollama" | "google";
  tavilyApiKey?: string;
  searchMode?: "rag" | "mixed";
}

export interface WebResult {
  title: string;
  url: string;
  content: string;
  extracted?: boolean;
}

export interface AgentLogEntry {
  iteration: number;
  tool: string;
  query: string;
  found: number;
  tokens?: number;
}

export interface AgentResult {
  chunks: RetrievedChunk[];
  webResults: WebResult[];
  log: AgentLogEntry[];
  usedAgent: boolean;
  totalAgentTokens: number;
}

// ── Tool definitions ───────────────────────────────────────────────────────────

const TOOL_SEARCH_DOCS = {
  type: "function",
  function: {
    name: "search_documents",
    description:
      "Search the internal knowledge base: case studies, POVs, RFPs, capability decks. Use for proof points, past client work, differentiators, and quantified outcomes.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Precise search query — use domain terminology, vary phrasings across calls to maximise coverage",
        },
      },
      required: ["query"],
    },
  },
};

const TOOL_SEARCH_WEB = {
  type: "function",
  function: {
    name: "search_web",
    description:
      "Search the internet for company news, industry trends, analyst reports, or market data.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Web search query" },
      },
      required: ["query"],
    },
  },
};

const AGENT_SYSTEM_PROMPT = `You are a presales research assistant with access to search tools.

Tool selection strategy — follow this BEFORE calling anything:
1. If the query mentions a specific company, prospect, or current events → call search_web FIRST
2. If the query is about capabilities, case studies, or past work → call search_documents FIRST
3. For everything else → call search_documents first, then search_web for broader context

Execution rules:
- Make 2-3 searches with DIFFERENT phrasings to maximise coverage
- If search_documents returns nothing, immediately try search_web (and vice versa)
- Stop calling tools once you have enough information to answer completely

Do NOT fabricate information. If nothing relevant is found after trying both tools, say so.`;

// ── Shared helpers (exported so route.ts can use them in fallback) ─────────────

export async function getEmbedding(text: string, config: AgentConfig): Promise<number[]> {
  const {
    embeddingProvider = "ollama",
    ollamaBaseUrl = "http://localhost:11434",
    ollamaEmbedModel = "bge-large",
    geminiApiKey = "",
  } = config;

  if (embeddingProvider === "google") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          taskType: "RETRIEVAL_QUERY",
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) throw new Error(`Google embed ${res.status}`);
    return ((await res.json()).embedding?.values as number[]) ?? [];
  }

  const res = await fetch(`${ollamaBaseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: ollamaEmbedModel, input: text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Embed ${res.status}`);
  return ((await res.json()).embeddings?.[0] as number[]) ?? [];
}

async function extractWithTavily(
  urls: string[],
  query: string,
  apiKey: string
): Promise<Map<string, string>> {
  if (!urls.length) return new Map();

  const res = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      urls,
      query,
      chunks_per_source: 5,
      extract_depth: "advanced",
      format: "markdown",
      include_images: false,
      include_favicon: false,
      timeout: 20,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) return new Map();

  const data = await res.json();
  const extracted = new Map<string, string>();
  for (const result of data.results ?? []) {
    if (typeof result.url !== "string" || typeof result.raw_content !== "string") continue;
    const content = result.raw_content.replace(/\s{3,}/g, "\n\n").trim();
    if (content) extracted.set(result.url, content.slice(0, 8_000));
  }
  return extracted;
}

export async function searchWeb(query: string, apiKey?: string): Promise<WebResult[]> {
  const parallelResults = await searchWithParallelMcp(query).catch(() => [] as WebResult[]);
  if (parallelResults.length) return parallelResults;
  if (!apiKey) return [];

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const results = (data.results ?? []).map((r: { title: string; url: string; content: string }) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: r.content ?? "",
  }));

  const topUrls = results.slice(0, 3).map((result: WebResult) => result.url).filter(Boolean);
  const extractedByUrl = await extractWithTavily(topUrls, query, apiKey).catch(() => new Map<string, string>());

  return results.map((result: WebResult) => {
    const content = extractedByUrl.get(result.url);
    return content ? { ...result, content, extracted: true } : result;
  });
}

// ── Internal LLM caller with tool support ─────────────────────────────────────

interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface LLMResponse {
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  usage?: { promptTokens: number; completionTokens: number; total: number };
}

async function callLLM(
  messages: AgentMessage[],
  tools: object[],
  config: AgentConfig
): Promise<LLMResponse> {
  const {
    aiProvider,
    ollamaBaseUrl = "http://localhost:11434",
    ollamaModel,
    openrouterApiKey,
    openrouterModel,
    geminiApiKey,
    geminiModel,
  } = config;

  if (aiProvider === "ollama") {
    // Ollama needs tool_calls.arguments as objects, not JSON strings
    const ollamaMessages = messages.map((m) => {
      if (m.role === "assistant" && m.tool_calls) {
        return {
          role: m.role,
          content: m.content ?? "",
          tool_calls: m.tool_calls.map((tc) => ({
            function: {
              name: tc.function.name,
              arguments: (() => {
                try { return JSON.parse(tc.function.arguments); }
                catch { return {}; }
              })(),
            },
          })),
        };
      }
      if (m.role === "tool") return { role: "tool", content: m.content ?? "" };
      return { role: m.role, content: m.content ?? "" };
    });

    const res = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        messages: ollamaMessages,
        tools: tools.length ? tools : undefined,
        stream: false,
        options: { num_predict: 1024 },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = await res.json();
    const msg = data.message ?? {};
    return {
      content: msg.content || null,
      tool_calls: msg.tool_calls?.map(
        (tc: { function: { name: string; arguments: unknown } }, i: number) => ({
          id: `call-${i}`,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments:
              typeof tc.function.arguments === "string"
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments),
          },
        })
      ) ?? undefined,
      usage: {
        promptTokens:     data.prompt_eval_count    ?? 0,
        completionTokens: data.eval_count           ?? 0,
        total:           (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
    };
  }

  // OpenRouter + Gemini share the OpenAI-compatible shape
  const [url, auth, model] =
    aiProvider === "gemini"
      ? [`${GEMINI_BASE}/chat/completions`, `Bearer ${geminiApiKey}`, geminiModel]
      : [
          "https://openrouter.ai/api/v1/chat/completions",
          `Bearer ${openrouterApiKey}`,
          openrouterModel,
        ];

  const res = await fetch(url!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth ?? "",
      ...(aiProvider === "openrouter" && {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Apexon Knowledge Hub",
      }),
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1024,
      ...(tools.length && { tools, tool_choice: "auto" }),
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`${aiProvider} ${res.status}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  return {
    content: msg.content || null,
    tool_calls: msg.tool_calls ?? undefined,
    usage: {
      promptTokens:     data.usage?.prompt_tokens     ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      total:            data.usage?.total_tokens       ?? 0,
    },
  };
}

// ── LLM re-ranker ─────────────────────────────────────────────────────────────

/**
 * After vector+keyword retrieval, ask the LLM to score each chunk 1-5 for true
 * relevance to the query — then keep only the best ones.
 *
 * This catches type mismatches (e.g. a "Scope coverage" slide ranking high when
 * the user asks for "case studies") that pure math can never understand.
 *
 * Falls through silently on any error — retrieval result is always the fallback.
 */
// Structural slide patterns — slides that only list/reference topics, never explain them.
// Detected by the opening text (the slide heading area).
const STRUCTURAL_PATTERNS = /^\s*(agenda|table of contents|contents|in.?scope|out.?of.?scope|scope overview|project scope|scope of work|scope of services|disclaimer|legal notice|confidentiality|introduction|about this|about us|who we are|objectives|executive summary overview)\b/i;

/**
 * Filters out structural slides (agendas, scope lists, TOC entries) that merely
 * LIST or REFERENCE the query topic rather than explain it. Does NOT make an LLM
 * call — fully deterministic, never fails, never causes empty results.
 *
 * Structural detection looks at the first ~120 characters of the slide text
 * (the heading area). Any slide that passes gets returned; if ALL slides are
 * structural, we return the original list unchanged so results are never empty.
 */
export function rerankChunks(
  query: string,
  chunks: RetrievedChunk[],
  _config: AgentConfig,
  keepTopK = 5,
): Promise<RetrievedChunk[]> {
  if (chunks.length === 0) return Promise.resolve([]);

  const filtered = chunks.filter((c) => !STRUCTURAL_PATTERNS.test(c.text.slice(0, 120)));

  // Never return empty — if all slides looked structural, keep the originals
  const result = filtered.length > 0 ? filtered : chunks;
  return Promise.resolve(result.slice(0, keepTopK));
}

// ── Context compression ────────────────────────────────────────────────────────

/**
 * Compresses retrieved chunks before synthesis using two techniques:
 *
 * 1. Query-aware snippets — splits each chunk into sentences, scores by
 *    query-term overlap, and keeps only the top 3-4 most relevant sentences
 *    plus any sentence containing a metric (numbers, %, $).
 *
 * 2. Same-page deduplication — when multiple chunks come from the same
 *    fileName+page, keeps only the one with the highest sentence score and
 *    merges its snippet with any unique metric sentences from the others.
 *
 * Returns a new array of chunks with `.text` replaced by the compressed
 * snippet. All other metadata (fileName, page, score, etc.) is preserved
 * so citations still work correctly downstream.
 */
export function compressContextChunks(
  query: string,
  chunks: RetrievedChunk[],
): RetrievedChunk[] {
  if (chunks.length === 0) return [];

  // Build a set of lowercased query terms (4+ chars, or acronyms)
  const queryTerms = query
    .split(/\W+/)
    .filter((t) => (t === t.toUpperCase() && /[A-Z]/.test(t)) || t.length >= 4)
    .map((t) => t.toLowerCase());

  // Metric pattern: any sentence with a number, %, $, or x (multiplier)
  const METRIC_RE = /\b\d[\d.,]*\s*(%|x\b|\$|k\b|m\b|bn\b|million|billion|thousand|percent|reduction|increase|improvement|uplift|savings|faster|times)\b/i;

  function splitSentences(text: string): string[] {
    // Split on sentence-ending punctuation followed by whitespace + capital
    return text
      .replace(/\n+/g, " ")
      .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20);
  }

  function scoreSentence(sentence: string): number {
    const lower = sentence.toLowerCase();
    let score = queryTerms.filter((t) => lower.includes(t)).length;
    if (METRIC_RE.test(sentence)) score += 2; // boost metrics
    return score;
  }

  function compressText(text: string, maxSentences = 4): string {
    const sentences = splitSentences(text);
    if (sentences.length <= maxSentences) return text.trim();

    // Score every sentence
    const scored = sentences.map((s, i) => ({ s, i, score: scoreSentence(s) }));

    // Always keep the first sentence (usually the heading/topic line)
    const first = scored[0];

    // Pick top-scoring remaining sentences, preserving original order
    const rest = scored
      .slice(1)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, maxSentences - 1)
      .sort((a, b) => a.i - b.i);

    return [first, ...rest].map((x) => x.s).join(" ").trim();
  }

  // ── Step 1: compress each chunk individually ─────────────────────────────
  const compressed = chunks.map((c) => ({
    ...c,
    text: compressText(c.text),
  }));

  // ── Step 2: deduplicate same-page chunks ─────────────────────────────────
  const pageKey = (c: RetrievedChunk) => `${c.fileName}::${c.page}`;
  const groups = new Map<string, typeof compressed>();

  for (const c of compressed) {
    const k = pageKey(c);
    if (!groups.has(k)) {
      groups.set(k, []);
    }
    groups.get(k)!.push(c);
  }

  const deduped: RetrievedChunk[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      deduped.push(group[0]);
      continue;
    }
    // Keep the chunk with the highest original score
    const best = group.reduce((a, b) => (b.score ?? 0) > (a.score ?? 0) ? b : a);
    // Merge any unique metric sentences from the others
    const extraMetrics = group
      .filter((c) => c !== best)
      .flatMap((c) => splitSentences(c.text).filter((s) => METRIC_RE.test(s)))
      .filter((s) => !best.text.includes(s));
    deduped.push({
      ...best,
      text: extraMetrics.length
        ? `${best.text} ${extraMetrics.slice(0, 2).join(" ")}`.trim()
        : best.text,
    });
  }

  // Restore original ordering (by position in the input `chunks` array)
  const order = new Map(chunks.map((c, i) => [pageKey(c), i]));
  return deduped.sort((a, b) => (order.get(pageKey(a)) ?? 0) - (order.get(pageKey(b)) ?? 0));
}

// ── Main agent runner ──────────────────────────────────────────────────────────

export async function runAgent(
  query: string,
  config: AgentConfig,
  sourceKey: string
): Promise<AgentResult> {
  const log: AgentLogEntry[] = [];
  const allChunks: RetrievedChunk[] = [];
  const allWebResults: WebResult[] = [];
  const seenChunkIds = new Set<string>();
  const seenWebUrls = new Set<string>();
  let totalAgentTokens = 0;

  const canWeb = config.searchMode === "mixed" && (Boolean(config.tavilyApiKey) || isParallelMcpEnabled());
  const toolList = canWeb
    ? [TOOL_SEARCH_DOCS, TOOL_SEARCH_WEB]
    : [TOOL_SEARCH_DOCS];

  const messages: AgentMessage[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    { role: "user", content: query },
  ];

  for (let iter = 0; iter < 3; iter++) {
    let response: LLMResponse;
    try {
      response = await callLLM(messages, toolList, config);
    } catch (err) {
      console.error(`[Agent] LLM call failed (iter ${iter + 1}):`, err);
      break;
    }

    const iterTokens = response.usage?.total ?? 0;
    totalAgentTokens += iterTokens;

    // LLM decided it has enough — stop
    if (!response.tool_calls?.length) break;

    messages.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.tool_calls,
    });

    // Distribute this iteration's token cost evenly across tool calls
    const tokensPerCall = response.tool_calls.length > 0
      ? Math.round(iterTokens / response.tool_calls.length)
      : 0;

    const toolResults = await Promise.all(response.tool_calls.map(async (call) => {
      let args: Record<string, string>;
      try { args = JSON.parse(call.function.arguments); }
      catch { args = { query }; }

      const q = args.query ?? args.company ?? query;

      if (call.function.name === "search_documents") {
        const emb = await getEmbedding(q, config).catch(() => null);
        const chunks = await retrieve(q, emb, sourceKey, 20).catch(() => [] as RetrievedChunk[]);
        return { call, q, tool: "search_documents" as const, chunks };
      }

      if (call.function.name === "search_web" && canWeb) {
        const results = await searchWeb(q, config.tavilyApiKey).catch(() => [] as WebResult[]);
        return { call, q, tool: "search_web" as const, results };
      }

      return { call, q, tool: "unavailable" as const };
    }));

    for (const result of toolResults) {
      if (result.tool === "search_documents") {
        const fresh = result.chunks.filter((c) => !seenChunkIds.has(c.id));
        fresh.forEach((c) => { seenChunkIds.add(c.id); allChunks.push(c); });

        log.push({ iteration: iter + 1, tool: "search_documents", query: result.q, found: fresh.length, tokens: tokensPerCall });
        messages.push({
          role: "tool",
          tool_call_id: result.call.id,
          content: fresh.length
            ? fresh.map((c) => `[${c.fileName} | Slide ${c.page}]\n${c.text}`).join("\n\n---\n\n")
            : "No documents found for this query.",
        });
      } else if (result.tool === "search_web") {
        const fresh = result.results.filter((r) => !seenWebUrls.has(r.url));
        fresh.forEach((r) => { seenWebUrls.add(r.url); allWebResults.push(r); });

        log.push({ iteration: iter + 1, tool: "search_web", query: result.q, found: fresh.length, tokens: tokensPerCall });
        messages.push({
          role: "tool",
          tool_call_id: result.call.id,
          content: fresh.length
            ? fresh.map((r) => `[${r.title} | ${r.url}]\n${r.content}`).join("\n\n---\n\n")
            : "No web results found.",
        });
      } else {
        messages.push({ role: "tool", tool_call_id: result.call.id, content: "Tool not available." });
      }
    }

    // Stop early once we have a large enough pool for the classifier
    if (allChunks.length >= 20) break;
  }

  return {
    chunks: allChunks,
    webResults: allWebResults,
    log,
    usedAgent: log.length > 0,
    totalAgentTokens,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENTIC RAG ENHANCEMENTS - Query Decomposition, Self-Correction, Synthesis
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Decomposes a complex research query into simpler sub-queries for better retrieval.
 * This helps when the original query has multiple aspects that need separate searches.
 */
export async function decomposeQuery(
  query: string,
  config: AgentConfig
): Promise<string[]> {
  const system = `You are a research query analyzer. Decompose complex questions into simpler sub-queries.`;

  const user = `Decompose this research query into 3-5 focused sub-queries that can be answered independently:

"${query}"

Return a JSON array of sub-queries:
["sub-query 1", "sub-query 2", ...]`;

  try {
    const response = await callLLM(
      [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      [],
      config
    );
    const parsed = JSON.parse(response.content || "[]");
    return Array.isArray(parsed) ? parsed : [query];
  } catch {
    return [query]; // Fallback to original
  }
}

/**
 * Self-correction: Verify that retrieved content actually answers the query.
 * If not, generate a follow-up query to fill the gaps.
 */
export async function verifyContentRelevance(
  query: string,
  chunks: RetrievedChunk[],
  webResults: WebResult[],
  config: AgentConfig
): Promise<{ relevant: RetrievedChunk[]; missingAspects: string[]; followUpQueries: string[] }> {
  const system = `You are a research relevance verifier. Check if retrieved content answers the user's question.`;

  const docContent = chunks.slice(0, 5).map(c => c.text.slice(0, 500)).join("\n\n---\n\n");
  const webContent = webResults.slice(0, 3).map(r => `${r.title}: ${r.content?.slice(0, 300)}`).join("\n\n---\n\n");

  const user = `Check if these sources answer the user's question: "${query}"

DOCUMENTS:
${docContent}

WEB RESULTS:
${webContent}

Return JSON with:
{
  "relevant_aspects": ["aspect 1", "aspect 2"],
  "missing_aspects": ["what's not covered"],
  "follow_up_queries": ["query to fill gap 1", "query to fill gap 2"]
}`;

  try {
    const response = await callLLM(
      [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      [],
      config
    );
    const parsed = JSON.parse(response.content || "{}");
    return {
      relevant: chunks,
      missingAspects: parsed.missing_aspects || [],
      followUpQueries: parsed.follow_up_queries || [],
    };
  } catch {
    return { relevant: chunks, missingAspects: [], followUpQueries: [] };
  }
}

/**
 * Synthesizes information from multiple sources into a coherent research response.
 */
export async function synthesizeResults(
  query: string,
  chunks: RetrievedChunk[],
  webResults: WebResult[],
  config: AgentConfig
): Promise<string> {
  const system = `You are a senior consultant synthesizing research. Create a coherent narrative from multiple sources.`;

  const docSources = chunks.slice(0, 8).map((c, i) =>
    `[Doc ${i + 1}: ${c.fileName} | Slide ${c.page}]\n${c.text.slice(0, 600)}`
  ).join("\n\n---\n\n");

  const webSources = webResults.slice(0, 5).map((r, i) =>
    `[Web ${i + 1}: ${r.title}]\n${r.content?.slice(0, 400) || r.url}`
  ).join("\n\n---\n\n");

  const user = `Create a coherent research synthesis answering: "${query}"

DOCUMENTS:
${docSources}

WEB RESULTS:
${webSources}

Provide a structured synthesis with:
1. Key findings
2. Supporting evidence (cite sources)
3. Any gaps or caveats
4. Recommendations if applicable`;

  try {
    const response = await callLLM(
      [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      [],
      config
    );
    return response.content || "Unable to synthesize results.";
  } catch {
    return "Synthesis failed. Please review sources manually.";
  }
}

/**
 * Full agentic RAG pipeline: decompose → retrieve → verify → synthesize
 */
export async function agenticRAG(
  query: string,
  config: AgentConfig,
  sourceKey = "agentic-rag"
): Promise<{
  chunks: RetrievedChunk[];
  webResults: WebResult[];
  synthesis: string;
  log: AgentLogEntry[];
  decomposition: string[];
  verification: { missingAspects: string[]; followUpQueries: string[] };
}> {
  const log: AgentLogEntry[] = [];

  // Step 1: Decompose query
  const subQueries = await decomposeQuery(query, config);
  log.push({ iteration: 1, tool: "decompose", query, found: subQueries.length });

  // Step 2: Search with sub-queries (using existing search)
  const allChunks: RetrievedChunk[] = [];
  const allWeb: WebResult[] = [];

  for (const sq of subQueries) {
    const result = await runAgent(sq, config, sourceKey);
    allChunks.push(...result.chunks);
    allWeb.push(...result.webResults);
    log.push(...result.log.map((l: AgentLogEntry) => ({ ...l, iteration: l.iteration + 1 })));
  }

  // Deduplicate
  const seenChunkIds = new Set<string>();
  const uniqueChunks = allChunks.filter(c => {
    if (seenChunkIds.has(c.id)) return false;
    seenChunkIds.add(c.id);
    return true;
  });

  const seenUrls = new Set<string>();
  const uniqueWeb = allWeb.filter(r => {
    if (seenUrls.has(r.url)) return false;
    seenUrls.add(r.url);
    return true;
  });

  // Step 3: Verify relevance
  const verification = await verifyContentRelevance(query, uniqueChunks, uniqueWeb, config);
  log.push({ iteration: log.length + 1, tool: "verify", query: "relevance check", found: verification.missingAspects.length });

  // Step 4: Follow-up if gaps
  let finalChunks = uniqueChunks;
  let finalWeb = uniqueWeb;

  if (verification.followUpQueries.length > 0) {
    for (const fq of verification.followUpQueries.slice(0, 2)) {
      const followResult = await runAgent(fq, config, sourceKey);
      finalChunks.push(...followResult.chunks.filter((c: RetrievedChunk) => !seenChunkIds.has(c.id)));
      finalWeb.push(...followResult.webResults.filter((r: WebResult) => !seenUrls.has(r.url)));
      log.push({ iteration: log.length + 1, tool: "follow-up", query: fq, found: followResult.chunks.length });
    }
  }

  // Step 5: Synthesize
  const synthesis = await synthesizeResults(query, finalChunks, finalWeb, config);

  return {
    chunks: finalChunks.slice(0, 10),
    webResults: finalWeb.slice(0, 5),
    synthesis,
    log,
    decomposition: subQueries,
    verification,
  };
}
