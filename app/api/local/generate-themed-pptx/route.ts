import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import PptxGenJS from "pptxgenjs";

export const maxDuration = 120;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ThemeColors {
  bg: string; text: string;
  accent1: string; accent2: string; accent3: string;
  accent4: string; accent5: string; accent6: string;
}

type SlideLayout = "bullets" | "pillars" | "stats" | "quote" | "comparison" | "timeline" | "matrix" | "org" | "infographic" | "fullbleed" | "four_column_case" | "architecture" | "capability" | "risk_matrix";

interface SlideInput {
  // Story Intelligence
  story_intent?: string;
  audience?: string;
  slide_type?: string;
  // Basic
  kind: "cover" | "section" | "content" | "closing";
  layout?: SlideLayout;
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
  // Consulting slide types
  case_study?: { challenge: string; solution: string; role: string; benefits: string };
  architecture?: { components: { name: string; description: string }[] };
  capability?: { categories: { name: string; items: string[] }[] };
  risk?: { items: { risk: string; impact: string; mitigation: string }[] };
  // Design
  takeaway?: string;
  design?: {
    style?: string;
    visualPattern?: string;
    iconHints?: string[];
  };
  notes?: string;
}

interface Body {
  title?: string;
  slides: SlideInput[];
  theme?: {
    colors?: Partial<ThemeColors>;
    fonts?: { major?: string; minor?: string };
    slideSize?: { widthIn?: number; heightIn?: number };
  };
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_COLORS: ThemeColors = {
  bg: "FFFFFF", text: "1A2233",
  accent1: "0D5FBC", accent2: "1F3A68", accent3: "00A3A1",
  accent4: "F4B400", accent5: "C8102E", accent6: "5C2D91",
};

const OUT_DIR = join(tmpdir(), "kh-generated-pptx");

// ── Utilities ────────────────────────────────────────────────────────────────

function safeFilename(name: string): string {
  return (name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "presentation") + ".pptx";
}

function darken(hex: string, amount = 0.2): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const k = 1 - amount;
  const to = (n: number) => Math.max(0, Math.min(255, Math.round(n * k))).toString(16).padStart(2, "0");
  return (to(r) + to(g) + to(b)).toUpperCase();
}

function lighten(hex: string, amount = 0.85): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const to = (n: number) => Math.round(n + (255 - n) * amount).toString(16).padStart(2, "0");
  return (to(r) + to(g) + to(b)).toUpperCase();
}

function gray(value: number): string {
  const v = Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
  return (v + v + v).toUpperCase();
}

// Pad slide index for nice "01 / 09" footers
function pad2(n: number): string { return String(n).padStart(2, "0"); }

