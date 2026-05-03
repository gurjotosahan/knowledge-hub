import { NextRequest, NextResponse } from "next/server";
import { loadIndex } from "@/lib/rag/indexer";
import { retrieve } from "@/lib/rag/retriever";
import { fetchFileParents } from "@/lib/rag/store";
import {
  runAgent,
  getEmbedding,
  searchWeb,
  type AgentConfig,
  type WebResult,
} from "@/lib/rag/agent";
import type { RetrievedChunk } from "@/lib/rag/retriever";
import type { ServiceLine } from "@/types";

export const maxDuration = 300;

interface QueryBody {
  query: string;
  conversationHistory?: { role: string; content: string }[];
  sourceKey?: string;
  folderPath?: string;
  aiProvider: "ollama" | "openrouter" | "gemini";
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaEmbedModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  embeddingProvider?: "ollama" | "google";
  searchMode?: "rag" | "mixed";
  tavilyApiKey?: string;
}

interface AICitation {
  sourceType?: "rag" | "web";
  file?: string;
  slide?: number;
  url?: string;
  title?: string;
  excerpt?: string;
}

interface AIResponse {
  answer: string;
  keyPoints: string[];
  metrics: string[];
  citations: AICitation[];
}

// ── System prompts ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a presales knowledge assistant helping sales engineers and bid teams win deals. Your job is to surface the most persuasive, reusable content from internal RFPs, POVs, and case studies.

Respond with ONLY valid JSON — no markdown fences, no text outside the JSON:
{
  "answer": "2-4 sentence executive summary of what the documents say about this topic, written in client-ready language",
  "keyPoints": [
    "Reusable bullet point suitable for a proposal or capability deck",
    "Another win theme or differentiator pulled from the documents"
  ],
  "metrics": [
    "Specific quantified outcome, e.g. '40% reduction in processing time for a tier-1 bank'",
    "Another concrete proof point with a number or percentage"
  ],
  "citations": [
    {"file": "exact_filename.ext", "slide": 3, "excerpt": "brief verbatim quote that supports a claim above"}
  ]
}

Rules:
- "answer" must be polished prose a presales lead could paste into an executive summary
- "keyPoints" are client-ready bullets (capability statements, differentiators, win themes) — 2-5 items
- "metrics" are ONLY hard numbers/percentages/timelines from the documents — omit if none found, do NOT fabricate
- "file" must be the exact filename as provided (including extension)
- "slide" is the page or slide number (integer)
- Only cite chunks that directly support a claim
- If no relevant content exists, set answer to "No relevant content found in the indexed documents." and all arrays to []`;

const MIXED_SYSTEM_PROMPT = `You are a presales knowledge assistant with access to BOTH internal enterprise documents AND live web search results.

Respond with ONLY valid JSON — no markdown fences, no text outside the JSON:
{
  "answer": "2-4 sentence executive summary synthesizing internal documents and web findings",
  "keyPoints": [
    "Client-ready bullet from either internal docs or web"
  ],
  "metrics": [
    "Hard quantified proof point from either source — only real numbers, do NOT fabricate"
  ],
  "citations": [
    {"sourceType": "rag", "file": "exact_filename.ext", "slide": 3, "excerpt": "verbatim quote from internal doc"},
    {"sourceType": "web", "url": "https://example.com", "title": "Page title", "excerpt": "verbatim quote from web result"}
  ]
}

Rules:
- "sourceType" MUST be either "rag" (internal document) or "web" (web search result)
- For rag: include "file" (exact filename) and "slide" (page/slide number)
- For web: include "url" and "title" — never include "file" or "slide"
- Prefer internal documents for proprietary metrics and client-specific proof points
- Use web results for market context, industry trends, and public benchmarks
- Synthesize both sources in the answer — do NOT treat them separately
- If no relevant content, set answer to "No relevant content found." and all arrays to []`;

const HYDE_PROMPT = `Write 2-3 sentences from an enterprise consulting proposal or RFP response that directly answers the question below. Include specific metrics, client outcomes, or capability statements. Use formal presales language. Output only the passage, nothing else.

