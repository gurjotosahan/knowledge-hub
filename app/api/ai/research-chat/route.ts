import { NextRequest, NextResponse } from "next/server";
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
  aiProvider: "ollama" | "openrouter" | "gemini";
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  openrouterModel?: string;
  geminiModel?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ChatBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { clientName, sections, question, history } = body;

  const config: AgentConfig = resolveAiConfig(body);

  const researchContext = sections
    .map((s) => `## ${s.emoji} ${s.title}\n${s.content}`)
    .join("\n\n");

  const systemPrompt = `You are a senior Apexon presales consultant. You have just completed detailed research on the prospect company "${clientName}".

${APEXON_SERVICES}

Below is the research intelligence already gathered on ${clientName}:

${researchContext}

Answer the analyst's follow-up questions using this research as your primary source. Be specific, cite facts from the research above, and always connect your answers to Apexon's ability to help. Keep answers concise and actionable — this is a presales context.`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: question },
  ];

  try {
    const answer = await callLLM(messages, config);
    return NextResponse.json({ answer });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