// Auto-pick layout if missing on a content slide
function inferLayout(s: SlideInput): SlideLayout {
  if (s.layout) return s.layout;
  if (s.stats && s.stats.length) return "stats";
  if (s.pillars && s.pillars.length) return "pillars";
  if (s.quote && s.quote.text) return "quote";
  if (s.comparison) return "comparison";
  if (s.timeline && s.timeline.length) return "timeline";
  if (s.matrix) return "matrix";
  if (s.org) return "org";
  if (s.infographic?.items?.length) return "infographic";
  if (s.fullbleed) return "fullbleed";
  if (s.case_study) return "four_column_case";
  if (s.architecture?.components?.length) return "architecture";
  if (s.capability?.categories?.length) return "capability";
  if (s.risk?.items?.length) return "risk_matrix";
  return "bullets";
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!Array.isArray(body.slides) || body.slides.length === 0) {
    return NextResponse.json({ error: "No slides provided" }, { status: 400 });
  }

  const colors: ThemeColors = { ...DEFAULT_COLORS, ...(body.theme?.colors ?? {}) };
  const fontMajor = body.theme?.fonts?.major || "Calibri";
  const fontMinor = body.theme?.fonts?.minor || "Calibri";
  const widthIn   = body.theme?.slideSize?.widthIn  || 13.333;
  const heightIn  = body.theme?.slideSize?.heightIn || 7.5;

  // Spacing tokens — wider margins for consulting style
  const M = {
    left: 0.7,
    right: 0.7,
    top: 0.65,
    bottom: 0.65,
  };
  const contentW = widthIn - M.left - M.right;

  // Color tokens
  const accent     = colors.accent1;
  const accentDark = darken(accent, 0.25);
  const accentSoft = lighten(accent, 0.88);
  const muted      = gray(120);
  const rule       = gray(200);
  const cardBg     = gray(248);

  // ── PPTX scaffold ──────────────────────────────────────────────────────────

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "KH_THEMED", width: widthIn, height: heightIn });
  pptx.layout = "KH_THEMED";

  pptx.title    = body.title || body.slides[0]?.title || "Presentation";
  pptx.author   = "Apexon KM360";
  pptx.company  = "Apexon";

  const totalSlides = body.slides.length;

  // Master used by content/section/closing — title rule, footer divider, page mark
  pptx.defineSlideMaster({
    title: "BASE",
    background: { color: colors.bg },
    objects: [
      // Top-right brand mark
      {
        text: {
          text: (body.title || pptx.title || "").toUpperCase(),
          options: {
            x: widthIn - 4.5, y: 0.28, w: 4, h: 0.25,
            fontFace: fontMinor, fontSize: 8, color: muted, charSpacing: 2,
            align: "right", valign: "middle",
          },
        },
      },
      // Bottom thin rule
      { line: {
        x: M.left, y: heightIn - 0.42, w: contentW, h: 0,
        line: { color: rule, width: 0.5 },
      } },
      // Bottom-left footer text
      {
        text: {
          text: "Confidential",
          options: {
            x: M.left, y: heightIn - 0.36, w: 3, h: 0.28,
            fontFace: fontMinor, fontSize: 8, color: muted, italic: true,
            align: "left", valign: "middle",
          },
        },
      },
    ],
    slideNumber: {
      x: widthIn - M.right - 1.2, y: heightIn - 0.36, w: 1.2, h: 0.28,
      fontFace: fontMinor, fontSize: 8, color: muted, align: "right",
    },
  });

  // ── Per-slide rendering helpers ────────────────────────────────────────────

  let slideIndex = 0;

  for (const s of body.slides) {
    slideIndex++;

    if (s.kind === "cover") {
      renderCover(pptx, s, { colors, accent, accentDark, fontMajor, fontMinor, widthIn, heightIn, M });
      if (s.notes) {/* added below */}
    } else if (s.kind === "section") {
      renderSection(pptx, s, slideIndex, totalSlides, { colors, accent, accentDark, fontMajor, fontMinor, widthIn, heightIn, M });
    } else if (s.kind === "closing") {
      renderClosing(pptx, s, { colors, accent, accentDark, fontMajor, fontMinor, widthIn, heightIn, M, muted });
    } else {
      const layout = inferLayout(s);
      const ctx = { colors, accent, accentDark, accentSoft, cardBg, muted, rule, fontMajor, fontMinor, widthIn, heightIn, M, contentW };
      if (s.design?.style === "dark_technical") {
        renderDarkTechnicalContent(pptx, s, ctx);
      } else switch (layout) {
        case "pillars":    renderContentPillars(pptx, s, ctx); break;
        case "stats":      renderContentStats(pptx, s, ctx); break;
        case "quote":      renderContentQuote(pptx, s, ctx); break;
        case "comparison": renderContentComparison(pptx, s, ctx); break;
        case "timeline":   renderContentTimeline(pptx, s, ctx); break;
        case "matrix":     renderContentMatrix(pptx, s, ctx); break;
        case "org":        renderContentOrg(pptx, s, ctx); break;
        case "infographic": renderContentInfographic(pptx, s, ctx); break;
        case "fullbleed":  renderContentFullbleed(pptx, s, ctx); break;
        // Phase 2: Consulting slide types
        case "four_column_case": renderContentFourColumnCase(pptx, s, ctx); break;
        case "architecture":     renderContentArchitecture(pptx, s, ctx); break;
        case "capability":       renderContentCapability(pptx, s, ctx); break;
        case "risk_matrix":      renderContentRiskMatrix(pptx, s, ctx); break;
        default:           renderContentBullets(pptx, s, ctx); break;
      }
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  try {
    await mkdir(OUT_DIR, { recursive: true });
    const filename = safeFilename(body.title || pptx.title);
    const outPath = join(OUT_DIR, `${randomUUID()}-${filename}`);
    const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    await writeFile(outPath, buf);
    return NextResponse.json({ path: outPath, filename, sizeBytes: buf.length, slideCount: body.slides.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Renderers ─────────────────────────────────────────────────────────────────

interface CommonCtx {
  colors: ThemeColors;
  accent: string;
  accentDark: string;
  fontMajor: string;
  fontMinor: string;
  widthIn: number;
  heightIn: number;
  M: { left: number; right: number; top: number; bottom: number };
}

interface ContentCtx extends CommonCtx {
  accentSoft: string;
  cardBg: string;
  muted: string;
  rule: string;
  contentW: number;
}

// ── Cover ────────────────────────────────────────────────────────────────────
function renderCover(pptx: PptxGenJS, s: SlideInput, ctx: CommonCtx) {
  const { colors, accent, accentDark, fontMajor, fontMinor, widthIn, heightIn, M } = ctx;
  const slide = pptx.addSlide();
  slide.background = { color: colors.bg };

  // Big left accent block
  slide.addShape("rect", {
    x: 0, y: 0, w: 0.45, h: heightIn,
    fill: { color: accent }, line: { type: "none" },
  });

  // Subtle deep panel for editorial feel (top-right)
  slide.addShape("rect", {
    x: widthIn * 0.55, y: 0, w: widthIn * 0.45, h: heightIn,
    fill: { color: lighten(accent, 0.94) }, line: { type: "none" },
  });

  // Bold accent stripe at top of right panel
  slide.addShape("rect", {
    x: widthIn * 0.55, y: 0, w: widthIn * 0.45, h: 0.18,
    fill: { color: accentDark }, line: { type: "none" },
  });

  // Kicker - larger and more prominent
  if (s.kicker) {
    slide.addText(s.kicker.toUpperCase(), {
      x: M.left + 0.3, y: heightIn * 0.26, w: widthIn - M.left - M.right - 0.3, h: 0.38,
      fontFace: fontMinor, fontSize: 13, bold: true, color: accentDark, charSpacing: 5,
      align: "left", valign: "middle",
    });
  }

  // Accent rule under kicker - longer
  slide.addShape("rect", {
    x: M.left + 0.3, y: heightIn * 0.34, w: 0.9, h: 0.07,
    fill: { color: accent }, line: { type: "none" },
  });

  // Title - much bigger for impact
  slide.addText(s.title, {
    x: M.left + 0.3, y: heightIn * 0.38, w: widthIn - M.left - M.right - 0.3, h: 2.4,
    fontFace: fontMajor, fontSize: 46, bold: true, color: colors.text,
    align: "left", valign: "top",
    paraSpaceAfter: 0,
  });

  // Subtitle - larger
  if (s.subtitle) {
    slide.addText(s.subtitle, {
      x: M.left + 0.3, y: heightIn * 0.68, w: widthIn - M.left - M.right - 0.3, h: 1.0,
      fontFace: fontMinor, fontSize: 18, color: gray(80),
      align: "left", valign: "top",
    });
  }

  // Footer: brand + date placeholder
  slide.addText("Apexon", {
    x: M.left + 0.3, y: heightIn - 0.85, w: 3, h: 0.3,
    fontFace: fontMinor, fontSize: 11, bold: true, color: colors.text,
    align: "left", valign: "middle",
  });
  slide.addShape("rect", {
    x: M.left + 0.3, y: heightIn - 0.55, w: 0.4, h: 0.04,
    fill: { color: accent }, line: { type: "none" },
  });

  if (s.notes) slide.addNotes(s.notes);
}

// ── Section divider ─────────────────────────────────────────────────────────
function renderSection(pptx: PptxGenJS, s: SlideInput, idx: number, total: number, ctx: CommonCtx) {
  const { colors, accent, fontMajor, fontMinor, widthIn, heightIn, M } = ctx;
  const slide = pptx.addSlide();
  slide.background = { color: colors.text };

  // Big number
  slide.addText(pad2(idx), {
    x: M.left, y: heightIn * 0.22, w: 3, h: 1.6,
    fontFace: fontMajor, fontSize: 80, bold: true, color: accent,
    align: "left", valign: "top",
  });

  // Counter (idx / total)
  slide.addText(`${pad2(idx)} / ${pad2(total)}`, {
    x: widthIn - M.right - 2, y: M.top, w: 2, h: 0.3,
    fontFace: fontMinor, fontSize: 10, color: lighten(colors.text, 0.6), charSpacing: 3,
    align: "right", valign: "middle",
  });

  // Kicker
  if (s.kicker) {
    slide.addText(s.kicker.toUpperCase(), {
      x: M.left, y: heightIn * 0.55, w: widthIn - M.left - M.right, h: 0.32,
      fontFace: fontMinor, fontSize: 11, bold: true, color: lighten(accent, 0.4), charSpacing: 4,
      align: "left", valign: "middle",
    });
  }

  // Title
  slide.addText(s.title, {
    x: M.left, y: heightIn * 0.6, w: widthIn - M.left - M.right, h: 1.6,
    fontFace: fontMajor, fontSize: 36, bold: true, color: "FFFFFF",
    align: "left", valign: "top",
  });

  // Accent line
  slide.addShape("rect", {
    x: M.left, y: heightIn * 0.85, w: 1.2, h: 0.07,
    fill: { color: accent }, line: { type: "none" },
  });

  if (s.notes) slide.addNotes(s.notes);
}

// ── Closing ──────────────────────────────────────────────────────────────────
function renderClosing(
  pptx: PptxGenJS, s: SlideInput,
  ctx: CommonCtx & { muted: string }
) {
  const { colors, accent, fontMajor, fontMinor, widthIn, M, muted } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });

  // Kicker
  slide.addText((s.kicker || "Next steps").toUpperCase(), {
    x: M.left, y: M.top + 0.15, w: widthIn - M.left - M.right, h: 0.32,
    fontFace: fontMinor, fontSize: 11, bold: true, color: accent, charSpacing: 4,
    align: "left", valign: "middle",
  });

  // Accent rule
  slide.addShape("rect", {
    x: M.left, y: M.top + 0.55, w: 0.7, h: 0.06,
    fill: { color: accent }, line: { type: "none" },
  });

  // Title
  slide.addText(s.title, {
    x: M.left, y: M.top + 0.75, w: widthIn - M.left - M.right, h: 1.5,
    fontFace: fontMajor, fontSize: 32, bold: true, color: colors.text,
    align: "left", valign: "top",
  });

  // Subtitle
  if (s.subtitle) {
    slide.addText(s.subtitle, {
      x: M.left, y: M.top + 2.1, w: widthIn - M.left - M.right, h: 0.7,
      fontFace: fontMinor, fontSize: 16, color: muted,
      align: "left", valign: "top",
    });
  }

  // Numbered next-steps cards
  const steps = (s.bullets || []).filter((b) => b.trim()).slice(0, 4);
  if (steps.length) {
    const colW = (widthIn - M.left - M.right - 0.3 * (steps.length - 1)) / steps.length;
    const rowY = M.top + 3.3;
    steps.forEach((step, i) => {
      const x = M.left + i * (colW + 0.3);
      slide.addShape("rect", {
        x, y: rowY, w: colW, h: 2.2,
        fill: { color: "FFFFFF" }, line: { color: "E2E2E2", width: 0.75 },
      });
      slide.addShape("rect", {
        x, y: rowY, w: colW, h: 0.06,
        fill: { color: accent }, line: { type: "none" },
      });
      slide.addText(pad2(i + 1), {
        x: x + 0.3, y: rowY + 0.25, w: colW - 0.6, h: 0.6,
        fontFace: fontMajor, fontSize: 28, bold: true, color: accent,
        align: "left", valign: "top",
      });
      slide.addText(step, {
        x: x + 0.3, y: rowY + 0.95, w: colW - 0.6, h: 1.15,
        fontFace: fontMinor, fontSize: 13, color: colors.text,
        align: "left", valign: "top",
      });
    });
  }

  if (s.notes) slide.addNotes(s.notes);
}

// ── Content title block (action title + kicker) ─────────────────────────────
function renderTitleBlock(slide: PptxGenJS.Slide, s: SlideInput, ctx: ContentCtx, opts?: { titleH?: number }) {
  const { colors, accent, accentDark, fontMajor, fontMinor, widthIn, M, muted } = ctx;
  const titleH = opts?.titleH ?? 1.0;

  // Kicker
  if (s.kicker) {
    slide.addText(s.kicker.toUpperCase(), {
      x: M.left, y: M.top, w: widthIn - M.left - M.right, h: 0.28,
      fontFace: fontMinor, fontSize: 10, bold: true, color: accentDark, charSpacing: 4,
      align: "left", valign: "middle",
    });
  }

  // Action title — larger for consulting impact
  slide.addText(s.title, {
    x: M.left, y: M.top + (s.kicker ? 0.35 : 0), w: widthIn - M.left - M.right - 0.3, h: titleH,
    fontFace: fontMajor, fontSize: 26, bold: true, color: colors.text,
    align: "left", valign: "top",
    paraSpaceAfter: 0,
  });

  // Title underline (full-width thin rule + accent stub)
  const ruleY = M.top + (s.kicker ? 0.32 : 0) + titleH + 0.05;
  slide.addShape("rect", {
    x: M.left, y: ruleY, w: widthIn - M.left - M.right, h: 0.012,
    fill: { color: ctx.rule }, line: { type: "none" },
  });
  slide.addShape("rect", {
    x: M.left, y: ruleY - 0.005, w: 0.7, h: 0.04,
    fill: { color: accent }, line: { type: "none" },
  });

  // muted not used elsewhere here but kept for parity
  void muted;

  return ruleY + 0.08;
}

// ── Takeaway band ────────────────────────────────────────────────────────────
function renderTakeaway(slide: PptxGenJS.Slide, s: SlideInput, ctx: ContentCtx) {
  if (!s.takeaway) return;
  const { accent, accentSoft, fontMinor, widthIn, heightIn, M } = ctx;
  const y = heightIn - 1.35;
  slide.addShape("rect", {
    x: M.left, y, w: widthIn - M.left - M.right, h: 0.65,
    fill: { color: accentSoft }, line: { type: "none" },
  });
  slide.addShape("rect", {
    x: M.left, y, w: 0.08, h: 0.65,
    fill: { color: accent }, line: { type: "none" },
  });
  slide.addText("SO WHAT", {
    x: M.left + 0.22, y: y + 0.05, w: 1.0, h: 0.22,
    fontFace: fontMinor, fontSize: 9, bold: true, color: accent, charSpacing: 4,
    align: "left", valign: "middle",
  });
  slide.addText(s.takeaway, {
    x: M.left + 0.22, y: y + 0.25, w: widthIn - M.left - M.right - 0.3, h: 0.38,
    fontFace: fontMinor, fontSize: 12, italic: true, color: ctx.colors.text,
    align: "left", valign: "middle",
  });
}

// ── Reference-driven style: dark technical consulting slide ─────────────────
function renderDarkTechnicalContent(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { fontMajor, fontMinor, widthIn, heightIn, M } = ctx;
  const slide = pptx.addSlide();
  const bg = "070B14";
  const panel = "111A2C";
  const panel2 = "17243B";
  const orange = "F04A24";
  const white = "FFFFFF";
  const muted = "CBD5E1";

  slide.background = { color: bg };

  // Subtle bottom wave bands to mimic polished technical templates.
  slide.addShape("arc", {
    x: -0.6, y: heightIn - 2.2, w: widthIn + 1.2, h: 2.8,
    line: { color: "142447", transparency: 30, width: 16 },
    adjustPoint: 0.25,
  } as any);
  slide.addShape("arc", {
    x: 1.4, y: heightIn - 1.8, w: widthIn + 0.5, h: 2.2,
    line: { color: "1B315D", transparency: 45, width: 10 },
    adjustPoint: 0.35,
  } as any);

  slide.addText(s.title, {
    x: M.left, y: 0.55, w: widthIn - M.left - M.right, h: 0.7,
    fontFace: fontMajor, fontSize: 28, bold: true, color: white,
    align: "left", valign: "top",
    fit: "shrink",
  });

  const iconHints = (s.design?.iconHints?.length ? s.design.iconHints : ["Stability", "Scalability", "Experience", "Reliability"]).slice(0, 4);
  const topY = 1.65;
  const labelW = 2.1;
  slide.addShape("chevron", {
    x: M.left, y: topY + 0.05, w: labelW, h: 0.55,
    fill: { color: white }, line: { type: "none" },
  } as any);
  slide.addText("Key Focus Areas", {
    x: M.left + 0.2, y: topY + 0.18, w: labelW - 0.35, h: 0.25,
    fontFace: fontMinor, fontSize: 11, bold: true, color: "111111",
    align: "center", valign: "middle",
    fit: "shrink",
  });

  const rowX = M.left + labelW + 0.4;
  const rowW = widthIn - rowX - M.right;
  const cellW = rowW / iconHints.length;
  iconHints.forEach((hint, i) => {
    const x = rowX + i * cellW;
    if (i > 0) {
      slide.addShape("rect", {
        x: x - 0.08, y: topY - 0.1, w: 0.02, h: 0.9,
        fill: { color: white, transparency: 10 }, line: { type: "none" },
      });
    }
    slide.addShape("ellipse", {
      x, y: topY + 0.05, w: 0.42, h: 0.42,
      fill: { color: bg, transparency: 100 }, line: { color: white, width: 1.2 },
    });
    slide.addText(hint.slice(0, 1).toUpperCase(), {
      x, y: topY + 0.1, w: 0.42, h: 0.26,
      fontFace: fontMajor, fontSize: 11, bold: true, color: white,
      align: "center", valign: "middle",
    });
    slide.addText(toTitleCase(hint), {
      x: x + 0.55, y: topY + 0.05, w: cellW - 0.7, h: 0.28,
      fontFace: fontMajor, fontSize: 14, bold: true, color: white,
      align: "left", valign: "middle",
      fit: "shrink",
    });
    slide.addText(i === 0 ? "At various loads" : i === 1 ? "Growth aligned" : i === 2 ? "Seamless" : "Across times", {
      x: x + 0.55, y: topY + 0.36, w: cellW - 0.7, h: 0.2,
      fontFace: fontMinor, fontSize: 9, color: muted,
      align: "left", valign: "middle",
      fit: "shrink",
    });
  });

  slide.addShape("rect", {
    x: M.left, y: 2.48, w: widthIn - M.left - M.right, h: 0.01,
    fill: { color: "D5D7DE", transparency: 25 }, line: { type: "none" },
  });
  slide.addText(s.kicker || s.design?.visualPattern || "Left Shifted Performance Testing Constructs", {
    x: M.left, y: 2.65, w: widthIn - M.left - M.right, h: 0.32,
    fontFace: fontMajor, fontSize: 15, bold: true, color: white,
    align: "center", valign: "middle",
    fit: "shrink",
  });

  const cards = buildDarkCards(s).slice(0, 3);
  const gap = 0.42;
  const cardW = (widthIn - M.left - M.right - gap * 2 - 3.15) / 3;
  const rowY = 3.25;
  cards.forEach((card, i) => {
    const x = M.left + i * (cardW + gap);
    slide.addShape("rect", {
      x, y: rowY, w: cardW, h: 1.15,
      rectRadius: 0.06,
      fill: { color: panel, transparency: 5 },
      line: { color: "33466B", width: 0.8 },
    } as any);
    slide.addShape("rect", {
      x: x + 0.1, y: rowY + 0.13, w: cardW - 0.2, h: 0.22,
      fill: { color: orange }, line: { type: "none" },
    });
    slide.addText(card.title, {
      x: x + 0.16, y: rowY + 0.14, w: cardW - 0.32, h: 0.18,
      fontFace: fontMajor, fontSize: 10, bold: true, color: white,
      align: "center", valign: "middle",
      fit: "shrink",
    });
    slide.addText(card.body, {
      x: x + 0.18, y: rowY + 0.52, w: cardW - 0.36, h: 0.45,
      fontFace: fontMinor, fontSize: 9, color: white,
      align: "center", valign: "mid",
      fit: "shrink",
    } as any);
    if (i < cards.length - 1) {
      slide.addText("+", {
        x: x + cardW + 0.08, y: rowY + 0.35, w: 0.28, h: 0.4,
        fontFace: fontMajor, fontSize: 20, bold: true, color: white,
        align: "center", valign: "middle",
      });
    }
  });

  const sidebarX = widthIn - M.right - 2.45;
  const sidebar = (s.bullets || []).slice(3, 6);
  const sideItems = sidebar.length ? sidebar : ["Realistic user flows", "Production-like data", "Monitoring feedback"];
  sideItems.forEach((item, i) => {
    slide.addShape("rect", {
      x: sidebarX, y: rowY + i * 0.48, w: 2.3, h: 0.24,
      fill: { color: orange }, line: { type: "none" },
    });
    slide.addText(item, {
      x: sidebarX + 0.08, y: rowY + i * 0.49, w: 2.14, h: 0.19,
      fontFace: fontMajor, fontSize: 9, bold: true, color: white,
      align: "center", valign: "middle",
      fit: "shrink",
    });
  });

  if (s.takeaway) {
    slide.addShape("rect", {
      x: M.left + 4.4, y: heightIn - 2.05, w: 4.8, h: 1.55,
      rectRadius: 0.08,
      fill: { color: panel2, transparency: 12 },
      line: { color: "33466B", width: 0.8 },
    } as any);
    slide.addText("GenAI In Performance Testing", {
      x: M.left + 4.65, y: heightIn - 1.88, w: 4.3, h: 0.24,
      fontFace: fontMajor, fontSize: 10, bold: true, color: "0B1220",
      align: "center", valign: "middle",
      fill: { color: "8EAEEA" },
      fit: "shrink",
    } as any);
    slide.addText(s.takeaway, {
      x: M.left + 4.75, y: heightIn - 1.42, w: 4.1, h: 0.65,
      fontFace: fontMinor, fontSize: 10, color: white,
      align: "left", valign: "top",
      fit: "shrink",
    });
  }

  slide.addText("Confidential Information - For intended recipients only.", {
    x: M.left, y: heightIn - 0.28, w: 4.2, h: 0.15,
    fontFace: fontMinor, fontSize: 6, color: "AAB3C5",
    align: "left", valign: "middle",
  });

  if (s.notes) slide.addNotes(s.notes);
}

function buildDarkCards(s: SlideInput): Array<{ title: string; body: string }> {
  if (s.pillars?.length) return s.pillars.map((p) => ({ title: p.title, body: p.body }));
  const bullets = (s.bullets || []).filter(Boolean);
  return bullets.slice(0, 3).map((b) => {
    const [head, ...rest] = b.split(":");
    return { title: head.slice(0, 44), body: (rest.join(":") || b).slice(0, 120) };
  });
}

function toTitleCase(value: string): string {
  return value.replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
}

// ── Layout: bullets ──────────────────────────────────────────────────────────
function renderContentBullets(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { colors, accent, fontMinor, widthIn, M } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });
  const yStart = renderTitleBlock(slide, s, ctx);

  const bullets = (s.bullets || []).filter((b) => b.trim());
  const bodyH = ctx.heightIn - yStart - 1.6 - M.bottom;

  if (bullets.length) {
    slide.addText(
      bullets.map((b) => ({
        text: b,
        options: { bullet: { code: "25CF", fontSize: 14 }, color: colors.text },
      })),
      {
        x: M.left + 0.15, y: yStart + 0.2, w: widthIn - M.left - M.right - 0.25, h: bodyH,
        fontFace: fontMinor, fontSize: 18, color: colors.text,
        align: "left", valign: "top",
        paraSpaceAfter: 14, paraSpaceBefore: 0,
      }
    );
  }

  // Force bullet color to accent via squares using shapes (PptxGenJS bullet color = paragraph color, fine)
  void accent;

  renderTakeaway(slide, s, ctx);
  if (s.notes) slide.addNotes(s.notes);
}

// ── Layout: pillars (numbered columns) ──────────────────────────────────────
function renderContentPillars(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { colors, accent, accentDark, fontMajor, fontMinor, cardBg, widthIn, M } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });
  const yStart = renderTitleBlock(slide, s, ctx);

  const items = (s.pillars || []).slice(0, 4);
  if (!items.length) {
    renderTakeaway(slide, s, ctx);
    if (s.notes) slide.addNotes(s.notes);
    return;
  }

  const gap   = 0.28;
  const total = widthIn - M.left - M.right;
  const colW  = (total - gap * (items.length - 1)) / items.length;
  const rowY  = yStart + 0.35;
  const rowH  = ctx.heightIn - rowY - 1.6 - M.bottom;

  items.forEach((p, i) => {
    const x = M.left + i * (colW + gap);
    const borderCol = "E2E2E2";
    // Card with subtle shadow effect via border
    slide.addShape("rect", {
      x, y: rowY, w: colW, h: rowH,
      fill: { color: cardBg }, line: { color: borderCol, width: 0.5 },
    });
    // Thick top accent bar
    slide.addShape("rect", {
      x, y: rowY, w: colW, h: 0.08,
      fill: { color: accent }, line: { type: "none" },
    });
    // Numbered badge - larger circle
    slide.addShape("ellipse", {
      x: x + colW/2 - 0.35, y: rowY + 0.35, w: 0.7, h: 0.7,
      fill: { color: accent }, line: { type: "none" },
    });
    slide.addText(pad2(i + 1), {
      x: x + colW/2 - 0.35, y: rowY + 0.35, w: 0.7, h: 0.7,
      fontFace: fontMajor, fontSize: 16, bold: true, color: "FFFFFF",
      align: "center", valign: "middle",
    });
    // Pillar title - larger
    slide.addText(p.title, {
      x: x + 0.35, y: rowY + 1.25, w: colW - 0.7, h: 0.8,
      fontFace: fontMajor, fontSize: 18, bold: true, color: colors.text,
      align: "left", valign: "top",
    });
    // Body - larger text
    slide.addText(p.body, {
      x: x + 0.35, y: rowY + 2.1, w: colW - 0.7, h: rowH - 2.3,
      fontFace: fontMinor, fontSize: 14, color: ctx.colors.text,
      align: "left", valign: "top",
    });
  });

  void accentDark;

  renderTakeaway(slide, s, ctx);
  if (s.notes) slide.addNotes(s.notes);
}

