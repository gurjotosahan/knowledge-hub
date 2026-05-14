import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

// QA Rules Configuration
const QA_RULES = {
  maxWordsPerSlide: 120,
  minTitleLength: 5,
  maxTitleLength: 100,
  minBulletLength: 10,
  maxBulletLength: 100,
  minStatsValueLength: 1,
  maxStatsValueLength: 10,
  maxPillars: 4,
  maxTimelinePhases: 6,
  maxRiskItems: 5,
  maxCapabilityCategories: 4,
  maxCapabilityItemsPerCategory: 6,
};

// Quality issue severity levels
type IssueSeverity = "critical" | "warning" | "info";

interface QualityIssue {
  slideIndex: number;
  slideTitle: string;
  category: string;
  severity: IssueSeverity;
  message: string;
  repairInstruction?: string;
}

interface QualityScore {
  overall: number;
  breakdown: {
    content: number;      // Words, bullets, text density
    structure: number;     // Layout, type matching
    messaging: number;     // Title quality, story intent
    design: number;        // Visual rules, spacing
  };
  issues: QualityIssue[];
  pass: boolean;
}

// Helper to check if title is an "insight" (action title) vs a label
function isActionTitle(title: string): boolean {
  if (!title) return false;
  const titleLower = title.toLowerCase();

  // Labels (bad) - short, generic, no verb
  const labelPatterns = [
    "overview", "summary", "introduction", "background", "context",
    "agenda", "table of contents", "title", "slide", "page",
    "chart", "graph", "diagram", "figure", "table"
  ];

  // Check if title matches any label pattern
  if (labelPatterns.some(p => titleLower === p || titleLower.includes(p))) {
    return false;
  }

  // Action titles (good) - have verbs, specific, longer
  const hasVerb = /\b(is|are|was|were|will|can|should|would|could|have|has|do|does|shows|demonstrates|reveals|delivers|enables|reduces|increases|accelerates|transforms|unlocks|drives|creates|builds|improves|addresses|solves)\b/i.test(title);
  const isSpecific = title.split(" ").length >= 4;
  const hasCapital = /^[A-Z]/.test(title);

  return hasVerb || (isSpecific && hasCapital);
}

// Analyze a single slide for quality issues
function analyzeSlide(slide: any, index: number): QualityIssue[] {
  const issues: QualityIssue[] = [];

  if (!slide) return issues;

  const title = slide.title || "";
  const slideType = slide.slide_type || slide.layout || "bullets";

  // 1. TITLE QUALITY CHECK
  if (!title || title.trim().length === 0) {
    issues.push({
      slideIndex: index,
      slideTitle: "(empty)",
      category: "messaging",
      severity: "critical",
      message: "Slide has no title",
      repairInstruction: "Add an action title - a full sentence stating the insight"
    });
  } else if (!isActionTitle(title)) {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 50),
      category: "messaging",
      severity: "warning",
      message: `Title "${title.substring(0, 30)}..." appears to be a label, not an insight`,
      repairInstruction: "Rewrite as an action title (e.g., 'Three factors are reshaping the market' vs 'Market Overview')"
    });
  }

  // 2. WORD COUNT CHECK
  const contentFields = [
    slide.bullets?.join(" "),
    slide.pillars?.map((p: any) => p.body).join(" "),
    slide.case_study?.challenge,
    slide.case_study?.solution,
    slide.case_study?.role,
    slide.case_study?.benefits,
    slide.takeaway,
  ].filter(Boolean).join(" ");

  const wordCount = contentFields.split(/\s+/).filter(Boolean).length;

  if (wordCount > QA_RULES.maxWordsPerSlide) {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "content",
      severity: "warning",
      message: `Slide has ${wordCount} words (recommended max: ${QA_RULES.maxWordsPerSlide})`,
      repairInstruction: "Compress content by 30%. Use shorter bullets, remove redundant phrases."
    });
  }

  // 3. STRUCTURE CHECK - verify slide type matches content
  if (slide.case_study && slide.layout !== "four_column_case" && slide.slide_type !== "case_study") {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "structure",
      severity: "info",
      message: "Slide has case_study data but not using four_column_case layout",
      repairInstruction: "Set layout to 'four_column_case' for proper rendering"
    });
  }

  if (slide.architecture?.components?.length > 0 && slide.layout !== "architecture") {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "structure",
      severity: "info",
      message: "Slide has architecture data but not using architecture layout",
      repairInstruction: "Set layout to 'architecture'"
    });
  }

  if (slide.risk?.items?.length > 0 && slide.layout !== "risk_matrix") {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "structure",
      severity: "info",
      message: "Slide has risk data but not using risk_matrix layout",
      repairInstruction: "Set layout to 'risk_matrix'"
    });
  }

  if (slide.capability?.categories?.length > 0 && slide.layout !== "capability") {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "structure",
      severity: "info",
      message: "Slide has capability data but not using capability layout",
      repairInstruction: "Set layout to 'capability'"
    });
  }

  // 4. KICKER CHECK
  if (!slide.kicker && slide.kind === "content") {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "messaging",
      severity: "warning",
      message: "Content slide missing kicker (e.g., CONTEXT, DIAGNOSIS, RECOMMENDATION)",
      repairInstruction: "Add a kicker - short uppercase tag that sets context"
    });
  }

  // 5. TAKEAWAY CHECK
  if (!slide.takeaway && slide.kind === "content") {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "messaging",
      severity: "warning",
      message: "Content slide missing takeaway (one-sentence 'so what')",
      repairInstruction: "Add a takeaway - one sentence that reinforces the title"
    });
  }

  // 6. STORY INTENT CHECK
  if (!slide.story_intent && slide.kind === "content") {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "messaging",
      severity: "info",
      message: "Slide missing story_intent (why this slide matters)",
      repairInstruction: "Add story_intent: show_urgency, build_confidence, demonstrate_value, explain_solution, or call_to_action"
    });
  }

  // 7. AUDIENCE CHECK
  if (!slide.audience) {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "messaging",
      severity: "info",
      message: "Slide missing audience (who is this for)",
      repairInstruction: "Add audience: CIO, CTO, CEO, Board, CFO, COO, etc."
    });
  }

  // 8. STATS FORMAT CHECK
  if (slide.stats) {
    slide.stats.forEach((stat: any, i: number) => {
      if (stat.value && stat.value.length > QA_RULES.maxStatsValueLength) {
        issues.push({
          slideIndex: index,
          slideTitle: title.substring(0, 30),
          category: "design",
          severity: "warning",
          message: `Stat ${i+1} value "${stat.value}" exceeds ${QA_RULES.maxStatsValueLength} chars`,
          repairInstruction: "Shorten value (e.g., '42%' vs '42 percent reduction')"
        });
      }
    });
  }

  // 9. PILLARS COUNT CHECK
  if (slide.pillars && slide.pillars.length > QA_RULES.maxPillars) {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "content",
      severity: "warning",
      message: `Slide has ${slide.pillars.length} pillars (recommended max: ${QA_RULES.maxPillars})`,
      repairInstruction: "Reduce to 3-4 pillars for better visual clarity"
    });
  }

  // 10. RISK ITEMS CHECK
  if (slide.risk?.items && slide.risk.items.length > QA_RULES.maxRiskItems) {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "content",
      severity: "warning",
      message: `Risk matrix has ${slide.risk.items.length} items (recommended max: ${QA_RULES.maxRiskItems})`,
      repairInstruction: "Focus on top 5 risks with highest impact"
    });
  }

  return issues;
}

