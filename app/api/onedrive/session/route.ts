import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ signedIn: false });
  return NextResponse.json({
    signedIn: true,
    name:  session.user?.name,
    email: session.user?.email,
    image: session.user?.image,
  });
}