// ── Layout: stats (big numbers) ──────────────────────────────────────────────
function renderContentStats(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { accent, fontMajor, fontMinor, widthIn, M, muted } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });
  const yStart = renderTitleBlock(slide, s, ctx);

  const items = (s.stats || []).slice(0, 4);
  if (!items.length) {
    renderTakeaway(slide, s, ctx);
    if (s.notes) slide.addNotes(s.notes);
    return;
  }

  const gap   = 0.4;
  const total = widthIn - M.left - M.right;
  const colW  = (total - gap * (items.length - 1)) / items.length;
  const rowY  = yStart + 0.7;

  items.forEach((stat, i) => {
    const x = M.left + i * (colW + gap);
    // Big stat value - consulting style
    slide.addText(stat.value, {
      x, y: rowY, w: colW, h: 1.8,
      fontFace: fontMajor, fontSize: 72, bold: true, color: accent,
      align: "left", valign: "top",
    });
    // Thick accent rule
    slide.addShape("rect", {
      x, y: rowY + 1.85, w: 0.7, h: 0.07,
      fill: { color: accent }, line: { type: "none" },
    });
    // Label - larger and clearer
    slide.addText(stat.label, {
      x, y: rowY + 2.05, w: colW, h: 1.0,
      fontFace: fontMinor, fontSize: 14, color: muted,
      align: "left", valign: "top",
    });
  });

  renderTakeaway(slide, s, ctx);
  if (s.notes) slide.addNotes(s.notes);
}

