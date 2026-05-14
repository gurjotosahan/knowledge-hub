import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { getOrderedPptxSlidePaths, slideXmlNumberFromPath } from "@/lib/pptxOrder";

export const dynamic = "force-dynamic";

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function cleanExtractedText(value: string): string {
  let text = decodeXml(value);

  for (let i = 0; i < 3; i++) {
    const embeddedRuns = Array.from(text.matchAll(/<(?:a|w):t[^>]*>([\s\S]*?)<\/(?:a|w):t>/g))
      .map((match) => decodeXml(match[1]).trim())
      .filter(Boolean);

    if (embeddedRuns.length === 0) break;
    text = embeddedRuns.join("\n");
  }

  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\b(?:xmlns(?::\w+)?|[a-zA-Z]+:[a-zA-Z]+|[a-zA-Z]+)="[^"]*"/g, " ")
    .replace(/\b(?:val|id|name|typeface|panose|pitchFamily|charset|lang|sz|kern|cap|spc|baseline|noProof|kumimoji|b|i|u|strike|x|y|cx|cy)="[^"]*"/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextFromXml(xml: string): string {
  return Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
    .map((match) => cleanExtractedText(match[1]))
    .filter(Boolean)
    .join("\n");
}

function classifySlide(title: string, content: string): string {
  const text = `${title} ${content}`.toLowerCase();
  if (text.includes("agenda") || text.includes("contents")) return "agenda";
  if (text.includes("executive summary")) return "executive_summary";
  if (text.includes("case study") || text.includes("challenge") && text.includes("solution")) return "case_study";
  if (text.includes("architecture") || text.includes("platform")) return "architecture";
  if (text.includes("roadmap") || text.includes("timeline") || text.includes("phase")) return "roadmap";
  if (text.includes("risk") || text.includes("mitigation")) return "risk";
  if (text.includes("next step") || text.includes("call to action")) return "closing";
  return "content";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    const slideFiles = await getOrderedPptxSlidePaths(zip);

    const slides: { slideNumber: number; title: string; content: string; notes: string; wordCount: number; detectedType: string }[] = [];

    for (let i = 0; i < slideFiles.length; i++) {
      const slidePath = slideFiles[i];
      const slideXml = await zip.files[slidePath].async("string");
      const slideNumber = i + 1;
      const sourceSlideNumber = slideXmlNumberFromPath(slidePath);
      const text = extractTextFromXml(slideXml);
      const lines = text.split("\n").filter((l) => l.trim());

      const title = lines[0] || "";
      const content = lines.slice(1).join("\n");

      // Try to get notes
      let notes = "";
      const notesPath = `ppt/notesSlides/notesSlide${sourceSlideNumber}.xml`;
      if (zip.files[notesPath]) {
        const notesXml = await zip.files[notesPath].async("string");
        notes = extractTextFromXml(notesXml);
      }

      slides.push({
        slideNumber,
        title: title || `Slide ${slides.length + 1}`,
        content: content.trim(),
        notes: notes.trim(),
        wordCount: text.split(/\s+/).filter(Boolean).length,
        detectedType: classifySlide(title, content),
      });
    }

    return NextResponse.json({
      success: true,
      slideCount: slides.length,
      slides,
    });
  } catch (err) {
    console.error("Extract PPTX error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    message: "PPTX Slide Extractor",
    usage: "POST with multipart form containing .pptx file",
  });
}
