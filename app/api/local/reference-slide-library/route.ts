import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { STYLE_LIBRARY_DIR, indexPptxStyles, readStyleLibrary, writeStyleLibrary } from "@/lib/pptxStyleLibrary";

export const maxDuration = 120;

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "-") || "reference.pptx";
}

export async function GET(): Promise<NextResponse> {
  const slides = await readStyleLibrary();
  const decks = Array.from(new Set(slides.map((s) => s.deckName)));
  return NextResponse.json({
    decks: decks.length,
    slides: slides.length,
    examples: slides.slice(-8).reverse(),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await mkdir(STYLE_LIBRARY_DIR, { recursive: true });
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    const single = form.get("file");
    if (single instanceof File) files.push(single);

    if (!files.length) {
      return NextResponse.json({ error: "No PPTX files uploaded" }, { status: 400 });
    }

    const existing = await readStyleLibrary();
    const indexed = [];
    for (const file of files) {
      if (!/\.pptx$/i.test(file.name)) continue;
      const dest = join(STYLE_LIBRARY_DIR, `${randomUUID()}-${safeName(file.name)}`);
      await writeFile(dest, Buffer.from(await file.arrayBuffer()));
      indexed.push(...await indexPptxStyles(dest, file.name));
    }

    const next = [...existing, ...indexed].slice(-1000);
    await writeStyleLibrary(next);

    return NextResponse.json({
      addedSlides: indexed.length,
      totalSlides: next.length,
      totalDecks: new Set(next.map((s) => s.deckName)).size,
      examples: indexed.slice(0, 6),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(): Promise<NextResponse> {
  try {
    await writeStyleLibrary([]);
    return NextResponse.json({ decks: 0, slides: 0, examples: [] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