// ── Layout: quote ────────────────────────────────────────────────────────────
function renderContentQuote(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { colors, accent, fontMajor, fontMinor, widthIn, heightIn, M, muted } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });
  const yStart = renderTitleBlock(slide, s, ctx);

  const q = s.quote;
  if (!q) {
    renderTakeaway(slide, s, ctx);
    if (s.notes) slide.addNotes(s.notes);
    return;
  }

  // Big quote glyph
  slide.addText("“", {
    x: M.left, y: yStart + 0.2, w: 1.2, h: 1.4,
    fontFace: fontMajor, fontSize: 96, bold: true, color: accent,
    align: "left", valign: "top",
  });

  // Quote text
  slide.addText(q.text, {
    x: M.left + 1.2, y: yStart + 0.6, w: widthIn - M.left - M.right - 1.2, h: heightIn - yStart - 2.6,
    fontFace: fontMajor, fontSize: 22, italic: true, color: colors.text,
    align: "left", valign: "top",
    paraSpaceAfter: 0,
  });

  if (q.attribution) {
    slide.addText(`— ${q.attribution}`, {
      x: M.left + 1.2, y: heightIn - 2.05, w: widthIn - M.left - M.right - 1.2, h: 0.4,
      fontFace: fontMinor, fontSize: 13, color: muted,
      align: "left", valign: "top",
    });
  }

  renderTakeaway(slide, s, ctx);
  if (s.notes) slide.addNotes(s.notes);
}

