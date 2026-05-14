import { NextRequest, NextResponse } from "next/server";
import type { AgentConfig } from "@/lib/rag/agent";
import { resolveAiConfig } from "@/lib/serverConfig";

export const maxDuration = 180;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

interface SlideContent {
  kind: string;
  layout: string;
  kicker?: string;
  title: string;
  subtitle?: string;
  bullets?: string[];
  pillars?: { title: string; body: string }[];
  stats?: { value: string; label: string }[];
  case_study?: { challenge: string; solution: string; role: string; benefits: string };
  architecture?: { components: { name: string; description: string }[] };
  capability?: { categories: { name: string; items: string[] }[] };
  risk?: { items: { risk: string; impact: string; mitigation: string }[] };
  takeaway?: string;
  notes?: string;
}

interface DeckDraft {
  title: string;
  slides: SlideContent[];
}

interface AgentState {
  status: "decomposing" | "generating" | "validating" | "refining" | "exporting" | "complete" | "error";
  currentStep: number;
  totalSteps: number;
  message: string;
  deck?: DeckDraft;
  issues?: any[];
  fixedIssues?: string[];
}

async function callLLM(messages: object[], config: AgentConfig): Promise<string> {
  if (config.aiProvider === "ollama") {
    const res = await fetch(`${config.ollamaBaseUrl ?? "http://localhost:11434"}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        messages,
        stream: false,
        format: "json",
      }),
      signal: AbortSignal.timeout(110_000),
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
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(110_000),
  });
  if (!res.ok) throw new Error(`${config.aiProvider} ${res.status}`);
  return (await res.json()).choices?.[0]?.message?.content ?? "";
}

function clip(s: unknown, n: number): string {
  return String(s ?? "").slice(0, n);
}

function parseDeck(raw: string): DeckDraft | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed || !Array.isArray(parsed.slides)) return null;
    return {
      title: clip(parsed.title || "Presentation", 140),
      slides: parsed.slides.map((s: any) => ({
        kind: (["cover", "section", "content", "closing"] as const).includes(s.kind) ? s.kind : "content",
        layout: s.layout || "bullets",
        kicker: s.kicker ? clip(s.kicker, 40) : undefined,
        title: clip(s.title, 180),
        subtitle: s.subtitle ? clip(s.subtitle, 220) : undefined,
        bullets: Array.isArray(s.bullets) ? s.bullets.slice(0, 6).map((b: string) => clip(b, 200)) : [],
        pillars: Array.isArray(s.pillars) ? s.pillars.slice(0, 4).map((p: any) => ({ title: clip(p?.title, 60), body: clip(p?.body, 200) })) : [],
        stats: Array.isArray(s.stats) ? s.stats.slice(0, 4).map((p: any) => ({ value: clip(p?.value, 16), label: clip(p?.label, 80) })) : [],
        case_study: s.case_study ? {
          challenge: clip(s.case_study.challenge, 200),
          solution: clip(s.case_study.solution, 200),
          role: clip(s.case_study.role, 200),
          benefits: clip(s.case_study.benefits, 200),
        } : undefined,
        architecture: s.architecture?.components ? { components: s.architecture.components.slice(0, 8) } : undefined,
        capability: s.capability?.categories ? { categories: s.capability.categories.slice(0, 4) } : undefined,
        risk: s.risk?.items ? { items: s.risk.items.slice(0, 5) } : undefined,
        takeaway: s.takeaway ? clip(s.takeaway, 220) : undefined,
        notes: s.notes ? clip(s.notes, 600) : undefined,
      })),
    };
  } catch {
    return null;
  }
}

// STEP 1: Decompose input into slide outline
async function decompose(topic: string, config: AgentConfig): Promise<{ outline: string[]; structure: string }> {
  const system = `You are a strategic consultant analyzing document structure. Break down content into slide-ready sections.`;

  const user = `Analyze this content and create a slide outline. Identify distinct sections that should become separate slides.

Content:
${topic}

Output JSON:
{
  "structure": "brief description of the content type",
  "outline": ["slide 1 title", "slide 2 title", ...]
}`;

  const response = await callLLM([{ role: "system", content: system }, { role: "user", content: user }], config);
  const parsed = JSON.parse(response);

  return {
    outline: parsed.outline || [],
    structure: parsed.structure || "general",
  };
}

// STEP 2: Generate deck with structure awareness
async function generateDeck(topic: string, outline: string[], config: AgentConfig, slideCount: number): Promise<DeckDraft> {
  const system = `You are a senior management consultant from McKinsey/BCG/Bain. You produce executive board-ready presentations.

OUTPUT: a single JSON object — no prose, no markdown fences.

SCHEMA:
{
  "title": string,
  "slides": [{
    "kind": "cover" | "section" | "content" | "closing",
    "layout": "bullets" | "pillars" | "stats" | "quote" | "comparison" | "timeline" | "four_column_case" | "architecture" | "capability" | "risk_matrix",
    "kicker"?: string,
    "title": string,
    "subtitle"?: string,
    "bullets"?: string[],
    "pillars"?: { "title": string, "body": string }[],
    "stats"?: { "value": string, "label": string }[],
    "case_study"?: { "challenge": string, "solution": string, "role": string, "benefits": string },
    "takeaway"?: string,
    "notes"?: string
  }]
}

CONSULTING-GRADE RULES:
1. ACTION TITLES — Every content slide title must be a full sentence stating the INSIGHT.
2. Each content slide must have a kicker (e.g. "CONTEXT", "DIAGNOSIS", "RECOMMENDATION").
3. Each content slide should have a takeaway — one-sentence "so what".
4. For case studies, use layout: "four_column_case" and populate case_study.challenge/solution/role/benefits.

MULTI-SLIDE MANDATORY: Generate at least ${Math.min(slideCount, outline.length + 3)} slides. Each section from the outline becomes a slide.`;

  const user = `Create a ${slideCount}-slide consulting-grade presentation based on this outline:

${outline.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Topic details:
${topic}`;

  const response = await callLLM([{ role: "system", content: system }, { role: "user", content: user }], config);
  const deck = parseDeck(response);

  if (!deck) throw new Error("Failed to parse generated deck");
  return deck;
}

// STEP 3: Validate and auto-fix issues
async function validateDeck(deck: DeckDraft, config: AgentConfig): Promise<{ deck: DeckDraft; issues: string[]; fixed: string[] }> {
  const issues: string[] = [];
  const fixed: string[] = [];

  // Check each slide for required fields
  deck.slides.forEach((slide, index) => {
    if (!slide.title) {
      issues.push(`Slide ${index + 1}: Missing title`);
    }
    if (slide.layout === "four_column_case" && !slide.case_study) {
      issues.push(`Slide ${index + 1}: Case study layout without case_study data`);
    }
    if (slide.kind === "content" && !slide.kicker && !slide.layout?.includes("four_column")) {
      issues.push(`Slide ${index + 1}: Content slide missing kicker`);
    }
    if (slide.kind === "content" && !slide.takeaway && !slide.layout?.includes("four_column")) {
      issues.push(`Slide ${index + 1}: Content slide missing takeaway`);
    }
  });

  // Auto-fix critical issues using LLM
  if (issues.length > 0) {
    const system = `You are a JSON slide repair expert. Fix the issues in the deck and return corrected JSON.`;

    const user = `Fix these issues in the deck:
${issues.map(i => `- ${i}`).join("\n")}

Current deck:
${JSON.stringify(deck, null, 2)}

Return the corrected deck as JSON.`;

    try {
      const response = await callLLM([{ role: "system", content: system }, { role: "user", content: user }], config);
      const fixedDeck = parseDeck(response);
      if (fixedDeck && fixedDeck.slides.length > 0) {
        fixed.push(...issues);
        return { deck: fixedDeck, issues: [], fixed };
      }
    } catch {
      // Keep original deck if fix fails
    }
  }

  return { deck, issues, fixed };
}

// STEP 4: Refine deck based on feedback
async function refineDeck(deck: DeckDraft, feedback: string, config: AgentConfig): Promise<DeckDraft> {
  const system = `You are a senior consultant refining presentation decks. Apply feedback and return improved JSON.`;

  const user = `Refine this deck based on feedback:

Feedback: ${feedback}

Current deck:
${JSON.stringify(deck, null, 2)}

Return the improved deck as JSON with the changes applied.`;

  const response = await callLLM([{ role: "system", content: system }, { role: "user", content: user }], config);
  const refined = parseDeck(response);

  return refined || deck;
}

// Main handler
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { topic, audience, slideCount, feedback, currentDeck } = body;

    if (!topic) return NextResponse.json({ error: "Missing topic" }, { status: 400 });

    const config = resolveAiConfig(body);
    const targetSlides = Math.min(Math.max(Number(slideCount) || 8, 1), 20);

    // Handle revision requests
    if (feedback && currentDeck) {
      const refined = await refineDeck(currentDeck, feedback, config);
      return NextResponse.json({
        status: "complete",
        deck: refined,
        message: "Deck refined based on feedback",
      });
    }

    // Full agentic flow
    const state: AgentState = {
      status: "decomposing",
      currentStep: 1,
      totalSteps: 4,
      message: "Analyzing content structure...",
    };

    // Step 1: Decompose
    const { outline, structure } = await decompose(topic, config);
    state.status = "generating";
    state.currentStep = 2;
    state.message = `Generating ${targetSlides} slides from ${outline.length} sections...`;

    // Step 2: Generate
    const deck = await generateDeck(topic, outline, config, targetSlides);
    state.deck = deck;
    state.status = "validating";
    state.currentStep = 3;
    state.message = "Validating and fixing issues...";

    // Step 3: Validate
    const { deck: validatedDeck, issues, fixed } = await validateDeck(deck, config);
    state.issues = issues;
    state.fixedIssues = fixed;
    state.deck = validatedDeck;
    state.status = "complete";
    state.currentStep = 4;
    state.message = "Deck ready for review";

    return NextResponse.json({
      status: state.status,
      message: state.message,
      deck: validatedDeck,
      issues: issues.length > 0 ? issues : undefined,
      fixedIssues: fixed.length > 0 ? fixed : undefined,
      structure,
      outline,
    });

  } catch (err) {
    return NextResponse.json({
      status: "error",
      error: String(err),
    }, { status: 500 });
  }
}

// GET for polling status (future: SSE support)
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ message: "PPT Agent endpoint. POST with topic to generate." });
}