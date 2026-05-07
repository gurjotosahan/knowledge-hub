import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { extname, basename } from "path";

interface ComposeBody {
  templatePath: string;
  slides: Array<{ filePath: string; slideNumber: number }>;
  title?: string;
}

// ── XML / rels helpers ────────────────────────────────────────────────────────

function attr(xml: string, name: string): string | null {
  return xml.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1] ?? null;
}

interface Rel { id: string; type: string; target: string; mode?: string }

function parseRels(xml: string): Rel[] {
  const out: Rel[] = [];
  for (const m of xml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const id     = attr(m[0], "Id")         ?? "";
    const type   = attr(m[0], "Type")       ?? "";
    const target = attr(m[0], "Target")     ?? "";
    const mode   = attr(m[0], "TargetMode") ?? undefined;
    if (id) out.push({ id, type, target, ...(mode ? { mode } : {}) });
  }
  return out;
}

function buildRelsXml(rels: Rel[]): string {
  const body = rels
    .map((r) => {
      const m = r.mode ? ` TargetMode="${r.mode}"` : "";
      return `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"${m}/>`;
    })
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `${body}\n</Relationships>`
  );
}

interface SlideRef { slideNumber: number; relId: string; sldIdXml: string }

function parseSlideRefs(presXml: string, presRelsXml: string): SlideRef[] {
  const byId = new Map<string, string>();
  for (const r of parseRels(presRelsXml)) byId.set(r.id, r.target);
  const out: SlideRef[] = [];
  const list = presXml.match(/<p:sldIdLst\b[^>]*>([\s\S]*?)<\/p:sldIdLst>/)?.[1] ?? "";
  for (const m of list.matchAll(/<p:sldId\b[^>]*\/>/g)) {
    const relId = attr(m[0], "r:id");
    if (!relId) continue;
    const n = (byId.get(relId) ?? "").match(/slide(\d+)\.xml$/)?.[1];
    if (n) out.push({ slideNumber: Number(n), relId, sldIdXml: m[0] });
  }
  return out;
}

// Resolve a PPTX-relative path.  e.g. resolvePptx("ppt/slides/slide1.xml", "../media/img.png") → "ppt/media/img.png"
function resolvePptx(basePart: string, rel: string): string {
  if (rel.startsWith("/")) return rel.slice(1);
  const segs = basePart.split("/").slice(0, -1);
  for (const s of rel.split("/")) {
    if (s === "..") segs.pop();
    else if (s !== ".") segs.push(s);
  }
  return segs.join("/");
}

// Relative path from a part at depth 3 (ppt/X/Y.xml) to ppt/media/Z  → always "../media/Z"
function mediaRelTarget(dstMediaPath: string): string {
  return `../media/${dstMediaPath.replace("ppt/media/", "")}`;
}

function rewriteRef(xml: string, oldId: string, newId: string): string {
  return xml
    .replaceAll(`r:id="${oldId}"`,    `r:id="${newId}"`)
    .replaceAll(`r:embed="${oldId}"`, `r:embed="${newId}"`)
    .replaceAll(`r:link="${oldId}"`,  `r:link="${newId}"`);
}

function applyIdMap(xml: string, map: Map<string, string>): string {
  for (const [o, n] of map) xml = rewriteRef(xml, o, n);
  return xml;
}

function escapeFileName(s: string): string {
  return s.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "composed";
}

function updateSlideCount(xml: string, n: number): string {
  return xml.replace(/<Slides>\d+<\/Slides>/, `<Slides>${n}</Slides>`);
}

