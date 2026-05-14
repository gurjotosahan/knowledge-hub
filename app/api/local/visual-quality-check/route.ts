import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

// Visual QA Configuration
const VISUAL_RULES = {
  minContrastRatio: 4.5,  // WCAG AA for text
  maxColorsPerSlide: 6,
  minTitleFontSize: 24,
  minBodyFontSize: 12,
  maxBulletsPerSlide: 6,
  minBulletSpacing: 20,
  requireVisualHierarchy: true,
  maxWhitespaceRatio: 0.8,
  minContentRatio: 0.2,
};

type IssueSeverity = "critical" | "warning" | "info";

interface VisualIssue {
  slideIndex: number;
  slideTitle: string;
  category: "color" | "typography" | "layout" | "hierarchy" | "consistency";
  severity: IssueSeverity;
  message: string;
  repairInstruction?: string;
}

interface VisualScore {
  overall: number;
  breakdown: {
    color: number;
    typography: number;
    layout: number;
    hierarchy: number;
    consistency: number;
  };
  pass: boolean;
}

interface ThemeAnalysis {
  primaryColor: string | null;
  accentColor: string | null;
  fontFamily: string | null;
  slideWidth: number;
  slideHeight: number;
  colorPalette: string[];
}

// Parse hex color to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

// Calculate relative luminance
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// Calculate contrast ratio between two colors
function getContrastRatio(color1: string, color2: string): number {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  if (!rgb1 || !rgb2) return 0;

  const l1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

// Analyze theme consistency
function analyzeTheme(theme: any): VisualIssue[] {
  const issues: VisualIssue[] = [];

  if (!theme) {
    issues.push({
      slideIndex: -1,
      slideTitle: "Theme",
      category: "consistency",
      severity: "critical",
      message: "No theme provided for visual analysis",
      repairInstruction: "Provide a theme object with colors and fonts"
    });
    return issues;
  }

  // Check for required theme colors
  const requiredColors = ['primary', 'accent', 'background'];
  const missingColors = requiredColors.filter(c => !theme[c]);

  if (missingColors.length > 0) {
    issues.push({
      slideIndex: -1,
      slideTitle: "Theme",
      category: "color",
      severity: "critical",
      message: `Missing required theme colors: ${missingColors.join(", ")}`,
      repairInstruction: "Define primary, accent, and background colors in theme"
    });
  }

  // Check color palette size
  if (theme.colors && theme.colors.length > VISUAL_RULES.maxColorsPerSlide) {
    issues.push({
      slideIndex: -1,
      slideTitle: "Theme",
      category: "color",
      severity: "warning",
      message: `Theme has ${theme.colors.length} colors (recommended max: ${VISUAL_RULES.maxColorsPerSlide})`,
      repairInstruction: "Consolidate to a simpler palette of 4-6 colors"
    });
  }

  // Check font family
  if (!theme.font) {
    issues.push({
      slideIndex: -1,
      slideTitle: "Theme",
      category: "typography",
      severity: "warning",
      message: "No font family specified in theme",
      repairInstruction: "Define a primary font family for consistency"
    });
  }

  return issues;
}

// Analyze a single slide's visual quality
function analyzeSlideVisual(slide: any, theme: any, index: number): VisualIssue[] {
  const issues: VisualIssue[] = [];
  const title = slide.title || "(no title)";
  const slideType = slide.layout || slide.slide_type || "bullets";

  // 1. TYPOGRAPHY CHECKS

  // Check title font size (if specified)
  if (slide.titleFontSize && slide.titleFontSize < VISUAL_RULES.minTitleFontSize) {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "typography",
      severity: "warning",
      message: `Title font size (${slide.titleFontSize}pt) is below minimum (${VISUAL_RULES.minTitleFontSize}pt)`,
      repairInstruction: "Increase title font size to at least 24pt for readability"
    });
  }

  // Check body font size
  if (slide.bodyFontSize && slide.bodyFontSize < VISUAL_RULES.minBodyFontSize) {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "typography",
      severity: "warning",
      message: `Body font size (${slide.bodyFontSize}pt) is below minimum (${VISUAL_RULES.minBodyFontSize}pt)`,
      repairInstruction: "Increase body text to at least 12pt"
    });
  }

  // 2. COLOR CONTRAST CHECKS

  // Check title color contrast
  if (slide.titleColor && theme?.background) {
    const contrast = getContrastRatio(slide.titleColor, theme.background);
    if (contrast < VISUAL_RULES.minContrastRatio) {
      issues.push({
        slideIndex: index,
        slideTitle: title.substring(0, 30),
        category: "color",
        severity: "critical",
        message: `Title color contrast (${contrast.toFixed(1)}:1) is below WCAG AA (${VISUAL_RULES.minContrastRatio}:1)`,
        repairInstruction: "Use a darker title color or lighter background"
      });
    }
  }

  // Check body text contrast
  if (slide.bodyColor && theme?.background) {
    const contrast = getContrastRatio(slide.bodyColor, theme.background);
    if (contrast < VISUAL_RULES.minContrastRatio) {
      issues.push({
        slideIndex: index,
        slideTitle: title.substring(0, 30),
        category: "color",
        severity: "warning",
        message: `Body text contrast (${contrast.toFixed(1)}:1) is below recommended (${VISUAL_RULES.minContrastRatio}:1)`,
        repairInstruction: "Ensure body text has sufficient contrast"
      });
    }
  }

  // 3. LAYOUT CHECKS

  // Check bullet count
  const bulletCount = slide.bullets?.length || 0;
  if (bulletCount > VISUAL_RULES.maxBulletsPerSlide) {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "layout",
      severity: "warning",
      message: `Slide has ${bulletCount} bullets (recommended max: ${VISUAL_RULES.maxBulletsPerSlide})`,
      repairInstruction: "Reduce to 5-6 bullets max. Consider splitting into multiple slides"
    });
  }

  // Check for content density
  const contentElements = [
    slide.bullets?.length || 0,
    slide.pillars?.length || 0,
    slide.stats?.length || 0,
    slide.risk?.items?.length || 0,
    slide.capability?.categories?.length || 0
  ].reduce((a, b) => a + b, 0);

  if (contentElements === 0 && slide.layout !== "fullbleed" && slide.layout !== "quote") {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "layout",
      severity: "warning",
      message: "Slide appears empty with no content elements",
      repairInstruction: "Add content (bullets, stats, pillars) to the slide"
    });
  }

  // 4. HIERARCHY CHECKS

  // Check for kicker (helps visual hierarchy)
  if (!slide.kicker && slide.kind === "content") {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "hierarchy",
      severity: "info",
      message: "Content slide missing kicker for visual hierarchy",
      repairInstruction: "Add a kicker (CONTEXT, DIAGNOSIS, RECOMMENDATION) to establish hierarchy"
    });
  }

  // Check for takeaway (visual anchor at bottom)
  if (!slide.takeaway && slide.kind === "content") {
    issues.push({
      slideIndex: index,
      slideTitle: title.substring(0, 30),
      category: "hierarchy",
      severity: "info",
      message: "Content slide missing takeaway for visual closure",
      repairInstruction: "Add a takeaway sentence at the bottom to anchor the slide"
    });
  }

  // 5. SLIDE TYPE SPECIFIC CHECKS

  // Stats slides should have proper stat formatting
  if (slideType === "stats" && slide.stats) {
    slide.stats.forEach((stat: any, i: number) => {
      if (stat.value && stat.value.length > 10) {
        issues.push({
          slideIndex: index,
          slideTitle: title.substring(0, 30),
          category: "typography",
          severity: "warning",
          message: `Stat ${i+1} value too long for visual impact: "${stat.value}"`,
          repairInstruction: "Keep stat values short (e.g., '42%' not '42 percent')"
        });
      }

      if (!stat.label) {
        issues.push({
          slideIndex: index,
          slideTitle: title.substring(0, 30),
          category: "hierarchy",
          severity: "warning",
          message: `Stat ${i+1} missing label for context`,
          repairInstruction: "Add a label below each stat for context"
        });
      }
    });
  }

  // Pillar slides should have consistent pillar height
  if (slideType === "pillars" && slide.pillars) {
    const pillarBodies = slide.pillars.map((p: any) => p.body?.length || 0);
    const avgLength = pillarBodies.reduce((a: number, b: number) => a + b, 0) / pillarBodies.length;
    const maxVariation = Math.max(...pillarBodies) - Math.min(...pillarBodies);

    if (maxVariation > avgLength * 0.5) {
      issues.push({
        slideIndex: index,
        slideTitle: title.substring(0, 30),
        category: "layout",
        severity: "warning",
        message: "Pillars have uneven content length, causing visual imbalance",
        repairInstruction: "Balance pillar content so they're similar in length"
      });
    }
  }

  // Architecture slides should have consistent component sizing
  if (slideType === "architecture" && slide.architecture?.components) {
    const componentCount = slide.architecture.components.length;
    if (componentCount > 8) {
      issues.push({
        slideIndex: index,
        slideTitle: title.substring(0, 30),
        category: "layout",
        severity: "warning",
        message: `Architecture has ${componentCount} components (may be too crowded)`,
        repairInstruction: "Group components into higher-level categories or use sub-diagrams"
      });
    }
  }

  // Case study slides should have all four columns
  if (slideType === "four_column_case" || slideType === "case_study") {
    const cs = slide.case_study;
    const missingFields: string[] = [];
    if (!cs?.challenge) missingFields.push("challenge");
    if (!cs?.solution) missingFields.push("solution");
    if (!cs?.role) missingFields.push("role");
    if (!cs?.benefits) missingFields.push("benefits");

    if (missingFields.length > 0) {
      issues.push({
        slideIndex: index,
        slideTitle: title.substring(0, 30),
        category: "consistency",
        severity: "warning",
        message: `Case study missing fields: ${missingFields.join(", ")}`,
        repairInstruction: "Provide all four case study sections for balanced layout"
      });
    }
  }

  // 6. CONSISTENCY CHECKS

  // Check if slide uses theme colors appropriately
  if (theme?.primary && slide.titleColor) {
    // Title should typically use primary or a dark color
    const titleContrastWithPrimary = getContrastRatio(slide.titleColor, theme.primary);
    if (titleContrastWithPrimary < 2) {
      issues.push({
        slideIndex: index,
        slideTitle: title.substring(0, 30),
        category: "consistency",
        severity: "info",
        message: "Title color may not align with theme primary",
        repairInstruction: "Consider using theme's primary color for titles"
      });
    }
  }

  return issues;
}

