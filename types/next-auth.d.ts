import type { UserPermissions } from "@/lib/auth/permissions";
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    id: string;
    role: "admin" | "user";
    permissions: UserPermissions;
  }

  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: "admin" | "user";
      permissions: UserPermissions;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "admin" | "user";
    permissions: UserPermissions;
  }
}
