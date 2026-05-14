import { NextRequest, NextResponse } from "next/server";
import { readFile, unlink, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { extname, basename, join } from "path";
import JSZip from "jszip";

interface ComposeBody {
  templatePath: string;
  slides: Array<{ filePath: string; slideNumber: number }>;
  title?: string;
  engine?: "zip" | "automizer" | "aspose" | "aspose-foss";
}

function pptxResponse(output: Buffer, filename: string, engine?: string): NextResponse {
  if (process.env.NODE_ENV !== "production") {
    writeFile("/private/tmp/knowledge-hub-last-composed.pptx", output).catch(() => undefined);
  }
  if (engine) console.log(`[compose-pptx] engine used: ${engine}, bytes: ${output.length}`);

  return new NextResponse(output as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(output.length),
      ...(engine ? { "X-Compose-Engine": engine } : {}),
    },
  });
}

interface SlideSize {
  cx: number;
  cy: number;
}

function parseSlideSize(presentationXml: string): SlideSize | null {
  const match = presentationXml.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  if (!match) return null;
  return { cx: Number(match[1]), cy: Number(match[2]) };
}

function setSlideSize(presentationXml: string, size: SlideSize): string {
  return presentationXml.replace(
    /<p:sldSz\b[^>]*\/>/,
    (tag) => tag.replace(/\bcx="\d+"/, `cx="${size.cx}"`).replace(/\bcy="\d+"/, `cy="${size.cy}"`)
  );
}

async function readPptxSlideSize(filePath: string): Promise<SlideSize | null> {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const presentationXml = await zip.files["ppt/presentation.xml"]?.async("text");
  return presentationXml ? parseSlideSize(presentationXml) : null;
}

async function makeRootWithSlideSize(templatePath: string, size: SlideSize): Promise<string> {
  const zip = await JSZip.loadAsync(await readFile(templatePath));
  const presentationPath = "ppt/presentation.xml";
  const presentationXml = await zip.files[presentationPath]?.async("text");
  if (!presentationXml) throw new Error("Invalid PPTX template");

  zip.file(presentationPath, setSlideSize(presentationXml, size));
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const outputPath = join(tmpdir(), `knowledge-hub-root-${randomUUID()}.pptx`);
  await writeFile(outputPath, output);
  return outputPath;
}

async function getOrderedSlidePaths(zip: JSZip): Promise<string[]> {
  const presentationXml = await zip.files["ppt/presentation.xml"]?.async("text");
  const relsXml = await zip.files["ppt/_rels/presentation.xml.rels"]?.async("text");
  if (!presentationXml || !relsXml) return [];

  const targetByRelId = new Map(parseRels(relsXml).map((rel) => [rel.id, rel.target]));
  const slideList = presentationXml.match(/<p:sldIdLst\b[^>]*>([\s\S]*?)<\/p:sldIdLst>/)?.[1] ?? "";
  const paths: string[] = [];

  for (const match of slideList.matchAll(/<p:sldId\b[^>]*\/>/g)) {
    const relId = attr(match[0], "r:id");
    const target = relId ? targetByRelId.get(relId) : null;
    if (!target) continue;
    paths.push(target.startsWith("ppt/") ? target : `ppt/${target.replace(/^\.\.\//, "")}`);
  }

  return paths;
}


