import { retrieve, type RetrievedChunk } from "./retriever";

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

export async function searchWeb(query: string, apiKey: string): Promise<WebResult[]> {
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
  return (data.results ?? []).map((r: { title: string; url: string; content: string }) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: r.content ?? "",
  }));
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

  const canWeb = config.searchMode === "mixed" && Boolean(config.tavilyApiKey);
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

    for (const call of response.tool_calls) {
      let args: Record<string, string>;
      try { args = JSON.parse(call.function.arguments); }
      catch { args = { query }; }

      const q = args.query ?? args.company ?? query;

      if (call.function.name === "search_documents") {
        const emb = await getEmbedding(q, config).catch(() => null);
        const chunks = await retrieve(q, emb, sourceKey, 20).catch(() => [] as RetrievedChunk[]);
        const fresh = chunks.filter((c) => !seenChunkIds.has(c.id));
        fresh.forEach((c) => { seenChunkIds.add(c.id); allChunks.push(c); });

        log.push({ iteration: iter + 1, tool: "search_documents", query: q, found: fresh.length, tokens: tokensPerCall });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: fresh.length
            ? fresh.map((c) => `[${c.fileName} | Slide ${c.page}]\n${c.text}`).join("\n\n---\n\n")
            : "No documents found for this query.",
        });

      } else if (call.function.name === "search_web" && canWeb) {
        const results = await searchWeb(q, config.tavilyApiKey!).catch(() => [] as WebResult[]);
        const fresh = results.filter((r) => !seenWebUrls.has(r.url));
        fresh.forEach((r) => { seenWebUrls.add(r.url); allWebResults.push(r); });

        log.push({ iteration: iter + 1, tool: "search_web", query: q, found: fresh.length, tokens: tokensPerCall });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: fresh.length
            ? fresh.map((r) => `[${r.title} | ${r.url}]\n${r.content}`).join("\n\n---\n\n")
            : "No web results found.",
        });

      } else {
        messages.push({ role: "tool", tool_call_id: call.id, content: "Tool not available." });
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
