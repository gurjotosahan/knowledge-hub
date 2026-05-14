import { NextRequest, NextResponse } from "next/server";
import { loadIndex } from "@/lib/rag/indexer";
import { retrieve } from "@/lib/rag/retriever";
import { fetchFileParents } from "@/lib/rag/store";
import {
  runAgent,
  rerankChunks,
  compressContextChunks,
  getEmbedding,
  searchWeb,
  agenticRAG,
  type AgentConfig,
  type WebResult,
} from "@/lib/rag/agent";
import { resolveAiConfig } from "@/lib/serverConfig";
import { isParallelMcpEnabled } from "@/lib/parallelMcp";
import {
  buildAgentHarnessReport,
  classifyAgentIntent,
  countCitationMarkers,
  type AgentHarnessTraceEntry,
} from "@/lib/agentHarness";
import type { RetrievedChunk } from "@/lib/rag/retriever";
import type { ServiceLine, SlideSearchGroup } from "@/types";

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
  useAgenticRag?: boolean; // Enable agentic RAG pipeline
  uploadedFilePaths?: string[];
  uploadedFileNames?: string[];
  imageDataUrl?: string;
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

const RESPONSE_FRAMEWORK = `Before answering, silently classify the query into exactly one primary category:
1. CAPABILITIES — what we can do, product/service features, differentiators, tech stack, integrations.
2. CASE_STUDIES — customer proof, wins, ROI, references, similar clients, industry outcomes.
3. PROCESS — delivery methodology, engagement model, phases, onboarding, how work gets done.
4. COMPETITIVE — competitors, objections, alternatives, comparisons, battlecards.
5. PRICING — commercials, pricing model, deal structure, ROI/business case, packaging.
6. GTM_ICP — target accounts, personas, verticals, ICP, campaigns, outbound plays.
7. RFP_PROPOSAL — ready-to-paste proposal/RFP answers, boilerplate, compliance responses.

Use the matching response format. Do not mix formats unless the query clearly spans categories; then lead with the primary category and add one short secondary note.

CAPABILITIES format:
- answer: one-line summary, then "Technical depth:" and "Differentiator:" when supported.
- keyPoints: 3-5 concrete key features plus 2-3 related capabilities if available.

CASE_STUDIES format:
- answer: lead with the best match and why it matches.
- keyPoints: snapshot cards written compactly as "Client | Industry | Challenge | Solution | Outcome | Assets available"; if no exact match, state the closest adjacent match and the gap.
- metrics: quantified outcomes only.

PROCESS format:
- answer: process name and context.
- keyPoints: numbered phase breakdown with phase name, what happens, duration, deliverable; include roles, FAQs, and watch-outs only when supported.

COMPETITIVE format:
- answer: competitor named or "General objection", their claimed strength, and our counter-position.
- keyPoints: where we win, where they may win, suggested talk track, trap questions.

PRICING format:
- answer: pricing model summary and value framing.
- keyPoints: packages, deal levers, approval requirements, what not to say.
- metrics: ROI/payback/cost figures only when sourced.

GTM_ICP format:
- answer: target profile and recommended play.
- keyPoints: primary persona, secondary persona, qualifying signals, disqualifying signals, messaging hook.

RFP_PROPOSAL format:
- answer: direct third-person answer ready to paste, plus short/standard/extended variants when requested or useful.
- keyPoints: key claims to verify, related sections, compliance notes.

General response rules:
- Never fabricate facts, numbers, case study details, pricing, certifications, or claims.
- If the knowledge base does not contain the information, say so clearly and suggest the closest place/person to verify if evident from context.
- Lead with the answer, not background.
- Avoid generic filler phrases and marketing adjectives unless backed by a specific sourced claim.`;