// Add a coordinate-system shift on the slide's root <p:spTree><p:grpSpPr> so children render at
// their native size, centered on the canvas. This is the "Ensure Fit" behaviour PowerPoint
// uses when you change a deck's slide size — preserves geometry instead of stretching.
//
// PowerPoint maps child coords from chOff/chExt space onto off/ext space. With ext = chExt
// (no scaling) and chOff = (-dx, -dy), every child renders at child_off + (dx, dy).
function centerSlideOnCanvas(slideXml: string, source: SlideSize, target: SlideSize): string {
  if (source.cx === target.cx && source.cy === target.cy) return slideXml;

  const dx = Math.round((target.cx - source.cx) / 2);
  const dy = Math.round((target.cy - source.cy) / 2);
  const xfrm = `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${target.cx}" cy="${target.cy}"/><a:chOff x="${-dx}" y="${-dy}"/><a:chExt cx="${target.cx}" cy="${target.cy}"/></a:xfrm>`;

  // Anchor on </p:nvGrpSpPr> so we only touch the spTree's grpSpPr, not nested groups inside
  // shapes. Two shapes the empty grpSpPr is usually written in.
  const afterNv = /(<\/p:nvGrpSpPr>\s*)<p:grpSpPr\s*\/>/;
  if (afterNv.test(slideXml)) {
    return slideXml.replace(afterNv, `$1<p:grpSpPr>${xfrm}</p:grpSpPr>`);
  }
  const afterNvEmpty = /(<\/p:nvGrpSpPr>\s*)<p:grpSpPr>\s*<\/p:grpSpPr>/;
  if (afterNvEmpty.test(slideXml)) {
    return slideXml.replace(afterNvEmpty, `$1<p:grpSpPr>${xfrm}</p:grpSpPr>`);
  }
  // grpSpPr already populated (rare — slide already has its own group transform). Leave alone:
  // overwriting risks breaking whatever it encodes, and most decks use the empty form above.
  return slideXml;
}