// Calculate visual score
function calculateVisualScore(issues: VisualIssue[]): VisualScore {
  const criticalCount = issues.filter(i => i.severity === "critical").length;
  const warningCount = issues.filter(i => i.severity === "warning").length;
  const infoCount = issues.filter(i => i.severity === "info").length;

  // Deduct points
  const deductions = criticalCount * 20 + warningCount * 5 + infoCount * 1;
  const overall = Math.max(0, 100 - deductions);

  // Category breakdown
  const colorIssues = issues.filter(i => i.category === "color").length;
  const typographyIssues = issues.filter(i => i.category === "typography").length;
  const layoutIssues = issues.filter(i => i.category === "layout").length;
  const hierarchyIssues = issues.filter(i => i.category === "hierarchy").length;
  const consistencyIssues = issues.filter(i => i.category === "consistency").length;

  return {
    overall,
    breakdown: {
      color: Math.max(0, 100 - colorIssues * 12),
      typography: Math.max(0, 100 - typographyIssues * 10),
      layout: Math.max(0, 100 - layoutIssues * 8),
      hierarchy: Math.max(0, 100 - hierarchyIssues * 6),
      consistency: Math.max(0, 100 - consistencyIssues * 8),
    },
    pass: criticalCount === 0 && overall >= 65,
  };
}

