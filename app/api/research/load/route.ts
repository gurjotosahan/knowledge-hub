import { NextRequest, NextResponse } from "next/server";
import { loadResearch } from "@/lib/researchStorage";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const research = await loadResearch(id);
  if (!research) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(research);
}
