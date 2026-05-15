import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { access, mkdir, readdir, rename, stat } from "fs/promises";
import { basename, join } from "path";
import { homedir } from "os";

const execFileAsync = promisify(execFile);
const PREVIEW_ROOT = join(homedir(), ".knowledge-hub", "slide-previews");
const PREVIEW_CACHE_VERSION = "v2";

export interface SlidePreviewInfo {
  slideNumber: number;
  pdfPath: string;
  thumbnailPath?: string;
  status: "thumbnail" | "pdf" | "failed";
  warning?: string;
}

export interface DeckPreviewResult {
  filePath: string;
  pdfPath?: string;
  previews: SlidePreviewInfo[];
  status: "ready" | "pdf-only" | "failed" | "skipped";
  warning?: string;
}

async function deckHash(filePath: string): Promise<string> {
  const fileStat = await stat(filePath);
  return createHash("md5")
    .update(`${PREVIEW_CACHE_VERSION}:${filePath}:${fileStat.size}:${fileStat.mtimeMs}`)
    .digest("hex")
    .slice(0, 16);
}

async function deckDir(filePath: string): Promise<string> {
  return join(PREVIEW_ROOT, await deckHash(filePath));
}

function findSoffice(): string {
  const candidates =
    process.platform === "darwin"
      ? ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "soffice", "libreoffice"]
      : process.platform === "linux"
        ? ["/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/local/bin/soffice", "soffice", "libreoffice"]
        : ["C:\\Program Files\\LibreOffice\\program\\soffice.exe", "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe", "soffice"];

  for (const candidate of candidates) {
    try {
      require("fs").accessSync(candidate);
      return candidate;
    } catch {
      if (!candidate.includes("/") && !candidate.includes("\\")) return candidate;
    }
  }
  return "soffice";
}

function commandExists(command: string): boolean {
  try {
    require("child_process").execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensurePdf(filePath: string, outDir: string): Promise<string> {
  const stem = basename(filePath).replace(/\.[^.]+$/, "");
  const pdfPath = join(outDir, "deck.pdf");
  if (await exists(pdfPath)) return pdfPath;

  const soffice = findSoffice();
  await execFileAsync(soffice, ["--headless", "--convert-to", "pdf", "--outdir", outDir, filePath], { timeout: 180_000 });
  const generated = join(outDir, `${stem}.pdf`);
  await access(generated);
  await rename(generated, pdfPath).catch(async () => {
    if (!(await exists(pdfPath))) throw new Error("LibreOffice PDF conversion did not produce a cached file.");
  });
  return pdfPath;
}

async function renderWithPdfToPpm(pdfPath: string, slideNumber: number, outDir: string): Promise<string | null> {
  if (!commandExists("pdftoppm")) return null;
  const prefix = join(outDir, `slide-${slideNumber}`);
  await execFileAsync("pdftoppm", ["-f", String(slideNumber), "-l", String(slideNumber), "-png", "-scale-to", "720", pdfPath, prefix], { timeout: 60_000 });
  // pdftoppm zero-pads page numbers based on total page count (e.g. slide-5-05.png for a 39-page deck)
  // so scan the directory for any file matching the prefix rather than guessing the padding
  const files = await readdir(outDir);
  const match = files.find((f) => f.startsWith(`slide-${slideNumber}-`) && f.endsWith(".png"));
  return match ? join(outDir, match) : null;
}

async function renderWithMagick(pdfPath: string, slideNumber: number, outDir: string): Promise<string | null> {
  if (!commandExists("magick")) return null;
  const outPath = join(outDir, `slide-${slideNumber}.png`);
  await execFileAsync("magick", [`${pdfPath}[${slideNumber - 1}]`, "-thumbnail", "720x405", outPath], { timeout: 60_000 });
  return (await exists(outPath)) ? outPath : null;
}

async function renderThumbnail(pdfPath: string, slideNumber: number, outDir: string): Promise<string | undefined> {
  const cached = join(outDir, `slide-${slideNumber}.png`);
  if (await exists(cached)) return cached;

  try {
    const fromPoppler = await renderWithPdfToPpm(pdfPath, slideNumber, outDir);
    if (fromPoppler) {
      if (fromPoppler !== cached) await rename(fromPoppler, cached).catch(() => undefined);
      return (await exists(cached)) ? cached : fromPoppler;
    }
  } catch {
    // Fall through to ImageMagick.
  }

  try {
    return await renderWithMagick(pdfPath, slideNumber, outDir) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function preRenderPptxDeck(
  filePath: string,
  slideNumbers: number[],
  onProgress: (msg: string) => void
): Promise<DeckPreviewResult> {
  if (!slideNumbers.length) {
    return { filePath, previews: [], status: "skipped" };
  }

  const outDir = await deckDir(filePath);
  await mkdir(outDir, { recursive: true });

  try {
    onProgress(`  Rendering slide previews for ${basename(filePath)} with LibreOffice...`);
    const pdfPath = await ensurePdf(filePath, outDir);
    const previews: SlidePreviewInfo[] = [];

    let thumbnailCount = 0;
    for (const slideNumber of slideNumbers) {
      const thumbnailPath = await renderThumbnail(pdfPath, slideNumber, outDir);
      if (thumbnailPath) thumbnailCount++;
      previews.push({
        slideNumber,
        pdfPath,
        thumbnailPath,
        status: thumbnailPath ? "thumbnail" : "pdf",
        warning: thumbnailPath ? undefined : "Cached PDF preview only; install pdftoppm or ImageMagick for PNG thumbnails.",
      });
    }

    const status = thumbnailCount > 0 ? "ready" : "pdf-only";
    onProgress(
      thumbnailCount > 0
        ? `  Cached ${thumbnailCount}/${slideNumbers.length} slide thumbnail(s).`
        : "  Cached deck PDF for previews. PNG thumbnails need pdftoppm or ImageMagick."
    );
    return {
      filePath,
      pdfPath,
      previews,
      status,
      warning: status === "pdf-only" ? "PNG thumbnails were not generated because no PDF image converter was found." : undefined,
    };
  } catch (err) {
    const warning = String(err).replace(/^Error:\s*/, "");
    onProgress(`  ⚠ Slide preview rendering failed for ${basename(filePath)}: ${warning}`);
    return { filePath, previews: [], status: "failed", warning };
  }
}