// Main handler
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { slides, theme } = body;

    if (!Array.isArray(slides) || slides.length === 0) {
      return NextResponse.json({ error: "No slides provided" }, { status: 400 });
    }

    // Analyze theme first
    const themeIssues = analyzeTheme(theme);

    // Analyze each slide
    const allIssues: VisualIssue[] = [...themeIssues];
    slides.forEach((slide, index) => {
      const issues = analyzeSlideVisual(slide, theme, index);
      allIssues.push(...issues);
    });

    // Calculate score
    const score = calculateVisualScore(allIssues);

    // Group by severity
    const critical = allIssues.filter(i => i.severity === "critical");
    const warnings = allIssues.filter(i => i.severity === "warning");
    const info = allIssues.filter(i => i.severity === "info");

    // Group by category
    const byCategory = {
      color: allIssues.filter(i => i.category === "color").length,
      typography: allIssues.filter(i => i.category === "typography").length,
      layout: allIssues.filter(i => i.category === "layout").length,
      hierarchy: allIssues.filter(i => i.category === "hierarchy").length,
      consistency: allIssues.filter(i => i.category === "consistency").length,
    };

    const summary = {
      totalSlides: slides.length,
      totalIssues: allIssues.length,
      critical: critical.length,
      warnings: warnings.length,
      info: info.length,
      byCategory,
    };

    // Generate repair plan if needed
    const repairPlan = score.pass ? null : {
      action: "Apply visual corrections",
      criticalIssues: critical.map(i => ({
        slide: i.slideIndex >= 0 ? i.slideIndex + 1 : "theme",
        instruction: i.repairInstruction,
      })),
      priorityFixes: warnings.slice(0, 5).map(i => ({
        slide: i.slideIndex >= 0 ? i.slideIndex + 1 : "theme",
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