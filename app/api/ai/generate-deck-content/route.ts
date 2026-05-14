import { NextRequest, NextResponse } from "next/server";
import type { AgentConfig } from "@/lib/rag/agent";
import { resolveAiConfig } from "@/lib/serverConfig";
import { readStyleLibrary, styleLibraryPrompt } from "@/lib/pptxStyleLibrary";

export const maxDuration = 120;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

async function callLLM(messages: object[], config: AgentConfig, jsonMode = true): Promise<string> {
  if (config.aiProvider === "ollama") {
    const res = await fetch(`${config.ollamaBaseUrl ?? "http://localhost:11434"}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        messages,
        stream: false,
        format: jsonMode ? "json" : undefined,
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
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(110_000),
  });
  if (!res.ok) throw new Error(`${config.aiProvider} ${res.status}`);
  return (await res.json()).choices?.[0]?.message?.content ?? "";
}

export interface GeneratedSlide {
  kind: "cover" | "section" | "content" | "closing";
  // PHASE 1: Story Intelligence
  story_intent?: "show_urgency" | "build_confidence" | "demonstrate_value" | "explain_solution" | "risk_mitigation" | "call_to_action";
  audience?: "CIO" | "CTO" | "CEO" | "Board" | "CFO" | "COO" | "VP_Engineering" | "Business_Leader";
  slide_type?: "executive_summary" | "problem_opportunity" | "current_vs_future" | "roadmap" | "case_study" | "reference_architecture" | "operating_model" | "capability_map" | "value_realization" | "risk_mitigation" | "win_themes";
  // Layout types (including Phase 2 consulting slides)
  layout?: "bullets" | "pillars" | "stats" | "quote" | "comparison" | "timeline" | "matrix" | "org" | "infographic" | "fullbleed" | "four_column_case" | "architecture" | "capability" | "risk_matrix";
  kicker?: string;
  title: string;
  subtitle?: string;
  // Standard content
  bullets?: string[];
  pillars?: { title: string; body: string }[];
  stats?:   { value: string; label: string }[];
  quote?:   { text: string; attribution?: string };
  comparison?: { left: { heading: string; items: string[] }; right: { heading: string; items: string[] } };
  timeline?: { phase: string; description: string }[];
  matrix?:   { topLeft: string; topRight: string; bottomLeft: string; bottomRight: string; axisX?: string; axisY?: string };
  org?:      { leader: string; roles: string[] };
  infographic?: { items: { label: string; value: string }[] };
  fullbleed?: { imagePrompt?: string; overlayText?: string };
  // PHASE 2: Consulting slide types
  case_study?: { challenge: string; solution: string; role: string; benefits: string };
  architecture?: { components: { name: string; description: string }[] };
  capability?: { categories: { name: string; items: string[] }[] };
  risk?: { items: { risk: string; impact: string; mitigation: string }[] };
  // Design hints
  takeaway?: string;
  design?: {
    style?: "dark_technical" | "light_consulting" | "visual_case_study" | "data_heavy" | "process_flow";
    template?: string;
    visualPattern?: string;
    iconHints?: string[];
  };
  notes?: string;
}

interface Body {
  topic: string;
  audience?: string;
  slideCount?: number;
  tone?: string;
  currentSlides?: GeneratedSlide[];
  revisionInstruction?: string;
  aiProvider: "ollama" | "openrouter" | "gemini";
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  openrouterModel?: string;
  geminiModel?: string;
  useStyleLibrary?: boolean;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clip(s: unknown, n: number): string { return String(s ?? "").slice(0, n); }

function tryParseDeck(raw: string): { title: string; slides: GeneratedSlide[] } | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || !Array.isArray(parsed.slides)) return null;
    const slides: GeneratedSlide[] = parsed.slides
      .filter((s: unknown): s is GeneratedSlide => Boolean(s && typeof (s as GeneratedSlide).title === "string"))
      .map((s: GeneratedSlide) => {
        const allowedLayouts = ["bullets", "pillars", "stats", "quote", "comparison", "timeline", "matrix", "org", "infographic", "fullbleed", "four_column_case", "architecture", "capability", "risk_matrix"] as const;
        const allowedStoryIntents = ["show_urgency", "build_confidence", "demonstrate_value", "explain_solution", "risk_mitigation", "call_to_action"] as const;
        const allowedAudiences = ["CIO", "CTO", "CEO", "Board", "CFO", "COO", "VP_Engineering", "Business_Leader"] as const;
        const allowedSlideTypes = ["executive_summary", "problem_opportunity", "current_vs_future", "roadmap", "case_study", "reference_architecture", "operating_model", "capability_map", "value_realization", "risk_mitigation", "win_themes"] as const;

        const layout = s.layout && allowedLayouts.includes(s.layout) ? s.layout : undefined;
        return {
          // Phase 1: Story Intelligence
          story_intent: s.story_intent && allowedStoryIntents.includes(s.story_intent) ? s.story_intent : undefined,
          audience: s.audience && allowedAudiences.includes(s.audience) ? s.audience : undefined,
          slide_type: s.slide_type && allowedSlideTypes.includes(s.slide_type) ? s.slide_type : undefined,
          // Basic
          kind: (["cover", "section", "content", "closing"] as const).includes(s.kind) ? s.kind : "content",
          layout,
          kicker:   s.kicker   ? clip(s.kicker, 40)    : undefined,
          title:    clip(s.title, 180),
          subtitle: s.subtitle ? clip(s.subtitle, 220) : undefined,
          // Standard content
          bullets:  Array.isArray(s.bullets) ? s.bullets.slice(0, 6).map((b) => clip(b, 200)) : undefined,
          pillars:  Array.isArray(s.pillars) ? s.pillars.slice(0, 4).map((p) => ({ title: clip(p?.title, 60), body: clip(p?.body, 200) })) : undefined,
          stats:    Array.isArray(s.stats)   ? s.stats.slice(0, 4).map((p) => ({ value: clip(p?.value, 16), label: clip(p?.label, 80) }))   : undefined,
          quote:    s.quote ? { text: clip(s.quote.text, 280), attribution: s.quote.attribution ? clip(s.quote.attribution, 80) : undefined } : undefined,
          comparison: s.comparison ? {
            left:  { heading: clip(s.comparison.left?.heading, 40),  items: Array.isArray(s.comparison.left?.items)  ? s.comparison.left.items.slice(0, 5).map((x) => clip(x, 140))  : [] },
            right: { heading: clip(s.comparison.right?.heading, 40), items: Array.isArray(s.comparison.right?.items) ? s.comparison.right.items.slice(0, 5).map((x) => clip(x, 140)) : [] },
          } : undefined,
          timeline: Array.isArray(s.timeline) ? s.timeline.slice(0, 6).map((t) => ({ phase: clip(t?.phase, 40), description: clip(t?.description, 120) })) : undefined,
          matrix:   s.matrix ? { topLeft: clip(s.matrix.topLeft, 100), topRight: clip(s.matrix.topRight, 100), bottomLeft: clip(s.matrix.bottomLeft, 100), bottomRight: clip(s.matrix.bottomRight, 100), axisX: s.matrix.axisX ? clip(s.matrix.axisX, 30) : undefined, axisY: s.matrix.axisY ? clip(s.matrix.axisY, 30) : undefined } : undefined,
          org:      s.org ? { leader: clip(s.org.leader, 60), roles: Array.isArray(s.org.roles) ? s.org.roles.slice(0, 6).map((r) => clip(r, 80)) : [] } : undefined,
          infographic: Array.isArray(s.infographic?.items) ? { items: s.infographic.items.slice(0, 5).map((it) => ({ label: clip(it?.label, 40), value: clip(it?.value, 60) })) } : undefined,
          fullbleed: s.fullbleed ? { imagePrompt: s.fullbleed.imagePrompt ? clip(s.fullbleed.imagePrompt, 200) : undefined, overlayText: s.fullbleed.overlayText ? clip(s.fullbleed.overlayText, 200) : undefined } : undefined,
          // Phase 2: Consulting slide types
          case_study: s.case_study ? {
            challenge: clip(s.case_study.challenge, 200),
            solution: clip(s.case_study.solution, 200),
            role: clip(s.case_study.role, 200),
            benefits: clip(s.case_study.benefits, 200),
          } : undefined,
          architecture: Array.isArray(s.architecture?.components) ? { components: s.architecture.components.slice(0, 8).map((c) => ({ name: clip(c?.name, 50), description: clip(c?.description, 100) })) } : undefined,
          capability: Array.isArray(s.capability?.categories) ? { categories: s.capability.categories.slice(0, 4).map((cat) => ({ name: clip(cat?.name, 40), items: Array.isArray(cat?.items) ? cat.items.slice(0, 6).map((it) => clip(it, 80)) : [] })) } : undefined,
          risk: Array.isArray(s.risk?.items) ? { items: s.risk.items.slice(0, 5).map((r) => ({ risk: clip(r?.risk, 80), impact: clip(r?.impact, 60), mitigation: clip(r?.mitigation, 80) })) } : undefined,
          // Design
          takeaway: s.takeaway ? clip(s.takeaway, 220) : undefined,
          design: s.design ? {
            style: (["dark_technical", "light_consulting", "visual_case_study", "data_heavy", "process_flow"] as const).includes(s.design.style as any) ? s.design.style : undefined,
            template: s.design.template ? clip(s.design.template, 60) : undefined,
            visualPattern: s.design.visualPattern ? clip(s.design.visualPattern, 180) : undefined,
            iconHints: Array.isArray(s.design.iconHints) ? s.design.iconHints.slice(0, 6).map((x) => clip(x, 40)) : undefined,
          } : undefined,
          notes:    s.notes    ? clip(s.notes, 600)    : undefined,
        };
      });
    if (!slides.length) return null;
    return { title: clip(parsed.title || "Presentation", 140), slides };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const topic = (body.topic || "").trim();
  if (!topic) return NextResponse.json({ error: "Missing topic" }, { status: 400 });

  const slideCount = clamp(Number(body.slideCount ?? 8), 1, 20);
  const audience = (body.audience || "").trim();
  const tone = (body.tone || "professional").trim();
  const revisionInstruction = (body.revisionInstruction || "").trim();
  const currentSlides = Array.isArray(body.currentSlides) ? body.currentSlides.slice(0, 20) : [];
  const styleLibrary = body.useStyleLibrary !== false ? await readStyleLibrary() : [];
  const styleExamples = styleLibraryPrompt(styleLibrary);

  const config = resolveAiConfig(body);

  const system = `You are a senior management consultant from McKinsey/BCG/Bain. You produce executive board-ready presentations with STRATEGIC STORY INTELLIGENCE.

OUTPUT: a single JSON object — no prose, no markdown fences.

SCHEMA:
{
  "title": string,
  "slides": Slide[]
}
where Slide = {
  // PHASE 1: STORY INTELLIGENCE
  "story_intent"?: "show_urgency" | "build_confidence" | "demonstrate_value" | "explain_solution" | "risk_mitigation" | "call_to_action",  // Why this slide matters
  "audience"?: "CIO" | "CTO" | "CEO" | "Board" | "CFO" | "COO" | "VP_Engineering" | "Business_Leader",  // Who this is for
  "slide_type"?: "executive_summary" | "problem_opportunity" | "current_vs_future" | "roadmap" | "case_study" | "reference_architecture" | "operating_model" | "capability_map" | "value_realization" | "risk_mitigation" | "win_themes",  // Consulting slide category

  "kind":     "cover" | "section" | "content" | "closing",
  "layout"?:  "bullets" | "pillars" | "stats" | "quote" | "comparison" | "timeline" | "matrix" | "org" | "infographic" | "fullbleed" | "four_column_case" | "architecture" | "capability" | "risk_matrix",
  "kicker"?:  string,
  "title":    string,                  // ACTION TITLE — full insight sentence
  "subtitle"?: string,

  // Standard content
  "bullets"?: string[],
  "pillars"?: { "title": string, "body": string }[],
  "stats"?:   { "value": string, "label": string }[],
  "quote"?:   { "text": string, "attribution"?: string },
  "comparison"?: { "left": { "heading": string, "items": string[] }, "right": { "heading": string, "items": string[] } },
  "timeline"?: { "phase": string, "description": string }[],
  "matrix"?: { "topLeft": string, "topRight": string, "bottomLeft": string, "bottomRight": string, "axisX"?: string, "axisY"?: string },
  "org"?: { "leader": string, "roles": string[] },
  "infographic"?: { "items": { "label": string, "value": string }[] },
  "fullbleed"?: { "imagePrompt"?: string, "overlayText"?: string },

  // PHASE 2: CONSULTING SLIDE TYPES
  "case_study"?: { "challenge": string, "solution": string, "role": string, "benefits": string },  // 4-column case study
  "architecture"?: { "components": { "name": string, "description": string }[] },  // Reference architecture
  "capability"?: { "categories": { "name": string, "items": string[] }[] },  // Capability map
  "risk"?: { "items": { "risk": string, "impact": string, "mitigation": string }[] },  // Risk matrix

  "takeaway"?: string,
  "notes"?:   string
}

STORY INTELLIGENCE RULES:
1. Every slide MUST have story_intent: what business outcome does this slide achieve?
2. Specify audience: who are we speaking to? (affects language, depth, emphasis)
3. Choose slide_type: maps to consulting slide templates (executive_summary, case_study, etc.)
4. Match layout to slide_type: case_study→four_column_case, roadmap→timeline, architecture→architecture, etc.

CONSULTING SLIDE TYPES:
- "executive_summary": high-level message for leadership
- "problem_opportunity": why change is needed
- "current_vs_future": transformation story
- "roadmap": phased delivery plan
- "case_study": 4-column proof point (Challenge/Solution/Role/Benefits)
- "reference_architecture": technical solution diagram
- "operating_model": governance/delivery structure
- "capability_map": scope and modules
- "value_realization": benefits and outcomes
- "risk_mitigation": delivery confidence
- "win_themes": proposal differentiation

LAYOUT MAPPING:
- case_study → four_column_case
- roadmap → timeline
- reference_architecture → architecture
- capability_map → capability
- risk_mitigation → risk_matrix

USE LAYOUTS STRATEGICALLY:
- "bullets": standard executive bullets
- "pillars": 3-4 parallel concepts with title + body
- "stats": 2-4 headline metrics (KPIs)
- "quote": powerful testimonial
- "comparison": before/after, pros/cons
- "timeline": phased roadmap (3-6 phases)
- "matrix": 2x2 strategic quadrant
- "org": team structure
- "infographic": visual data with large numbers
- "fullbleed": dramatic visual (use sparingly)
- "four_column_case": Challenge | Solution | Apexon Role | Benefits
- "architecture": component names + descriptions
- "capability": category name + items list
- "risk_matrix": risk | impact | mitigation

CONSULTING-GRADE RULES:
1. ACTION TITLES — Every content slide title must be a full sentence stating the INSIGHT.
2. Each content slide must have a kicker (e.g. "CONTEXT", "DIAGNOSIS", "RECOMMENDATION").
3. Each content slide should have a takeaway — one-sentence "so what".
4. Vary layouts. Don't make every slide bullets.
5. Story intent drives content: show_urgency→emphasize cost of inaction; build_confidence→show proof points; demonstrate_value→quantify benefits.
6. Use 4-column case study for client proof points. Use capability map for scope definition. Use risk matrix for delivery confidence.
7. Tone: confident, declarative, executive. No hedging.`;

  const user = `Create a ${slideCount}-slide consulting-grade presentation.

Topic: ${topic}
${audience ? `Audience: ${audience}\n` : ""}Tone: ${tone}

Mix layouts and visual templates. The JSON must be written by you, including design.template for every slide. Do not default every slide to dark_technical or dark_capability_map.

MULTI-SLIDE REQUIREMENT:
The input contains detailed content with multiple distinct sections. Generate SEPARATE slides for:
- Executive summary / overview
- Client context / background
- Business challenge / problem statement
- Solution description
- Technology / platform approach
- Expected outcomes / benefits
- Call to action / next steps

Never compress detailed multi-section content into fewer than 3 slides. If the user provides 6+ distinct sections, create 6+ slides.

CASE STUDY SLIDE STRUCTURE:
When the topic describes a client case study (client context, challenge, solution, role, outcomes):
- Use layout: "four_column_case"
- Populate ALL case_study fields:
  - challenge: the business problem or pain point
  - solution: what was implemented/delivered
  - role: Apexon's involvement (e.g., "Implementation partner", "Solution architect")
  - benefits: quantified or qualitative outcomes
- Add kicker: "CASE STUDY"
- Add title: action title describing the outcome (e.g., "Platform-first approach enabled 40% faster MVP launch")
- Add takeaway: one-sentence business impact

STRUCTURE FIDELITY RULE:
Before writing JSON for each slide, identify the native structure of the user's content/reference. Preserve that structure first, then choose a template. Do not squeeze source material into a smaller or unrelated model.

Use this mapping:
- Lifecycle/process/roadmap/journey/stages/steps -> process_timeline. Preserve the actual number of stages up to 9 as pillars.
- Framework/capability map/architecture/operating model -> dark_capability_map or executive_summary depending on density.
- Today-vs-tomorrow/options/tradeoffs/vendor comparison -> comparison_matrix with comparison.left/right.
- Metrics/KPIs/value case/business case/benchmarks -> metric_dashboard with stats.
- Executive answer/recommendation/summary of 3 messages -> executive_summary with 3 pillars.
- Principle/quote/customer voice/key belief -> quote_focus.
- Short narrative/proof points -> clean_bullets.

If the source/reference has more items than the selected template usually shows, do one of these:
1. choose a template that can hold the item count,
2. split the content across multiple slides,
3. or summarize only when the user explicitly asks for simplification.
Never silently drop stages, columns, categories, metrics, or named entities from the source/reference.

Available templates:
- executive_summary: one-page answer with 3 insight cards and a recommendation band
- dark_capability_map: dark technical capability slide with icon row and modular capability cards
- clean_bullets: clean consulting action-title slide for concise points
- process_timeline: staged roadmap/process flow; use all actual stages from the source/reference, up to 9
- metric_dashboard: headline numbers and KPI cards
- comparison_matrix: two-column comparison, today vs tomorrow, options, or tradeoffs
- quote_focus: strong quote or principle with supporting implication

Use dark_capability_map only for technical architecture/capability maps. For strategy narrative, use executive_summary, clean_bullets, comparison_matrix, process_timeline, or metric_dashboard as appropriate. Action titles, kickers, and takeaways are mandatory on content slides.

If the user asks to follow an uploaded/reference slide, use it as the structure and style source. Do not retrofit its content into a different built-in model. For lifecycle/process slides, keep the same stage count and express each stage as one pillar item with a short title and body.

For a 1-slide request, make the slide self-contained, dense, and focused: title, kicker, 3-5 strong points, and a takeaway. Do not waste the slide on a decorative cover.

${revisionInstruction ? `Revise the existing draft instead of starting from scratch. Preserve what is good, apply the user's instruction, and return the complete updated JSON deck.\n\nUSER REVISION INSTRUCTION:\n${revisionInstruction}\n\nCURRENT DRAFT JSON:\n${JSON.stringify({ title: topic, slides: currentSlides }, null, 2)}\n` : ""}

${styleExamples ? `Use these uploaded reference slide styles as the private style memory. Choose the best design.style, visualPattern, and iconHints for each slide; do not ask the user to choose.\n\nREFERENCE STYLE MEMORY:\n${styleExamples}\n` : "No uploaded reference style memory is available yet; choose clean consulting styles automatically."}

Return only the JSON object described in the schema.`;

  try {
    const raw = await callLLM(
      [{ role: "system", content: system }, { role: "user", content: user }],
      config,
      true
    );
    const parsed = tryParseDeck(raw);
    if (!parsed) {
      return NextResponse.json({ error: "Model did not return valid deck JSON", raw }, { status: 502 });
    }
    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