async function normalizeComposedOutput(
  output: Buffer,
  slides: ComposeBody["slides"],
  targetSize: SlideSize,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(output);
  const presentationPath = "ppt/presentation.xml";
  const presentationXml = await zip.files[presentationPath]?.async("text");
  if (presentationXml) zip.file(presentationPath, setSlideSize(presentationXml, targetSize));

  // Each slide keeps its native geometry — no linear rescaling (which stretches/squashes
  // mismatched-aspect slides). Slides smaller than the canvas get centered via a group
  // transform; slides matching the canvas are left untouched.
  const slidePaths = await getOrderedSlidePaths(zip);
  const sizeByPath = new Map<string, SlideSize | null>();

  for (let i = 0; i < slides.length; i++) {
    const item = slides[i];
    if (!sizeByPath.has(item.filePath)) {
      sizeByPath.set(item.filePath, await readPptxSlideSize(item.filePath).catch(() => null));
    }
    const sourceSize = sizeByPath.get(item.filePath);
    if (!sourceSize) continue;

    const slidePath = slidePaths[i] ?? `ppt/slides/slide${i + 1}.xml`;
    const slideXml = await zip.files[slidePath]?.async("text");
    if (!slideXml) continue;

    zip.file(slidePath, centerSlideOnCanvas(slideXml, sourceSize, targetSize));
  }

  await repairZipPackage(zip);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

// Defense-in-depth: walk every .rels file, drop relationships whose target part is missing
// from the zip, strip references to those rel IDs from the corresponding XML body, and prune
// Content_Types Overrides for parts that don't exist. Catches issues from both the ZIP merger
// (charts/diagrams we drop) and Automizer (master media refs it sometimes mishandles).
async function repairZipPackage(zip: JSZip): Promise<void> {
  const fileSet = new Set(Object.keys(zip.files).filter((k) => !zip.files[k].dir));

  // 1. Clean broken rels
  const relsFiles = [...fileSet].filter((f) => /\.rels$/.test(f));
  for (const relsFile of relsFiles) {
    const xml = await zip.files[relsFile].async("text");
    // Subject of "X/_rels/Y.rels" is "X/Y"; targets resolve relative to "X". For the package
    // root rels file "_rels/.rels", the filename ".rels" wouldn't match [^/]+\.rels, so the
    // pattern uses [^/]* to also match the empty stem.
    const realBase = relsFile.replace(/(?:^|\/)_rels\/[^/]*\.rels$/, "").replace(/\/$/, "");
    const allRels = parseRels(xml);

    const kept: Rel[] = [];
    const dropped: string[] = [];
    for (const rel of allRels) {
      if (rel.mode === "External") { kept.push(rel); continue; }
      // OPC allows absolute targets (starting with "/") — resolve from package root.
      let resolved: string;
      if (rel.target.startsWith("/")) {
        resolved = rel.target.slice(1);
      } else {
        const baseSegs = realBase.split("/").filter(Boolean);
        for (const s of rel.target.split("/")) {
          if (s === "..") baseSegs.pop();
          else if (s !== ".") baseSegs.push(s);
        }
        resolved = baseSegs.join("/");
      }
      if (fileSet.has(resolved)) kept.push(rel);
      else dropped.push(rel.id);
    }

    if (dropped.length === 0) continue;
    zip.file(relsFile, buildRelsXml(kept));

    // Strip references from the XML body that this .rels file describes (e.g.,
    // ppt/slides/_rels/slide1.xml.rels  →  ppt/slides/slide1.xml)
    const bodyPath = relsFile.replace(/_rels\/([^/]+)\.rels$/, "$1");
    const body = await zip.files[bodyPath]?.async("text");
    if (body) zip.file(bodyPath, dropRefs(body, dropped));
  }

  // 2. Prune Content_Types overrides for parts that don't exist
  const ctPath = "[Content_Types].xml";
  let ctXml = await zip.files[ctPath]?.async("text") ?? "";
  if (ctXml) {
    ctXml = ctXml.replace(/<Override\s[^>]*\bPartName="([^"]+)"[^>]*\/>\s*/g, (tag, partName: string) => {
      const part = partName.replace(/^\//, "");
      return fileSet.has(part) ? tag : "";
    });

    // 2b. Add missing Default entries for media extensions present in the zip but not
    // registered (Aspose eval mode can add .emf/.wmf watermark assets without registering them).
    const registeredExts = new Set(
      [...ctXml.matchAll(/<Default\s[^>]*Extension="([^"]+)"/g)].map((m) => m[1].toLowerCase())
    );
    const missingLines: string[] = [];
    for (const path of fileSet) {
      const ext = extname(path).slice(1).toLowerCase();
      if (!ext || registeredExts.has(ext)) continue;
      const mime = MIME[`.${ext}`];
      if (mime) {
        missingLines.push(`<Default Extension="${ext}" ContentType="${mime}"/>`);
        registeredExts.add(ext);
      }
    }
    if (missingLines.length) ctXml = ctXml.replace("</Types>", missingLines.join("\n") + "\n</Types>");

    zip.file(ctPath, ctXml);
  }

  // 3. Fix presentation.xml: sync app.xml slide count and strip stale section refs.
  // Templates often have sections ("Appendix", "Testing", etc.) whose p14:sldId entries
  // point to template slides that no longer exist in the composed output — PowerPoint
  // silently repairs (and removes) these, which causes the "repaired content" dialog.
  let presXml = await zip.files["ppt/presentation.xml"]?.async("text") ?? "";
  const sldCount = [...presXml.matchAll(/<p:sldId\b/g)].length;

  if (presXml.includes("sectionLst")) {
    const validSldIds = new Set(
      [...presXml.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g)].map((m) => m[1])
    );
    const before = presXml;
    // Drop individual stale <p14:sldId id="X"/> / <p15:sldId id="X"/> entries.
    presXml = presXml.replace(/<p1[45]:sldId\b[^>]*\/>/g, (tag) => {
      const id = tag.match(/\bid="(\d+)"/)?.[1];
      return id && validSldIds.has(id) ? tag : "";
    });
    // Remove sections that became empty (self-closing or empty sldIdLst).
    presXml = presXml.replace(
      /<p1[45]:section\b[^>]*>\s*<p1[45]:sldIdLst\s*\/>\s*<\/p1[45]:section>/g, ""
    );
    presXml = presXml.replace(
      /<p1[45]:section\b[^>]*>\s*<p1[45]:sldIdLst>\s*<\/p1[45]:sldIdLst>\s*<\/p1[45]:section>/g, ""
    );
    if (presXml !== before) zip.file("ppt/presentation.xml", presXml);
  }

  const appPath = "docProps/app.xml";
  const appXml = await zip.files[appPath]?.async("text").catch(() => null);
  if (appXml && sldCount > 0) {
    const titles = Array.from({ length: sldCount }, (_, i) => `Slide ${i + 1}`);
    zip.file(appPath, rebuildAppXml(updateSlideCount(appXml, sldCount), titles));
  }
}

