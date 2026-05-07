import * as fs from "fs/promises";
import * as path from "path";
import { extractDoc, type ExtractedDoc } from "@/lib/extractors";
import { appendIndex, writeIndex, readMeta, type IndexMeta } from "./store";
import type { SearchableFileType } from "@/types";

export interface RagChunk {
  id: string;
  fileName: string;
  filePath: string;
  fileType: SearchableFileType;
  page: number;
  chunkIndex: number;
  text: string;
  embedding?: number[];
  level?: "parent" | "child";
  parentId?: string;
}

// Lightweight metadata returned by loadIndex — no chunks array (data lives in LanceDB)
export interface RagIndex {
  version: number;
  sourceKey: string;
  indexedAt: string;
  embedModel: string;
}

export interface IndexStatus {
  exists: boolean;
  indexedAt?: string;
  chunks?: number;
  files?: number;
  embedModel?: string;
}

const INDEX_VERSION  = 3;
const PARENT_CHARS   = 1600;
const PARENT_OVERLAP = 200;
const CHILD_CHARS    = 400;
const CHILD_OVERLAP  = 60;
const EMBED_CONCURRENCY = 6;

function splitText(text: string, chunkSize: number, overlap: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= chunkSize) return [trimmed];

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = start + chunkSize;
    if (end < trimmed.length) {
      const breakAt = Math.max(
        trimmed.lastIndexOf(".", end),
        trimmed.lastIndexOf("\n", end)
      );
      if (breakAt > start + chunkSize * 0.5) end = breakAt + 1;
    }
    const chunk = trimmed.slice(start, Math.min(end, trimmed.length)).trim();
    if (chunk) chunks.push(chunk);
    start = end - overlap;
    if (start >= trimmed.length) break;
  }
  return chunks;
}

function chunkHierarchical(
  text: string,
  fileName: string,
  filePath: string,
  fileType: SearchableFileType,
  page: number
): Array<{ parent: Omit<RagChunk, "embedding">; children: Omit<RagChunk, "embedding">[] }> {
  const parentTexts = splitText(text, PARENT_CHARS, PARENT_OVERLAP);
  return parentTexts.map((parentText, pi) => {
    const parentId = `${fileName}::page-${page}::parent-${pi}`;
    const parent: Omit<RagChunk, "embedding"> = {
      id: parentId, fileName, filePath, fileType, page, chunkIndex: pi,
      text: parentText, level: "parent",
    };
    const children: Omit<RagChunk, "embedding">[] = splitText(parentText, CHILD_CHARS, CHILD_OVERLAP)
      .map((childText, ci) => ({
        id: `${parentId}::child-${ci}`, fileName, filePath, fileType, page, chunkIndex: ci,
        text: childText, level: "child" as const, parentId,
      }));
    return { parent, children };
  });
}

async function embedText(
  text: string,
  ollamaBaseUrl: string,
  model: string,
  provider: "ollama" | "google" = "ollama",
  googleApiKey = ""
): Promise<number[]> {
  if (provider === "google") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${googleApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          taskType: "RETRIEVAL_DOCUMENT",
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) throw new Error(`Google embed ${res.status}`);
    const data = await res.json();
    return (data.embedding?.values as number[]) ?? [];
  }

  const res = await fetch(`${ollamaBaseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Embed ${res.status}`);
  const data = await res.json();
  return (data.embeddings?.[0] as number[]) ?? [];
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const current = next++;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run())
  );
  return results;
}

// ── Shared core ───────────────────────────────────────────────────────────────

export async function indexExtractedDocs(
  sourceKey: string,
  docs: ExtractedDoc[],
  ollamaBaseUrl: string,
  embedModel: string,
  onProgress: (msg: string) => void,
  embeddingProvider: "ollama" | "google" = "ollama",
  googleApiKey = ""
): Promise<{ chunks: number; files: number }> {
  const chunks: RagChunk[] = [];
  const childrenToEmbed: RagChunk[] = [];

  for (let fi = 0; fi < docs.length; fi++) {
    const doc = docs[fi];
    onProgress(`[${fi + 1}/${docs.length}] Chunking ${doc.fileName}...`);

    for (const slide of doc.slides) {
      if (!slide.text?.trim()) continue;
      for (const { parent, children } of chunkHierarchical(
        slide.text, doc.fileName, doc.filePath, doc.fileType, slide.number
      )) {
        chunks.push(parent as RagChunk);
        for (const child of children) {
          const c: RagChunk = { ...child };
          childrenToEmbed.push(c);
          chunks.push(c);
        }
      }
    }
  }

  let embedded = 0;
  onProgress(`Embedding ${childrenToEmbed.length} child chunks (${EMBED_CONCURRENCY} at a time)...`);
  await mapConcurrent(childrenToEmbed, EMBED_CONCURRENCY, async (chunk) => {
    try {
      chunk.embedding = await embedText(chunk.text, ollamaBaseUrl, embedModel, embeddingProvider, googleApiKey);
    } catch {
      // Keyword retrieval still works when an individual embedding fails.
    }
    embedded++;
    if (embedded % 25 === 0 || embedded === childrenToEmbed.length) {
      onProgress(`Embedded ${embedded}/${childrenToEmbed.length} chunks`);
    }
  });

  const parentCount = chunks.filter((c) => c.level === "parent").length;
  const fileNames = new Set(chunks.map((c) => c.fileName));

  const meta: IndexMeta = {
    version: INDEX_VERSION,
    sourceKey,
    indexedAt: new Date().toISOString(),
    embedModel,
    parentChunks: parentCount,
    files: fileNames.size,
  };

  await writeIndex(sourceKey, chunks, meta);

  onProgress(`Done — ${parentCount} parent chunks (${chunks.length} total) from ${docs.length} files.`);
  return { chunks: parentCount, files: docs.length };
}

