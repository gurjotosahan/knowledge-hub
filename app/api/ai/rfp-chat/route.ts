import { NextRequest, NextResponse } from "next/server";
import { resolveAiConfig } from "@/lib/serverConfig";

export const maxDuration = 120;

async function callLLM(prompt: string, config: ReturnType<typeof resolveAiConfig>): Promise<string> {
  const { aiProvider, ollamaBaseUrl, ollamaModel, openrouterApiKey, openrouterModel, geminiApiKey, geminiModel } = config;

  const hasOllama = aiProvider === "ollama" && ollamaModel && ollamaBaseUrl;
  const hasOpenRouter = aiProvider === "openrouter" && openrouterApiKey && openrouterModel;
  const hasGemini = aiProvider === "gemini" && geminiApiKey && geminiModel;
  
  if (!hasOllama && !hasOpenRouter && !hasGemini) {
    return "";
  }

  if (hasOpenRouter) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openrouterApiKey}`,
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "RFP Chat"
        },
        body: JSON.stringify({
          model: openrouterModel,
          messages: [
            { role: "system", content: "You are an RFP analysis assistant. Answer questions based only on the provided RFP analysis." },
            { role: "user", content: prompt }
          ],
          temperature: 0.5,
          max_tokens: 2048
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`OpenRouter error: ${res.status}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      console.error("OpenRouter call failed:", err);
      return "";
    }
  }

  if (hasOllama) {
    try {
      const res = await fetch(`${ollamaBaseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [
            { role: "system", content: "You are an RFP analysis assistant. Answer questions based only on the provided RFP analysis." },
            { role: "user", content: prompt }
          ],
          stream: false,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
      return (await res.json()).message?.content ?? "";
    } catch (err) {
      console.error("Ollama call failed:", err);
      return "";
    }
  }

  if (hasGemini) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: "You are an RFP analysis assistant. Answer questions based only on the provided RFP analysis." }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } catch (err) {
      console.error("Gemini call failed:", err);
      return "";
    }
  }

  return "";
}

function searchAnalysisForAnswer(question: string, analysis: Record<string, string>): string {
  const questionLower = question.toLowerCase();
  const sectionKeywords: Record<string, string[]> = {
    executive_brief: ["summarize", "summary", "brief", "overview", "objective"],
    opportunity_snapshot: ["client", "title", "deadline", "due date", "industry", "reference"],
    client_objective: ["objective", "goal", "outcome", "purpose"],
    pain_points: ["pain", "problem", "challenge", "current state"],
    scope_intelligence: ["scope", "deliverable", "responsibility", "in scope", "out of scope"],
    requirement_intelligence: ["requirement", "functional", "technical", "capability"],
    mandatory_items: ["mandatory", "disqualification", "must", "required"],
    evaluation_criteria: ["evaluation", "criteria", "scoring", "score", "weight"],
    submission_intelligence: ["submit", "submission", "proposal", "format", "case study", "reference"],
    commercial_intelligence: ["pricing", "price", "cost", "commercial", "payment", "budget"],
    technical_intelligence: ["technical", "architecture", "cloud", "integration", "platform"],
    security_compliance: ["security", "privacy", "compliance", "hipaa", "fhir", "hl7"],
    delivery_governance: ["delivery", "timeline", "governance", "milestone", "implementation"],
    risks_assumptions: ["risk", "assumption", "dependency", "mitigation"],
    clarification_questions: ["clarification", "question", "unclear"],
    response_strategy: ["strategy", "win theme", "storyline", "response", "proposal structure"],
  };

  const matches = Object.entries(sectionKeywords)
    .filter(([sectionId, keywords]) => analysis[sectionId] && keywords.some(keyword => questionLower.includes(keyword)))
    .map(([sectionId]) => sectionId);

  const selected = matches.length ? matches : Object.keys(analysis).slice(0, 3);
  if (selected.length) {
    return selected
      .map((sectionId) => {
        const title = sectionId.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
        const excerpt = analysis[sectionId]
          .split("\n")
          .map(line => line.trim())
          .filter(Boolean)
          .slice(0, 10)
          .join("\n");
        return `## ${title}\n${excerpt}`;
      })
      .join("\n\n");
  }

  return `I need more context to answer that specific question. The RFP analysis covers these areas:
- Executive Opportunity Brief
- Opportunity Snapshot (client, RFP title, dates)
- Client Objective and Business Problem
- Scope Intelligence
- Requirement Intelligence
- Technical/Architecture Intelligence
- Security/Compliance Intelligence
- Delivery and Governance
- Submission Intelligence
- Commercial/Pricing Intelligence
- Mandatory Items
- Risks and Assumptions
- Clarification Questions
- Response Strategy

Could you ask about one of these specific areas?`;
}

