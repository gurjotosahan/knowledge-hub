import * as fs from "fs/promises";
import * as path from "path";
import { extractDoc, type ExtractedDoc } from "@/lib/extractors";
import { appendIndex, writeIndex, readMeta, type IndexMeta, type IndexedFile } from "./store";
import { preRenderPptxDeck, type SlidePreviewInfo } from "@/lib/localSlidePreviews";
import {
  classifyDocumentAsset,
  classifySectionAsset,
  enrichDocumentAssetWithLlm,
  enrichSectionAssetWithLlm,
  type AssetIntelligence,
  type AssetLlmConfig,
} from "@/lib/assetIntelligence";
import { extractYearMetadata, type YearConfidence } from "@/lib/recency";
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
  thumbnailPath?: string;
  previewPdfPath?: string;
  previewStatus?: "thumbnail" | "pdf" | "failed";
  documentAssetType?: AssetIntelligence["documentAssetType"];
  sectionAssetType?: AssetIntelligence["sectionAssetType"];
  industries?: string[];
  serviceLines?: string[];
  technologies?: string[];
  reusableFor?: string[];
  proofStrength?: AssetIntelligence["proofStrength"];
  hasMetrics?: boolean;
  assetSummary?: string;
  assetYear?: number;
  yearSignals?: number[];
  yearConfidence?: YearConfidence;
}

interface IndexExtractOptions {
  generateSlidePreviews?: boolean;
  enableAssetLlmEnrichment?: boolean;
  assetLlmConfig?: AssetLlmConfig;
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
  needsRebuild?: boolean;
  message?: string;
  indexedAt?: string;
  chunks?: number;
  files?: number;
  embedModel?: string;
  missingFiles?: number;
  missingFileNames?: string[];
}

const INDEX_VERSION  = 8;
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
  page: number,
  preview?: SlidePreviewInfo,
  asset?: AssetIntelligence,
  yearMetadata = extractYearMetadata(text, `${fileName} ${filePath}`)
): Array<{ parent: Omit<RagChunk, "embedding">; children: Omit<RagChunk, "embedding">[] }> {
  const parentTexts = splitText(text, PARENT_CHARS, PARENT_OVERLAP);
  return parentTexts.map((parentText, pi) => {
    const parentId = `${fileName}::page-${page}::parent-${pi}`;
    const parent: Omit<RagChunk, "embedding"> = {
      id: parentId, fileName, filePath, fileType, page, chunkIndex: pi,
      text: parentText, level: "parent",
      thumbnailPath: preview?.thumbnailPath,
      previewPdfPath: preview?.pdfPath,
      previewStatus: preview?.status,
      documentAssetType: asset?.documentAssetType,
      sectionAssetType: asset?.sectionAssetType,
      industries: asset?.industries,
      serviceLines: asset?.serviceLines,
      technologies: asset?.technologies,
      reusableFor: asset?.reusableFor,
      proofStrength: asset?.proofStrength,
      hasMetrics: asset?.hasMetrics,
      assetSummary: asset?.summary,
      assetYear: yearMetadata.assetYear,
      yearSignals: yearMetadata.yearSignals,
      yearConfidence: yearMetadata.yearConfidence,
    };
    const children: Omit<RagChunk, "embedding">[] = splitText(parentText, CHILD_CHARS, CHILD_OVERLAP)
      .map((childText, ci) => ({
        id: `${parentId}::child-${ci}`, fileName, filePath, fileType, page, chunkIndex: ci,
        text: childText, level: "child" as const, parentId,
        thumbnailPath: preview?.thumbnailPath,
        previewPdfPath: preview?.pdfPath,
        previewStatus: preview?.status,
        documentAssetType: asset?.documentAssetType,
        sectionAssetType: asset?.sectionAssetType,
        industries: asset?.industries,
        serviceLines: asset?.serviceLines,
        technologies: asset?.technologies,
        reusableFor: asset?.reusableFor,
        proofStrength: asset?.proofStrength,
        hasMetrics: asset?.hasMetrics,
        assetSummary: asset?.summary,
        assetYear: yearMetadata.assetYear,
        yearSignals: yearMetadata.yearSignals,
        yearConfidence: yearMetadata.yearConfidence,
      }));
    return { parent, children };
  });
}

