import { NextRequest, NextResponse } from "next/server";
import { renderVisualSlideSvg } from "@/lib/visualSlideRenderer";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const slide = await req.json();
    return new NextResponse(renderVisualSlideSvg(slide), {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