async function composeWithAspose(body: ComposeBody, useLicense = true): Promise<Buffer> {
  const outputPath = join(tmpdir(), `knowledge-hub-aspose-${randomUUID()}.pptx`);
  // FOSS engine uses a separate script (aspose-slides-foss, MIT, no watermark).
  // Commercial engine uses aspose-compose.py (eval watermark without a license file).
  const scriptPath = join(
    process.cwd(), "scripts",
    useLicense ? "aspose-compose.py" : "aspose-foss-compose.py"
  );
  const python = process.env.ASPOSE_PYTHON_BIN || process.env.PYTHON_BIN || "python3";

  try {
    const input = JSON.stringify({
      templatePath: body.templatePath,
      slides: body.slides,
      outputPath,
    });

    // Aspose.Slides for Python (.NET runtime) needs libgdiplus on macOS — typically at
    // /opt/homebrew/lib (Apple Silicon) or /usr/local/lib (Intel). Surface it via DYLD path
    // so the user doesn't have to export it before launching `npm run dev`.
    const env = { ...process.env };
    if (process.platform === "darwin") {
      const existing = env.DYLD_FALLBACK_LIBRARY_PATH ?? "";
      const homebrewLibs = ["/opt/homebrew/lib", "/usr/local/lib"];
      env.DYLD_FALLBACK_LIBRARY_PATH = [existing, ...homebrewLibs].filter(Boolean).join(":");
    }

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(python, [scriptPath], { stdio: ["pipe", "pipe", "pipe"], env });
      let stderr = "";
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("error", (err) => reject(new Error(`aspose-compose spawn failed: ${err.message}. Ensure '${python}' is on PATH and the required package is installed (aspose-slides or aspose-slides-foss).`)));
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`aspose-compose exited ${code}: ${stderr.slice(-500) || "(no stderr)"}`));
      });
      proc.stdin.write(input);
      proc.stdin.end();
    });

    // Run repairZipPackage as defense-in-depth (Aspose handles masters/layouts correctly itself,
    // but the post-processing also normalizes Content_Types and app.xml).
    const buf = await readFile(outputPath);
    const zip = await JSZip.loadAsync(buf);
    await repairZipPackage(zip);
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  } finally {
    await unlink(outputPath).catch(() => undefined);
  }
}

