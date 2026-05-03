import * as lancedb from "@lancedb/lancedb";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { createHash } from "crypto";
import type { RagChunk } from "./indexer";

export interface IndexMeta {
  version: number;
  sourceKey: string;
  indexedAt: string;
  embedModel: string;
  parentChunks: number;
  files: number;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

function dbDir(sourceKey: string): string {
  const hash = createHash("md5").update(sourceKey).digest("hex").slice(0, 8);
  return path.join(os.homedir(), ".knowledge-hub", "lancedb", hash);
}

function metaPath(sourceKey: string): string {
  return dbDir(sourceKey) + ".meta.json";
}

// ── Serialisation ─────────────────────────────────────────────────────────────

function toRecord(chunk: RagChunk, dim: number): Record<string, unknown> {
  return {
    id:         chunk.id,
    fileName:   chunk.fileName,
    filePath:   chunk.filePath,
    fileType:   chunk.fileType,
    page:       chunk.page,
    chunkIndex: chunk.chunkIndex,
    text:       chunk.text,
    level:      chunk.level   ?? "",
    parentId:   chunk.parentId ?? "",
    // Parents have no embedding — zero vector keeps the schema uniform
    vector: new Float32Array(chunk.embedding ?? new Array(dim).fill(0)),
  };
}

function fromRecord(row: Record<string, unknown>): RagChunk {
  const level = row.level as string;
  return {
    id:         row.id         as string,
    fileName:   row.fileName   as string,
    filePath:   row.filePath   as string,
    fileType:   row.fileType   as "pdf" | "pptx",
    page:       row.page       as number,
    chunkIndex: row.chunkIndex as number,
    text:       row.text       as string,
    level:      level === "parent" ? "parent" : level === "child" ? "child" : undefined,
    parentId:   (row.parentId as string) || undefined,
  };
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function writeIndex(
  sourceKey: string,
  chunks: RagChunk[],
  meta: IndexMeta
): Promise<void> {
  const dir = dbDir(sourceKey);
  await fs.mkdir(path.dirname(dir), { recursive: true });

  // Detect embedding dimension from first child chunk that has an embedding
  const firstEmbedded = chunks.find((c) => c.embedding?.length);
  const dim = firstEmbedded?.embedding?.length ?? 1;

  const records = chunks.map((c) => toRecord(c, dim));

  const db = await lancedb.connect(dir);
  await db.createTable("chunks", records, { mode: "overwrite" });

  await fs.writeFile(metaPath(sourceKey), JSON.stringify(meta), "utf-8");
}

// ── Read meta ─────────────────────────────────────────────────────────────────

export async function readMeta(sourceKey: string): Promise<IndexMeta | null> {
  try {
    const raw = await fs.readFile(metaPath(sourceKey), "utf-8");
    return JSON.parse(raw) as IndexMeta;
  } catch {
    return null;
  }
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function vectorSearch(
  sourceKey: string,
  embedding: number[],
  limit: number
): Promise<RagChunk[]> {
  const db  = await lancedb.connect(dbDir(sourceKey));
  const tbl = await db.openTable("chunks");

  // Over-fetch then filter to children (level = "child" or "" for legacy)
  const rows = await tbl
    .vectorSearch(new Float32Array(embedding))
    .limit(limit * 3)
    .toArray() as Record<string, unknown>[];

  return rows
    .filter((r) => (r.level as string) !== "parent")
    .slice(0, limit)
    .map(fromRecord);
}

// Fetch all child chunks for BM25 / filename scoring (text + meta only, no vectors)
export async function fetchChildChunks(sourceKey: string): Promise<RagChunk[]> {
  const db  = await lancedb.connect(dbDir(sourceKey));
  const tbl = await db.openTable("chunks");

  const rows = await tbl
    .query()
    .select(["id", "fileName", "filePath", "fileType", "page", "chunkIndex", "text", "level", "parentId"])
    .toArray() as Record<string, unknown>[];

  return rows
    .filter((r) => (r.level as string) !== "parent")
    .map(fromRecord);
}

// Fetch parent chunks by IDs for context expansion
export async function fetchParentsByIds(
  sourceKey: string,
  parentIds: string[]
): Promise<RagChunk[]> {
  if (!parentIds.length) return [];
  const db  = await lancedb.connect(dbDir(sourceKey));
  const tbl = await db.openTable("chunks");

  // LanceDB WHERE with IN clause
  const list = parentIds.map((id) => `'${id.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`).join(", ");
  const rows = await tbl
    .query()
    .where(`level = 'parent' AND id IN (${list})`)
    .select(["id", "fileName", "filePath", "fileType", "page", "chunkIndex", "text", "level", "parentId"])
    .toArray() as Record<string, unknown>[];

  return rows.map(fromRecord);
}

// Fetch parent chunks for a specific file (used by query route to build doc list)
export async function fetchFileParents(
  sourceKey: string,
  filePath: string
): Promise<RagChunk[]> {
  const db  = await lancedb.connect(dbDir(sourceKey));
  const tbl = await db.openTable("chunks");

  const escaped = filePath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const rows = await tbl
    .query()
    .where(`filePath = '${escaped}' AND (level = 'parent' OR level = '')`)
    .select(["id", "fileName", "filePath", "fileType", "page", "chunkIndex", "text", "level", "parentId"])
    .toArray() as Record<string, unknown>[];

  return rows.map(fromRecord);
}
