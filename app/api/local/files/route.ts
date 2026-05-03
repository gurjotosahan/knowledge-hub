import { NextRequest, NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import { join, extname } from "path";
import type { LocalSourceEntry } from "@/types";

export async function GET(req: NextRequest) {
  const folder = req.nextUrl.searchParams.get("folder");
  if (!folder) {
    return NextResponse.json({ error: "Missing folder parameter" }, { status: 400 });
  }

  try {
    const entries = await readdir(folder);
    const items = await Promise.all(
      entries.map(async (name): Promise<LocalSourceEntry | null> => {
        const fullPath = join(folder, name);
        const info = await stat(fullPath);

        if (info.isDirectory()) {
          return {
            name,
            path: fullPath,
            kind: "directory",
            modifiedAt: info.mtime.toISOString(),
          };
        }

        if (info.isFile() && /\.(pdf|pptx)$/i.test(name)) {
          return {
            name,
            path: fullPath,
            kind: "file",
            type: extname(name).toLowerCase().slice(1) as "pdf" | "pptx",
            sizeBytes: info.size,
            modifiedAt: info.mtime.toISOString(),
          };
        }

        return null;
      })
    );

    const filtered = items
      .filter((entry): entry is LocalSourceEntry => entry != null)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

    return NextResponse.json({
      folder,
      entries: filtered,
      files: filtered.filter((entry) => entry.kind === "file"),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Cannot read folder: ${String(err)}` },
      { status: 500 }
    );
  }
}
