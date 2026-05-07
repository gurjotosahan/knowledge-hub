import * as lancedb from "@lancedb/lancedb";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { createHash } from "crypto";
import type { RagChunk } from "./indexer";
import type { SearchableFileType } from "@/types";

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

const tableCache = new Map<string, Promise<lancedb.Table>>();

function chunksTable(sourceKey: string): Promise<lancedb.Table> {
  const dir = dbDir(sourceKey);
  const cached = tableCache.get(dir);
  if (cached) return cached;

  const opened = lancedb.connect(dir).then((db) => db.openTable("chunks"));
  tableCache.set(dir, opened);
  return opened;
}

function clearRuntimeCaches(sourceKey: string): void {
  tableCache.delete(dbDir(sourceKey));
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
    fileType:   row.fileType   as SearchableFileType,
    page:       row.page       as number,
    chunkIndex: row.chunkIndex as number,
    text:       row.text       as string,
    level:      level === "parent" ? "parent" : level === "child" ? "child" : undefined,
    parentId:   (row.parentId as string) || undefined,
  };
}

// ── Write ─────────────────────────────────────────────────────────────────────

async function buildFtsIndex(table: lancedb.Table): Promise<void> {
  await table.createIndex("text", { config: lancedb.Index.fts(), replace: true });
}

export async function writeIndex(
  sourceKey: string,
  chunks: RagChunk[],
  meta: IndexMeta
): Promise<void> {
  clearRuntimeCaches(sourceKey);
  const dir = dbDir(sourceKey);
  await fs.mkdir(path.dirname(dir), { recursive: true });

  const firstEmbedded = chunks.find((c) => c.embedding?.length);
  const dim = firstEmbedded?.embedding?.length ?? 1;

  const records = chunks.map((c) => toRecord(c, dim));

  const db = await lancedb.connect(dir);
  const table = await db.createTable("chunks", records, { mode: "overwrite" });
  await buildFtsIndex(table);

  await fs.writeFile(metaPath(sourceKey), JSON.stringify(meta), "utf-8");
  clearRuntimeCaches(sourceKey);
}

export async function appendIndex(
  sourceKey: string,
  chunks: RagChunk[],
  metaPatch: Pick<IndexMeta, "version" | "sourceKey" | "indexedAt" | "embedModel" | "parentChunks" | "files">
): Promise<IndexMeta> {
  const existingMeta = await readMeta(sourceKey);
  if (!existingMeta || existingMeta.version !== metaPatch.version || existingMeta.embedModel !== metaPatch.embedModel) {
    await writeIndex(sourceKey, chunks, metaPatch);
    return metaPatch;
  }

  clearRuntimeCaches(sourceKey);
  const dir = dbDir(sourceKey);
  await fs.mkdir(path.dirname(dir), { recursive: true });

  const firstEmbedded = chunks.find((c) => c.embedding?.length);
  const dim = firstEmbedded?.embedding?.length ?? 1;
  const records = chunks.map((c) => toRecord(c, dim));

  const db = await lancedb.connect(dir);
  let table: lancedb.Table;
  try {
    table = await db.openTable("chunks");
  } catch {
    await writeIndex(sourceKey, chunks, metaPatch);
    return metaPatch;
  }
  if (records.length > 0) {
    await table.add(records);
    // Rebuild FTS index to include newly added documents
    await buildFtsIndex(table);
  }

  const nextMeta: IndexMeta = {
    ...existingMeta,
    indexedAt: metaPatch.indexedAt,
    parentChunks: existingMeta.parentChunks + metaPatch.parentChunks,
    files: existingMeta.files + metaPatch.files,
  };
  await fs.writeFile(metaPath(sourceKey), JSON.stringify(nextMeta), "utf-8");
  clearRuntimeCaches(sourceKey);
  return nextMeta;
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
  const tbl = await chunksTable(sourceKey);

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

// FTS search — replaces the in-memory BM25 loop; scales to millions of chunks
export async function ftsSearch(
  sourceKey: string,
  query: string,
  limit: number
): Promise<RagChunk[]> {
  const tbl = await chunksTable(sourceKey);
  try {
    const rows = await tbl
      .search(query, "fts")
      .select(["id", "fileName", "filePath", "fileType", "page", "chunkIndex", "text", "level", "parentId"])
      .where("level != 'parent'")
      .limit(limit)
      .toArray() as (Record<string, unknown> & { _score?: number })[];
    return rows.map((r) => ({ ...fromRecord(r), score: r._score ?? 0 } as RagChunk & { score: number }));
  } catch {
    // FTS index may not exist yet (pre-existing index built before this change)
    return [];
  }
}

// Fetch parent chunks by IDs for context expansion
export async function fetchParentsByIds(
  sourceKey: string,
  parentIds: string[]
): Promise<RagChunk[]> {
  if (!parentIds.length) return [];
  const tbl = await chunksTable(sourceKey);

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
  const tbl = await chunksTable(sourceKey);

  const escaped = filePath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const rows = await tbl
    .query()
    .where(`filePath = '${escaped}' AND (level = 'parent' OR level = '')`)
    .select(["id", "fileName", "filePath", "fileType", "page", "chunkIndex", "text", "level", "parentId"])
    .toArray() as Record<string, unknown>[];

  return rows.map(fromRecord);
}
