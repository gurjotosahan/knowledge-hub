import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";

const MIME: Record<string, string> = {
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  gif:  "image/gif",
  svg:  "image/svg+xml",
  webp: "image/webp",
  wmf:  "image/wmf",
  emf:  "image/emf",
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const filePath  = req.nextUrl.searchParams.get("path");
  const mediaPath = req.nextUrl.searchParams.get("media");
  if (!filePath || !mediaPath) {
    return NextResponse.json({ error: "Missing path or media" }, { status: 400 });
  }

  try {
    const buffer = await readFile(filePath);
    const JSZip  = (await import("jszip")).default;
    const zip    = await JSZip.loadAsync(buffer);

    const file = zip.files[mediaPath];
    if (!file) return NextResponse.json({ error: "Media not found" }, { status: 404 });

    const ext  = mediaPath.split(".").pop()?.toLowerCase() ?? "";
    const mime = MIME[ext] ?? "application/octet-stream";
    const data = Buffer.from(await file.async("arraybuffer"));

    return new NextResponse(data, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
