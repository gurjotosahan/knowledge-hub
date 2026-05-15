import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized({ token }) {
        return !!token;
      },
    },
  }
);

// Protect all routes except login, setup, and NextAuth internals
export const config = {
  matcher: [
    "/((?!login|setup|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