export async function appendExtractedDocs(
  sourceKey: string,
  docs: ExtractedDoc[],
  ollamaBaseUrl: string,
  embedModel: string,
  onProgress: (msg: string) => void,
  embeddingProvider: "ollama" | "google" = "ollama",
  googleApiKey = ""
): Promise<{ chunks: number; files: number; totalChunks: number; totalFiles: number }> {
  const chunks: RagChunk[] = [];
  const childrenToEmbed: RagChunk[] = [];

  for (let fi = 0; fi < docs.length; fi++) {
    const doc = docs[fi];
    onProgress(`[${fi + 1}/${docs.length}] Chunking ${doc.fileName}...`);

    for (const slide of doc.slides) {
      if (!slide.text?.trim()) continue;
      for (const { parent, children } of chunkHierarchical(
        slide.text, doc.fileName, doc.filePath, doc.fileType, slide.number
      )) {
        chunks.push(parent as RagChunk);
        for (const child of children) {
          const c: RagChunk = { ...child };
          childrenToEmbed.push(c);
          chunks.push(c);
        }
      }
    }
  }

  let embedded = 0;
  onProgress(`Embedding ${childrenToEmbed.length} new child chunks...`);
  await mapConcurrent(childrenToEmbed, EMBED_CONCURRENCY, async (chunk) => {
    try {
      chunk.embedding = await embedText(chunk.text, ollamaBaseUrl, embedModel, embeddingProvider, googleApiKey);
    } catch {
      // Keyword retrieval still works when an individual embedding fails.
    }
    embedded++;
    if (embedded % 25 === 0 || embedded === childrenToEmbed.length) {
      onProgress(`Embedded ${embedded}/${childrenToEmbed.length} new chunks`);
    }
  });

  const parentCount = chunks.filter((c) => c.level === "parent").length;
  const fileNames = new Set(chunks.map((c) => c.fileName));
  if (chunks.length === 0) {
    const existingMeta = await readMeta(sourceKey);
    onProgress("No searchable text found in the new file(s).");
    return {
      chunks: 0,
      files: docs.length,
      totalChunks: existingMeta?.parentChunks ?? 0,
      totalFiles: existingMeta?.files ?? 0,
    };
  }

  const meta: IndexMeta = {
    version: INDEX_VERSION,
    sourceKey,
    indexedAt: new Date().toISOString(),
    embedModel,
    parentChunks: parentCount,
    files: fileNames.size,
  };

  const nextMeta = await appendIndex(sourceKey, chunks, meta);
  onProgress(`Done — appended ${parentCount} parent chunks from ${docs.length} new file(s).`);
  return {
    chunks: parentCount,
    files: docs.length,
    totalChunks: nextMeta.parentChunks,
    totalFiles: nextMeta.files,
  };
}

// ── Local folder entry point ──────────────────────────────────────────────────

async function walkFolder(folderPath: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        await walk(full);
      } else if (entry.isFile() && /\.(pdf|pptx|docx)$/i.test(entry.name)) {
        files.push(full);
      }
    }
  }
  await walk(folderPath);
  return files;
}

export async function buildIndex(
  folderPath: string,
  ollamaBaseUrl: string,
  embedModel: string,
  onProgress: (msg: string) => void,
  embeddingProvider: "ollama" | "google" = "ollama",
  googleApiKey = ""
): Promise<{ chunks: number; files: number }> {
  const filePaths = await walkFolder(folderPath);
  onProgress(`Found ${filePaths.length} file(s). Extracting text…`);

  const docs: ExtractedDoc[] = [];
  for (let i = 0; i < filePaths.length; i++) {
    const fp = filePaths[i];
    onProgress(`[${i + 1}/${filePaths.length}] Extracting ${path.basename(fp)}`);
    try { docs.push(await extractDoc(fp)); }
    catch { onProgress(`  ⚠ Skipping ${path.basename(fp)}: extraction failed`); }
  }

  return indexExtractedDocs(folderPath, docs, ollamaBaseUrl, embedModel, onProgress, embeddingProvider, googleApiKey);
}

// ── Read / status ─────────────────────────────────────────────────────────────

export async function loadIndex(sourceKey: string): Promise<RagIndex | null> {
  const meta = await readMeta(sourceKey);
  if (!meta || meta.version !== INDEX_VERSION) return null;
  return {
    version:    meta.version,
    sourceKey:  meta.sourceKey,
    indexedAt:  meta.indexedAt,
    embedModel: meta.embedModel,
  };
}

export async function getIndexStatus(sourceKey: string): Promise<IndexStatus> {
  const meta = await readMeta(sourceKey);
  if (!meta) return { exists: false };
  return {
    exists:    true,
    indexedAt: meta.indexedAt,
    chunks:    meta.parentChunks,
    files:     meta.files,
    embedModel: meta.embedModel,
  };
}
