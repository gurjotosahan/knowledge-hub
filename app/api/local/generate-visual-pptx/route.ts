import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import PptxGenJS from "pptxgenjs";
import { renderVisualSlideSvg } from "@/lib/visualSlideRenderer";
import type { PptDeckDraft, PptSlideDraft } from "@/types/ppt-intelligence";

export const maxDuration = 120;

type Body = Partial<PptDeckDraft> & { slides: PptSlideDraft[] };

const OUT_DIR = join(tmpdir(), "kh-generated-pptx");
function safeFilename(name: string): string {
  return (name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "presentation") + ".pptx";
}

function dataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!Array.isArray(body.slides) || body.slides.length === 0) {
    return NextResponse.json({ error: "No slides provided" }, { status: 400 });
  }

  try {
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
    pptx.layout = "WIDE";
    pptx.author = "Apexon Knowledge Hub";
    pptx.company = "Apexon";
    pptx.subject = "Visual PPT Generator";
    pptx.title = body.title || body.slides[0]?.title || "Presentation";

    body.slides.forEach((slideInput) => {
      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };
      slide.addImage({ data: dataUri(renderVisualSlideSvg(slideInput)), x: 0, y: 0, w: 13.333, h: 7.5 });
      if (slideInput.notes) slide.addNotes(slideInput.notes);
    });

    await mkdir(OUT_DIR, { recursive: true });
    const filename = safeFilename(body.title || body.slides[0]?.title || "presentation");
    const outPath = join(OUT_DIR, `${randomUUID()}-${filename}`);
    const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    await writeFile(outPath, buf);
    return NextResponse.json({ path: outPath, filename, sizeBytes: buf.length, slideCount: body.slides.length, engine: "visual-svg" });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
