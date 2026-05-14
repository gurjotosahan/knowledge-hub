import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, access, mkdir, stat } from "fs/promises";
import { createHash } from "crypto";
import { join, basename } from "path";
import { tmpdir } from "os";

export const maxDuration = 300;

const execAsync = promisify(exec);
const CACHE_DIR  = join(tmpdir(), "kh-pdf-cache");
const PDF_CACHE_VERSION = "v2";

// In-memory lock — prevents parallel conversions of the same file
const locks = new Map<string, Promise<string>>();

// ── Locate LibreOffice binary (cross-platform) ────────────────────────────────

function findSoffice(): string | null {
  const candidates = [
    // macOS
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    // Linux
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
    "/usr/local/bin/soffice",
    // Windows (soffice.exe must be in PATH or one of these)
    "soffice",
    "libreoffice",
  ];

  // Check common macOS/Linux absolute paths synchronously via try/exec later
  // For PATH-based names we rely on exec failing with ENOENT
  if (process.platform === "darwin") {
    const macPath = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
    // existsSync is fine here — called once per request before any async work
    try { require("fs").accessSync(macPath); return macPath; } catch {}
  }
  if (process.platform === "linux") {
    for (const p of ["/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/local/bin/soffice"]) {
      try { require("fs").accessSync(p); return p; } catch {}
    }
  }
  // Windows — check common install path
  if (process.platform === "win32") {
    const win = "C:\\Program Files\\LibreOffice\\program\\soffice.exe";
    try { require("fs").accessSync(win); return win; } catch {}
    const win86 = "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe";
    try { require("fs").accessSync(win86); return win86; } catch {}
  }
  // Last resort: hope it's in PATH
  return "soffice";
}

// ── Conversion ────────────────────────────────────────────────────────────────

async function convertToPdf(filePath: string, outDir: string): Promise<string> {
  const soffice = findSoffice();
  if (!soffice) throw new Error("LibreOffice not found");

  // soffice --headless --convert-to pdf --outdir <dir> <file>
  // Output file = same name, .pdf extension
  const cmd = `"${soffice}" --headless --convert-to pdf --outdir "${outDir}" "${filePath}"`;
  await execAsync(cmd, { timeout: 120_000 });

  const stem    = basename(filePath).replace(/\.[^.]+$/, "");
  const pdfPath = join(outDir, `${stem}.pdf`);
  await access(pdfPath); // throws if conversion produced no file
  return pdfPath;
}

async function ensureConverted(filePath: string): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });

  const fileStat = await stat(filePath);
  const key     = createHash("md5")
    .update(`${PDF_CACHE_VERSION}:${filePath}:${fileStat.size}:${fileStat.mtimeMs}`)
    .digest("hex");
  const stem    = basename(filePath).replace(/\.[^.]+$/, "");
  const pdfPath = join(CACHE_DIR, `${key}-${stem}.pdf`);

  // Already cached?
  try { await access(pdfPath); return pdfPath; } catch {}

  // Deduplicate concurrent requests for the same file
  const existing = locks.get(key);
  if (existing) { await existing; return pdfPath; }

  const promise = convertToPdf(filePath, CACHE_DIR).then((src) => {
    // LibreOffice writes the PDF next to the source stem; rename to our keyed path
    if (src !== pdfPath) return require("fs/promises").rename(src, pdfPath).then(() => pdfPath);
    return pdfPath;
  });
  locks.set(key, promise);
  try {
    await promise;
  } finally {
    locks.delete(key);
  }
  return pdfPath;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  // Check LibreOffice is available before trying
  const soffice = findSoffice();
  if (!soffice) {
    return NextResponse.json(
      {
        error: "LibreOffice is not installed",
        install: {
          mac:     "Download from https://www.libreoffice.org/download/libreoffice-still/",
          linux:   "sudo apt install libreoffice   or   sudo dnf install libreoffice",
          windows: "Download from https://www.libreoffice.org/download/libreoffice-still/",
        },
      },
      { status: 503 }
    );
  }

  try {
    const pdfPath = await ensureConverted(filePath);
    const buffer  = await readFile(pdfPath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type":  "application/pdf",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    const msg = String(err);
    const isNotInstalled = msg.includes("ENOENT") || msg.includes("not found");
    return NextResponse.json(
      { error: isNotInstalled ? "LibreOffice not found in PATH" : msg },
      { status: isNotInstalled ? 503 : 500 }
    );
  }
}