// ── Layout: comparison ───────────────────────────────────────────────────────
function renderContentComparison(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { colors, accent, accentSoft, cardBg, fontMajor, fontMinor, widthIn, M } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });
  const yStart = renderTitleBlock(slide, s, ctx);

  const c = s.comparison;
  if (!c) {
    renderTakeaway(slide, s, ctx);
    if (s.notes) slide.addNotes(s.notes);
    return;
  }

  const gap  = 0.3;
  const total= widthIn - M.left - M.right;
  const colW = (total - gap) / 2;
  const rowY = yStart + 0.35;
  const rowH = ctx.heightIn - rowY - 1.6 - M.bottom;

  const renderSide = (
    x: number, side: { heading: string; items: string[] }, isRight: boolean
  ) => {
    slide.addShape("rect", {
      x, y: rowY, w: colW, h: rowH,
      fill: { color: isRight ? accentSoft : cardBg }, line: { type: "none" },
    });
    slide.addShape("rect", {
      x, y: rowY, w: colW, h: 0.06,
      fill: { color: isRight ? accent : "9AA1AB" }, line: { type: "none" },
    });
    slide.addText(side.heading.toUpperCase(), {
      x: x + 0.3, y: rowY + 0.3, w: colW - 0.6, h: 0.4,
      fontFace: fontMinor, fontSize: 11, bold: true,
      color: isRight ? accent : "5C6473", charSpacing: 4,
      align: "left", valign: "middle",
    });
    const items = (side.items || []).slice(0, 5);
    if (items.length) {
      slide.addText(
        items.map((t) => ({ text: t, options: { bullet: { code: isRight ? "25A0" : "2014" }, color: colors.text } })),
        {
          x: x + 0.3, y: rowY + 0.85, w: colW - 0.6, h: rowH - 1.0,
          fontFace: fontMinor, fontSize: 14, color: colors.text,
          align: "left", valign: "top",
          paraSpaceAfter: 8, paraSpaceBefore: 0,
        }
      );
    }
  };

  renderSide(M.left,                c.left,  false);
  renderSide(M.left + colW + gap,   c.right, true);

  void fontMajor;

  renderTakeaway(slide, s, ctx);
  if (s.notes) slide.addNotes(s.notes);
}

