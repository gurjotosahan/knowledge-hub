import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { basename } from "path";

interface CreateDeckBody {
  filePath?: string;
  slides?: number[];
  title?: string;
  items?: Array<{
    filePath: string;
    slideNumber: number;
    fileTitle?: string;
  }>;
}

interface SlideRef {
  slideNumber: number;
  relId: string;
  sldIdXml: string;
}

function escapeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "selected-slides";
}

function updateSlideCount(xml: string, count: number): string {
  return xml.replace(/<Slides>\d+<\/Slides>/, `<Slides>${count}</Slides>`);
}

function attr(xml: string, name: string): string | null {
  return xml.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1] ?? null;
}

function parseSlideRefs(presentationXml: string, relsXml: string): SlideRef[] {
  const relTargetById = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const id = attr(match[0], "Id");
    const target = attr(match[0], "Target");
    if (id && target) relTargetById.set(id, target);
  }

  const refs: SlideRef[] = [];
  const sldIdListXml = presentationXml.match(/<p:sldIdLst\b[^>]*>([\s\S]*?)<\/p:sldIdLst>/)?.[1] ?? "";
  for (const match of sldIdListXml.matchAll(/<p:sldId\b[^>]*\/>/g)) {
    const relId = attr(match[0], "r:id");
    if (!relId) continue;
    const target = relTargetById.get(relId) ?? "";
    const slideMatch = target.match(/(?:^|\/)slide(\d+)\.xml$/);
    if (!slideMatch) continue;
    refs.push({
      slideNumber: Number(slideMatch[1]),
      relId,
      sldIdXml: match[0],
    });
  }
  return refs;
}

function filterPresentationRels(relsXml: string, keepSlideRelIds: Set<string>): string {
  return relsXml.replace(
    /<Relationship\b[^>]*\bType="[^"]*\/slide"[^>]*\/>/g,
    (rel) => {
      const relId = attr(rel, "Id");
      return relId && keepSlideRelIds.has(relId) ? rel : "";
    }
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: CreateDeckBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const deckItems = Array.isArray(body.items) ? body.items : [];
  const itemFilePaths = [...new Set(deckItems.map((item) => item.filePath).filter(Boolean))];
  const filePath = body.filePath || itemFilePaths[0];
  if (itemFilePaths.length > 1) {
    return NextResponse.json(
      { error: "Export supports one source PPTX per deck. Create a new deck for slides from a different source file." },
      { status: 400 }
    );
  }

  const requestedSlides = deckItems.length
    ? deckItems.map((item) => item.slideNumber)
    : Array.isArray(body.slides) ? body.slides : [];
  const slides = [...new Set(requestedSlides)]
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 200);

  if (!filePath || slides.length === 0) {
    return NextResponse.json({ error: "Missing filePath or slides" }, { status: 400 });
  }
  if (!/\.pptx$/i.test(filePath)) {
    return NextResponse.json({ error: "Deck creation supports PPTX files only." }, { status: 415 });
  }

  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await readFile(filePath));

    const presentationPath = "ppt/presentation.xml";
    const relsPath = "ppt/_rels/presentation.xml.rels";
    const appPropsPath = "docProps/app.xml";

    const presentationXml = await zip.files[presentationPath]?.async("text");
    const relsXml = await zip.files[relsPath]?.async("text");
    if (!presentationXml || !relsXml) {
      return NextResponse.json({ error: "Invalid PPTX package" }, { status: 400 });
    }

    const refsBySlide = new Map(parseSlideRefs(presentationXml, relsXml).map((ref) => [ref.slideNumber, ref]));
    const selectedRefs = slides.map((slideNumber) => refsBySlide.get(slideNumber)).filter((ref): ref is SlideRef => Boolean(ref));

    if (selectedRefs.length === 0) {
      return NextResponse.json({ error: "None of the selected slides were found in the deck." }, { status: 404 });
    }

    const keepRelIds = new Set(selectedRefs.map((ref) => ref.relId));
    const nextSlideList = `<p:sldIdLst>\n${selectedRefs.map((ref) => ref.sldIdXml).join("\n")}\n</p:sldIdLst>`;
    const nextPresentationXml = presentationXml.replace(/<p:sldIdLst\b[^>]*>[\s\S]*?<\/p:sldIdLst>/, nextSlideList);
    zip.file(presentationPath, nextPresentationXml);
    zip.file(relsPath, filterPresentationRels(relsXml, keepRelIds));

    const appPropsXml = await zip.files[appPropsPath]?.async("text").catch(() => null);
    if (appPropsXml) zip.file(appPropsPath, updateSlideCount(appPropsXml, selectedRefs.length));

    const output = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const baseTitle = body.title?.trim() || basename(filePath).replace(/\.pptx$/i, "");
    const filename = `${escapeFileName(baseTitle)}-selected-slides.pptx`;

    return new NextResponse(output as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(output.length),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
