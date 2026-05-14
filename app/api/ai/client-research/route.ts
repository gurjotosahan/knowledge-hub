import { NextRequest, NextResponse } from "next/server";
import { searchWeb } from "@/lib/rag/agent";
import { buildInternalResearchContext } from "@/lib/internalResearchContext";
import { saveResearch } from "@/lib/researchStorage";
import { RESEARCH_SECTIONS } from "@/types/research";
import type { ResearchReference, ResearchSectionDef, SavedResearch, ResearchSectionResult } from "@/types/research";
import type { AgentConfig } from "@/lib/rag/agent";
import { resolveAiConfig } from "@/lib/serverConfig";
import { isParallelMcpEnabled } from "@/lib/parallelMcp";
import { buildAgentHarnessReport, countCitationMarkers } from "@/lib/agentHarness";

export const maxDuration = 300;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

// ── Apexon service catalogue (used in every research prompt) ──────────────────

const APEXON_SERVICES = `
APEXON SERVICE LINES & CAPABILITIES:
1. Digital Engineering — Custom software, web/mobile apps, API development, microservices, cloud-native apps
2. Cloud Services — AWS/Azure/GCP migration, FinOps, cloud modernization, DevSecOps, platform engineering
3. Data & AI — Data strategy, data engineering, analytics, AI/ML, GenAI/LLM solutions, data governance
4. Quality Engineering — Test automation, performance testing, QA transformation, shift-left testing
5. Digital Experience — UX/CX design, Salesforce CRM, ServiceNow ITSM, digital commerce
6. Life Sciences — Clinical data management, regulatory compliance (FDA/EMA), CTMS, EDC, pharmacovigilance
7. BFSI — Core banking modernization, payments, open banking APIs, regulatory reporting, fraud detection
8. Healthcare IT — EHR integration, interoperability (FHIR/HL7), patient engagement, digital health platforms
9. Cybersecurity — Zero trust architecture, cloud security, identity management, compliance (SOC2/HIPAA)
10. Intelligent Automation — RPA, process mining, AI-powered workflow automation
`.trim();

const CURRENT_RESEARCH_YEAR = new Date().getFullYear();
const EARLIEST_DEFAULT_RESEARCH_YEAR = CURRENT_RESEARCH_YEAR - 1;

function normalizeResearchSearchQuery(query: string): string {
  const yearPattern = /\b(20\d{2})\b/g;

  const normalized = query.replace(yearPattern, "").replace(/\s{2,}/g, " ").trim();

  const recencyYears = [CURRENT_RESEARCH_YEAR, EARLIEST_DEFAULT_RESEARCH_YEAR];

  return [normalized, ...recencyYears].filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;

  const start = trimmed.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth++;
    if (char === "}") depth--;
    if (depth === 0) return trimmed.slice(start, i + 1);
  }

  return null;
}

function parseResearchSections(raw: string): ResearchSectionResult[] | null {
  const candidates = [
    raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim(),
    extractJsonObject(raw),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed.sections)) return parsed.sections;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function attachInternalReferences(
  sections: ResearchSectionResult[],
  references: ResearchReference[]
): ResearchSectionResult[] {
  if (!references.length) return sections;

  return sections.map((section) => {
    const cited = [...section.content.matchAll(/\[I(\d+)\]/g)]
      .map((match) => references[Number(match[1]) - 1])
      .filter((ref): ref is ResearchReference => Boolean(ref));

    const sectionRefs = cited.length ? cited : references.slice(0, 5);
    return { ...section, references: sectionRefs };
  });
}

const APEXON_SYSTEM_PROMPT = `You are a senior presales consultant and business intelligence analyst at Apexon — a global IT services and digital engineering company.

Your mission is to build sharp, actionable account intelligence that helps Apexon's GTM and presales teams WIN deals and engage prospects strategically.

${APEXON_SERVICES}

RESEARCH PHILOSOPHY:
- Every insight must answer: "How does this create an opening for Apexon?"
- Map pain points → Apexon service lines explicitly
- Identify the BEST entry point (not the obvious one)
- Think like a hunter, not a librarian
- Today is in ${CURRENT_RESEARCH_YEAR}. Search for ${CURRENT_RESEARCH_YEAR} first, keep ${EARLIEST_DEFAULT_RESEARCH_YEAR} as the oldest default recency year, and avoid older years unless explicitly needed for historical context.

OUTPUT FORMAT: Always respond with valid JSON only — no markdown fences, no text outside JSON.`;