Question: `;

const QUERY_REWRITE_PROMPT = `You are a search query optimizer for an enterprise knowledge base. Given a user's search query, generate 2 alternative phrasings that would retrieve the same relevant documents. Consider:
- Inverting subject/object relationships (e.g. "impact of X on Y" ↔ "Y affected by X" ↔ "X and Y")
- Synonyms and domain-specific terminology
- Abbreviations and full forms

Output ONLY a JSON array of exactly 2 strings. No explanation, no markdown.

User query: `;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

// ── Fallback helpers (used when model doesn't support tool calling) ────────────

async function generateAlternativeQueries(
  query: string,
  body: QueryBody,
  ollamaBase: string
): Promise<string[]> {
  let raw = "";
  try {
    if (body.aiProvider === "ollama") {
      const res = await fetch(`${ollamaBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: body.ollamaModel,
          messages: [{ role: "user", content: QUERY_REWRITE_PROMPT + query }],
          stream: false,
          options: { num_predict: 80, temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(12_000),
      });
      raw = ((await res.json()).message?.content ?? "").trim();
    } else {
      const [url, authHeader, model] =
        body.aiProvider === "gemini"
          ? [`${GEMINI_BASE}/chat/completions`, `Bearer ${body.geminiApiKey}`, body.geminiModel]
          : ["https://openrouter.ai/api/v1/chat/completions", `Bearer ${body.openrouterApiKey}`, body.openrouterModel];
      const res = await fetch(url!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader ?? "",
          ...(body.aiProvider === "openrouter" && {
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Apexon Knowledge Hub",
          }),
        },
        body: JSON.stringify({ model, messages: [{ role: "user", content: QUERY_REWRITE_PROMPT + query }], max_tokens: 80, temperature: 0.2 }),
        signal: AbortSignal.timeout(12_000),
      });
      raw = ((await res.json()).choices?.[0]?.message?.content ?? "").trim();
    }
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === "string").slice(0, 2);
    }
  } catch { /* alternatives are best-effort */ }
  return [];
}