function compactText(text: string, maxChars: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function searchWorkspaceForAnswer(
  question: string,
  rfpText?: string,
  workspaceDocuments?: Array<{ name?: string; kind?: string; text?: string }>
): string {
  const docs = [
    ...(rfpText ? [{ name: "Primary RFP", kind: "Primary RFP", text: rfpText }] : []),
    ...(workspaceDocuments ?? []),
  ].filter((doc) => doc.text?.trim());

  if (!docs.length) return "";

  const terms = question
    .toLowerCase()
    .split(/\W+/)
    .filter(term => term.length > 3 && !["what", "should", "create", "generate", "this", "that", "with", "from"].includes(term));

  const scored = docs.map((doc) => {
    const text = doc.text ?? "";
    const lower = text.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
    return { doc, score };
  }).sort((a, b) => b.score - a.score);

  const useful = scored.filter(item => item.score > 0).slice(0, 3);
  const selected = useful.length ? useful : scored.slice(0, 2);

  return selected
    .map(({ doc }) => `## ${doc.kind || "Document"}: ${doc.name || "Untitled"}\n${compactText(doc.text ?? "", 1200)}`)
    .join("\n\n");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { question, analysis, history, config: clientConfig, rfpText, workspaceDocuments } = body;

    if (!question) {
      return NextResponse.json({ error: "No question provided" }, { status: 400 });
    }

    const aiConfig = resolveAiConfig({
      aiProvider: clientConfig?.aiProvider,
      ollamaBaseUrl: clientConfig?.ollamaBaseUrl,
      ollamaModel: clientConfig?.ollamaModel,
      openrouterApiKey: clientConfig?.openrouterApiKey,
      openrouterModel: clientConfig?.openrouterModel,
      geminiApiKey: clientConfig?.geminiApiKey,
      geminiModel: clientConfig?.geminiModel,
    });

    // Try LLM first
    const systemPrompt = `You are an RFP opportunity intelligence assistant helping presales teams understand RFPs and supporting opportunity documents.

Rules:
- Use only the provided RFP analysis and workspace source documents below.
- If information is not in the sources, say "Not specified in the workspace sources."
- If inferred, say "This is inferred and should be validated."
- Do not invent facts
- Be concise and practical
- For clarification questions, derive useful questions from gaps, ambiguous requirements, missing dates, missing acceptance criteria, commercial unknowns, and risks in the sources.`;

    const contextSection = analysis ? 
      `RFP ANALYSIS:\n${Object.entries(analysis).map(([key, value]) => `## ${key}\n${value}`).join('\n\n')}` 
      : "";

    const sourceDocsSection = Array.isArray(workspaceDocuments) && workspaceDocuments.length
      ? `\n\nWORKSPACE SOURCE DOCUMENTS:\n${workspaceDocuments.map((doc: { name?: string; kind?: string; text?: string }, index: number) =>
          `## D${index + 1}: ${doc.kind || "Document"} - ${doc.name || "Untitled"}\n${compactText(doc.text || "", 5000)}`
        ).join("\n\n")}`
      : rfpText
        ? `\n\nPRIMARY RFP SOURCE:\n${compactText(rfpText, 8000)}`
        : "";

    const historySection = history && history.length > 0 ? 
      `\n\nCONVERSATION HISTORY:\n${history.map((h: { role: string; content: string }) => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`).join('\n')}` 
      : "";

    const prompt = `${systemPrompt}\n\n${contextSection}${sourceDocsSection}${historySection}\n\nUser question: ${question}\n\nProvide a helpful, accurate answer based only on the RFP analysis and workspace source documents provided.`;

    try {
      const response = await callLLM(prompt, aiConfig);
      
      if (response && response.trim().length > 0) {
        return NextResponse.json({ answer: response });
      }
    } catch (err) {
      console.error("LLM call error:", err);
    }

    // Fallback: search the analysis without LLM
    if (analysis && Object.keys(analysis).length > 0) {
      const workspaceFallback = searchWorkspaceForAnswer(question, rfpText, workspaceDocuments);
      const fallbackAnswer = workspaceFallback || searchAnalysisForAnswer(question, analysis);
      return NextResponse.json({ 
        answer: fallbackAnswer,
        source: "fallback"
      });
    }

    const workspaceFallback = searchWorkspaceForAnswer(question, rfpText, workspaceDocuments);
    if (workspaceFallback) {
      return NextResponse.json({
        answer: workspaceFallback,
        source: "fallback",
      });
    }

    return NextResponse.json({ 
      answer: "I couldn't process your question at this time. Please try again or rephrase your question." 
    });
  } catch (err) {
    console.error("RFP Chat error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    message: "RFP Chat API",
    features: ["LLM-powered answers", "Fallback keyword search"]
  });
}
