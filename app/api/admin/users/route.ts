import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { listUsers, createUser } from "@/lib/auth/users";
import type { UserPermissions } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const users = await listUsers();
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { username?: string; displayName?: string; password?: string; role?: "admin" | "user"; permissions?: UserPermissions };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, displayName, password, role, permissions } = body;
  if (!username || !password || !role) {
    return NextResponse.json({ error: "username, password, and role are required." }, { status: 400 });
  }

  try {
    const user = await createUser({ username, displayName: displayName ?? username, password, role, permissions });
    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
