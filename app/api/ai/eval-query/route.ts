import { NextRequest, NextResponse } from "next/server";
import { loadIndex } from "@/lib/rag/indexer";
import { getEmbedding } from "@/lib/rag/agent";
import { retrieve } from "@/lib/rag/retriever";
import { fetchFileParents } from "@/lib/rag/store";
import { resolveAiConfig } from "@/lib/serverConfig";
import type { RetrievedChunk } from "@/lib/rag/retriever";
import type { ServiceLine } from "@/types";

export const maxDuration = 120;

interface EvalQueryBody {
  query: string;
  sourceKey?: string;
  folderPath?: string;
  topK?: number;
  aiProvider?: "ollama" | "openrouter" | "gemini";
  ollamaBaseUrl?: string;
  ollamaEmbedModel?: string;
  embeddingProvider?: "ollama" | "google";
}

function elapsedSince(start: number): number {
  return Date.now() - start;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let body: EvalQueryBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = body.query?.trim();
  const sourceKey = body.sourceKey ?? body.folderPath ?? "";
  const topK = Math.max(1, Math.min(body.topK ?? 10, 30));

  if (!query || !sourceKey) {
    return NextResponse.json({ error: "Missing query or sourceKey" }, { status: 400 });
  }

  const indexMeta = await loadIndex(sourceKey);
  if (!indexMeta) {
    return NextResponse.json(
      { error: "No search index found. Build the index before running evals." },
      { status: 404 }
    );
  }

  const config = resolveAiConfig({
    ...body,
    ollamaEmbedModel: body.ollamaEmbedModel ?? indexMeta.embedModel,
  });

  const embeddingStartedAt = Date.now();
  const embedding = await getEmbedding(query, config).catch(() => null);
  const embeddingMs = elapsedSince(embeddingStartedAt);

  const retrievalStartedAt = Date.now();
  const chunks = await retrieve(query, embedding, sourceKey, topK).catch(() => [] as RetrievedChunk[]);
  const retrievalMs = elapsedSince(retrievalStartedAt);

  const sources = chunks.map((chunk, i) => ({
    id: `eval-src-${i}`,
    docId: chunk.fileName,
    title: chunk.fileName.replace(/\.(pdf|pptx)$/i, "").replace(/[-_]/g, " "),
    slide: chunk.page,
    serviceLine: "BFSI" as ServiceLine,
    filePath: chunk.filePath,
    fileType: chunk.fileType,
    excerpt: chunk.text.slice(0, 500),
    sourceType: "rag" as const,
    score: chunk.score,
  }));

  const seenFiles = new Map<string, RetrievedChunk>();
  for (const chunk of chunks) {
    if (!seenFiles.has(chunk.filePath)) seenFiles.set(chunk.filePath, chunk);
  }

  const documentsStartedAt = Date.now();
  const documents = await Promise.all(
    [...seenFiles.values()].map(async (chunk) => {
      const fileChunks = await fetchFileParents(sourceKey, chunk.filePath).catch(() => []);
      const uniquePages = [...new Set(fileChunks.map((c) => c.page))].sort((a, b) => a - b);
      return {
        id: chunk.fileName,
        title: chunk.fileName.replace(/\.(pdf|pptx)$/i, "").replace(/[-_]/g, " "),
        filePath: chunk.filePath,
        fileType: chunk.fileType,
        pages: uniquePages,
      };
    })
  );

  return NextResponse.json({
    query,
    sourceKey,
    topK,
    chunks: chunks.map((chunk) => ({
      id: chunk.id,
      fileName: chunk.fileName,
      filePath: chunk.filePath,
      fileType: chunk.fileType,
      page: chunk.page,
      score: chunk.score,
      text: chunk.text,
    })),
    sources,
    documents,
    timingsMs: {
      embedding: embeddingMs,
      retrieval: retrievalMs,
      documents: elapsedSince(documentsStartedAt),
      total: elapsedSince(startedAt),
    },
  });
}