function chooseYearMetadata(
  slideYear: ReturnType<typeof extractYearMetadata>,
  docYear: ReturnType<typeof extractYearMetadata>
): ReturnType<typeof extractYearMetadata> {
  if (!slideYear.assetYear) return docYear;
  if (slideYear.yearConfidence === "low" && docYear.assetYear && docYear.yearConfidence !== "low") return docYear;
  return slideYear;
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
  googleApiKey = "",
  options: IndexExtractOptions = {}
): Promise<{ chunks: number; files: number }> {
  const chunks: RagChunk[] = [];
  const childrenToEmbed: RagChunk[] = [];
  const previewByDoc = new Map<string, Map<number, SlidePreviewInfo>>();

  if (options.generateSlidePreviews) {
    const pptxDocs = docs.filter((doc) => doc.fileType === "pptx");
    onProgress(`Preparing cached slide previews for ${pptxDocs.length} PPTX deck(s)...`);
    for (const doc of pptxDocs) {
      const result = await preRenderPptxDeck(doc.filePath, doc.slides.map((slide) => slide.number), onProgress);
      previewByDoc.set(doc.filePath, new Map(result.previews.map((preview) => [preview.slideNumber, preview])));
    }
  }

  for (let fi = 0; fi < docs.length; fi++) {
    const doc = docs[fi];
    onProgress(`[${fi + 1}/${docs.length}] Building asset intelligence for ${doc.fileName}...`);
    const docPreviews = previewByDoc.get(doc.filePath);
    const docText = doc.slides.map((slide) => slide.text).join("\n\n");
    const docYearText = `${doc.fileName} ${doc.filePath} ${doc.slides.slice(0, 4).map((slide) => slide.text).join(" ")}`;
    const docYearMetadata = extractYearMetadata(docYearText);
    const docIntel = options.enableAssetLlmEnrichment
      ? await enrichDocumentAssetWithLlm(
          classifyDocumentAsset(doc.fileName, doc.fileType, docText),
          doc.fileName,
          doc.fileType,
          docText,
          options.assetLlmConfig
        )
      : classifyDocumentAsset(doc.fileName, doc.fileType, docText);

    for (const slide of doc.slides) {
      if (!slide.text?.trim()) continue;
      const ruleSectionIntel = classifySectionAsset(docIntel, slide.text, slide.number);
      const sectionIntel = options.enableAssetLlmEnrichment
        ? await enrichSectionAssetWithLlm(ruleSectionIntel, slide.number, slide.text, options.assetLlmConfig)
        : ruleSectionIntel;
      const slideYearMetadata = extractYearMetadata(slide.text, docYearText);
      const yearMetadata = chooseYearMetadata(slideYearMetadata, docYearMetadata);
      for (const { parent, children } of chunkHierarchical(
        slide.text, doc.fileName, doc.filePath, doc.fileType, slide.number, docPreviews?.get(slide.number), sectionIntel, yearMetadata
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

  // Build indexed files list from the docs we just processed
  const indexedFiles: IndexedFile[] = await Promise.all(
    docs.map(async (doc) => {
      try {
        const stat = await fs.stat(doc.filePath);
        return { path: doc.filePath, mtime: stat.mtimeMs };
      } catch {
        return { path: doc.filePath, mtime: 0 };
      }
    })
  );

  const meta: IndexMeta = {
    version: INDEX_VERSION,
    sourceKey,
    indexedAt: new Date().toISOString(),
    embedModel,
    parentChunks: parentCount,
    files: fileNames.size,
    indexedFiles,
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
  googleApiKey = "",
  options: IndexExtractOptions = {}
): Promise<{ chunks: number; files: number; totalChunks: number; totalFiles: number }> {
  const chunks: RagChunk[] = [];
  const childrenToEmbed: RagChunk[] = [];
  const previewByDoc = new Map<string, Map<number, SlidePreviewInfo>>();

  if (options.generateSlidePreviews) {
    const pptxDocs = docs.filter((doc) => doc.fileType === "pptx");
    onProgress(`Preparing cached slide previews for ${pptxDocs.length} new PPTX deck(s)...`);
    for (const doc of pptxDocs) {
      const result = await preRenderPptxDeck(doc.filePath, doc.slides.map((slide) => slide.number), onProgress);
      previewByDoc.set(doc.filePath, new Map(result.previews.map((preview) => [preview.slideNumber, preview])));
    }
  }

  for (let fi = 0; fi < docs.length; fi++) {
    const doc = docs[fi];
    onProgress(`[${fi + 1}/${docs.length}] Building asset intelligence for ${doc.fileName}...`);
    const docPreviews = previewByDoc.get(doc.filePath);
    const docText = doc.slides.map((slide) => slide.text).join("\n\n");
    const docYearText = `${doc.fileName} ${doc.filePath} ${doc.slides.slice(0, 4).map((slide) => slide.text).join(" ")}`;
    const docYearMetadata = extractYearMetadata(docYearText);
    const docIntel = options.enableAssetLlmEnrichment
      ? await enrichDocumentAssetWithLlm(
          classifyDocumentAsset(doc.fileName, doc.fileType, docText),
          doc.fileName,
          doc.fileType,
          docText,
          options.assetLlmConfig
        )
      : classifyDocumentAsset(doc.fileName, doc.fileType, docText);

    for (const slide of doc.slides) {
      if (!slide.text?.trim()) continue;
      const ruleSectionIntel = classifySectionAsset(docIntel, slide.text, slide.number);
      const sectionIntel = options.enableAssetLlmEnrichment
        ? await enrichSectionAssetWithLlm(ruleSectionIntel, slide.number, slide.text, options.assetLlmConfig)
        : ruleSectionIntel;
      const slideYearMetadata = extractYearMetadata(slide.text, docYearText);
      const yearMetadata = chooseYearMetadata(slideYearMetadata, docYearMetadata);
      for (const { parent, children } of chunkHierarchical(
        slide.text, doc.fileName, doc.filePath, doc.fileType, slide.number, docPreviews?.get(slide.number), sectionIntel, yearMetadata
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

  // Build indexed files list from the new docs
  const indexedFiles: IndexedFile[] = await Promise.all(
    docs.map(async (doc) => {
      try {
        const stat = await fs.stat(doc.filePath);
        return { path: doc.filePath, mtime: stat.mtimeMs };
      } catch {
        return { path: doc.filePath, mtime: 0 };
      }
    })
  );

  const meta: IndexMeta = {
    version: INDEX_VERSION,
    sourceKey,
    indexedAt: new Date().toISOString(),
    embedModel,
    parentChunks: parentCount,
    files: fileNames.size,
    indexedFiles,
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
      } else if (entry.isFile() && isSupportedSourceFile(entry.name)) {
        files.push(full);
      }
    }
  }
  await walk(folderPath);
  return files;
}

function isSupportedSourceFile(fileName: string): boolean {
  return !fileName.startsWith("~$") && /\.(pdf|pptx|docx)$/i.test(fileName);
}

async function missingIndexedFiles(sourceKey: string, meta: IndexMeta): Promise<string[]> {
  if (sourceKey.startsWith("graph:") || sourceKey.startsWith("onedrive:")) return [];
  try {
    const stat = await fs.stat(sourceKey);
    if (!stat.isDirectory()) return [];
    const indexed = new Set((meta.indexedFiles ?? []).map((file) => file.path));
    const current = await walkFolder(sourceKey);
    return current.filter((filePath) => !indexed.has(filePath));
  } catch {
    return [];
  }
}

export async function buildIndex(
  folderPath: string,
  ollamaBaseUrl: string,
  embedModel: string,
  onProgress: (msg: string) => void,
  embeddingProvider: "ollama" | "google" = "ollama",
  googleApiKey = "",
  options: IndexExtractOptions = {}
): Promise<{ chunks: number; files: number }> {
  const filePaths = await walkFolder(folderPath);
  onProgress(`Found ${filePaths.length} file(s). Checking for new/modified files…`);

  const existingMeta = await readMeta(folderPath);
  const canAppend =
    existingMeta &&
    existingMeta.version === INDEX_VERSION &&
    existingMeta.embedModel === embedModel;

  if (existingMeta && !canAppend) {
    onProgress("Index schema or embedding model changed. Rebuilding the full index...");
    return buildFullIndex(filePaths, folderPath, ollamaBaseUrl, embedModel, onProgress, embeddingProvider, googleApiKey, options);
  }

  const existingFiles = new Map<string, number>();
  if (existingMeta?.indexedFiles) {
    for (const f of existingMeta.indexedFiles) {
      existingFiles.set(f.path, f.mtime);
    }
  }

  const currentFiles = new Map<string, number>();
  for (const fp of filePaths) {
    try {
      const stat = await fs.stat(fp);
      currentFiles.set(fp, stat.mtimeMs);
    } catch {
      // File might have been deleted between walk and stat.
    }
  }

  const deletedFilePaths = [...existingFiles.keys()].filter((fp) => !currentFiles.has(fp));
  if (deletedFilePaths.length > 0) {
    onProgress(`${deletedFilePaths.length} previously indexed file(s) were removed. Rebuilding the full index...`);
    return buildFullIndex(filePaths, folderPath, ollamaBaseUrl, embedModel, onProgress, embeddingProvider, googleApiKey, options);
  }

  const newFilePaths: string[] = [];
  const modifiedFilePaths: string[] = [];
  for (const [fp, mtime] of currentFiles) {
    const existingMtime = existingFiles.get(fp);
    if (!existingMtime) {
      newFilePaths.push(fp);
    } else if (mtime > existingMtime) {
      modifiedFilePaths.push(fp);
    }
  }

  if (modifiedFilePaths.length > 0) {
    onProgress(`${modifiedFilePaths.length} modified file(s) detected. Rebuilding the full index to avoid stale duplicate chunks...`);
    return buildFullIndex(filePaths, folderPath, ollamaBaseUrl, embedModel, onProgress, embeddingProvider, googleApiKey, options);
  }

  const skippedCount = filePaths.length - newFilePaths.length;
  if (skippedCount > 0) {
    onProgress(`Skipping ${skippedCount} unchanged file(s). ${newFilePaths.length} new.`);
  }

  if (newFilePaths.length === 0) {
    onProgress("No new or modified files to index.");
    return { chunks: existingMeta?.parentChunks ?? 0, files: existingMeta?.files ?? 0 };
  }

  onProgress(`Extracting text from ${newFilePaths.length} new file(s)…`);

  const docs: ExtractedDoc[] = [];
  for (let i = 0; i < newFilePaths.length; i++) {
    const fp = newFilePaths[i];
    onProgress(`[${i + 1}/${newFilePaths.length}] Extracting ${path.basename(fp)}`);
    try { docs.push(await extractDoc(fp)); }
    catch { onProgress(`  ⚠ Skipping ${path.basename(fp)}: extraction failed`); }
  }

  if (canAppend) {
    return appendExtractedDocs(folderPath, docs, ollamaBaseUrl, embedModel, onProgress, embeddingProvider, googleApiKey, options);
  }

  return indexExtractedDocs(folderPath, docs, ollamaBaseUrl, embedModel, onProgress, embeddingProvider, googleApiKey, options);
}

async function buildFullIndex(
  filePaths: string[],
  folderPath: string,
  ollamaBaseUrl: string,
  embedModel: string,
  onProgress: (msg: string) => void,
  embeddingProvider: "ollama" | "google",
  googleApiKey: string,
  options: IndexExtractOptions
): Promise<{ chunks: number; files: number }> {
  onProgress(`Extracting text from ${filePaths.length} file(s)…`);

  const docs: ExtractedDoc[] = [];
  for (let i = 0; i < filePaths.length; i++) {
    const fp = filePaths[i];
    onProgress(`[${i + 1}/${filePaths.length}] Extracting ${path.basename(fp)}`);
    try { docs.push(await extractDoc(fp)); }
    catch { onProgress(`  ⚠ Skipping ${path.basename(fp)}: extraction failed`); }
  }

  return indexExtractedDocs(folderPath, docs, ollamaBaseUrl, embedModel, onProgress, embeddingProvider, googleApiKey, options);
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
  const missingFiles = await missingIndexedFiles(sourceKey, meta);
  if (meta.version !== INDEX_VERSION) {
    return {
      exists: false,
      needsRebuild: true,
      message: "Index schema changed. Rebuild the knowledge index before searching recommendations.",
      indexedAt: meta.indexedAt,
      chunks: meta.parentChunks,
      files: meta.files,
      embedModel: meta.embedModel,
      missingFiles: missingFiles.length,
      missingFileNames: missingFiles.map((filePath) => path.basename(filePath)).slice(0, 8),
    };
  }
  return {
    exists:    true,
    indexedAt: meta.indexedAt,
    chunks:    meta.parentChunks,
    files:     meta.files,
    embedModel: meta.embedModel,
    missingFiles: missingFiles.length,
    missingFileNames: missingFiles.map((filePath) => path.basename(filePath)).slice(0, 8),
  };
}
