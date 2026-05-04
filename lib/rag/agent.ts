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
        const chunks = await retrieve(q, emb, sourceKey, 8).catch(() => [] as RetrievedChunk[]);
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

    // Stop early once we have substantial context
    if (allChunks.length >= 6) break;
  }

  return {
    chunks: allChunks,
    webResults: allWebResults,
    log,
    usedAgent: log.length > 0,
    totalAgentTokens,
  };
}