// ── Layout: timeline ────────────────────────────────────────────────────────
function renderContentTimeline(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { colors, accent, fontMajor, fontMinor, widthIn, M, muted } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });
  const yStart = renderTitleBlock(slide, s, ctx);

  const phases = (s.timeline || []).slice(0, 6);
  if (!phases.length) { renderTakeaway(slide, s, ctx); if (s.notes) slide.addNotes(s.notes); return; }

  const stepW = (widthIn - M.left - M.right - 0.4 * (phases.length - 1)) / phases.length;
  const rowY = yStart + 0.5;
  const rowH = ctx.heightIn - rowY - 1.6 - M.bottom;

  phases.forEach((p, i) => {
    const x = M.left + i * (stepW + 0.4);
    // Phase number in accent circle
    slide.addShape("ellipse", {
      x: x + stepW/2 - 0.35, y: rowY, w: 0.7, h: 0.7,
      fill: { color: accent }, line: { type: "none" },
    });
    slide.addText(String(i + 1), {
      x: x + stepW/2 - 0.35, y: rowY, w: 0.7, h: 0.7,
      fontFace: fontMajor, fontSize: 16, bold: true, color: "FFFFFF",
      align: "center", valign: "middle",
    });
    // Connector line
    if (i < phases.length - 1) {
      slide.addShape("rect", {
        x: x + stepW, y: rowY + 0.35, w: 0.4, h: 0.03,
        fill: { color: accent }, line: { type: "none" },
      });
    }
    // Phase title
    slide.addText(p.phase, {
      x: x + 0.1, y: rowY + 0.85, w: stepW - 0.2, h: 0.6,
      fontFace: fontMajor, fontSize: 12, bold: true, color: colors.text,
      align: "center", valign: "top",
    });
    // Description
    slide.addText(p.description, {
      x: x + 0.1, y: rowY + 1.45, w: stepW - 0.2, h: rowH - 1.6,
      fontFace: fontMinor, fontSize: 11, color: muted,
      align: "center", valign: "top",
    });
  });

  renderTakeaway(slide, s, ctx);
  if (s.notes) slide.addNotes(s.notes);
}

// ── Layout: matrix (2x2 quadrant) ─────────────────────────────────────────────
function renderContentMatrix(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { colors, accent, accentSoft, fontMajor, fontMinor, widthIn, M, muted } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });
  const yStart = renderTitleBlock(slide, s, ctx);

  const m = s.matrix;
  if (!m) { renderTakeaway(slide, s, ctx); if (s.notes) slide.addNotes(s.notes); return; }

  const quadW = (widthIn - M.left - M.right - 0.3) / 2;
  const quadH = ctx.heightIn - yStart - 1.6 - M.bottom - 0.3;
  const qy = yStart + 0.4;

  // Draw axis labels if provided
  if (m.axisX) {
    slide.addText(m.axisX.toUpperCase(), {
      x: M.left, y: qy - 0.3, w: widthIn - M.left - M.right, h: 0.25,
      fontFace: fontMinor, fontSize: 10, bold: true, color: muted, charSpacing: 3,
      align: "center", valign: "middle",
    });
  }
  if (m.axisY) {
    slide.addText(m.axisY.toUpperCase(), {
      x: M.left - 0.3, y: qy, w: 0.3, h: quadH * 2 + 0.3,
      fontFace: fontMinor, fontSize: 10, bold: true, color: muted, charSpacing: 3,
      align: "center", valign: "middle",
    });
  }

  const quads = [
    { x: M.left, y: qy, text: m.topLeft, isTop: true },
    { x: M.left + quadW + 0.3, y: qy, text: m.topRight, isTop: true },
    { x: M.left, y: qy + quadH + 0.3, text: m.bottomLeft, isTop: false },
    { x: M.left + quadW + 0.3, y: qy + quadH + 0.3, text: m.bottomRight, isTop: false },
  ];

  quads.forEach((q, i) => {
    const isTop = q.isTop;
    slide.addShape("rect", {
      x: q.x, y: q.y, w: quadW, h: quadH,
      fill: { color: i % 2 === 0 ? colors.bg : accentSoft }, line: { color: "E2E2E2", width: 0.5 },
    });
    // Accent bar at top of each quadrant
    slide.addShape("rect", {
      x: q.x, y: q.y, w: quadW, h: 0.06,
      fill: { color: isTop ? accent : muted }, line: { type: "none" },
    });
    slide.addText(q.text || "", {
      x: q.x + 0.25, y: q.y + 0.3, w: quadW - 0.5, h: quadH - 0.6,
      fontFace: fontMinor, fontSize: 14, color: colors.text,
      align: "left", valign: "top",
    });
  });

  renderTakeaway(slide, s, ctx);
  if (s.notes) slide.addNotes(s.notes);
}

