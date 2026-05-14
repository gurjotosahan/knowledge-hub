import { getEmbedding, type AgentConfig } from "@/lib/rag/agent";
import { loadIndex } from "@/lib/rag/indexer";
import { retrieve, type RetrievedChunk } from "@/lib/rag/retriever";
import type { ResearchReference } from "@/types/research";

export interface InternalResearchContext {
  chunks: RetrievedChunk[];
  references: ResearchReference[];
  text: string;
}

function compactText(text: string, maxChars: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function formatChunk(chunk: RetrievedChunk, index: number): string {
  const locator = chunk.fileType === "pptx" ? `slide ${chunk.page}` : `page ${chunk.page}`;
  return `[I${index + 1}] ${chunk.fileName} (${locator})\n${compactText(chunk.text, 850)}`;
}

function toReference(chunk: RetrievedChunk, index: number): ResearchReference {
  return {
    id: `I${index + 1}`,
    marker: `I${index + 1}`,
    title: chunk.fileName.replace(/\.(pdf|pptx|docx)$/i, "").replace(/[-_]/g, " "),
    fileName: chunk.fileName,
    filePath: chunk.filePath,
    fileType: chunk.fileType,
    page: Math.max(1, chunk.page),
    excerpt: compactText(chunk.text, 220),
  };
}

export async function buildInternalResearchContext(
  sourceKey: string | undefined,
  queries: string[],
  config: AgentConfig,
  maxChunks = 10
): Promise<InternalResearchContext> {
  if (!sourceKey) return { chunks: [], references: [], text: "" };

  const index = await loadIndex(sourceKey).catch(() => null);
  if (!index) return { chunks: [], references: [], text: "" };

  const uniqueQueries = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 8);
  const retrievalGroups = await Promise.all(
    uniqueQueries.map(async (query) => {
      const embedding = await getEmbedding(query, config).catch(() => null);
      return retrieve(query, embedding, sourceKey, 5).catch(() => [] as RetrievedChunk[]);
    })
  );

  const byId = new Map<string, RetrievedChunk>();
  for (const chunk of retrievalGroups.flat()) {
    if (!byId.has(chunk.id)) byId.set(chunk.id, chunk);
  }

  const chunks = [...byId.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, maxChunks);

  return {
    chunks,
    references: chunks.map(toReference),
    text: chunks.map(formatChunk).join("\n\n"),
  };
}
