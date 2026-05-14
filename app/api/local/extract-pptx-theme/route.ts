import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import JSZip from "jszip";

export interface PptxTheme {
  colors: {
    bg: string;        // light background (lt1)
    text: string;      // dark text (dk1)
    accent1: string;
    accent2: string;
    accent3: string;
    accent4: string;
    accent5: string;
    accent6: string;
  };
  fonts: {
    major: string;     // headings
    minor: string;     // body
  };
  slideSize: { widthIn: number; heightIn: number };
}

const FALLBACK: PptxTheme = {
  colors: {
    bg:      "FFFFFF",
    text:    "1F2937",
    accent1: "0EA5E9",
    accent2: "8B5CF6",
    accent3: "10B981",
    accent4: "F59E0B",
    accent5: "EF4444",
    accent6: "6366F1",
  },
  fonts: { major: "Calibri", minor: "Calibri" },
  slideSize: { widthIn: 13.333, heightIn: 7.5 },
};

function extractColor(themeXml: string, schemeName: string): string | null {
  const re = new RegExp(`<a:${schemeName}>([\\s\\S]*?)</a:${schemeName}>`);
  const block = themeXml.match(re)?.[1];
  if (!block) return null;
  const srgb = block.match(/<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);
  if (srgb) return srgb[1].toUpperCase();
  const sys = block.match(/<a:sysClr\s+[^>]*\blastClr="([0-9A-Fa-f]{6})"/);
  if (sys) return sys[1].toUpperCase();
  return null;
}

function extractFont(themeXml: string, kind: "majorFont" | "minorFont"): string | null {
  const re = new RegExp(`<a:${kind}>([\\s\\S]*?)</a:${kind}>`);
  const block = themeXml.match(re)?.[1];
  if (!block) return null;
  const latin = block.match(/<a:latin\s+typeface="([^"]+)"/);
  return latin?.[1] || null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  try {
    const zip = await JSZip.loadAsync(await readFile(filePath));

    const themeXml = await zip.files["ppt/theme/theme1.xml"]?.async("text");
    const presentationXml = await zip.files["ppt/presentation.xml"]?.async("text");

    const theme: PptxTheme = JSON.parse(JSON.stringify(FALLBACK));

    if (themeXml) {
      const colorMap: Record<string, keyof PptxTheme["colors"]> = {
        lt1: "bg", dk1: "text",
        accent1: "accent1", accent2: "accent2", accent3: "accent3",
        accent4: "accent4", accent5: "accent5", accent6: "accent6",
      };
      for (const [scheme, key] of Object.entries(colorMap)) {
        const c = extractColor(themeXml, scheme);
        if (c) theme.colors[key] = c;
      }
      const major = extractFont(themeXml, "majorFont");
      const minor = extractFont(themeXml, "minorFont");
      if (major) theme.fonts.major = major;
      if (minor) theme.fonts.minor = minor;
    }

    if (presentationXml) {
      const m = presentationXml.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
      if (m) {
        // EMU per inch = 914400
        theme.slideSize.widthIn  = Math.round((Number(m[1]) / 914400) * 1000) / 1000;
        theme.slideSize.heightIn = Math.round((Number(m[2]) / 914400) * 1000) / 1000;
      }
    }

    return NextResponse.json(theme);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