// ── Layout: org chart ────────────────────────────────────────────────────────
function renderContentOrg(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { colors, accent, fontMajor, fontMinor, widthIn, M, muted } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });
  const yStart = renderTitleBlock(slide, s, ctx);

  const o = s.org;
  if (!o) { renderTakeaway(slide, s, ctx); if (s.notes) slide.addNotes(s.notes); return; }

  const roles = (o.roles || []).slice(0, 6);
  const cardW = (widthIn - M.left - M.right - 0.25 * (Math.max(roles.length, 1) - 1)) / Math.max(roles.length, 1);
  const rowY = yStart + 0.8;
  const rowH = ctx.heightIn - rowY - 1.6 - M.bottom;

  // Leader at top
  slide.addShape("ellipse", {
    x: widthIn/2 - 0.5, y: rowY, w: 1.0, h: 1.0,
    fill: { color: accent }, line: { type: "none" },
  });
  slide.addText(o.leader.charAt(0).toUpperCase(), {
    x: widthIn/2 - 0.5, y: rowY, w: 1.0, h: 1.0,
    fontFace: fontMajor, fontSize: 24, bold: true, color: "FFFFFF",
    align: "center", valign: "middle",
  });
  slide.addText(o.leader, {
    x: widthIn/2 - 1.5, y: rowY + 1.15, w: 3.0, h: 0.5,
    fontFace: fontMajor, fontSize: 16, bold: true, color: colors.text,
    align: "center", valign: "top",
  });

  // Team roles
  if (roles.length) {
    const gap = 0.25;
    const realCardW = (widthIn - M.left - M.right - gap * (roles.length - 1)) / roles.length;
    const rolesY = rowY + 2.0;
    roles.forEach((role, i) => {
      const x = M.left + i * (realCardW + gap);
      slide.addShape("rect", {
        x, y: rolesY, w: realCardW, h: rowH - 0.3,
        fill: { color: colors.bg }, line: { color: "E2E2E2", width: 0.5 },
      });
      slide.addShape("rect", {
        x, y: rolesY, w: realCardW, h: 0.05,
        fill: { color: accent }, line: { type: "none" },
      });
      slide.addText(role, {
        x: x + 0.2, y: rolesY + 0.25, w: realCardW - 0.4, h: rowH - 0.6,
        fontFace: fontMinor, fontSize: 12, color: colors.text,
        align: "center", valign: "middle",
      });
    });
  }

  renderTakeaway(slide, s, ctx);
  if (s.notes) slide.addNotes(s.notes);
}

// ── Layout: infographic ───────────────────────────────────────────────────────
function renderContentInfographic(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { colors, accent, fontMajor, fontMinor, widthIn, M, muted } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });
  const yStart = renderTitleBlock(slide, s, ctx);

  const items = (s.infographic?.items || []).slice(0, 5);
  if (!items.length) { renderTakeaway(slide, s, ctx); if (s.notes) slide.addNotes(s.notes); return; }

  const gap = 0.3;
  const total = widthIn - M.left - M.right;
  const colW = (total - gap * (items.length - 1)) / items.length;
  const rowY = yStart + 0.6;
  const rowH = ctx.heightIn - rowY - 1.6 - M.bottom;

  items.forEach((it, i) => {
    const x = M.left + i * (colW + gap);
    // Big value
    slide.addText(it.value, {
      x, y: rowY, w: colW, h: 1.4,
      fontFace: fontMajor, fontSize: 56, bold: true, color: accent,
      align: "center", valign: "top",
    });
    // Accent underline
    slide.addShape("rect", {
      x: x + colW/2 - 0.4, y: rowY + 1.45, w: 0.8, h: 0.06,
      fill: { color: accent }, line: { type: "none" },
    });
    // Label
    slide.addText(it.label, {
      x: x + 0.15, y: rowY + 1.65, w: colW - 0.3, h: rowH - 1.8,
      fontFace: fontMinor, fontSize: 13, color: muted,
      align: "center", valign: "top",
    });
  });

  renderTakeaway(slide, s, ctx);
  if (s.notes) slide.addNotes(s.notes);
}

// ── Layout: fullbleed (dramatic) ─────────────────────────────────────────────
function renderContentFullbleed(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { colors, accent, fontMajor, fontMinor, widthIn, heightIn, M } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });
  const yStart = renderTitleBlock(slide, s, ctx);

  const fb = s.fullbleed;
  // Dark gradient background simulation
  slide.background = { color: colors.text };

  // Accent band at top
  slide.addShape("rect", {
    x: M.left, y: yStart, w: widthIn - M.left - M.right, h: 0.08,
    fill: { color: accent }, line: { type: "none" },
  });

  // Overlay text centered dramatically
  const overlay = fb?.overlayText || s.title;
  slide.addText(overlay, {
    x: M.left + 0.5, y: yStart + 0.8, w: widthIn - M.left - M.right - 1, h: heightIn - yStart - 2.5,
    fontFace: fontMajor, fontSize: 32, bold: true, color: "FFFFFF",
    align: "center", valign: "middle",
  });

  // Bottom accent bar
  slide.addShape("rect", {
    x: M.left, y: heightIn - 0.65, w: widthIn - M.left - M.right, h: 0.08,
    fill: { color: accent }, line: { type: "none" },
  });

  renderTakeaway(slide, s, ctx);
  if (s.notes) slide.addNotes(s.notes);
}

// ── Layout: Four Column Case Study (Challenge | Solution | Role | Benefits) ─────
function renderContentFourColumnCase(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { colors, accent, fontMajor, fontMinor, widthIn, M, muted } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });
  const yStart = renderTitleBlock(slide, s, ctx);

  const cs = s.case_study;
  if (!cs) { renderTakeaway(slide, s, ctx); if (s.notes) slide.addNotes(s.notes); return; }

  const colW = (widthIn - M.left - M.right - 0.2 * 3) / 4;
  const rowY = yStart + 0.4;
  const rowH = ctx.heightIn - rowY - 1.6 - M.bottom;

  const columns = [
    { title: "CHALLENGE", content: cs.challenge, color: "C8102E" },
    { title: "SOLUTION", content: cs.solution, color: accent },
    { title: "APEXON ROLE", content: cs.role, color: "5C2D91" },
    { title: "BENEFITS", content: cs.benefits, color: "00A3A1" },
  ];

  columns.forEach((col, i) => {
    const x = M.left + i * (colW + 0.2);
    // Card background
    slide.addShape("rect", {
      x, y: rowY, w: colW, h: rowH,
      fill: { color: colors.bg }, line: { color: "E2E2E2", width: 0.5 },
    });
    // Top color bar
    slide.addShape("rect", {
      x, y: rowY, w: colW, h: 0.08,
      fill: { color: col.color }, line: { type: "none" },
    });
    // Column title
    slide.addText(col.title, {
      x: x + 0.2, y: rowY + 0.2, w: colW - 0.4, h: 0.4,
      fontFace: fontMinor, fontSize: 10, bold: true, color: col.color, charSpacing: 3,
      align: "left", valign: "middle",
    });
    // Content
    slide.addText(col.content, {
      x: x + 0.2, y: rowY + 0.7, w: colW - 0.4, h: rowH - 0.9,
      fontFace: fontMinor, fontSize: 12, color: colors.text,
      align: "left", valign: "top",
    });
  });

  renderTakeaway(slide, s, ctx);
  if (s.notes) slide.addNotes(s.notes);
}

