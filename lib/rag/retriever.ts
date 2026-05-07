import type { RagChunk } from "./indexer";
import { vectorSearch, ftsSearch, fetchParentsByIds } from "./store";

export interface RetrievedChunk extends RagChunk {
  score: number;
}

// ── Term extraction ────────────────────────────────────────────────────────────
function extractTerms(query: string): string[] {
  return query
    .split(/\W+/)
    .filter((t) => {
      if (t.length < 2) return false;
      if (t === t.toUpperCase() && /[A-Z]/.test(t)) return true;
      return t.length >= 4;
    })
    .map((t) => t.toLowerCase());
}

// ── Filename relevance ─────────────────────────────────────────────────────────
function filenameScore(terms: string[], fileName: string, filePath?: string): number {
  const text = [
    fileName.toLowerCase().replace(/\.(pdf|pptx|docx)$/i, ""),
    (filePath ?? "").toLowerCase(),
  ].join(" ");
  const parts = text.split(/\W+/).filter(Boolean);
  let hits = 0;
  for (const t of terms) {
    if (parts.some((p) => p.includes(t) || t.includes(p))) hits++;
  }
  return hits / Math.max(terms.length, 1);
}

// ── Reciprocal Rank Fusion ────────────────────────────────────────────────────
function reciprocalRankFusion(rankings: number[][], k = 60): number[] {
  const scores = new Map<number, number>();
  for (const list of rankings) {
    list.forEach((idx, rank) => {
      scores.set(idx, (scores.get(idx) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i);
}

// ── Main retriever ─────────────────────────────────────────────────────────────
export async function retrieve(
  query: string,
  queryEmbedding: number[] | null,
  sourceKey: string,
  topK = 10,
  expandedQuery?: string
): Promise<RetrievedChunk[]> {

  const terms = extractTerms(query);
  const ftsQuery = expandedQuery
    ? `${query} ${expandedQuery}`.trim()
    : query;

  // 1. Semantic vector search + FTS — run in parallel
  const [semChunks, ftsChunks] = await Promise.all([
    queryEmbedding?.length
      ? vectorSearch(sourceKey, queryEmbedding, topK * 3).catch(() => [] as RagChunk[])
      : Promise.resolve([] as RagChunk[]),
    ftsSearch(sourceKey, ftsQuery, topK * 3).catch(() => [] as RagChunk[]),
  ]);

  if (!semChunks.length && !ftsChunks.length) return [];

  // 2. Deduplicate into a unified pool, preserving score metadata
  const chunkById = new Map<string, RagChunk & { semScore: number; ftsScore: number }>();

  for (const c of semChunks) {
    chunkById.set(c.id, { ...c, semScore: 1.0, ftsScore: 0 });
  }
  for (const c of ftsChunks) {
    const existing = chunkById.get(c.id);
    const ftsScore = (c as RagChunk & { score?: number }).score ?? 0;
    if (existing) {
      existing.ftsScore = ftsScore;
    } else {
      chunkById.set(c.id, { ...c, semScore: 0, ftsScore });
    }
  }

  const pool = [...chunkById.values()];

  // 3. Three independent ranking signals for RRF
  const semIdSet = new Set(semChunks.map((c) => c.id));
  const ftsIdSet = new Set(ftsChunks.map((c) => c.id));

  const semRanking = pool
    .map((c, i) => ({ i, hit: semIdSet.has(c.id) }))
    .filter((x) => x.hit)
    .map((x) => x.i);

  const ftsRanking = pool
    .map((c, i) => ({ i, hit: ftsIdSet.has(c.id) }))
    .filter((x) => x.hit)
    .map((x) => x.i);

  const fnRanking = pool
    .map((c, i) => ({ i, s: filenameScore(terms, c.fileName, c.filePath) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);

  // 4. Merge with RRF
  const signals = [
    ...(semRanking.length ? [semRanking.slice(0, 40)] : []),
    ...(ftsRanking.length  ? [ftsRanking.slice(0, 40)]  : []),
    ...(fnRanking.length   ? [fnRanking.slice(0, 40)]   : []),
  ];

  const finalOrder: number[] =
    signals.length > 1 ? reciprocalRankFusion(signals)
    : signals.length === 1 ? signals[0]
    : pool.slice(0, topK).map((_, i) => i);

  // 5. Score candidates: semantic primary, FTS secondary, filename tertiary
  const maxFts = Math.max(...pool.map((c) => c.ftsScore), 1);
  const candidates = finalOrder.slice(0, topK * 3).map((i) => {
    const c = pool[i];
    const score = c.semScore
      + (c.ftsScore / maxFts) * 0.45
      + filenameScore(terms, c.fileName, c.filePath) * 0.50;
    return { chunk: c, score };
  }).sort((a, b) => b.score - a.score);

  // 6. Hierarchical expansion: child → parent
  const isHierarchical = pool.some((c) => c.level === "child");

  if (isHierarchical) {
    const seenParents = new Set<string>();
    const parentIds: string[] = [];
    for (const { chunk } of candidates) {
      if (parentIds.length >= topK) break;
      if (chunk.parentId && !seenParents.has(chunk.parentId)) {
        seenParents.add(chunk.parentId);
        parentIds.push(chunk.parentId);
      }
    }

    const parents = await fetchParentsByIds(sourceKey, parentIds).catch(() => [] as RagChunk[]);
    const parentById = new Map(parents.map((p) => [p.id, p]));

    const results: RetrievedChunk[] = [];
    for (const { chunk, score } of candidates) {
      if (results.length >= topK) break;
      if (!chunk.parentId) continue;
      const parent = parentById.get(chunk.parentId);
      if (parent && !results.some((r) => r.id === parent.id)) {
        results.push({ ...parent, score });
      }
    }
    return results;
  }

  return candidates.slice(0, topK).map(({ chunk, score }) => ({ ...chunk, score }));
}
