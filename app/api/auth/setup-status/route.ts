import { NextResponse } from "next/server";
import { getUserCount } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export async function GET() {
  const count = await getUserCount();
  return NextResponse.json({ needsSetup: count === 0 });
}
