import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { extname } from "path";

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
    const buffer = await readFile(filePath);
    const mime = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": "inline",
        // Allow browser PDF renderer and canvas to access the response
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Cannot serve file: ${String(err)}` },
      { status: 500 }
    );
  }
}
