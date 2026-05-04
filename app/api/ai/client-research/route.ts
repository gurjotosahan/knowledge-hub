import { NextRequest, NextResponse } from "next/server";
import { searchWeb } from "@/lib/rag/agent";
import { saveResearch } from "@/lib/researchStorage";
import { RESEARCH_SECTIONS } from "@/types/research";
import type { SavedResearch, ResearchSectionResult } from "@/types/research";
import type { AgentConfig } from "@/lib/rag/agent";
import { resolveAiConfig } from "@/lib/serverConfig";

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

const APEXON_SYSTEM_PROMPT = `You are a senior presales consultant and business intelligence analyst at Apexon — a global IT services and digital engineering company.

Your mission is to build sharp, actionable account intelligence that helps Apexon's GTM and presales teams WIN deals and engage prospects strategically.

${APEXON_SERVICES}

RESEARCH PHILOSOPHY:
- Every insight must answer: "How does this create an opening for Apexon?"
- Map pain points → Apexon service lines explicitly
- Identify the BEST entry point (not the obvious one)
- Think like a hunter, not a librarian

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
          description: "Specific search query. Be precise — e.g. 'JPMorgan Chase cloud migration strategy 2025' not just 'JPMorgan technology'",
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

// ── Agentic research loop ──────────────────────────────────────────────────────

async function runAgenticResearch(
  clientName: string,
  selectedSections: string[],
  followUpQuery: string | undefined,
  config: AgentConfig,
  tavilyApiKey: string | undefined,
  onProgress: (msg: string) => void
): Promise<ResearchSectionResult[]> {
  const defs = RESEARCH_SECTIONS.filter((s) => selectedSections.includes(s.id));
  const sectionList = defs.map((d) => `{ "id": "${d.id}", "title": "${d.title}" }`).join(", ");

  const messages: Message[] = [
    { role: "system", content: APEXON_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Research prospect company: **${clientName}**

Generate an Apexon-focused presales intelligence report for these sections:
[${sectionList}]

${followUpQuery ? `Analyst's specific question: "${followUpQuery}"` : ""}

INSTRUCTIONS:
1. ${tavilyApiKey ? "Use the search_web tool to gather real-time intelligence. Run at least 6-8 targeted searches across different topics (strategy, technology, challenges, leadership, competitors, recent news)." : "Use your training knowledge to research this company thoroughly."}
2. After gathering intelligence, synthesize findings into each requested section.
3. For EVERY section, explicitly connect findings to Apexon service opportunities.
4. Be specific — cite real facts, name real executives, reference real initiatives.
5. The "hypothesis" and "engagement" sections MUST name specific Apexon service lines.

Return JSON:
{
  "sections": [
    { "id": "section_id", "title": "Section Title", "emoji": "emoji", "content": "markdown content with **bold** key facts and - bullet points" }
  ]
}`,
    },
  ];

  const tools = tavilyApiKey ? [SEARCH_TOOL] : [];
  let searchCount = 0;
  const MAX_ITERATIONS = 15;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await callLLMWithTools(messages, tools, config);

    // No tool calls — LLM is done, has the final answer
    if (!response.tool_calls?.length) {
      const raw = response.content ?? "";
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      try {
        const parsed = JSON.parse(cleaned);
        return parsed.sections ?? [];
      } catch {
        // Fallback if JSON parsing fails
        return defs.map((d) => ({
          id: d.id, title: d.title, emoji: d.emoji,
          content: `Research completed. Raw output: ${raw.slice(0, 300)}`,
        }));
      }
    }

    // Execute tool calls
    messages.push({ role: "assistant", content: response.content, tool_calls: response.tool_calls });

    for (const tc of response.tool_calls) {
      if (tc.function.name === "search_web") {
        let args: { query: string };
        try { args = JSON.parse(tc.function.arguments); } catch { args = { query: clientName }; }

        searchCount++;
        onProgress(`🔍 [${searchCount}] Searching: "${args.query}"`);

        const results = await searchWeb(args.query, tavilyApiKey!).catch(() => []);
        const resultText = results.length
          ? results.map((r) => `[${r.title}]\n${r.content}`).join("\n\n")
          : "No results found for this query.";

        messages.push({ role: "tool", tool_call_id: tc.id, content: resultText });
      }
    }
  }

  // Max iterations reached — ask LLM to finalize with what it has
  onProgress("Synthesizing all gathered intelligence…");
  messages.push({ role: "user", content: `You have gathered sufficient intelligence. Now write the complete research report as JSON with the sections array. Focus on Apexon service opportunities in every section.` });

  const final = await callLLMWithTools(messages, [], config);
  const raw = final.content ?? "";
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed.sections ?? [];
  } catch {
    return defs.map((d) => ({
      id: d.id, title: d.title, emoji: d.emoji,
      content: `Research data gathered but synthesis failed. Please try again.`,
    }));
  }
}

// ── Route handler ──────────────────────────────────────────────────────────────

interface ResearchBody {
  clientName: string;
  selectedSections: string[];
  followUpQuery?: string;
  aiProvider: "ollama" | "openrouter" | "gemini";
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  openrouterModel?: string;
  geminiModel?: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: ResearchBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { clientName, selectedSections, followUpQuery } = body;

  if (!clientName?.trim()) return NextResponse.json({ error: "Missing clientName" }, { status: 400 });

  const config: AgentConfig = resolveAiConfig(body);
  const tavilyApiKey = config.tavilyApiKey;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        send({ type: "progress", msg: `🤖 Starting agentic research on ${clientName}…` });
        if (tavilyApiKey) {
          send({ type: "progress", msg: "🌐 Web search enabled — agent will run targeted queries" });
        } else {
          send({ type: "progress", msg: "💡 Using AI knowledge (add Tavily key for live web search)" });
        }

        const sections = await runAgenticResearch(
          clientName.trim(),
          selectedSections,
          followUpQuery,
          config,
          tavilyApiKey,
          (msg) => send({ type: "progress", msg })
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
