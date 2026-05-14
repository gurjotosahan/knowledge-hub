import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import JSZip from "jszip";

export type SlideStyle = "dark_technical" | "light_consulting" | "visual_case_study" | "data_heavy" | "process_flow";

export interface ReferenceSlideStyle {
  id: string;
  deckName: string;
  deckPath: string;
  slideNumber: number;
  title: string;
  textSample: string;
  colors: string[];
  style: SlideStyle;
  visualPattern: string;
  scoreHints: string[];
  indexedAt: string;
}

export const STYLE_LIBRARY_DIR = join(tmpdir(), "kh-reference-slides");
export const STYLE_LIBRARY_PATH = join(STYLE_LIBRARY_DIR, "library.json");

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function stripXml(xml: string): string {
  return xml
    .replace(/<a:br\s*\/>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSlideText(slideXml: string): string {
  const matches = Array.from(slideXml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g));
  return matches
    .map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractColors(xml: string): string[] {
  const srgb = Array.from(xml.matchAll(/\b(?:val|color)="([0-9A-Fa-f]{6})"/g)).map((m) => m[1].toUpperCase());
  const solid = Array.from(xml.matchAll(/<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/g)).map((m) => m[1].toUpperCase());
  return uniq([...srgb, ...solid]).slice(0, 12);
}

function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function classifyStyle(text: string, colors: string[], shapeCount: number, imageCount: number): Pick<ReferenceSlideStyle, "style" | "visualPattern" | "scoreHints"> {
  const lower = text.toLowerCase();
  const darkColors = colors.filter((c) => luminance(c) < 0.18).length;
  const redOrange = colors.some((c) => /^f[0-9a-f]{5}$/i.test(c) || /^e[0-9a-f]{5}$/i.test(c));
  const hasProcessWords = /\b(phase|stage|journey|roadmap|flow|construct|approach|steps?)\b/.test(lower);
  const hasTools = /\b(tool|platform|monitoring|apm|cloud|aws|azure|jira|jmeter|splunk|datadog)\b/.test(lower);
  const hasNumbers = /\b\d+[%x]?\b/.test(lower);

  if (darkColors >= 2 && (hasTools || shapeCount > 20)) {
    return {
      style: "dark_technical",
      visualPattern: redOrange ? "dark technical capability map with orange labels, modular boxes, icon row, and tools sidebar" : "dark technical capability map with modular boxes and icon-led sections",
      scoreHints: ["dark background", "technical", "icons", "modular boxes", "dense consulting slide"],
    };
  }
  if (hasProcessWords) {
    return {
      style: "process_flow",
      visualPattern: "horizontal process flow with staged boxes and connective operators",
      scoreHints: ["process", "flow", "stages", "arrows", "structured"],
    };
  }
  if (imageCount > 0) {
    return {
      style: "visual_case_study",
      visualPattern: "case-study layout with image block, benefit sidebar, and outcome modules",
      scoreHints: ["case study", "image", "benefits", "client story"],
    };
  }
  if (hasNumbers) {
    return {
      style: "data_heavy",
      visualPattern: "data-led executive slide with headline metrics and supporting proof points",
      scoreHints: ["metrics", "stats", "numbers", "evidence"],
    };
  }
  return {
    style: "light_consulting",
    visualPattern: "clean consulting slide with action title, section rule, and structured content blocks",
    scoreHints: ["consulting", "clean", "executive", "structured"],
  };
}

export async function readStyleLibrary(): Promise<ReferenceSlideStyle[]> {
  try {
    return JSON.parse(await readFile(STYLE_LIBRARY_PATH, "utf8"));
  } catch {
    return [];
  }
}

export async function writeStyleLibrary(items: ReferenceSlideStyle[]): Promise<void> {
  await mkdir(STYLE_LIBRARY_DIR, { recursive: true });
  await writeFile(STYLE_LIBRARY_PATH, JSON.stringify(items, null, 2));
}

export async function indexPptxStyles(deckPath: string, deckName: string): Promise<ReferenceSlideStyle[]> {
  const zip = await JSZip.loadAsync(await readFile(deckPath));
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/i)?.[1] ?? 0) - Number(b.match(/slide(\d+)\.xml/i)?.[1] ?? 0));

  const indexedAt = new Date().toISOString();
  const slides: ReferenceSlideStyle[] = [];
  for (const path of slidePaths) {
    const slideNumber = Number(path.match(/slide(\d+)\.xml/i)?.[1] ?? slides.length + 1);
    const xml = await zip.files[path].async("text");
    const relsPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
    const relsXml = await zip.files[relsPath]?.async("text").catch(() => "") ?? "";
    const text = extractSlideText(xml);
    const colors = extractColors(xml);
    const shapeCount = (xml.match(/<p:sp\b/g) ?? []).length + (xml.match(/<p:graphicFrame\b/g) ?? []).length;
    const imageCount = (xml.match(/<p:pic\b/g) ?? []).length + (relsXml.match(/\/media\//g) ?? []).length;
    const classified = classifyStyle(text, colors, shapeCount, imageCount);
    const title = text.split(/[.!?]\s/)[0]?.slice(0, 100) || `Slide ${slideNumber}`;

    slides.push({
      id: `${Date.now()}-${slideNumber}-${Math.random().toString(36).slice(2, 8)}`,
      deckName,
      deckPath,
      slideNumber,
      title,
      textSample: stripXml(text).slice(0, 500),
      colors,
      ...classified,
      indexedAt,
    });
  }
  return slides;
}

export function styleLibraryPrompt(items: ReferenceSlideStyle[], limit = 24): string {
  if (!items.length) return "";
  return items.slice(-limit).map((s, i) => {
    return `${i + 1}. style=${s.style}; pattern=${s.visualPattern}; hints=${s.scoreHints.join(", ")}; example="${s.title}"`;
  }).join("\n");
}

function scoreReference(slide: ReferenceSlideStyle, query: { style?: string; layout?: string; title?: string; text?: string; iconHints?: string[] }): number {
  let score = 0;
  const haystack = `${slide.style} ${slide.visualPattern} ${slide.scoreHints.join(" ")} ${slide.title} ${slide.textSample}`.toLowerCase();
  const queryText = `${query.title ?? ""} ${query.text ?? ""}`.toLowerCase();
  const words = queryText.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const inferredStyle = query.style ?? inferStyleFromQuery(queryText);

  if (inferredStyle && slide.style === inferredStyle) score += 12;
  if (query.layout && haystack.includes(query.layout.toLowerCase())) score += 3;
  for (const hint of query.iconHints ?? []) {
    if (haystack.includes(hint.toLowerCase())) score += 4;
  }
  for (const word of words.slice(0, 30)) {
    if (haystack.includes(word)) score += 1;
  }
  return score;
}

function inferStyleFromQuery(text: string): SlideStyle | undefined {
  if (/\b(performance|stress|load|scalability|reliability|monitoring|apm|testing|automation|devops|cloud|api|architecture|platform|security)\b/.test(text)) {
    return "dark_technical";
  }
  if (/\b(roadmap|journey|phase|stage|operating model|process|workflow|migration)\b/.test(text)) {
    return "process_flow";
  }
  if (/\b(case study|client|benefit|outcome|impact|success story)\b/.test(text)) {
    return "visual_case_study";
  }
  if (/\b(metric|kpi|revenue|cost|growth|percentage|forecast|market|savings)\b/.test(text)) {
    return "data_heavy";
  }
  return undefined;
}

export function selectReferenceSlides(
  library: ReferenceSlideStyle[],
  slides: Array<{ title?: string; layout?: string; bullets?: string[]; design?: { style?: string; iconHints?: string[] } }>
): ReferenceSlideStyle[] {
  if (!library.length) return [];
  return slides.map((slide, index) => {
    const ranked = library
      .map((ref) => ({
        ref,
        score: scoreReference(ref, {
          style: slide.design?.style,
          layout: slide.layout,
          title: slide.title,
          text: slide.bullets?.join(" "),
          iconHints: slide.design?.iconHints,
        }) + (ref.slideNumber === index + 1 ? 1 : 0),
      }))
      .sort((a, b) => b.score - a.score);
    return ranked[0]?.ref ?? library[index % library.length];
  });
}
