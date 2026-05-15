// Server-side only — used exclusively in Next.js API routes (Node.js runtime)
import { readFile } from "fs/promises";
import { extname, basename } from "path";
import { getOrderedPptxSlidePaths } from "@/lib/pptxOrder";
import type { SearchableFileType } from "@/types";

export interface ExtractedSlide {
  number: number;
  text: string;
}

export interface ExtractedDoc {
  fileName: string;
  filePath: string;
  fileType: SearchableFileType;
  totalSlides: number;
  slides: ExtractedSlide[];
}

export async function extractDoc(filePath: string): Promise<ExtractedDoc> {
  const ext = extname(filePath).toLowerCase();
  const fileName = basename(filePath);

  if (ext === ".pdf") {
    const slides = await extractPdfPages(filePath);
    return { fileName, filePath, fileType: "pdf", totalSlides: slides.length, slides };
  }
  if (ext === ".pptx") {
    const slides = await extractPptxSlides(filePath);
    return { fileName, filePath, fileType: "pptx", totalSlides: slides.length, slides };
  }
  if (ext === ".docx") {
    const slides = await extractDocxSections(filePath);
    return { fileName, filePath, fileType: "docx", totalSlides: slides.length, slides };
  }
  throw new Error(`Unsupported file type: ${ext}`);
}

async function extractPdfPages(filePath: string): Promise<ExtractedSlide[]> {
  const buffer = await readFile(filePath);

  // Dynamic import keeps pdf-parse out of the client bundle
  const pdfParse = (await import("pdf-parse")).default;

  const pageTexts: string[] = [];

  await pdfParse(buffer, {
    // pagerender is called per page by pdf-parse's internal pdf.js usage
    pagerender(pageData: {
      getTextContent: () => Promise<{ items: { str?: string }[] }>;
    }) {
      return pageData.getTextContent().then((tc) => {
        const text = tc.items
          .map((i) => i.str ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        pageTexts.push(text);
        return text;
      });
    },
  });

  // Fallback: split by form-feed character if pagerender didn't fire
  if (pageTexts.length === 0) {
    const data = await pdfParse(buffer);
    const pages = data.text
      .split("\f")
      .map((t: string) => t.trim())
      .filter(Boolean);
    return pages.map((text: string, i: number) => ({ number: i + 1, text }));
  }

  return pageTexts.map((text, i) => ({ number: i + 1, text }));
}

async function extractPptxSlides(filePath: string): Promise<ExtractedSlide[]> {
  const buffer = await readFile(filePath);
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const slideKeys = await getOrderedPptxSlidePaths(zip);

  const slides: ExtractedSlide[] = [];
  let slideNum = 0;
  for (let i = 0; i < slideKeys.length; i++) {
    const xml = await zip.files[slideKeys[i]].async("text");

    // LibreOffice skips hidden slides when converting to PDF, so we must too —
    // otherwise every slide after a hidden one gets the wrong PDF page number.
    if (/<p:sld\b[^>]*\bshow="(?:0|false)"/.test(xml)) continue;
    slideNum++;

    // Extract title placeholder text so it can be weighted more heavily
    const titleParts: string[] = [];
    for (const spMatch of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
      const sp = spMatch[0];
      if (!/<p:ph[^>]*\btype="(?:title|ctrTitle)"/.test(sp)) continue;
      Array.from(sp.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).forEach((m) => {
        const t = cleanExtractedXmlText(m[1]);
        if (t) titleParts.push(t);
      });
    }

    // All text runs (includes tables, SmartArt, and other non-sp shapes)
    const allParts: string[] = [];
    Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).forEach((m) => {
      const t = cleanExtractedXmlText(m[1]);
      if (t) allParts.push(t);
    });

    // Title appears 3× total (2 extra prepends + 1× inside allParts) to anchor
    // the embedding to the slide's main topic without losing body text context.
    const text = [...titleParts, ...titleParts, ...allParts].join(" ");
    slides.push({ number: slideNum, text });
  }

  return slides;
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function cleanExtractedXmlText(text: string): string {
  let cleaned = decodeXmlText(text);

  for (let i = 0; i < 3; i++) {
    const embeddedRuns = Array.from(cleaned.matchAll(/<(?:a|w):t[^>]*>([\s\S]*?)<\/(?:a|w):t>/g))
      .map((match) => decodeXmlText(match[1]).trim())
      .filter(Boolean);
    if (embeddedRuns.length === 0) break;
    cleaned = embeddedRuns.join(" ");
  }

  return cleaned
    .replace(/<[^>]+>/g, " ")
    .replace(/\b(?:xmlns(?::\w+)?|[a-zA-Z]+:[a-zA-Z]+|[a-zA-Z]+)="[^"]*"/g, " ")
    .replace(/\b(?:val|id|name|typeface|panose|pitchFamily|charset|lang|sz|kern|cap|spc|baseline|noProof|kumimoji|b|i|u|strike|x|y|cx|cy)="[^"]*"/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractDocxSections(filePath: string): Promise<ExtractedSlide[]> {
  const buffer = await readFile(filePath);
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.files["word/document.xml"]?.async("text");
  if (!xml) return [];

  const paragraphs = Array.from(xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g))
    .map((p) => Array.from(p[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
      .map((m) => cleanExtractedXmlText(m[1]))
      .join("")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);

  const sections: ExtractedSlide[] = [];
  let current = "";
  for (const para of paragraphs) {
    const next = current ? `${current}\n${para}` : para;
    if (next.length > 2500 && current) {
      sections.push({ number: sections.length + 1, text: current });
      current = para;
    } else {
      current = next;
    }
  }
  if (current) sections.push({ number: sections.length + 1, text: current });

  return sections.length ? sections : [{ number: 1, text: "" }];
}