// Calculate quality score based on issues
function calculateScore(issues: QualityIssue[]): QualityScore {
  const criticalCount = issues.filter(i => i.severity === "critical").length;
  const warningCount = issues.filter(i => i.severity === "warning").length;
  const infoCount = issues.filter(i => i.severity === "info").length;

  // Deduct points for issues
  const deductions = criticalCount * 15 + warningCount * 5 + infoCount * 1;
  const overall = Math.max(0, 100 - deductions);

  // Calculate breakdown
  const contentIssues = issues.filter(i => i.category === "content").length;
  const structureIssues = issues.filter(i => i.category === "structure").length;
  const messagingIssues = issues.filter(i => i.category === "messaging").length;
  const designIssues = issues.filter(i => i.category === "design").length;

  return {
    overall,
    breakdown: {
      content: Math.max(0, 100 - contentIssues * 10),
      structure: Math.max(0, 100 - structureIssues * 5),
      messaging: Math.max(0, 100 - messagingIssues * 8),
      design: Math.max(0, 100 - designIssues * 8),
    },
    issues: issues,
    pass: criticalCount === 0 && overall >= 70,
  };
}

// Main handler
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const slides = body.slides;

    if (!Array.isArray(slides) || slides.length === 0) {
      return NextResponse.json({ error: "No slides provided" }, { status: 400 });
    }

    // Analyze all slides
    const allIssues: QualityIssue[] = [];
    slides.forEach((slide, index) => {
      const issues = analyzeSlide(slide, index);
      allIssues.push(...issues);
    });

    // Calculate overall score
    const score = calculateScore(allIssues);

    // Group issues by severity
    const critical = allIssues.filter(i => i.severity === "critical");
    const warnings = allIssues.filter(i => i.severity === "warning");
    const info = allIssues.filter(i => i.severity === "info");

    // Generate summary
    const summary = {
      totalSlides: slides.length,
      totalIssues: allIssues.length,
      critical: critical.length,
      warnings: warnings.length,
      info: info.length,
    };

    // Generate repair plan if needed
    const repairPlan = score.pass ? null : {
      action: "Regenerate with corrections",
      priorityIssues: critical.map(i => ({
        slide: i.slideIndex + 1,
        instruction: i.repairInstruction,
      })),
      secondaryIssues: warnings.slice(0, 5).map(i => ({
        slide: i.slideIndex + 1,
        instruction: i.repairInstruction,
      })),
    };

    return NextResponse.json({
      score,
      summary,
      issues: allIssues,
      repairPlan,
    });

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}