async function composeWithAutomizer(body: ComposeBody): Promise<Buffer> {
  let Automizer: any;
  try {
    Automizer = (await import("pptx-automizer")).Automizer;
  } catch {
    throw new Error("pptx-automizer is not installed. Run: npm install pptx-automizer");
  }

  const outputPath = join(tmpdir(), `knowledge-hub-automizer-${randomUUID()}.pptx`);
  let rootPath = body.templatePath;
  const sourceAliases = new Map<string, string>();
  const sourcePaths = [...new Set(body.slides.map((slide) => slide.filePath))];

  try {
    // Template-wins: the user's branded canvas defines the target aspect ratio. Fall back to
    // the first import only if the template has no slide size defined.
    const targetSize = (await readPptxSlideSize(body.templatePath))
      ?? (await readPptxSlideSize(body.slides[0]?.filePath ?? ""));
    if (!targetSize) throw new Error("Could not read PPTX slide size.");

    rootPath = await makeRootWithSlideSize(body.templatePath, targetSize);

    const automizer = new Automizer({
      autoImportSlideMasters: true,
      removeExistingSlides: true,
      assertRelatedContents: false,
      cleanup: false,
      verbosity: 0,
    });

    automizer.loadRoot(rootPath);
    sourcePaths.forEach((filePath, index) => {
      const alias = `source-${index}`;
      sourceAliases.set(filePath, alias);
      automizer.load(filePath, alias);
    });

    for (const item of body.slides) {
      const alias = sourceAliases.get(item.filePath);
      if (alias && Number.isInteger(item.slideNumber) && item.slideNumber > 0) {
        automizer.addSlide(alias, item.slideNumber);
      }
    }

    await automizer.write(outputPath);
    return normalizeComposedOutput(await readFile(outputPath), body.slides, targetSize);
  } finally {
    if (rootPath !== body.templatePath) await unlink(rootPath).catch(() => undefined);
    await unlink(outputPath).catch(() => undefined);
  }
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

// Strip references to rel IDs that we deliberately dropped (notesSlide, charts, OLE objects,
// tags, diagrams — anything we can't safely copy). Without this, slide XML keeps r:id="rIdX"
// pointing to a rel we didn't write, producing PowerPoint repair errors.
//
// For image embeds (r:embed), removing the attribute alone leaves <a:blip/> with no source,
// which PowerPoint flags as a repair error. Remove the enclosing <p:pic> or <p:graphicFrame>
// instead. For r:id / r:link (hyperlinks, etc.) stripping the attribute is safe.
function dropRefs(xml: string, ids: Iterable<string>): string {
  const idSet = new Set(ids);
  for (const id of idSet) {
    // Remove any <p:pic> whose blipFill references this id (image embed).
    xml = xml.replace(
      new RegExp(`<p:pic\\b[^>]*>(?:(?!<p:pic\\b).)*?r:embed="${id}"[\\s\\S]*?</p:pic>`, "g"),
      ""
    );
    // Remove any <p:graphicFrame> that references this id (chart, OLE, diagram).
    xml = xml.replace(
      new RegExp(`<p:graphicFrame\\b[^>]*>[\\s\\S]*?r:id="${id}"[\\s\\S]*?</p:graphicFrame>`, "g"),
      ""
    );
    // Fallback: strip remaining bare attribute references (hyperlinks, notes, tags).
    xml = xml
      .replaceAll(` r:id="${id}"`, "")
      .replaceAll(` r:embed="${id}"`, "")
      .replaceAll(` r:link="${id}"`, "");
  }
  return xml;
}

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Update docProps/app.xml so HeadingPairs and TitlesOfParts match the rebuilt slide list.
// Stale entries here are a known source of "PowerPoint found a problem" repair warnings.
function rebuildAppXml(xml: string, slideTitles: string[]): string {
  const n = slideTitles.length;
  let out = xml.replace(
    /(<vt:lpstr>Slide Titles<\/vt:lpstr>\s*<\/vt:variant>\s*<vt:variant>\s*<vt:i4>)\d+(<\/vt:i4>)/,
    `$1${n}$2`
  );
  out = out.replace(
    /(<TitlesOfParts>\s*<vt:vector\s+size=")\d+("\s+baseType="lpstr">)[\s\S]*?(<\/vt:vector>\s*<\/TitlesOfParts>)/,
    `$1${n}$2${slideTitles.map((t) => `<vt:lpstr>${escapeXmlAttr(t)}</vt:lpstr>`).join("")}$3`
  );
  return out;
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

  const engine = body.engine
    ?? ((process.env.PPTX_MERGE_ENGINE as ComposeBody["engine"]) || "automizer");
  if (engine === "aspose") {
    try {
      const output = await composeWithAspose(body);
      const fileTitle = title?.trim() || basename(templatePath).replace(/\.pptx$/i, "");
      return pptxResponse(output, `${escapeFileName(fileTitle)}-composed.pptx`, "aspose");
    } catch (err) {
      console.error("[compose-pptx] Aspose failed; falling back to ZIP merger", err);
    }
  }
  if (engine === "aspose-foss") {
    try {
      const output = await composeWithAspose(body, false);
      const fileTitle = title?.trim() || basename(templatePath).replace(/\.pptx$/i, "");
      return pptxResponse(output, `${escapeFileName(fileTitle)}-aspose-foss.pptx`, "aspose-foss");
    } catch (err) {
      console.error("[compose-pptx] Aspose FOSS failed; falling back to ZIP merger", err);
    }
  }
  if (engine === "automizer") {
    try {
      const output = await composeWithAutomizer(body);
      const fileTitle = title?.trim() || basename(templatePath).replace(/\.pptx$/i, "");
      return pptxResponse(output, `${escapeFileName(fileTitle)}-composed.pptx`, "automizer");
    } catch (err) {
      console.error("[compose-pptx] Automizer failed; falling back to ZIP merger", err);
    }
  }

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
    let nextSldId    = Math.max(255, ...[...presXml.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
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
      const dropped = new Set<string>();
      let c = 1;

      for (const rel of srcRels) {
        if (rel.type.endsWith("/slideMaster")) {
          const nid = `rId${c++}`;
          idMap.set(rel.id, nid);
          newRels.push({ id: nid, type: rel.type, target: `../slideMasters/slideMaster${newMasterNum}.xml` });
        } else if (rel.mode === "External") {
          const nid = `rId${c++}`;
          idMap.set(rel.id, nid);
          newRels.push({ ...rel, id: nid });
        } else if (rel.type.includes("/image") || rel.type.includes("/media")) {
          const nid = `rId${c++}`;
          idMap.set(rel.id, nid);
          const srcMedia = resolvePptx(srcLayoutPath, rel.target);
          const dstMedia = await copyMedia(srcZip, srcMedia, fileKey);
          newRels.push({ id: nid, type: rel.type, target: mediaRelTarget(dstMedia) });
        } else {
          // Drop charts, diagrams, OLE objects, tags, etc. — we don't copy their files,
          // so keeping the rel produces a broken pointer (PPT repair error).
          dropped.add(rel.id);
        }
      }

      dst.file(dstPath, dropRefs(applyIdMap(srcXml, idMap), dropped));
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
      const dropped = new Set<string>();
      let c = 1;

      for (const rel of srcRels) {
        if (rel.type.endsWith("/slideLayout")) {
          const nid = `rId${c++}`;
          idMap.set(rel.id, nid);
          const srcLayoutPath = resolvePptx(srcMasterPath, rel.target);
          const newLayoutNum  = await copyLayout(srcZip, srcLayoutPath, fileKey, newMasterNum);
          layoutNumByPath.set(srcLayoutPath, newLayoutNum);
          newRels.push({ id: nid, type: rel.type, target: `../slideLayouts/slideLayout${newLayoutNum}.xml` });
        } else if (rel.type.endsWith("/theme")) {
          const srcThemePath = resolvePptx(srcMasterPath, rel.target);
          const themeXml     = await srcZip.files[srcThemePath]?.async("text");
          if (themeXml) {
            const nid = `rId${c++}`;
            idMap.set(rel.id, nid);
            const themeDst = `ppt/theme/themeExt${newMasterNum}.xml`;
            dst.file(themeDst, themeXml);
            ctPending.push({ partName: `/${themeDst}`, contentType: "application/vnd.openxmlformats-officedocument.drawingml.theme+xml" });
            newRels.push({ id: nid, type: rel.type, target: `../theme/themeExt${newMasterNum}.xml` });
          } else {
            dropped.add(rel.id);
          }
        } else if (rel.mode === "External") {
          const nid = `rId${c++}`;
          idMap.set(rel.id, nid);
          newRels.push({ ...rel, id: nid });
        } else if (rel.type.includes("/image") || rel.type.includes("/media")) {
          const nid = `rId${c++}`;
          idMap.set(rel.id, nid);
          const srcMedia = resolvePptx(srcMasterPath, rel.target);
          const dstMedia = await copyMedia(srcZip, srcMedia, fileKey);
          newRels.push({ id: nid, type: rel.type, target: mediaRelTarget(dstMedia) });
        } else {
          // Drop unknown rel types (charts/diagrams/OLE/tags) instead of leaving broken pointers.
          dropped.add(rel.id);
        }
      }

      dst.file(dstPath, dropRefs(applyIdMap(srcXml, idMap), dropped));
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
        const dropped = new Set<string>();
        let c = 1;

        for (const rel of srcSlideRels) {
          if (rel.type.endsWith("/slideLayout")) {
            const nid = `rId${c++}`;
            idMap.set(rel.id, nid);
            newSlideRels.push({ id: nid, type: rel.type, target: layoutTarget });
          } else if (rel.mode === "External") {
            const nid = `rId${c++}`;
            idMap.set(rel.id, nid);
            newSlideRels.push({ ...rel, id: nid });
          } else if (rel.type.includes("/image") || rel.type.includes("/media")) {
            const nid = `rId${c++}`;
            idMap.set(rel.id, nid);
            const srcMedia = resolvePptx(srcSlidePath, rel.target);
            const dstMedia = await copyMedia(srcZip, srcMedia, item.filePath);
            newSlideRels.push({ id: nid, type: rel.type, target: mediaRelTarget(dstMedia) });
          } else {
            // Drop notesSlide, charts, OLE, diagrams, tags — keeping them produces broken pointers.
            dropped.add(rel.id);
          }
        }

        const newSlideNum  = nextSlideNum++;
        const newSlidePath = `ppt/slides/slide${newSlideNum}.xml`;
        dst.file(newSlidePath, dropRefs(applyIdMap(srcSlideXml, idMap), dropped));
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

    // ── Remove orphan template slides ────────────────────────────────────────
    // Template slides the user did NOT pick are still in the zip but are no longer
    // referenced from presentation.xml.rels — those orphans + their Content_Types
    // overrides cause "PowerPoint found a problem" repair warnings.
    const orphanSlideTargets = allPresRels
      .filter((r) => r.type.endsWith("/slide") && !keptSlideRelIds.has(r.id))
      .map((r) => r.target);
    const removedPartNames: string[] = [];
    for (const target of orphanSlideTargets) {
      const slidePath = target.startsWith("ppt/") ? target
        : target.startsWith("../") ? `ppt/${target.slice(3)}`
        : `ppt/${target}`;
      const slideRelPath = slidePath.replace(/\/([^/]+)$/, "/_rels/$1.rels");

      // Drop notesSlide referenced from this orphan slide (and its rels) too
      const orphanRelsXml = await dst.files[slideRelPath]?.async("text").catch(() => null);
      if (orphanRelsXml) {
        for (const rel of parseRels(orphanRelsXml)) {
          if (!rel.type.endsWith("/notesSlide")) continue;
          const notesPath = resolvePptx(slidePath, rel.target);
          const notesRelPath = notesPath.replace(/\/([^/]+)$/, "/_rels/$1.rels");
          if (dst.files[notesPath]) { dst.remove(notesPath); removedPartNames.push(`/${notesPath}`); }
          if (dst.files[notesRelPath]) dst.remove(notesRelPath);
        }
      }

      if (dst.files[slidePath])   { dst.remove(slidePath);   removedPartNames.push(`/${slidePath}`); }
      if (dst.files[slideRelPath]) dst.remove(slideRelPath);
    }

    // Update app.xml: rebuild slide count + titles list to match the new deck
    const appXml = await dst.files["docProps/app.xml"]?.async("text").catch(() => null);
    if (appXml) {
      const titles = newSldIdEntries.map((_, i) => `Slide ${i + 1}`);
      dst.file("docProps/app.xml", rebuildAppXml(updateSlideCount(appXml, titles.length), titles));
    }

    // Patch Content_Types — add new overrides AND drop overrides for removed orphan parts
    await patchContentTypes(dst, ctPending);
    if (removedPartNames.length > 0) {
      const ctPath = "[Content_Types].xml";
      let ctXml = await dst.files[ctPath]?.async("text") ?? "";
      for (const part of removedPartNames) {
        const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Match the whole self-closing Override tag. Don't use [^/] — ContentType values contain /.
        ctXml = ctXml.replace(new RegExp(`<Override\\s[^>]*\\bPartName="${escaped}"[^>]*\\/>\\s*`, "g"), "");
      }
      dst.file(ctPath, ctXml);
    }

    // ── Output ────────────────────────────────────────────────────────────────
    const output = await dst.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const fileTitle = title?.trim() || basename(templatePath).replace(/\.pptx$/i, "");
    // Template-wins canvas size
    const targetSize = (await readPptxSlideSize(templatePath))
      ?? (await readPptxSlideSize(slides[0]?.filePath ?? ""));
    const normalizedOutput = targetSize
      ? await normalizeComposedOutput(output, slides, targetSize)
      : output;

    return pptxResponse(normalizedOutput, `${escapeFileName(fileTitle)}-composed.pptx`, "zip");
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
