import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import type { PptxSlideData, TextShape, ImageShape, Para, TextRun } from "@/types/pptx";

// ── XML helpers ───────────────────────────────────────────────────────────────

function getAttr(xml: string, name: string): string | null {
  return xml.match(new RegExp(`\\b${name}="([^"]*)"`))?.[ 1] ?? null;
}

function getBlock(xml: string, localName: string): string | null {
  const re = new RegExp(
    `<(?:[a-zA-Z]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z]+:)?${localName}>`
  );
  return xml.match(re)?.[1] ?? null;
}

function allBlocks(xml: string, localName: string): string[] {
  const re = new RegExp(
    `<(?:[a-zA-Z]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z]+:)?${localName}>`,
    "g"
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[0]);
  return out;
}

function parseColor(xml: string): string | null {
  const srgb = xml.match(/<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);
  if (srgb) return `#${srgb[1]}`;
  const sys = xml.match(/<a:sysClr[^>]+lastClr="([0-9A-Fa-f]{6})"/);
  if (sys) return `#${sys[1]}`;
  return null;
}

function parseXfrm(xml: string): { x: number; y: number; w: number; h: number } | null {
  const offM = xml.match(/<a:off([^/]+)\/>/);
  const extM = xml.match(/<a:ext([^/]+)\/>/);
  if (!offM || !extM) return null;
  const x  = offM[1].match(/\bx="(-?\d+)"/)?.[1];
  const y  = offM[1].match(/\by="(-?\d+)"/)?.[1];
  const cx = extM[1].match(/\bcx="(\d+)"/)?.[1];
  const cy = extM[1].match(/\bcy="(\d+)"/)?.[1];
  if (x == null || y == null || !cx || !cy) return null;
  return { x: +x, y: +y, w: +cx, h: +cy };
}

function isDark(hex: string): boolean {
  if (hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

// Build rId → zip-path map from a .rels XML string, relative to a base dir
function buildRelMap(relsXml: string, baseDir: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of relsXml.matchAll(/<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g)) {
    const target = m[2];
    // Resolve relative paths
    const resolved = target.startsWith("/")
      ? target.slice(1)
      : target.startsWith("../")
      ? target.replace("../", baseDir.split("/").slice(0, -1).join("/") + "/")
      : `${baseDir}/${target}`;
    map[m[1]] = resolved.replace(/\/+/g, "/");
  }
  return map;
}

// ── Shapes parser (shared for slide / layout / master spTrees) ────────────────

function parseShapes(
  xml: string,
  slideW: number,
  slideH: number,
  relMap: Record<string, string>,
  bgColor: string | undefined
): (TextShape | ImageShape)[] {
  const shapes: (TextShape | ImageShape)[] = [];

  // Text shapes
  for (const sp of allBlocks(xml, "sp")) {
    const spPr = getBlock(sp, "spPr") ?? "";
    const txBody = getBlock(sp, "txBody");
    if (!txBody) continue;

    const xfrm = parseXfrm(sp);
    if (!xfrm) continue;

    const x = (xfrm.x / slideW) * 100;
    const y = (xfrm.y / slideH) * 100;
    const w = (xfrm.w / slideW) * 100;
    const h = (xfrm.h / slideH) * 100;
    if (w <= 0 || h <= 0) continue;

    let fill: string | undefined;
    if (!spPr.includes("<a:noFill") && !spPr.includes("<a:noFill/>")) {
      const sf = getBlock(spPr, "solidFill");
      if (sf) fill = parseColor(sf) ?? undefined;
    }

    const bodyPr = getBlock(txBody, "bodyPr") ?? "";
    const valign = (getAttr(bodyPr, "anchor") ?? "t") as TextShape["valign"];

    const paragraphs: Para[] = [];
    for (const pXml of allBlocks(txBody, "p")) {
      const pPr = getBlock(pXml, "pPr") ?? "";
      const align = (getAttr(pPr, "algn") ?? "l") as Para["align"];
      const runs: TextRun[] = [];

      for (const rXml of allBlocks(pXml, "r")) {
        const t = getBlock(rXml, "t");
        if (!t?.trim()) continue;
        const rPr = getBlock(rXml, "rPr") ?? "";
        const bold    = /\bb="1"/.test(rPr) || /\bb="true"/.test(rPr);
        const italic  = /\bi="1"/.test(rPr) || /\bi="true"/.test(rPr);
        const szRaw   = getAttr(rPr, "sz");
        const fontSize = szRaw ? +szRaw / 100 : undefined;
        const colorSf = getBlock(rPr, "solidFill");
        const color   = colorSf ? (parseColor(colorSf) ?? undefined) : undefined;
        runs.push({ text: t, bold: bold || undefined, italic: italic || undefined, fontSize, color });
      }
      if (pXml.includes("<a:br")) runs.push({ text: "\n" });
      if (runs.length) paragraphs.push({ runs, align });
    }
    if (!paragraphs.length) continue;

    const bgForContrast = fill ?? bgColor ?? "#ffffff";
    const defaultColor  = isDark(bgForContrast) ? "#f1f5f9" : "#1e293b";
    shapes.push({ kind: "text", x, y, w, h, fill, valign, paragraphs, defaultColor });
  }

  // Image shapes
  for (const pic of allBlocks(xml, "pic")) {
    const xfrm = parseXfrm(pic);
    if (!xfrm) continue;
    const blipM = pic.match(/<a:blip[^>]+r:embed="([^"]+)"/);
    if (!blipM) continue;
    const mediaPath = relMap[blipM[1]];
    if (!mediaPath) continue;

    shapes.push({
      kind: "image",
      x: (xfrm.x / slideW) * 100,
      y: (xfrm.y / slideH) * 100,
      w: (xfrm.w / slideW) * 100,
      h: (xfrm.h / slideH) * 100,
      mediaPath,
    });
  }

  return shapes;
}

