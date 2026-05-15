import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Apexon KM360",
  description: "Search-first AI-assisted knowledge platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-50 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
