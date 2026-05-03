import { NextRequest, NextResponse } from "next/server";
import { extractDoc } from "@/lib/extractors";

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  try {
    const doc = await extractDoc(filePath);
    return NextResponse.json(doc);
  } catch (err) {
    return NextResponse.json(
      { error: `Extraction failed: ${String(err)}` },
      { status: 500 }
    );
  }
}
