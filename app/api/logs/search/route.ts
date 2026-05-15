import { NextRequest, NextResponse } from "next/server";
import { getSearchLogAggregates } from "@/lib/searchLog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sourceKey = req.nextUrl.searchParams.get("sourceKey") ?? undefined;
  const aggregates = await getSearchLogAggregates(sourceKey);
  return NextResponse.json(aggregates);
}
