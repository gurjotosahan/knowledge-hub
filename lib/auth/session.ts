import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyCredentials } from "./users";
import { ADMIN_PERMISSIONS } from "./permissions";

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 }, // 7 days
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;
        const user = await verifyCredentials(credentials.username, credentials.password);
        if (!user) return null;
        return {
          id: user.id,
          name: user.displayName,
          email: user.username, // NextAuth needs email field; we use username
          role: user.role,
          permissions: user.permissions,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role ?? "user";
        token.permissions = user.permissions ?? ADMIN_PERMISSIONS;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        ...session.user,
        id: token.id as string,
        role: token.role as "admin" | "user",
        permissions: token.permissions as typeof ADMIN_PERMISSIONS,
      };
      return session;
    },
  },
};
