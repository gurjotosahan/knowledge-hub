import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import { createReadStream } from "fs";
import { extname } from "path";
import { Readable } from "stream";

const MIME: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  try {
    const ext = extname(filePath).toLowerCase();
    const mime = MIME[ext];
    if (!mime) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });
    }

    const info = await stat(filePath);
    if (!info.isFile()) {
      return NextResponse.json({ error: "Path is not a file" }, { status: 400 });
    }

    const range = req.headers.get("range");
    const baseHeaders = {
      "Content-Type": mime,
      "Content-Disposition": "inline",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
    };

    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match) {
        return new NextResponse(null, {
          status: 416,
          headers: { ...baseHeaders, "Content-Range": `bytes */${info.size}` },
        });
      }

      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : info.size - 1;
      if (start >= info.size || end >= info.size || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { ...baseHeaders, "Content-Range": `bytes */${info.size}` },
        });
      }

      const stream = createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${info.size}`,
        },
      });
    }

    const stream = createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
      headers: {
        ...baseHeaders,
        "Content-Length": String(info.size),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Cannot serve file: ${String(err)}` },
      { status: 500 }
    );
  }
}