// ── Main route ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const filePath = req.nextUrl.searchParams.get("path");
  const slideNum = Math.max(1, parseInt(req.nextUrl.searchParams.get("slide") ?? "1", 10));
  if (!filePath) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  try {
    const buffer = await readFile(filePath);
    const JSZip  = (await import("jszip")).default;
    const zip    = await JSZip.loadAsync(buffer);

    // ── Presentation dimensions ──
    const presXml = (await zip.files["ppt/presentation.xml"]?.async("text")) ?? "";
    const sldSzM  = presXml.match(/<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/);
    const slideW  = sldSzM ? +sldSzM[1] : 9144000;
    const slideH  = sldSzM ? +sldSzM[2] : 5143500;

    // ── Slide XML & its rel map ──
    const slideXml = await zip.files[`ppt/slides/slide${slideNum}.xml`]?.async("text");
    if (!slideXml) return NextResponse.json({ error: "Slide not found" }, { status: 404 });

    const slideRelsXml =
      (await zip.files[`ppt/slides/_rels/slide${slideNum}.xml.rels`]?.async("text")) ?? "";
    const slideRelMap = buildRelMap(slideRelsXml, "ppt/slides");

    // ── Resolve slide layout ──
    const layoutRel = slideRelsXml.match(/Target="(\.\.\/slideLayouts\/[^"]+)"/);
    const layoutPath = layoutRel
      ? "ppt/" + layoutRel[1].replace("../", "")
      : null;
    const layoutXml = layoutPath
      ? ((await zip.files[layoutPath]?.async("text")) ?? "")
      : "";
    const layoutName = layoutPath?.split("/").pop() ?? "";
    const layoutRelsXml = layoutName
      ? ((await zip.files[`ppt/slideLayouts/_rels/${layoutName}.rels`]?.async("text")) ?? "")
      : "";
    const layoutRelMap = layoutRelsXml
      ? buildRelMap(layoutRelsXml, "ppt/slideLayouts")
      : {};

    // ── Resolve slide master ──
    const masterRel = layoutRelsXml.match(/Target="(\.\.\/slideMasters\/[^"]+)"/);
    const masterPath = masterRel
      ? "ppt/" + masterRel[1].replace("../", "")
      : null;
    const masterXml = masterPath
      ? ((await zip.files[masterPath]?.async("text")) ?? "")
      : "";
    const masterName = masterPath?.split("/").pop() ?? "";
    const masterRelsXml = masterName
      ? ((await zip.files[`ppt/slideMasters/_rels/${masterName}.rels`]?.async("text")) ?? "")
      : "";
    const masterRelMap = masterRelsXml
      ? buildRelMap(masterRelsXml, "ppt/slideMasters")
      : {};

    // ── Background: slide → layout → master ──
    let background: string | undefined;
    let backgroundMediaPath: string | undefined;

    for (const [bgXml, relMap] of [
      [slideXml,  slideRelMap],
      [layoutXml, layoutRelMap],
      [masterXml, masterRelMap],
    ] as [string, Record<string, string>][]) {
      if (background || backgroundMediaPath) break;
      const bgBlock = getBlock(bgXml, "bg");
      if (!bgBlock) continue;
      // Solid fill
      const sf = getBlock(bgBlock, "solidFill");
      if (sf) { background = parseColor(sf) ?? undefined; break; }
      // Image fill
      const blipM = bgBlock.match(/<a:blip[^>]+r:embed="([^"]+)"/);
      if (blipM) {
        const p = relMap[blipM[1]];
        if (p && zip.files[p]) { backgroundMediaPath = p; break; }
      }
    }

    // ── Parse shapes: slide overrides layout (master is decorative, skip) ──
    const slideSpTreeXml  = getBlock(slideXml,  "spTree") ?? "";
    const layoutSpTreeXml = getBlock(layoutXml, "spTree") ?? "";

    // Use slide shapes if any exist; supplement with layout shapes for content
    const slideShapes  = parseShapes(slideSpTreeXml,  slideW, slideH, slideRelMap,  background);
    const layoutShapes = parseShapes(layoutSpTreeXml, slideW, slideH, layoutRelMap, background);

    // Slide-level shapes take priority; add layout shapes that aren't covered
    const shapes = slideShapes.length > 0
      ? slideShapes
      : layoutShapes;

    // Images behind text
    shapes.sort((a, b) =>
      a.kind === "image" && b.kind === "text" ? -1
      : a.kind === "text" && b.kind === "image" ? 1
      : 0
    );

    const result: PptxSlideData = {
      slideEmuWidth: slideW,
      slideEmuHeight: slideH,
      background,
      backgroundMediaPath,
      shapes,
    };

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
