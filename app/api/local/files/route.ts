import { NextRequest, NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import { join, extname } from "path";
import type { LocalSourceEntry } from "@/types";

async function listFolder(folder: string, recursive: boolean, depth = 0): Promise<LocalSourceEntry[]> {
  const entries = await readdir(folder);
  const items = await Promise.all(
    entries.map(async (name): Promise<LocalSourceEntry[]> => {
      const fullPath = join(folder, name);
      const info = await stat(fullPath);

      if (info.isDirectory()) {
        const directory: LocalSourceEntry = {
          name,
          path: fullPath,
          kind: "directory",
          modifiedAt: info.mtime.toISOString(),
        };
        if (!recursive || depth >= 6) return [directory];
        const children = await listFolder(fullPath, recursive, depth + 1).catch(() => []);
        return children;
      }

      if (info.isFile() && /\.(pdf|pptx|docx)$/i.test(name)) {
        return [{
          name,
          path: fullPath,
          kind: "file",
          type: extname(name).toLowerCase().slice(1) as LocalSourceEntry["type"],
          sizeBytes: info.size,
          modifiedAt: info.mtime.toISOString(),
        }];
      }

      return [];
    })
  );

  return items.flat().slice(0, 1000);
}

export async function GET(req: NextRequest) {
  const folder = req.nextUrl.searchParams.get("folder");
  const recursive = req.nextUrl.searchParams.get("recursive") === "true";
  if (!folder) {
    return NextResponse.json({ error: "Missing folder parameter" }, { status: 400 });
  }

  try {
    const filtered = (await listFolder(folder, recursive))
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
