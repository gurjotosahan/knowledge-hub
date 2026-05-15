import { NextRequest, NextResponse } from "next/server";
import { createUser, getUserCount } from "@/lib/auth/users";

// Unprotected by middleware (sits under /api/auth/*).
// Creates the first admin account only when no users exist.
export async function POST(req: NextRequest) {
  const count = await getUserCount();
  if (count > 0) {
    return NextResponse.json({ error: "Setup already complete." }, { status: 403 });
  }

  let body: { username?: string; displayName?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, displayName, password } = body;
  if (!username || !password) {
    return NextResponse.json({ error: "username and password are required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  try {
    const user = await createUser({
      username,
      displayName: displayName || username,
      password,
      role: "admin",
    });
    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