// ── Content_Types ─────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".bmp": "image/bmp", ".tiff": "image/tiff",
  ".svg": "image/svg+xml", ".wmf": "image/x-wmf", ".emf": "image/x-emf",
  ".mp4": "video/mp4", ".mp3": "audio/mpeg",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function patchContentTypes(zip: any, overrides: Array<{ partName: string; contentType: string }>) {
  const ctPath = "[Content_Types].xml";
  let ctXml: string = await zip.files[ctPath]?.async("text") ?? "";
  if (!ctXml) return;

  const seenExt  = new Set<string>([...ctXml.matchAll(/<Default\s[^>]*Extension="([^"]+)"/g)].map((m) => m[1].toLowerCase()));
  const seenPart = new Set<string>([...ctXml.matchAll(/<Override\s[^>]*PartName="([^"]+)"/g)].map((m) => m[1]));

  const lines: string[] = [];
  for (const { partName, contentType } of overrides) {
    if (seenPart.has(partName)) continue;
    const isMedia = /\/(image|video|audio)/.test(contentType);
    if (isMedia) {
      const ext = partName.split(".").pop()?.toLowerCase() ?? "";
      if (!seenExt.has(ext)) { lines.push(`<Default Extension="${ext}" ContentType="${contentType}"/>`); seenExt.add(ext); }
    } else {
      lines.push(`<Override PartName="${partName}" ContentType="${contentType}"/>`);
      seenPart.add(partName);
    }
  }
  if (lines.length) ctXml = ctXml.replace("</Types>", lines.join("\n") + "\n</Types>");
  zip.file(ctPath, ctXml);
}

// ── Main route ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ComposeBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { templatePath, slides, title } = body;
  if (!templatePath || !Array.isArray(slides) || slides.length === 0)
    return NextResponse.json({ error: "Missing templatePath or slides" }, { status: 400 });
  if (!/\.pptx$/i.test(templatePath))
    return NextResponse.json({ error: "Template must be a PPTX file" }, { status: 415 });

  try {
    const JSZip = (await import("jszip")).default;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dst: any = await JSZip.loadAsync(await readFile(templatePath));

    let presXml  = await dst.files["ppt/presentation.xml"]?.async("text") ?? "";
    let presRels = await dst.files["ppt/_rels/presentation.xml.rels"]?.async("text") ?? "";
    if (!presXml || !presRels)
      return NextResponse.json({ error: "Invalid PPTX template" }, { status: 400 });

    const tmplSlideByNum = new Map(parseSlideRefs(presXml, presRels).map((r) => [r.slideNumber, r]));
    const allPresRels    = parseRels(presRels);

    // Next available numbers
    const zipNums = (re: RegExp) =>
      Object.keys(dst.files).map((f) => Number(f.match(re)?.[1])).filter(Boolean);
    let nextSlideNum  = Math.max(0, ...zipNums(/ppt\/slides\/slide(\d+)\.xml$/))  + 100;
    let nextLayoutNum = Math.max(0, ...zipNums(/ppt\/slideLayouts\/slideLayout(\d+)\.xml$/)) + 1;
    let nextMasterNum = Math.max(0, ...zipNums(/ppt\/slideMasters\/slideMaster(\d+)\.xml$/)) + 1;
    let mediaCounter  = 0;

    let maxRelNum    = allPresRels.reduce((m, r) => Math.max(m, Number(r.id.replace(/\D/g, "")) || 0), 0);
    let nextSldId    = Math.max(255, ...[...presXml.matchAll(/\bid="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
    let nextMasterId = Math.max(2147483647, ...[...presXml.matchAll(/<p:sldMasterId\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]))) + 1;

    // ── Caches ────────────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const srcZips = new Map<string, any>();
    const mediaCache  = new Map<string, string>(); // "fileKey::srcPath" → dst media path
    const layoutCache = new Map<string, number>();  // "fileKey::srcLayoutPath" → new layout num
    // masterCache maps "fileKey::srcMasterPath" → { newMasterNum, layoutNumByPath }
    const masterCache = new Map<string, { newMasterNum: number; layoutNumByPath: Map<string, number> }>();

    // Pending content-type overrides
    const ctPending: Array<{ partName: string; contentType: string }> = [];

    // New entries for presentation.xml
    const newMasterPresRels: Rel[]    = [];
    const newMasterIdEntries: string[] = [];
    const newSlidePresRels: Rel[]     = [];
    const newSldIdEntries: string[]   = [];
    const keptSlideRelIds = new Set<string>();

    async function getSrc(fp: string) {
      if (!srcZips.has(fp)) srcZips.set(fp, await JSZip.loadAsync(await readFile(fp)));
      return srcZips.get(fp);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function copyMedia(srcZip: any, srcPath: string, fileKey: string): Promise<string> {
      const k = `${fileKey}::${srcPath}`;
      if (!mediaCache.has(k)) {
        const ext     = extname(srcPath) || ".bin";
        const dstPath = `ppt/media/ext${++mediaCounter}${ext}`;
        const buf     = await srcZip.files[srcPath]?.async("nodebuffer");
        if (buf) {
          dst.file(dstPath, buf);
          ctPending.push({ partName: `/${dstPath}`, contentType: MIME[ext.toLowerCase()] ?? "application/octet-stream" });
        }
        mediaCache.set(k, dstPath);
      }
      return mediaCache.get(k)!;
    }

    // Copy a layout as part of a master copy.  newMasterNum is already known.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function copyLayout(srcZip: any, srcLayoutPath: string, fileKey: string, newMasterNum: number): Promise<number> {
      const k = `${fileKey}::${srcLayoutPath}`;
      if (layoutCache.has(k)) return layoutCache.get(k)!;

      const newNum     = nextLayoutNum++;
      const dstPath    = `ppt/slideLayouts/slideLayout${newNum}.xml`;
      const dstRelPath = `ppt/slideLayouts/_rels/slideLayout${newNum}.xml.rels`;

      const srcXml     = await srcZip.files[srcLayoutPath]?.async("text") ?? "";
      const srcRelPath = srcLayoutPath.replace(/\/([^/]+)$/, "/_rels/$1.rels");
      const srcRels    = parseRels(await srcZip.files[srcRelPath]?.async("text") ?? "");

      const newRels: Rel[] = [];
      const idMap = new Map<string, string>();
      let c = 1;

      for (const rel of srcRels) {
        const nid = `rId${c++}`;
        idMap.set(rel.id, nid);

        if (rel.type.endsWith("/slideMaster")) {
          // Point back to our new master
          newRels.push({ id: nid, type: rel.type, target: `../slideMasters/slideMaster${newMasterNum}.xml` });
        } else if (rel.mode === "External") {
          newRels.push({ ...rel, id: nid });
        } else if (rel.type.includes("/image") || rel.type.includes("/media")) {
          const srcMedia = resolvePptx(srcLayoutPath, rel.target);
          const dstMedia = await copyMedia(srcZip, srcMedia, fileKey);
          newRels.push({ id: nid, type: rel.type, target: mediaRelTarget(dstMedia) });
        } else {
          newRels.push({ ...rel, id: nid });
        }
      }

      dst.file(dstPath, applyIdMap(srcXml, idMap));
      dst.file(dstRelPath, buildRelsXml(newRels));
      ctPending.push({ partName: `/${dstPath}`, contentType: "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml" });

      layoutCache.set(k, newNum);
      return newNum;
    }

    // Copy a master AND ALL its layouts (so no broken refs in master rels).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function ensureMaster(srcZip: any, srcMasterPath: string, fileKey: string) {
      const k = `${fileKey}::${srcMasterPath}`;
      if (masterCache.has(k)) return masterCache.get(k)!;

      const newMasterNum = nextMasterNum++;
      const dstPath      = `ppt/slideMasters/slideMaster${newMasterNum}.xml`;
      const dstRelPath   = `ppt/slideMasters/_rels/slideMaster${newMasterNum}.xml.rels`;

      // Reserve cache entry immediately to break any accidental re-entry
      const layoutNumByPath = new Map<string, number>();
      masterCache.set(k, { newMasterNum, layoutNumByPath });

      const srcXml     = await srcZip.files[srcMasterPath]?.async("text") ?? "";
      const srcRelPath = srcMasterPath.replace(/\/([^/]+)$/, "/_rels/$1.rels");
      const srcRels    = parseRels(await srcZip.files[srcRelPath]?.async("text") ?? "");

      const newRels: Rel[] = [];
      const idMap = new Map<string, string>();
      let c = 1;

      for (const rel of srcRels) {
        const nid = `rId${c++}`;
        idMap.set(rel.id, nid);

        if (rel.type.endsWith("/slideLayout")) {
          // Copy this layout (pointing to our new master)
          const srcLayoutPath = resolvePptx(srcMasterPath, rel.target);
          const newLayoutNum  = await copyLayout(srcZip, srcLayoutPath, fileKey, newMasterNum);
          layoutNumByPath.set(srcLayoutPath, newLayoutNum);
          newRels.push({ id: nid, type: rel.type, target: `../slideLayouts/slideLayout${newLayoutNum}.xml` });
        } else if (rel.type.endsWith("/theme")) {
          // Copy theme file
          const srcThemePath = resolvePptx(srcMasterPath, rel.target);
          const themeXml     = await srcZip.files[srcThemePath]?.async("text");
          if (themeXml) {
            const themeDst = `ppt/theme/themeExt${newMasterNum}.xml`;
            dst.file(themeDst, themeXml);
            ctPending.push({ partName: `/${themeDst}`, contentType: "application/vnd.openxmlformats-officedocument.drawingml.theme+xml" });
            newRels.push({ id: nid, type: rel.type, target: `../theme/themeExt${newMasterNum}.xml` });
          } else {
            newRels.push({ ...rel, id: nid });
          }
        } else if (rel.mode === "External") {
          newRels.push({ ...rel, id: nid });
        } else if (rel.type.includes("/image") || rel.type.includes("/media")) {
          const srcMedia = resolvePptx(srcMasterPath, rel.target);
          const dstMedia = await copyMedia(srcZip, srcMedia, fileKey);
          newRels.push({ id: nid, type: rel.type, target: mediaRelTarget(dstMedia) });
        } else {
          newRels.push({ ...rel, id: nid });
        }
      }

      dst.file(dstPath, applyIdMap(srcXml, idMap));
      dst.file(dstRelPath, buildRelsXml(newRels));
      ctPending.push({ partName: `/${dstPath}`, contentType: "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml" });

      // Register master in presentation
      const presRelId = `rId${++maxRelNum}`;
      newMasterPresRels.push({ id: presRelId, type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster", target: `slideMasters/slideMaster${newMasterNum}.xml` });
      newMasterIdEntries.push(`<p:sldMasterId id="${nextMasterId++}" r:id="${presRelId}"/>`);

      return masterCache.get(k)!;
    }

    // ── Process each slide ────────────────────────────────────────────────────

    for (const item of slides) {
      if (item.filePath === templatePath) {
        // ── Template slide: keep as-is ───────────────────────────────────────
        const ref = tmplSlideByNum.get(item.slideNumber);
        if (!ref) continue;
        keptSlideRelIds.add(ref.relId);
        newSldIdEntries.push(`<p:sldId id="${nextSldId++}" r:id="${ref.relId}"/>`);
      } else {
        // ── External slide ───────────────────────────────────────────────────
        const srcZip     = await getSrc(item.filePath);
        const srcPresXml = await srcZip.files["ppt/presentation.xml"]?.async("text") ?? "";
        const srcPresRels= await srcZip.files["ppt/_rels/presentation.xml.rels"]?.async("text") ?? "";
        const srcRef     = parseSlideRefs(srcPresXml, srcPresRels).find((r) => r.slideNumber === item.slideNumber);
        if (!srcRef) continue;

        const srcSlideTarget = parseRels(srcPresRels).find((r) => r.id === srcRef.relId)?.target ?? "";
        const srcSlidePath   = srcSlideTarget.startsWith("slides/") ? `ppt/${srcSlideTarget}`
          : srcSlideTarget.startsWith("../") ? `ppt/${srcSlideTarget.slice(3)}` : srcSlideTarget;

        const srcSlideXml = await srcZip.files[srcSlidePath]?.async("text");
        if (!srcSlideXml) continue;

        const srcRelPath  = srcSlidePath.replace(/\/([^/]+)$/, "/_rels/$1.rels");
        const srcSlideRels = parseRels(await srcZip.files[srcRelPath]?.async("text") ?? "");

        // Resolve layout → master chain, copy both
        let layoutTarget = "../slideLayouts/slideLayout1.xml";
        const layoutRel  = srcSlideRels.find((r) => r.type.endsWith("/slideLayout"));

        if (layoutRel) {
          const srcLayoutPath = resolvePptx(srcSlidePath, layoutRel.target);

          // Find master from layout rels
          const srcLayoutRelPath = srcLayoutPath.replace(/\/([^/]+)$/, "/_rels/$1.rels");
          const srcLayoutRels    = parseRels(await srcZip.files[srcLayoutRelPath]?.async("text") ?? "");
          const masterRel        = srcLayoutRels.find((r) => r.type.endsWith("/slideMaster"));

          if (masterRel) {
            const srcMasterPath = resolvePptx(srcLayoutPath, masterRel.target);
            const { layoutNumByPath } = await ensureMaster(srcZip, srcMasterPath, item.filePath);
            const newLayoutNum = layoutNumByPath.get(srcLayoutPath);
            if (newLayoutNum !== undefined) layoutTarget = `../slideLayouts/slideLayout${newLayoutNum}.xml`;
          }
        }

        // Rewrite slide rels
        const newSlideRels: Rel[] = [];
        const idMap = new Map<string, string>();
        let c = 1;

        for (const rel of srcSlideRels) {
          const nid = `rId${c++}`;
          idMap.set(rel.id, nid);

          if (rel.type.endsWith("/slideLayout")) {
            newSlideRels.push({ id: nid, type: rel.type, target: layoutTarget });
          } else if (rel.mode === "External") {
            newSlideRels.push({ ...rel, id: nid });
          } else if (rel.type.includes("/image") || rel.type.includes("/media")) {
            const srcMedia = resolvePptx(srcSlidePath, rel.target);
            const dstMedia = await copyMedia(srcZip, srcMedia, item.filePath);
            newSlideRels.push({ id: nid, type: rel.type, target: mediaRelTarget(dstMedia) });
          } else {
            newSlideRels.push({ ...rel, id: nid });
          }
        }

        const newSlideNum  = nextSlideNum++;
        const newSlidePath = `ppt/slides/slide${newSlideNum}.xml`;
        dst.file(newSlidePath, applyIdMap(srcSlideXml, idMap));
        dst.file(`ppt/slides/_rels/slide${newSlideNum}.xml.rels`, buildRelsXml(newSlideRels));
        ctPending.push({ partName: `/${newSlidePath}`, contentType: "application/vnd.openxmlformats-officedocument.presentationml.slide+xml" });

        const relId = `rId${++maxRelNum}`;
        newSlidePresRels.push({ id: relId, type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide", target: `slides/slide${newSlideNum}.xml` });
        newSldIdEntries.push(`<p:sldId id="${nextSldId++}" r:id="${relId}"/>`);
      }
    }

    // ── Rebuild presentation.xml ─────────────────────────────────────────────

    if (newMasterIdEntries.length > 0) {
      presXml = presXml.replace(
        /(<p:sldMasterIdLst\b[^>]*>)([\s\S]*?)(<\/p:sldMasterIdLst>)/,
        (_: string, open: string, inner: string, close: string) =>
          `${open}${inner}${newMasterIdEntries.join("\n")}\n${close}`
      );
    }

    presXml = presXml.replace(
      /<p:sldIdLst\b[^>]*>[\s\S]*?<\/p:sldIdLst>/,
      `<p:sldIdLst>\n${newSldIdEntries.join("\n")}\n</p:sldIdLst>`
    );
    dst.file("ppt/presentation.xml", presXml);

    // Rebuild presentation rels
    const keptSlideRels    = allPresRels.filter((r) => r.type.endsWith("/slide") && keptSlideRelIds.has(r.id));
    const nonSlideRels     = allPresRels.filter((r) => !r.type.endsWith("/slide"));
    dst.file("ppt/_rels/presentation.xml.rels", buildRelsXml([
      ...nonSlideRels,
      ...newMasterPresRels,
      ...keptSlideRels,
      ...newSlidePresRels,
    ]));

    // Update app.xml slide count
    const appXml = await dst.files["docProps/app.xml"]?.async("text").catch(() => null);
    if (appXml) dst.file("docProps/app.xml", updateSlideCount(appXml, newSldIdEntries.length));

    // Patch Content_Types
    await patchContentTypes(dst, ctPending);

    // ── Output ────────────────────────────────────────────────────────────────
    const output = await dst.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const fileTitle = title?.trim() || basename(templatePath).replace(/\.pptx$/i, "");

    return new NextResponse(output as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${escapeFileName(fileTitle)}-composed.pptx"`,
        "Content-Length": String(output.length),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