async function generateHypotheticalPassage(
  query: string,
  body: QueryBody,
  ollamaBase: string
): Promise<string> {
  if (body.aiProvider === "ollama") {
    const res = await fetch(`${ollamaBase}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: body.ollamaModel,
        messages: [{ role: "user", content: HYDE_PROMPT + query }],
        stream: false,
        options: { num_predict: 200, temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Ollama HyDE ${res.status}`);
    return ((await res.json()).message?.content ?? "").trim();
  }
  const [url, authHeader, model] =
    body.aiProvider === "gemini"
      ? [`${GEMINI_BASE}/chat/completions`, `Bearer ${body.geminiApiKey}`, body.geminiModel]
      : ["https://openrouter.ai/api/v1/chat/completions", `Bearer ${body.openrouterApiKey}`, body.openrouterModel];
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader ?? "",
      ...(body.aiProvider === "openrouter" && {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Apexon Knowledge Hub",
      }),
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content: HYDE_PROMPT + query }], max_tokens: 200, temperature: 0.3 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HyDE ${res.status}`);
  return ((await res.json()).choices?.[0]?.message?.content ?? "").trim();
}

function crossQueryRRF(resultSets: RetrievedChunk[][], topK: number, k = 60): RetrievedChunk[] {
  const scores = new Map<string, number>();
  const seen   = new Map<string, RetrievedChunk>();
  for (const results of resultSets) {
    for (let rank = 0; rank < results.length; rank++) {
      const chunk = results[rank];
      scores.set(chunk.id, (scores.get(chunk.id) ?? 0) + 1 / (k + rank + 1));
      if (!seen.has(chunk.id)) seen.set(chunk.id, chunk);
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([key]) => seen.get(key)!)
    .filter(Boolean);
}

// ── Main handler ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: QueryBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { query, aiProvider } = body;
  const sourceKey = body.sourceKey ?? body.folderPath ?? "";
  if (!query || !sourceKey) {
    return NextResponse.json({ error: "Missing query or sourceKey" }, { status: 400 });
  }

  // ── 1. Verify index ─────────────────────────────────────────────────────────
  const indexMeta = await loadIndex(sourceKey);
  if (!indexMeta) {
    return NextResponse.json(
      { error: "No search index found. Open Settings and click Build Index first." },
      { status: 404 }
    );
  }

  const ollamaBase    = body.ollamaBaseUrl ?? "http://localhost:11434";
  const embedModel    = body.ollamaEmbedModel ?? indexMeta.embedModel ?? "bge-large";
  const embedProvider = body.embeddingProvider ?? "ollama";
  const googleApiKey  = body.geminiApiKey ?? "";

  const agentConfig: AgentConfig = {
    aiProvider,
    ollamaBaseUrl:    body.ollamaBaseUrl,
    ollamaModel:      body.ollamaModel,
    ollamaEmbedModel: embedModel,
    openrouterApiKey: body.openrouterApiKey,
    openrouterModel:  body.openrouterModel,
    geminiApiKey:     body.geminiApiKey,
    geminiModel:      body.geminiModel,
    embeddingProvider: embedProvider,
    tavilyApiKey:     body.tavilyApiKey,
    searchMode:       body.searchMode,
  };

  // ── 2. Retrieve context — agent first, fallback to hybrid pipeline ──────────
  let contextChunks: RetrievedChunk[];
  let webResults: WebResult[];
  let agentLog: { iteration: number; tool: string; query: string; found: number }[] = [];

  const agentResult = await runAgent(query, agentConfig, sourceKey).catch(() => ({
    chunks: [] as RetrievedChunk[],
    webResults: [] as WebResult[],
    log: [] as { iteration: number; tool: string; query: string; found: number; tokens?: number }[],
    usedAgent: false,
    totalAgentTokens: 0,
  }));

  if (agentResult.usedAgent) {
    // Agent successfully called tools — use its results
    contextChunks = agentResult.chunks.slice(0, 8);
    webResults    = agentResult.webResults;
    agentLog      = agentResult.log;
    console.log(`[Agent] ${agentLog.length} tool calls across ${new Set(agentLog.map(l => l.iteration)).size} iterations, ${contextChunks.length} chunks, ${webResults.length} web results`);
  } else {
    // Fallback: existing HyDE + multi-query hybrid pipeline
    console.log("[Agent] Model doesn't support tool calling — using hybrid fallback");
    const [hypothetical, alternatives] = await Promise.all([
      generateHypotheticalPassage(query, body, ollamaBase).catch(() => ""),
      generateAlternativeQueries(query, body, ollamaBase).catch(() => [] as string[]),
    ]);
    const queryVariants: string[] = [hypothetical || query, ...alternatives];

    const embeddingResults = await Promise.allSettled(
      queryVariants.map((q) => getEmbedding(q, agentConfig))
    );

    const [retrievalResults, fallbackWebResults] = await Promise.all([
      Promise.allSettled(
        queryVariants.map((q, i) => {
          const embResult = embeddingResults[i];
          const emb = embResult.status === "fulfilled" ? embResult.value : null;
          return retrieve(q, emb, sourceKey, 12, i === 0 ? (hypothetical || undefined) : undefined);
        })
      ),
      body.searchMode === "mixed" && body.tavilyApiKey
        ? searchWeb(query, body.tavilyApiKey).catch(() => [] as WebResult[])
        : Promise.resolve([] as WebResult[]),
    ]);

    const allRetrievals = retrievalResults
      .filter((r): r is PromiseFulfilledResult<RetrievedChunk[]> => r.status === "fulfilled")
      .map((r) => r.value);

    contextChunks = crossQueryRRF(allRetrievals, 12).slice(0, 5);
    webResults    = fallbackWebResults;
  }

  // Safety net: if internal search found nothing AND a Tavily key exists, always try web.
  // Fires regardless of searchMode — zero internal results is always a good reason to check the web.
  if (contextChunks.length === 0 && webResults.length === 0 && body.tavilyApiKey) {
    console.log("[Agent] Safety net: zero internal results, falling back to web search");
    webResults = await searchWeb(query, body.tavilyApiKey).catch(() => []);
  }

  if (contextChunks.length === 0 && webResults.length === 0) {
    const hint = body.tavilyApiKey
      ? "No relevant content found in your documents or the web for this query."
      : "No matching documents found. Add a Tavily API key in Settings to also search the internet.";
    return NextResponse.json({ answer: hint, sources: [], documents: [] });
  }

  // ── 3. Build context string ─────────────────────────────────────────────────
  const label = (t: "pdf" | "pptx", n: number) => `${t === "pdf" ? "Page" : "Slide"} ${n}`;

  const docContext = contextChunks.length > 0
    ? contextChunks
        .map((c) => `[INTERNAL DOC: ${c.fileName} | ${label(c.fileType, c.page)}]\n${c.text}`)
        .join("\n\n---\n\n")
    : "";

  const webContext = webResults.length > 0
    ? webResults.map((r) => `[WEB: ${r.title} | ${r.url}]\n${r.content}`).join("\n\n---\n\n")
    : "";

  const fullContext =
    docContext && webContext
      ? `${docContext}\n\n=== LIVE WEB SEARCH RESULTS ===\n\n${webContext}`
      : docContext || webContext;

  const systemPrompt = webResults.length > 0 ? MIXED_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const history = (body.conversationHistory ?? []).slice(-6);
  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: `Document chunks:\n---\n${fullContext}\n---\n\nQuestion: ${query}` },
  ];

  // ── 4. Synthesize — single structured LLM call ──────────────────────────────
  let rawContent: string;
  let synthesisTokens = 0;
  try {
    if (aiProvider === "ollama") {
      const res = await fetch(`${ollamaBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: body.ollamaModel, messages, stream: false, format: "json" }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
      const data = await res.json();
      rawContent = data.message?.content ?? "";
      synthesisTokens = (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0);
    } else {
      const [url, authHeader, model] =
        aiProvider === "gemini"
          ? [`${GEMINI_BASE}/chat/completions`, `Bearer ${body.geminiApiKey}`, body.geminiModel]
          : ["https://openrouter.ai/api/v1/chat/completions", `Bearer ${body.openrouterApiKey}`, body.openrouterModel];

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader ?? "",
          ...(aiProvider === "openrouter" && {
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Apexon Knowledge Hub",
          }),
        },
        body: JSON.stringify({
          model,
          messages,
          // response_format omitted — many OSS models on OpenRouter return empty content when
          // they don't support json_object mode. The system prompt instructs JSON output and
          // extractAIResponse handles all formats (raw JSON, markdown-fenced, partial, etc.)
          ...(aiProvider === "gemini" && { response_format: { type: "json_object" } }),
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        const errBody = await res.text();
        let friendly = `${aiProvider} returned ${res.status}`;
        if (res.status === 429) {
          friendly = aiProvider === "gemini"
            ? "Gemini quota exceeded. Switch to gemini-2.0-flash in Settings or wait for your quota to reset."
            : "Rate limit hit. Please wait a moment and try again.";
        } else if (res.status === 401 || res.status === 403) {
          friendly = "Invalid API key. Check your key in Settings.";
        }
        throw new Error(friendly + (res.status !== 429 ? `\n\nDetails: ${errBody}` : ""));
      }
      const data = await res.json();
      rawContent = data.choices?.[0]?.message?.content
        ?? data.choices?.[0]?.message?.reasoning_content  // some reasoning models put output here
        ?? "";
      synthesisTokens = data.usage?.total_tokens ?? 0;
    }
  } catch (err) {
    return NextResponse.json({ error: `AI request failed: ${err}` }, { status: 502 });
  }

  // ── 5. Parse AI response ────────────────────────────────────────────────────
  function tryParse(s: string): AIResponse | null {
    try {
      const p = JSON.parse(s);
      if (p && typeof p.answer === "string") {
        return {
          answer:    p.answer,
          keyPoints: Array.isArray(p.keyPoints) ? p.keyPoints : [],
          metrics:   Array.isArray(p.metrics)   ? p.metrics   : [],
          citations: Array.isArray(p.citations) ? p.citations : [],
        };
      }
    } catch { /* try next strategy */ }
    return null;
  }

  function extractAIResponse(raw: string): AIResponse {
    const direct = tryParse(raw);
    if (direct) return direct;

    const stripped = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
    const fromStripped = tryParse(stripped);
    if (fromStripped) return fromStripped;

    const lastAnswerIdx = raw.lastIndexOf('"answer"');
    if (lastAnswerIdx !== -1) {
      const objStart = raw.lastIndexOf("{", lastAnswerIdx);
      if (objStart !== -1) {
        let depth = 0, end = -1;
        for (let i = objStart; i < raw.length; i++) {
          if (raw[i] === "{") depth++;
          else if (raw[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end !== -1) {
          const fromSlice = tryParse(raw.slice(objStart, end + 1));
          if (fromSlice) return fromSlice;
        }
      }
    }

    const braceMatches = [...raw.matchAll(/\{/g)].map((m) => m.index!);
    for (const start of braceMatches.reverse()) {
      let depth = 0, end = -1;
      for (let i = start; i < raw.length; i++) {
        if (raw[i] === "{") depth++;
        else if (raw[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end !== -1) {
        const candidate = tryParse(raw.slice(start, end + 1));
        if (candidate) return candidate;
      }
    }

    return { answer: raw.trim() || "No response received.", keyPoints: [], metrics: [], citations: [] };
  }

  const parsed = extractAIResponse(rawContent);

  // ── 6. Citations → Source objects ───────────────────────────────────────────
  const sources = parsed.citations
    .map((c, i) => {
      if (c.sourceType === "web" || c.url) {
        return {
          id: `web-src-${i}`,
          docId: c.url ?? "",
          title: c.title ?? c.url ?? "Web result",
          slide: 0,
          serviceLine: "BFSI" as ServiceLine,
          sourceType: "web" as const,
          url: c.url,
          excerpt: c.excerpt,
        };
      }
      const chunk = contextChunks.find(
        (ch) =>
          ch.fileName.toLowerCase() === c.file?.toLowerCase() ||
          ch.fileName.toLowerCase().includes((c.file ?? "").toLowerCase())
      );
      if (!chunk) return null;
      return {
        id: `local-src-${i}`,
        docId: chunk.fileName,
        title: chunk.fileName.replace(/\.(pdf|pptx)$/i, "").replace(/[-_]/g, " "),
        slide: Math.max(1, c.slide ?? chunk.page),
        serviceLine: "BFSI" as ServiceLine,
        filePath: chunk.filePath,
        fileType: chunk.fileType,
        excerpt: c.excerpt ?? chunk.text.slice(0, 200),
        sourceType: "rag" as const,
      };
    })
    .filter(Boolean);

  // ── 7. Document list ────────────────────────────────────────────────────────
  const seenFiles = new Map<string, (typeof contextChunks)[0]>();
  for (const chunk of contextChunks) {
    if (!seenFiles.has(chunk.fileName)) seenFiles.set(chunk.fileName, chunk);
  }

  const documents = await Promise.all(
    [...seenFiles.values()].map(async (chunk) => {
      const fileChunks = await fetchFileParents(sourceKey, chunk.filePath).catch(() => []);
      const uniquePages = [...new Set(fileChunks.map((c) => c.page))].sort((a, b) => a - b);
      const maxPage = uniquePages[uniquePages.length - 1] ?? 1;
      return {
        id: chunk.fileName,
        title: chunk.fileName.replace(/\.(pdf|pptx)$/i, "").replace(/[-_]/g, " "),
        summary: `${uniquePages.length} ${chunk.fileType === "pdf" ? "pages" : "slides"} · ${chunk.fileType.toUpperCase()}`,
        filePath: chunk.filePath,
        fileType: chunk.fileType,
        totalSlides: maxPage,
        slides: uniquePages.map((page) => ({
          number: page,
          text: fileChunks.filter((c) => c.page === page).map((c) => c.text).join(" "),
        })),
        serviceLine: "BFSI" as ServiceLine,
        type: "RFP" as const,
        tags: [chunk.fileType.toUpperCase()],
      };
    })
  );

  const totalTokens = (agentResult?.usedAgent ? agentResult.totalAgentTokens : 0) + synthesisTokens;

  return NextResponse.json({
    answer: parsed.answer,
    keyPoints: parsed.keyPoints,
    metrics: parsed.metrics,
    sources,
    documents,
    agentLog: agentLog.length ? agentLog : undefined,
    tokenUsage: {
      agentTokens:     agentResult?.usedAgent ? agentResult.totalAgentTokens : 0,
      synthesisTokens,
      totalTokens,
    },
  });
}
