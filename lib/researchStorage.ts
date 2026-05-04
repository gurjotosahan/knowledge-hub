import { readFile, writeFile, mkdir, readdir, unlink } from "fs/promises";
import { join } from "path";
import type { SavedResearch } from "@/types/research";

const RESEARCH_DIR = join(process.cwd(), "data", "research");

async function ensureDir() {
  await mkdir(RESEARCH_DIR, { recursive: true });
}

export async function saveResearch(research: SavedResearch): Promise<void> {
  await ensureDir();
  await writeFile(
    join(RESEARCH_DIR, `${research.id}.json`),
    JSON.stringify(research, null, 2),
    "utf-8"
  );
}

export async function listResearch(): Promise<SavedResearch[]> {
  await ensureDir();
  const files = (await readdir(RESEARCH_DIR)).filter((f) => f.endsWith(".json"));
  const results: SavedResearch[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(join(RESEARCH_DIR, f), "utf-8");
      results.push(JSON.parse(raw) as SavedResearch);
    } catch {}
  }
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadResearch(id: string): Promise<SavedResearch | null> {
  try {
    const raw = await readFile(join(RESEARCH_DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw) as SavedResearch;
  } catch {
    return null;
  }
}

export async function deleteResearch(id: string): Promise<void> {
  await unlink(join(RESEARCH_DIR, `${id}.json`)).catch(() => {});
}