const SYSTEM_PROMPT = `You are an intelligent Knowledge Management assistant built for Sales, PreSales, and Go-to-Market teams. Your job is to retrieve, synthesize, and present knowledge in the most actionable format for the person asking.

${RESPONSE_FRAMEWORK}

Respond with ONLY valid JSON — no markdown fences, no text outside the JSON:
{
  "answer": "category-formatted answer with inline citation markers like [1] or [2] placed immediately after each supported claim",
  "keyPoints": [
    "category-specific supporting bullet from the selected format"
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
- Insert inline citation markers [1], [2], [3], etc. directly after each claim in "answer" — the number maps to the 1-based index of the citation in the "citations" array
- "metrics" are ONLY hard numbers/percentages/timelines from the documents — omit if none found, do NOT fabricate
- If the question names a client, company, product, or project, answer ONLY from chunks that explicitly mention that named entity OR from slides/pages in a deck/file whose overall content or filename establishes that entity as the client/prospect
- Do NOT use proof points from other clients/entities as analogies or filler for a named-entity question
- Keep "keyPoints" factual and source-specific; omit generic capability bullets that are not directly supported by the cited chunks
- Never mention implementation terms like "document chunks", "chunks", "retrieved context", "context window", or "knowledge base excerpts" in the answer
- "file" must be the exact filename as provided (including extension)
- "slide" is the page or slide number (integer)
- Only cite chunks that directly support a claim
- If no relevant content exists, set answer to "No relevant content found in the indexed documents." and all arrays to []`;

const MIXED_SYSTEM_PROMPT = `You are an intelligent Knowledge Management assistant built for Sales, PreSales, and Go-to-Market teams with access to BOTH internal enterprise documents AND live web search results.

${RESPONSE_FRAMEWORK}

Respond with ONLY valid JSON — no markdown fences, no text outside the JSON:
{
  "answer": "category-formatted answer synthesizing internal documents and web findings, with inline citation markers like [1] or [2] placed immediately after each supported claim",
  "keyPoints": [
    "category-specific supporting bullet from either internal docs or web"
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
- Insert inline citation markers [1], [2], [3], etc. directly after each claim in "answer" — the number maps to the 1-based index of the citation in the "citations" array
- Prefer internal documents for proprietary metrics and client-specific proof points
- Use web results for market context, industry trends, and public benchmarks
- Synthesize both sources in the answer — do NOT treat them separately
- If the question names a client, company, product, or project, answer ONLY from sources that explicitly mention that named entity OR from slides/pages in a deck/file whose overall content or filename establishes that entity as the client/prospect
- Do NOT use proof points from other clients/entities as analogies or filler for a named-entity question
- Keep "keyPoints" factual and source-specific; omit generic capability bullets that are not directly supported by the cited sources
- Never mention implementation terms like "document chunks", "chunks", "retrieved context", "context window", or "knowledge base excerpts" in the answer
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

const ENTITY_STOPWORDS = new Set([
  "AI", "API", "ROI", "RFP", "POV", "PPTX", "PDF", "LLM", "ML", "GenAI", "Apexon",
]);

function normalizeEntityToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function extractEntityTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const match of query.matchAll(/\b[A-Z][A-Z0-9&.-]{2,}\b/g)) {
    const term = match[0].replace(/[?.!,;:]+$/g, "");
    if (!ENTITY_STOPWORDS.has(term)) terms.add(term);
  }
  for (const match of query.matchAll(/\b(?:for|from|about|at|with|as|by)\s+([A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,3})/g)) {
    const phrase = match[1].replace(/[?.!,;:]+$/g, "").trim();
    if (!ENTITY_STOPWORDS.has(phrase)) terms.add(phrase);
  }
  return [...terms];
}

function mentionsEntity(text: string, entity: string): boolean {
  const normalizedText = normalizeEntityToken(text);
  const normalizedEntity = normalizeEntityToken(entity);
  return normalizedEntity.length > 1 && normalizedText.includes(normalizedEntity);
}

function filterByNamedEntities<T extends { fileName?: string; title?: string; filePath?: string; text?: string; content?: string }>(
  items: T[],
  entityTerms: string[]
): T[] {
  if (entityTerms.length === 0) return items;
  const filtered = items.filter((item) => {
    const haystack = [item.fileName, item.title, item.filePath, item.text, item.content].filter(Boolean).join(" ");
    return entityTerms.some((entity) => mentionsEntity(haystack, entity));
  });
  return filtered.length > 0 ? filtered : [];
}

async function filterChunksByNamedEntitiesWithDeckContext(
  chunks: RetrievedChunk[],
  entityTerms: string[],
  sourceKey: string
): Promise<RetrievedChunk[]> {
  if (entityTerms.length === 0) return chunks;

  const deckEntityCache = new Map<string, boolean>();
  const matchesDeckContext = async (chunk: RetrievedChunk): Promise<boolean> => {
    const fileScope = [chunk.fileName, chunk.filePath].filter(Boolean).join(" ");
    if (entityTerms.some((entity) => mentionsEntity(fileScope, entity))) return true;

    const cached = deckEntityCache.get(chunk.filePath);
    if (cached !== undefined) return cached;

    const fileChunks = await fetchFileParents(sourceKey, chunk.filePath).catch(() => []);
    const fullDeckText = [
      chunk.fileName,
      chunk.filePath,
      ...fileChunks.map((c) => c.text),
    ].join(" ");
    const deckMatches = entityTerms.some((entity) => mentionsEntity(fullDeckText, entity));
    deckEntityCache.set(chunk.filePath, deckMatches);
    return deckMatches;
  };

  const checks = await Promise.all(chunks.map(async (chunk) => {
    const localContext = [chunk.fileName, chunk.filePath, chunk.text].filter(Boolean).join(" ");
    const directMatch = entityTerms.some((entity) => mentionsEntity(localContext, entity));
    return directMatch || await matchesDeckContext(chunk);
  }));

  return chunks.filter((_, index) => checks[index]);
}

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
            "X-Title": "Apexon KM360",
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
        "X-Title": "Apexon KM360",
      }),
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content: HYDE_PROMPT + query }], max_tokens: 200, temperature: 0.3 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HyDE ${res.status}`);
  return ((await res.json()).choices?.[0]?.message?.content ?? "").trim();
}