// ── Layout: Reference Architecture ─────────────────────────────────────────────
function renderContentArchitecture(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { colors, accent, fontMajor, fontMinor, widthIn, M, muted } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });
  const yStart = renderTitleBlock(slide, s, ctx);

  const arch = s.architecture?.components || [];
  if (!arch.length) { renderTakeaway(slide, s, ctx); if (s.notes) slide.addNotes(s.notes); return; }

  const itemsPerRow = 4;
  const rowH = 0.9;
  const gapY = 0.15;
  const startY = yStart + 0.5;

  arch.forEach((comp, i) => {
    const row = Math.floor(i / itemsPerRow);
    const col = i % itemsPerRow;
    const x = M.left + col * 3.2;
    const y = startY + row * (rowH + gapY);

    // Component box
    slide.addShape("rect", {
      x, y, w: 3.0, h: rowH,
      fill: { color: colors.bg }, line: { color: accent, width: 1 },
    });
    // Icon placeholder circle
    slide.addShape("ellipse", {
      x: x + 0.2, y: y + rowH/2 - 0.2, w: 0.4, h: 0.4,
      fill: { color: accent }, line: { type: "none" },
    });
    // Component name
    slide.addText(comp.name, {
      x: x + 0.7, y: y + 0.15, w: 2.2, h: 0.35,
      fontFace: fontMajor, fontSize: 11, bold: true, color: colors.text,
      align: "left", valign: "middle",
    });
    // Description
    slide.addText(comp.description, {
      x: x + 0.7, y: y + 0.5, w: 2.2, h: rowH - 0.55,
      fontFace: fontMinor, fontSize: 9, color: muted,
      align: "left", valign: "top",
    });
  });

  renderTakeaway(slide, s, ctx);
  if (s.notes) slide.addNotes(s.notes);
}

// ── Layout: Capability Map ───────────────────────────────────────────────────────
function renderContentCapability(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { colors, accent, fontMajor, fontMinor, widthIn, M, muted } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });
  const yStart = renderTitleBlock(slide, s, ctx);

  const cats = s.capability?.categories || [];
  if (!cats.length) { renderTakeaway(slide, s, ctx); if (s.notes) slide.addNotes(s.notes); return; }

  const colW = (widthIn - M.left - M.right - 0.2 * (cats.length - 1)) / cats.length;
  const rowY = yStart + 0.4;
  const rowH = ctx.heightIn - rowY - 1.6 - M.bottom;

  cats.forEach((cat, i) => {
    const x = M.left + i * (colW + 0.2);
    // Category card
    slide.addShape("rect", {
      x, y: rowY, w: colW, h: rowH,
      fill: { color: colors.bg }, line: { color: "E2E2E2", width: 0.5 },
    });
    // Accent header
    slide.addShape("rect", {
      x, y: rowY, w: colW, h: 0.5,
      fill: { color: accent }, line: { type: "none" },
    });
    // Category name
    slide.addText(cat.name.toUpperCase(), {
      x: x + 0.2, y: rowY + 0.1, w: colW - 0.4, h: 0.35,
      fontFace: fontMinor, fontSize: 10, bold: true, color: "FFFFFF", charSpacing: 2,
      align: "left", valign: "middle",
    });
    // Items
    const items = cat.items.slice(0, 6);
    slide.addText(
      items.map((it, idx) => ({ text: `• ${it}`, options: { color: colors.text } })),
      {
        x: x + 0.2, y: rowY + 0.65, w: colW - 0.4, h: rowH - 0.8,
        fontFace: fontMinor, fontSize: 10, color: colors.text,
        align: "left", valign: "top",
        paraSpaceAfter: 4,
      }
    );
  });

  renderTakeaway(slide, s, ctx);
  if (s.notes) slide.addNotes(s.notes);
}

// ── Layout: Risk Matrix ─────────────────────────────────────────────────────────
function renderContentRiskMatrix(pptx: PptxGenJS, s: SlideInput, ctx: ContentCtx) {
  const { colors, accent, fontMajor, fontMinor, widthIn, M, muted } = ctx;
  const slide = pptx.addSlide({ masterName: "BASE" });
  const yStart = renderTitleBlock(slide, s, ctx);

  const risks = s.risk?.items || [];
  if (!risks.length) { renderTakeaway(slide, s, ctx); if (s.notes) slide.addNotes(s.notes); return; }

  // Header row
  const headerH = 0.4;
  slide.addText("RISK", { x: M.left, y: yStart + 0.15, w: 3.5, h: headerH, fontFace: fontMinor, fontSize: 9, bold: true, color: colors.text, align: "left", valign: "middle" });
  slide.addText("IMPACT", { x: M.left + 3.5, y: yStart + 0.15, w: 2.5, h: headerH, fontFace: fontMinor, fontSize: 9, bold: true, color: colors.text, align: "center", valign: "middle" });
  slide.addText("MITIGATION", { x: M.left + 6, y: yStart + 0.15, w: widthIn - M.left - M.right - 6, h: headerH, fontFace: fontMinor, fontSize: 9, bold: true, color: colors.text, align: "left", valign: "middle" });

  const startY = yStart + 0.55;
  const rowH = 0.7;
  const gapY = 0.1;

  risks.forEach((r, i) => {
    const y = startY + i * (rowH + gapY);
    // Row background (alternating)
    if (i % 2 === 0) {
      slide.addShape("rect", {
        x: M.left, y: y, w: widthIn - M.left - M.right, h: rowH,
        fill: { color: "F8F9FA" }, line: { type: "none" },
      });
    }
    // Risk column
    slide.addText(r.risk, {
      x: M.left + 0.15, y: y, w: 3.3, h: rowH,
      fontFace: fontMinor, fontSize: 11, color: colors.text,
      align: "left", valign: "middle",
    });
    // Impact column (with colored badge)
    const impactColor = (r.impact || "").toLowerCase().includes("high") ? "C8102E" : (r.impact || "").toLowerCase().includes("medium") ? "F4B400" : "00A3A1";
    slide.addShape("rect", {
      x: M.left + 3.7, y: y + rowH/2 - 0.12, w: 1.8, h: 0.24,
      fill: { color: impactColor }, line: { type: "none" },
    });
    slide.addText(r.impact || "-", {
      x: M.left + 3.7, y: y + rowH/2 - 0.12, w: 1.8, h: 0.24,
      fontFace: fontMinor, fontSize: 9, bold: true, color: "FFFFFF",
      align: "center", valign: "middle",
    });
    // Mitigation column
    slide.addText(r.mitigation, {
      x: M.left + 6.15, y: y, w: widthIn - M.left - M.right - 6.15, h: rowH,
      fontFace: fontMinor, fontSize: 11, color: muted,
      align: "left", valign: "middle",
    });
  });

  renderTakeaway(slide, s, ctx);
  if (s.notes) slide.addNotes(s.notes);
}