// ── Tool definitions ───────────────────────────────────────────────────────────

const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "search_web",
    description: "Search the web for real-time information about the prospect company. Call multiple times with different queries to build comprehensive intelligence.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: `Specific search query. Be precise and current — e.g. 'JPMorgan Chase cloud migration strategy ${CURRENT_RESEARCH_YEAR} ${EARLIEST_DEFAULT_RESEARCH_YEAR}' not just 'JPMorgan technology'.`,
        },
      },
      required: ["query"],
    },
  },
};

// ── LLM caller with tool support ──────────────────────────────────────────────

type Message = { role: string; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

async function callLLMWithTools(
  messages: Message[],
  tools: object[],
  config: AgentConfig
): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  if (config.aiProvider === "ollama") {
    const ollamaMessages = messages.map((m) => {
      if (m.role === "assistant" && m.tool_calls) {
        return {
          role: "assistant",
          content: m.content ?? "",
          tool_calls: m.tool_calls.map((tc) => ({
            function: {
              name: tc.function.name,
              arguments: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
            },
          })),
        };
      }
      if (m.role === "tool") return { role: "tool", content: m.content ?? "" };
      return { role: m.role, content: m.content ?? "" };
    });

    const res = await fetch(`${config.ollamaBaseUrl ?? "http://localhost:11434"}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.ollamaModel, messages: ollamaMessages, tools: tools.length ? tools : undefined, stream: false }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = await res.json();
    const msg = data.message ?? {};
    return {
      content: msg.content || null,
      tool_calls: msg.tool_calls?.map((tc: { function: { name: string; arguments: unknown } }, i: number) => ({
        id: `call-${i}`,
        type: "function" as const,
        function: { name: tc.function.name, arguments: typeof tc.function.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function.arguments) },
      })),
    };
  }

  const [url, auth, model] =
    config.aiProvider === "gemini"
      ? [`${GEMINI_BASE}/chat/completions`, `Bearer ${config.geminiApiKey}`, config.geminiModel]
      : ["https://openrouter.ai/api/v1/chat/completions", `Bearer ${config.openrouterApiKey}`, config.openrouterModel];

  const res = await fetch(url!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth ?? "",
      ...(config.aiProvider === "openrouter" && { "HTTP-Referer": "http://localhost:3000", "X-Title": "Apexon Knowledge Hub" }),
    },
    body: JSON.stringify({ model, messages, ...(tools.length && { tools, tool_choice: "auto" }) }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${config.aiProvider} ${res.status}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  return { content: msg.content || null, tool_calls: msg.tool_calls ?? undefined };
}

async function callLLMStreamingText(
  messages: Message[],
  config: AgentConfig,
  onDelta: (delta: string) => void
): Promise<string> {
  if (config.aiProvider === "ollama") {
    const res = await fetch(`${config.ollamaBaseUrl ?? "http://localhost:11434"}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.ollamaModel, messages, stream: true }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        const delta = event.message?.content ?? "";
        if (delta) {
          content += delta;
          onDelta(delta);
        }
      }
    }

    return content;
  }

  const [url, auth, model] =
    config.aiProvider === "gemini"
      ? [`${GEMINI_BASE}/chat/completions`, `Bearer ${config.geminiApiKey}`, config.geminiModel]
      : ["https://openrouter.ai/api/v1/chat/completions", `Bearer ${config.openrouterApiKey}`, config.openrouterModel];

  const res = await fetch(url!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth ?? "",
      ...(config.aiProvider === "openrouter" && { "HTTP-Referer": "http://localhost:3000", "X-Title": "Apexon Knowledge Hub" }),
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok || !res.body) throw new Error(`${config.aiProvider} ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data);
      const delta = event.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        content += delta;
        onDelta(delta);
      }
    }
  }

  return content;
}

async function callLLMText(messages: Message[], config: AgentConfig): Promise<string> {
  const response = await callLLMWithTools(messages, [], config);
  return response.content ?? "";
}

function toStreamingSynthesisMessages(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "user",
        content: `Search result / retrieved context:\n${message.content ?? ""}`,
      };
    }

    return {
      role: message.role === "system" ? "system" : message.role === "assistant" ? "assistant" : "user",
      content: message.content ?? "",
    };
  });
}

async function streamResearchSections(
  defs: ResearchSectionDef[],
  messages: Message[],
  references: ResearchReference[],
  config: AgentConfig,
  onProgress: (msg: string) => void,
  onSectionStart: (section: ResearchSectionResult) => void,
  onSectionDelta: (sectionId: string, delta: string) => void
): Promise<ResearchSectionResult[]> {
  const sections: ResearchSectionResult[] = [];

  for (const def of defs) {
    onProgress(`Writing ${def.title}…`);
    const sectionRefs = references.slice(0, 5);
    const section: ResearchSectionResult = {
      id: def.id,
      title: def.title,
      emoji: def.emoji,
      content: "",
      references: sectionRefs,
    };
    onSectionStart(section);

    const sectionMessages: Message[] = [
      ...toStreamingSynthesisMessages(messages),
      {
        role: "user",
        content: `Write the "${def.title}" section now.

Section instruction:
${def.prompt}

Output only polished markdown content for this one section. Do not include JSON, markdown fences, or the section heading. Use bullets where useful. Reference internal snippets with markers like [I1] when they support Apexon capabilities or proof points.`,
      },
    ];

    const content = await callLLMStreamingText(sectionMessages, config, (delta) => {
      onSectionDelta(def.id, delta);
    });
    let finalContent = content.trim() || "No content was generated for this section.";
    let fallbackCount = finalContent === "No content was generated for this section." ? 1 : 0;
    const markerCount = countCitationMarkers(finalContent);
    const hasInternalRefs = /\[I\d+\]/.test(finalContent);

    if (sectionRefs.length > 0 && !hasInternalRefs) {
      try {
        const repaired = await callLLMText([
          ...sectionMessages,
          {
            role: "user",
            content: `Repair the "${def.title}" section below so every Apexon capability, proof point, or recommendation grounded in internal context includes internal reference markers like [I1]. Preserve useful content, remove unsupported Apexon claims, and return polished markdown only.\n\nDraft:\n${finalContent}`,
          },
        ], config);
        if (/\[I\d+\]/.test(repaired)) {
          finalContent = repaired.trim();
        }
      } catch {
        fallbackCount++;
      }
    }

    const harness = buildAgentHarnessReport({
      intent: "client_research",
      toolsUsed: ["internal_research", "section_synthesis"],
      retrievedItems: sectionRefs.length,
      evidenceRefs: Math.max(markerCount, (finalContent.match(/\[I\d+\]/g) || []).length),
      fallbacks: fallbackCount,
      warnings: sectionRefs.length > 0 && !/\[I\d+\]/.test(finalContent)
        ? [`${def.title}: internal references were available but not cited in the section.`]
        : [],
      agentTrace: [
        { step: "retrieve", tool: "internal_research", query: def.searchQueryTemplate, found: sectionRefs.length, status: sectionRefs.length ? "ok" : "warning" },
        { step: "synthesize", tool: "section_synthesis", query: def.title, found: finalContent.length ? 1 : 0, status: finalContent.length ? "ok" : "warning" },
      ],
    });

    sections.push({
      ...section,
      content: finalContent,
      references: references.length ? attachInternalReferences([{ ...section, content: finalContent }], references)[0].references : undefined,
      harness,
    });
  }

  return sections;
}

// ── Agentic research loop ──────────────────────────────────────────────────────

async function runAgenticResearch(
  clientName: string,
  selectedSections: string[],
  followUpQuery: string | undefined,
  researchSections: ResearchSectionDef[],
  sourceKey: string | undefined,
  config: AgentConfig,
  tavilyApiKey: string | undefined,
  webSearchEnabled: boolean,
  onProgress: (msg: string) => void,
  onSectionStart: (section: ResearchSectionResult) => void,
  onSectionDelta: (sectionId: string, delta: string) => void
): Promise<ResearchSectionResult[]> {
  const defs = researchSections.filter((s) => selectedSections.includes(s.id));
  const internalQueries = defs.flatMap((d) => [
    `${clientName} ${d.title} ${d.description} Apexon capabilities case studies proof points`,
    `Apexon ${d.title} ${d.description} services capabilities accelerators outcomes`,
    d.searchQueryTemplate.replaceAll("{{client}}", clientName),
  ]);
  if (followUpQuery) internalQueries.push(`${followUpQuery} Apexon capabilities case studies proof points`);

  onProgress("Searching Apexon internal documents and slide library…");
  const internalContext = await buildInternalResearchContext(sourceKey, internalQueries, config, 12);
  onProgress(
    internalContext.chunks.length
      ? `Found ${internalContext.chunks.length} internal Apexon evidence snippets`
      : "No matching internal Apexon snippets found in the current index"
  );

  const sectionList = defs.map((d) => JSON.stringify({
    id: d.id,
    title: d.title,
    emoji: d.emoji,
    description: d.description,
    searchQuery: normalizeResearchSearchQuery(d.searchQueryTemplate.replaceAll("{{client}}", clientName)),
    outputPrompt: d.prompt,
  })).join(", ");

  const messages: Message[] = [
    { role: "system", content: APEXON_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Research prospect company: **${clientName}**

Generate an Apexon-focused presales intelligence report for these sections:
[${sectionList}]

${followUpQuery ? `Analyst's specific question: "${followUpQuery}"` : ""}

INTERNAL_APEXON_CONTEXT_FROM_INDEXED_DOCS:
${internalContext.text || "No internal Apexon document snippets were retrieved for this run."}

INSTRUCTIONS:
1. Use INTERNAL_APEXON_CONTEXT_FROM_INDEXED_DOCS as the primary source for Apexon's capabilities, accelerators, proof points, delivery strengths, and "how Apexon can help" recommendations. Reference internal snippets with markers like [I1] when you use them.
2. ${webSearchEnabled ? `Use the search_web tool to gather real-time prospect intelligence. Start from the searchQuery provided for each selected section, then run additional targeted searches when needed. Prefer ${CURRENT_RESEARCH_YEAR}; use ${EARLIEST_DEFAULT_RESEARCH_YEAR} as the oldest default year; do not use older years unless the analyst asks for historical context.` : "Use your training knowledge only for prospect background when live web search is unavailable."}
3. Web/prospect facts explain the client's situation; internal Apexon context explains why Apexon is credible and what to propose.
4. After gathering intelligence, synthesize findings into each requested section.
5. Follow each section's outputPrompt exactly; it is the admin-defined instruction for that module.
6. For EVERY section, explicitly connect findings to Apexon service opportunities grounded in internal context when available.
7. Be specific — cite real facts, name real executives, reference real initiatives.
8. The "hypothesis" and "engagement" sections MUST name specific Apexon service lines and internal proof points when those sections are requested.
9. If internal evidence is thin, say which internal proof point is missing rather than inventing Apexon claims.

Return JSON:
{
  "sections": [
    { "id": "section_id", "title": "Section Title", "emoji": "emoji", "content": "markdown content with **bold** key facts and - bullet points" }
  ]
}`,
    },
  ];

  const tools = webSearchEnabled ? [SEARCH_TOOL] : [];
  let searchCount = 0;
  const MAX_ITERATIONS = 15;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await callLLMWithTools(messages, tools, config);

    // No tool calls — LLM is done, has the final answer
    if (!response.tool_calls?.length) {
      onProgress("Synthesizing live research sections…");
      return streamResearchSections(
        defs,
        messages,
        internalContext.references,
        config,
        onProgress,
        onSectionStart,
        onSectionDelta
      );
    }

    // Execute tool calls
    messages.push({ role: "assistant", content: response.content, tool_calls: response.tool_calls });

    const toolResults = await Promise.all(response.tool_calls.map(async (tc) => {
      if (tc.function.name !== "search_web") {
        return { tc, query: "", resultText: "Tool not available.", searched: false };
      }

        let args: { query: string };
        try { args = JSON.parse(tc.function.arguments); } catch { args = { query: clientName }; }

        const normalizedQuery = normalizeResearchSearchQuery(args.query);

        const results = await searchWeb(normalizedQuery, tavilyApiKey).catch(() => []);
        const resultText = results.length
          ? results.map((r) => `[${r.title}]\n${r.content}`).join("\n\n")
          : "No results found for this query.";

        return { tc, query: normalizedQuery, resultText, searched: true };
    }));

    for (const result of toolResults) {
      if (result.searched) {
        searchCount++;
        onProgress(`🔍 [${searchCount}] Searching: "${result.query}"`);
      }
      messages.push({ role: "tool", tool_call_id: result.tc.id, content: result.resultText });
    }
  }

  // Max iterations reached — ask LLM to finalize with what it has
  onProgress("Synthesizing all gathered intelligence…");
  return streamResearchSections(
    defs,
    messages,
    internalContext.references,
    config,
    onProgress,
    onSectionStart,
    onSectionDelta
  );
}

// ── Route handler ──────────────────────────────────────────────────────────────

interface ResearchBody {
  clientName: string;
  selectedSections: string[];
  followUpQuery?: string;
  researchSections?: ResearchSectionDef[];
  sourceKey?: string;
  aiProvider: "ollama" | "openrouter" | "gemini";
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaEmbedModel?: string;
  openrouterModel?: string;
  geminiModel?: string;
  embeddingProvider?: "ollama" | "google";
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: ResearchBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { clientName, selectedSections, followUpQuery } = body;

  if (!clientName?.trim()) return NextResponse.json({ error: "Missing clientName" }, { status: 400 });

  const config: AgentConfig = resolveAiConfig(body);
  const tavilyApiKey = config.tavilyApiKey;
  const webSearchEnabled = Boolean(tavilyApiKey) || isParallelMcpEnabled();
  const encoder = new TextEncoder();
  const researchSections = Array.isArray(body.researchSections) && body.researchSections.length
    ? body.researchSections
    : RESEARCH_SECTIONS;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        send({ type: "progress", msg: `🤖 Starting agentic research on ${clientName}…` });
        if (webSearchEnabled) {
          send({ type: "progress", msg: "🌐 Web search enabled — agent will run targeted queries" });
          send({ type: "progress", msg: tavilyApiKey ? "📄 Tavily Extract enabled — opening top web results" : "⚡ Parallel MCP enabled — using free web_search/web_fetch" });
        } else {
          send({ type: "progress", msg: "💡 Using AI knowledge (enable Parallel MCP or add Tavily key for live web search)" });
        }

        const sections = await runAgenticResearch(
          clientName.trim(),
          selectedSections,
          followUpQuery,
          researchSections,
          body.sourceKey,
          config,
          tavilyApiKey,
          webSearchEnabled,
          (msg) => send({ type: "progress", msg }),
          (section) => send({ type: "section-start", section }),
          (sectionId, delta) => send({ type: "section-delta", sectionId, delta })
        );

        send({ type: "progress", msg: `✅ Research complete — ${sections.length} sections generated` });

        // Stream sections one by one
        for (const section of sections) {
          send({ type: "section", section });
        }

        // Save
        const research: SavedResearch = {
          id:               Date.now().toString(),
          clientName:       clientName.trim(),
          createdAt:        new Date().toISOString(),
          selectedSections: selectedSections,
          sections,
        };
        await saveResearch(research);
        send({ type: "done", researchId: research.id });

      } catch (err) {
        send({ type: "error", error: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