function deterministicQueryVariants(query: string): string[] {
  const lower = query.toLowerCase();
  const variants: string[] = [];
  const wantsBanking = /\b(bank|banking|bfsi|financial services|finance)\b/.test(lower);
  const wantsCapabilities = /\b(capability|capabilities|competenc(?:y|ies)|expertise|offering|offerings)\b/.test(lower);

  if (wantsBanking && wantsCapabilities) {
    variants.push(
      "banking practice confluence technology domain",
      "banking practice credentials financial services",
      "BFSI domain technology banking practice capabilities"
    );
  }

  if (wantsCapabilities) {
    variants.push(
      query.replace(/\bcapabilit(?:y|ies)\b/gi, "practice credentials"),
      query.replace(/\bcapabilit(?:y|ies)\b/gi, "domain expertise offerings")
    );
  }

  return variants.filter((variant, index, arr) => variant.trim() && arr.indexOf(variant) === index);
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

function buildSlideGroupsFromChunks(chunks: RetrievedChunk[], intent: string): SlideSearchGroup[] {
  if (intent !== "find_assets") return [];
  const localServeUrl = (filePath?: string) => filePath ? `/api/local/serve?path=${encodeURIComponent(filePath)}` : undefined;
  const pptChunks = chunks.filter((chunk) => chunk.fileType === "pptx").slice(0, 12);
  const byFile = new Map<string, RetrievedChunk[]>();
  for (const chunk of pptChunks) {
    const existing = byFile.get(chunk.filePath) ?? [];
    existing.push(chunk);
    byFile.set(chunk.filePath, existing);
  }
  return [...byFile.entries()].map(([filePath, fileChunks]) => ({
    filePath,
    fileTitle: fileChunks[0].fileName.replace(/\.pptx$/i, "").replace(/[-_]/g, " "),
    fileType: "pptx" as const,
    slides: fileChunks.slice(0, 5).map((chunk) => ({
      slideNumber: chunk.page,
      reason: "Matched by unified Knowledge Search retrieval.",
      excerpt: chunk.text.slice(0, 320),
      score: chunk.score,
      confidence: (chunk.score ?? 0) > 0.75 ? "High" as const : "Medium" as const,
      thumbnailUrl: localServeUrl(chunk.thumbnailPath),
      previewPdfUrl: localServeUrl(chunk.previewPdfPath),
      previewStatus: chunk.previewStatus,
    })),
  }));
}

function sourcesWillBeEmpty(citations: AICitation[]): boolean {
  return citations.length === 0;
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
  const intent = classifyAgentIntent(query);
  const entityTerms = extractEntityTerms(query);
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

  const agentConfig: AgentConfig = resolveAiConfig({
    ...body,
    ollamaEmbedModel: body.ollamaEmbedModel ?? indexMeta.embedModel,
  });
  const resolvedBody: QueryBody = {
    ...body,
    ollamaBaseUrl:     agentConfig.ollamaBaseUrl,
    ollamaModel:       agentConfig.ollamaModel,
    ollamaEmbedModel:  agentConfig.ollamaEmbedModel,
    openrouterApiKey:  agentConfig.openrouterApiKey,
    openrouterModel:   agentConfig.openrouterModel,
    geminiApiKey:      agentConfig.geminiApiKey,
    geminiModel:       agentConfig.geminiModel,
    embeddingProvider: agentConfig.embeddingProvider,
    tavilyApiKey:      agentConfig.tavilyApiKey,
  };
  const ollamaBase = agentConfig.ollamaBaseUrl ?? "http://localhost:11434";

  if (aiProvider === "openrouter" && !resolvedBody.openrouterApiKey) {
    return NextResponse.json(
      { error: "Missing OPENROUTER_API_KEY in .env.local. Add the key, then restart the Next.js dev server." },
      { status: 400 }
    );
  }
  if (aiProvider === "gemini" && !resolvedBody.geminiApiKey) {
    return NextResponse.json(
      { error: "Missing GEMINI_API_KEY or GOOGLE_API_KEY in .env.local. Add the key, then restart the Next.js dev server." },
      { status: 400 }
    );
  }

  // ── 2. Retrieve context — agent first, fallback to hybrid pipeline ──────────
  let contextChunks: RetrievedChunk[] = [];
  let webResults: WebResult[] = [];
  let agentLog: { iteration: number; tool: string; query: string; found: number }[] = [];
  let agenticSynthesis: string | undefined;
  let usedAgent = false;
  let agentTokens = 0;
  let fallbackCount = 0;
  const harnessTrace: AgentHarnessTraceEntry[] = [
    { step: "intent", tool: "intent_classifier", query, found: 1, status: "ok", note: intent },
  ];

  // Use Agentic RAG if requested
  if (body.useAgenticRag) {
    console.log("[Agentic RAG] Using enhanced pipeline with decomposition + verification + synthesis");
    const agenticResult = await agenticRAG(query, agentConfig).catch(() => null);

    if (agenticResult) {
      const filteredChunks = await filterChunksByNamedEntitiesWithDeckContext(agenticResult.chunks, entityTerms, sourceKey);
      contextChunks = await rerankChunks(query, filteredChunks, agentConfig, 8);
      webResults = filterByNamedEntities(agenticResult.webResults, entityTerms);
      agentLog = agenticResult.log;
      agenticSynthesis = agenticResult.synthesis;
      usedAgent = true;
      agentTokens = agenticResult.log.length * 100; // Estimate
      console.log(`[Agentic RAG] ${agenticResult.decomposition.length} sub-queries, ${contextChunks.length} chunks, ${webResults.length} web`);
      harnessTrace.push({
        step: "retrieve",
        tool: "agentic_rag",
        query,
        found: contextChunks.length + webResults.length,
        status: "ok",
        note: `${agenticResult.decomposition.length} decomposed queries`,
      });
    } else {
      console.log("[Agentic RAG] Failed, falling back to standard agent");
      fallbackCount++;
      harnessTrace.push({ step: "retrieve", tool: "agentic_rag", query, found: 0, status: "fallback", note: "Agentic RAG failed; standard retrieval used." });
    }
  }

  // Standard agent (only runs when the heavier agentic workflow is explicitly enabled).
  // Normal Knowledge Search uses the faster hybrid retrieval path below.
  if (body.useAgenticRag && contextChunks.length === 0) {
    const agentResult = await runAgent(query, agentConfig, sourceKey).catch(() => ({
      chunks: [] as RetrievedChunk[],
      webResults: [] as WebResult[],
      log: [] as { iteration: number; tool: string; query: string; found: number; tokens?: number }[],
      usedAgent: false,
      totalAgentTokens: 0,
    }));

    if (agentResult.usedAgent) {
      const rawAgentChunks = await filterChunksByNamedEntitiesWithDeckContext(agentResult.chunks, entityTerms, sourceKey);
      rawAgentChunks.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      contextChunks = await rerankChunks(query, rawAgentChunks, agentConfig, 8);
      webResults = filterByNamedEntities(agentResult.webResults, entityTerms);
      agentLog = agentResult.log;
      usedAgent = true;
      agentTokens = agentResult.totalAgentTokens;
      console.log(`[Agent] ${agentLog.length} tool calls, ${contextChunks.length} chunks, ${webResults.length} web`);
      harnessTrace.push({ step: "retrieve", tool: "standard_agent", query, found: contextChunks.length + webResults.length, status: "ok" });
    }
  }

  if (contextChunks.length === 0 && webResults.length === 0) {
    console.log(body.useAgenticRag ? "[Agent] Agent path empty — using hybrid fallback" : "[Search] Using fast hybrid retrieval");
    const [hypothetical, alternatives] = await Promise.all([
      generateHypotheticalPassage(query, resolvedBody, ollamaBase).catch(() => ""),
      generateAlternativeQueries(query, resolvedBody, ollamaBase).catch(() => [] as string[]),
    ]);
    const queryVariants: string[] = [...new Set([query, ...deterministicQueryVariants(query), hypothetical, ...alternatives].filter(Boolean))];

    const embeddingResults = await Promise.allSettled(
      queryVariants.map((q) => getEmbedding(q, agentConfig))
    );

    const [retrievalResults, fallbackWebResults] = await Promise.all([
      Promise.allSettled(
        queryVariants.map((q, i) => {
          const embResult = embeddingResults[i];
          const emb = embResult.status === "fulfilled" ? embResult.value : null;
          return retrieve(q, emb, sourceKey, 16, i === 0 ? (hypothetical || undefined) : undefined);
        })
      ),
      resolvedBody.searchMode === "mixed" && (resolvedBody.tavilyApiKey || isParallelMcpEnabled())
        ? searchWeb(query, resolvedBody.tavilyApiKey).catch(() => [] as WebResult[])
        : Promise.resolve([] as WebResult[]),
    ]);

    const allRetrievals = retrievalResults
      .filter((r): r is PromiseFulfilledResult<RetrievedChunk[]> => r.status === "fulfilled")
      .map((r) => r.value);

    const rawFallbackChunks = await filterChunksByNamedEntitiesWithDeckContext(crossQueryRRF(allRetrievals, 18), entityTerms, sourceKey);
    contextChunks = await rerankChunks(query, rawFallbackChunks, agentConfig, 12);
    webResults = filterByNamedEntities(fallbackWebResults, entityTerms);
    harnessTrace.push({
      step: "retrieve",
      tool: "hybrid_rag",
      query,
      found: contextChunks.length + webResults.length,
      status: body.useAgenticRag ? "fallback" : "ok",
      note: body.useAgenticRag ? "Agent path unavailable; used HyDE + multi-query retrieval." : "Fast retrieval path used.",
    });
  }

  // Safety net: if internal search found nothing AND web search is available, always try web.
  // Fires regardless of searchMode — zero internal results is always a good reason to check the web.
  if (contextChunks.length === 0 && webResults.length === 0 && (resolvedBody.tavilyApiKey || isParallelMcpEnabled())) {
    console.log("[Agent] Safety net: zero internal results, falling back to web search");
    webResults = filterByNamedEntities(
      await searchWeb(query, resolvedBody.tavilyApiKey).catch(() => []),
      entityTerms
    );
    fallbackCount++;
    harnessTrace.push({ step: "retrieve", tool: "web_safety_net", query, found: webResults.length, status: "fallback", note: "No internal results; used web safety net." });
  }

  const uploadedFilePaths = (body.uploadedFilePaths ?? []).filter((path): path is string => typeof path === "string" && path.length > 0);
  const uploadedFileNames = (body.uploadedFileNames ?? []).filter((name): name is string => typeof name === "string" && name.length > 0);
  if (uploadedFilePaths.length > 0) {
    const uploadedParents = (await Promise.all(
      uploadedFilePaths.map((filePath) => fetchFileParents(sourceKey, filePath).catch(() => []))
    )).flat();
    const uploadedChunks: RetrievedChunk[] = uploadedParents.map((chunk, index) => ({
      ...chunk,
      score: 10_000 - index,
    }));
    const existingIds = new Set(uploadedChunks.map((chunk) => chunk.id));
    contextChunks = [
      ...uploadedChunks,
      ...contextChunks.filter((chunk) => !existingIds.has(chunk.id)),
    ].slice(0, Math.max(12, uploadedChunks.length));
  }

  if (contextChunks.length === 0 && webResults.length === 0) {
    const hint = entityTerms.length
      ? `No relevant content found that explicitly mentions ${entityTerms.join(", ")}.`
      : resolvedBody.tavilyApiKey
      ? "No relevant content found in your documents or the web for this query."
      : "No matching documents found. Add a Tavily API key in Settings to also search the internet.";
    return NextResponse.json({ answer: hint, sources: [], documents: [] });
  }

  // ── 3. Compress chunks, then build context string ───────────────────────────
  const label = (t: "pdf" | "pptx" | "docx", n: number) =>
    `${t === "pdf" ? "Page" : t === "pptx" ? "Slide" : "Section"} ${n}`;

  // Compress: query-aware sentence extraction + same-page dedup.
  // contextChunks keeps original metadata for citations; compressed chunks feed the LLM.
  const compressedChunks = compressContextChunks(query, contextChunks);

  const docContext = compressedChunks.length > 0
    ? compressedChunks
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
  const imageDataUrl = body.imageDataUrl ?? null;

  const userText = `Source excerpts for grounding:\n---\n${fullContext}\n---\n\n${imageDataUrl ? "The user has attached an image (screenshot or diagram). Analyze it alongside the document excerpts to answer the question.\n\n" : ""}${uploadedFileNames.length ? `Uploaded document instruction: The user has attached/uploaded these document(s) for this request: ${uploadedFileNames.join(", ")}. Treat the excerpts from these uploaded files as the provided document content. If the user asks to analyze "this document", "this RFP", or "the uploaded document", analyze these uploaded files directly instead of saying no document was provided.\n\n` : ""}${entityTerms.length ? `Named entity constraint: Use evidence that explicitly mentions ${entityTerms.join(", ")} OR evidence from a deck/file whose overall context establishes ${entityTerms.join(", ")} as the client/prospect. Do not use proof points from unrelated clients. If the provided source excerpts do not answer the question for that entity, return no relevant content.\n\n` : ""}Question: ${query}`;

  const userContent = imageDataUrl
    ? [
        { type: "image_url", image_url: { url: imageDataUrl } },
        { type: "text", text: userText },
      ]
    : userText;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userContent },
  ];

  // ── 4. Synthesize — single structured LLM call ──────────────────────────────
  let rawContent: string;
  let synthesisTokens = 0;

  function isTimeoutError(err: unknown): boolean {
    const text = String(err);
    return text.includes("TimeoutError") || text.includes("aborted due to timeout") || text.includes("The operation was aborted");
  }

  function isRateLimitError(err: unknown): boolean {
    const text = String(err).toLowerCase();
    return text.includes("rate limit") || text.includes("quota exceeded") || text.includes("429");
  }

  function fallbackSynthesis(reason = "The full AI synthesis did not complete"): AIResponse {
    const docCitations = contextChunks.slice(0, 3).map((chunk) => ({
      sourceType: "rag" as const,
      file: chunk.fileName,
      slide: chunk.page,
      excerpt: chunk.text.slice(0, 260),
    }));
    const webCitations = webResults.slice(0, 2).map((result) => ({
      sourceType: "web" as const,
      url: result.url,
      title: result.title,
      excerpt: result.content.slice(0, 260),
    }));
    const citations = [...docCitations, ...webCitations];
    const keyPoints = [
      ...contextChunks.slice(0, 3).map((chunk) => `${chunk.fileName} ${label(chunk.fileType, chunk.page)}: ${chunk.text.replace(/\s+/g, " ").slice(0, 220)}`),
      ...webResults.slice(0, 2).map((result) => `${result.title}: ${result.content.replace(/\s+/g, " ").slice(0, 220)}`),
    ];

    return {
      answer: citations.length
        ? `${reason}, but these are the strongest retrieved internal and web signals for the request. Use the source links below to inspect the evidence directly.`
        : `${reason}, and no relevant source evidence was available.`,
      keyPoints,
      metrics: [],
      citations,
    };
  }

  try {
    if (aiProvider === "ollama") {
      const res = await fetch(`${ollamaBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: resolvedBody.ollamaModel, messages, stream: false, format: "json", options: { num_predict: 2048 } }),
        signal: AbortSignal.timeout(75_000),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
      const data = await res.json();
      rawContent = data.message?.content ?? "";
      synthesisTokens = (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0);
    } else {
      const [url, authHeader, model] =
        aiProvider === "gemini"
          ? [`${GEMINI_BASE}/chat/completions`, `Bearer ${resolvedBody.geminiApiKey}`, resolvedBody.geminiModel]
          : ["https://openrouter.ai/api/v1/chat/completions", `Bearer ${resolvedBody.openrouterApiKey}`, resolvedBody.openrouterModel];

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader ?? "",
          ...(aiProvider === "openrouter" && {
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Apexon KM360",
          }),
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 2048,
          // response_format omitted — many OSS models on OpenRouter return empty content when
          // they don't support json_object mode. The system prompt instructs JSON output and
          // extractAIResponse handles all formats (raw JSON, markdown-fenced, partial, etc.)
          ...(aiProvider === "gemini" && { response_format: { type: "json_object" } }),
        }),
        signal: AbortSignal.timeout(35_000),
      });
      if (!res.ok) {
        const errBody = await res.text();
        let friendly = `${aiProvider} returned ${res.status}`;
        if (res.status === 429) {
          friendly = aiProvider === "gemini"
            ? "Gemini quota exceeded. Switch to gemini-2.0-flash in Settings or wait for your quota to reset."
            : "Rate limit hit. Please wait a moment and try again.";
        } else if (res.status === 401 || res.status === 403) {
          friendly = aiProvider === "gemini"
            ? "Invalid Gemini API key. Check GEMINI_API_KEY or GOOGLE_API_KEY in .env.local, then restart the dev server."
            : "Invalid OpenRouter API key. Check OPENROUTER_API_KEY in .env.local, then restart the dev server.";
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
    if (isTimeoutError(err)) {
      rawContent = JSON.stringify(fallbackSynthesis("The full AI synthesis timed out"));
      fallbackCount++;
      harnessTrace.push({ step: "synthesis", tool: "llm_synthesis", query, found: 0, status: "fallback", note: "Timed out; returned retrieved source evidence." });
    } else if (isRateLimitError(err)) {
      rawContent = JSON.stringify(fallbackSynthesis("The selected model hit a rate limit"));
      fallbackCount++;
      harnessTrace.push({ step: "synthesis", tool: "llm_synthesis", query, found: 0, status: "fallback", note: "Rate limited; returned retrieved source evidence." });
    } else {
      return NextResponse.json({ error: `AI request failed: ${err}` }, { status: 502 });
    }
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
  const slideGroupsFromAnswer: SlideSearchGroup[] = buildSlideGroupsFromChunks(contextChunks, intent);
  const harnessWarnings = [
    ...(harnessTrace.some((entry) => entry.step === "synthesis" && entry.status === "fallback") ? ["Model synthesis did not complete; response is source-evidence fallback."] : []),
    ...(sourcesWillBeEmpty(parsed.citations) && contextChunks.length > 0 ? ["Model citations could not be mapped cleanly to retrieved internal sources."] : []),
    ...(intent === "find_assets" && slideGroupsFromAnswer.length === 0 ? ["Query looks asset/slide-oriented but no PPTX slide candidates were found in answer retrieval."] : []),
  ];

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
        title: chunk.fileName.replace(/\.(pdf|pptx|docx)$/i, "").replace(/[-_]/g, " "),
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
        title: chunk.fileName.replace(/\.(pdf|pptx|docx)$/i, "").replace(/[-_]/g, " "),
        summary: `${uniquePages.length} ${chunk.fileType === "pdf" ? "pages" : chunk.fileType === "pptx" ? "slides" : "sections"} · ${chunk.fileType.toUpperCase()}`,
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

  const totalTokens = agentTokens + synthesisTokens;
  const toolsUsed = [
    usedAgent ? "agentic_or_standard_agent" : "hybrid_rag",
    ...(webResults.length ? ["web_search"] : []),
    ...(slideGroupsFromAnswer.length ? ["slide_search"] : []),
    "synthesis",
  ];
  const harness = buildAgentHarnessReport({
    intent,
    toolsUsed,
    retrievedItems: contextChunks.length + webResults.length + slideGroupsFromAnswer.reduce((sum, group) => sum + group.slides.length, 0),
    evidenceRefs: countCitationMarkers(parsed.answer) || parsed.citations.length,
    fallbacks: fallbackCount,
    warnings: harnessWarnings,
    agentTrace: [
      ...harnessTrace,
      ...agentLog.map((entry) => ({
        step: "tool",
        tool: entry.tool,
        query: entry.query,
        found: entry.found,
        status: "ok" as const,
      })),
      ...(slideGroupsFromAnswer.length ? [{ step: "retrieve", tool: "slide_search", query, found: slideGroupsFromAnswer.reduce((sum, group) => sum + group.slides.length, 0), status: "ok" as const }] : []),
    ],
  });

  return NextResponse.json({
    answer: parsed.answer,
    keyPoints: parsed.keyPoints,
    metrics: parsed.metrics,
    sources,
    documents,
    slideGroups: slideGroupsFromAnswer,
    harness,
    agentLog: agentLog.length ? agentLog : undefined,
    tokenUsage: {
      agentTokens: usedAgent ? agentTokens : 0,
      synthesisTokens,
      totalTokens,
    },
  });
}
