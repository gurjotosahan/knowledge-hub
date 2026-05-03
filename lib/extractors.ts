// Server-side only — used exclusively in Next.js API routes (Node.js runtime)
import { readFile } from "fs/promises";
import { extname, basename } from "path";

export interface ExtractedSlide {
  number: number;
  text: string;
}

export interface ExtractedDoc {
  fileName: string;
  filePath: string;
  fileType: "pdf" | "pptx";
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

  const slideKeys = Object.keys(zip.files)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)![0]);
      const nb = parseInt(b.match(/\d+/)![0]);
      return na - nb;
    });

  const slides: ExtractedSlide[] = [];
  for (let i = 0; i < slideKeys.length; i++) {
    const xml = await zip.files[slideKeys[i]].async("text");
    const parts: string[] = [];
    Array.from(xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)).forEach((m) => {
      const t = m[1].trim();
      if (t) parts.push(t);
    });
    slides.push({ number: i + 1, text: parts.join(" ") });
  }

  return slides;
}
