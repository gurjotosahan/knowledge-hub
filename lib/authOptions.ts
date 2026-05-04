import type { AuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";

export const authOptions: AuthOptions = {
  providers: [
    AzureADProvider({
      clientId:     process.env.AZURE_CLIENT_ID     ?? "",
      clientSecret: process.env.AZURE_CLIENT_SECRET ?? "",
      tenantId:     process.env.AZURE_TENANT_ID     ?? "common",
      authorization: {
        params: {
          scope: "openid profile email offline_access Files.Read.All Sites.Read.All",
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken  = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt    = account.expires_at;
      }
      return token;
    },
    async session({ session, token }) {
      (session as unknown as Record<string, unknown>).accessToken = token.accessToken;
      return session;
    },
  },
};
