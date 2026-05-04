import { NextResponse } from "next/server";
import { listResearch } from "@/lib/researchStorage";

export async function GET() {
  try {
    const list = await listResearch();
    return NextResponse.json(list);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
