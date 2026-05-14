import { NextRequest, NextResponse } from "next/server";
import { buildInternalResearchContext } from "@/lib/internalResearchContext";
import type { AgentConfig } from "@/lib/rag/agent";
import type { ResearchSectionResult } from "@/types/research";
import { resolveAiConfig } from "@/lib/serverConfig";

export const maxDuration = 120;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

const APEXON_SERVICES = `
APEXON SERVICE LINES: Digital Engineering, Cloud (AWS/Azure/GCP), Data & AI / GenAI, Quality Engineering,
Digital Experience / Salesforce / ServiceNow, Life Sciences (CTMS/EDC/regulatory), BFSI (core banking/payments/open banking),
Healthcare IT (EHR/FHIR/interoperability), Cybersecurity, Intelligent Automation / RPA.
`.trim();

async function callLLM(messages: object[], config: AgentConfig): Promise<string> {
  if (config.aiProvider === "ollama") {
    const res = await fetch(`${config.ollamaBaseUrl ?? "http://localhost:11434"}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.ollamaModel, messages, stream: false }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    return (await res.json()).message?.content ?? "";
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
    body: JSON.stringify({ model, messages }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`${config.aiProvider} ${res.status}`);
  return (await res.json()).choices?.[0]?.message?.content ?? "";
}

interface ChatBody {
  clientName: string;
  sections: ResearchSectionResult[];
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  sourceKey?: string;
  aiProvider: "ollama" | "openrouter" | "gemini";
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaEmbedModel?: string;
  openrouterModel?: string;
  geminiModel?: string;
  embeddingProvider?: "ollama" | "google";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ChatBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { clientName, sections, question, history } = body;

  const config: AgentConfig = resolveAiConfig(body);
  const internalContext = await buildInternalResearchContext(
    body.sourceKey,
    [
      `${question} Apexon capabilities case studies proof points internal slides`,
      `${clientName} ${question} Apexon services accelerators outcomes`,
      `Apexon how can help ${clientName} ${question}`,
    ],
    config,
    8
  );

  const researchContext = sections
    .map((s) => `## ${s.emoji} ${s.title}\n${s.content}`)
    .join("\n\n");

  const systemPrompt = `You are a senior Apexon presales consultant. You have just completed detailed research on the prospect company "${clientName}".

${APEXON_SERVICES}

Below is the research intelligence already gathered on ${clientName}:

${researchContext}

Additional internal Apexon evidence from indexed documents/slides:
${internalContext.text || "No additional internal Apexon document snippets were retrieved for this follow-up."}

Answer the analyst's follow-up questions using the completed research plus the internal Apexon evidence. For "how can Apexon help" style questions, ground recommendations in internal snippets when available and cite them with markers like [I1]. Use external/prospect facts for client context, and internal documents for Apexon capabilities and proof points. If internal evidence is missing, say what proof point is missing instead of inventing it. Keep answers concise and actionable — this is a presales context.`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: question },
  ];

  try {
    const answer = await callLLM(messages, config);
    const cited = [...answer.matchAll(/\[I(\d+)\]/g)]
      .map((match) => internalContext.references[Number(match[1]) - 1])
      .filter(Boolean);
    return NextResponse.json({
      answer,
      references: cited.length ? cited : internalContext.references.slice(0, 5),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
