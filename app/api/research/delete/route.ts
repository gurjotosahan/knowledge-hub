import { NextRequest, NextResponse } from "next/server";
import { deleteResearch } from "@/lib/researchStorage";

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await deleteResearch(id);
  return NextResponse.json({ ok: true });
}
