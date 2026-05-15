import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { ADMIN_PERMISSIONS, DEFAULT_USER_PERMISSIONS, type UserPermissions } from "./permissions";

const USERS_FILE = path.join(os.homedir(), ".knowledge-hub", "users.json");

export interface StoredUser {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string; // "salt:hash" — both hex
  role: "admin" | "user";
  createdAt: string;
  permissions: UserPermissions;
}

// Public shape returned to clients (no password hash)
export type PublicUser = Omit<StoredUser, "passwordHash">;

async function readUsers(): Promise<StoredUser[]> {
  try {
    const raw = await fs.readFile(USERS_FILE, "utf-8");
    return JSON.parse(raw) as StoredUser[];
  } catch {
    return [];
  }
}

async function writeUsers(users: StoredUser[]): Promise<void> {
  await fs.mkdir(path.dirname(USERS_FILE), { recursive: true });
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

function hashPassword(password: string): string {
  const salt = randomBytes(32).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

export async function listUsers(): Promise<PublicUser[]> {
  return (await readUsers()).map(({ passwordHash: _, ...rest }) => rest);
}

export async function getUserCount(): Promise<number> {
  return (await readUsers()).length;
}

export async function findByUsername(username: string): Promise<StoredUser | null> {
  const users = await readUsers();
  return users.find((u) => u.username.toLowerCase() === username.toLowerCase()) ?? null;
}

export async function findById(id: string): Promise<StoredUser | null> {
  const users = await readUsers();
  return users.find((u) => u.id === id) ?? null;
}

export async function verifyCredentials(
  username: string,
  password: string
): Promise<PublicUser | null> {
  const user = await findByUsername(username);
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  const { passwordHash: _, ...rest } = user;
  return rest;
}

export async function createUser(data: {
  username: string;
  displayName: string;
  password: string;
  role: "admin" | "user";
  permissions?: UserPermissions;
}): Promise<PublicUser> {
  const users = await readUsers();
  if (users.some((u) => u.username.toLowerCase() === data.username.toLowerCase())) {
    throw new Error(`Username "${data.username}" is already taken.`);
  }
  const user: StoredUser = {
    id: randomUUID(),
    username: data.username.trim(),
    displayName: data.displayName.trim() || data.username.trim(),
    passwordHash: hashPassword(data.password),
    role: data.role,
    createdAt: new Date().toISOString(),
    permissions: data.permissions ?? (data.role === "admin" ? ADMIN_PERMISSIONS : DEFAULT_USER_PERMISSIONS),
  };
  await writeUsers([...users, user]);
  const { passwordHash: _, ...rest } = user;
  return rest;
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<StoredUser, "displayName" | "role" | "permissions">> & { password?: string }
): Promise<PublicUser> {
  const users = await readUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) throw new Error("User not found.");
  const updated: StoredUser = {
    ...users[idx],
    ...(patch.displayName !== undefined && { displayName: patch.displayName }),
    ...(patch.role !== undefined && { role: patch.role }),
    ...(patch.permissions !== undefined && { permissions: patch.permissions }),
    ...(patch.password && { passwordHash: hashPassword(patch.password) }),
  };
  users[idx] = updated;
  await writeUsers(users);
  const { passwordHash: _, ...rest } = updated;
  return rest;
}

export async function deleteUser(id: string): Promise<void> {
  const users = await readUsers();
  const remaining = users.filter((u) => u.id !== id);
  if (remaining.length === users.length) throw new Error("User not found.");
  // Prevent deleting the last admin
  const adminCount = remaining.filter((u) => u.role === "admin").length;
  if (adminCount === 0 && users.find((u) => u.id === id)?.role === "admin") {
    throw new Error("Cannot delete the last admin account.");
  }
  await writeUsers(remaining);
}
