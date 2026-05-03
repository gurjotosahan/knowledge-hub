import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Apexon Knowledge Hub",
  description: "Search-first AI-assisted knowledge platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-50 antialiased">{children}</body>
    </html>
  );
}
