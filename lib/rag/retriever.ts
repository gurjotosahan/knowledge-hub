import type { RagChunk } from "./indexer";
import { vectorSearch, fetchChildChunks, fetchParentsByIds } from "./store";

export interface RetrievedChunk extends RagChunk {
  score: number;
}


function bm25Score(queryTerms: string[], doc: string, avgLen: number): number {
  const k1 = 1.5, b = 0.75;
  const words = doc.toLowerCase().split(/\W+/);
  const len = words.length;
  const tf = new Map<string, number>();
  for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);

  let score = 0;
  for (const term of queryTerms) {
    const f = tf.get(term) ?? 0;
    if (f === 0) continue;
    score += (f * (k1 + 1)) / (f + k1 * (1 - b + b * (len / avgLen)));
  }
  return score;
}

function filenameScore(queryTerms: string[], fileName: string, filePath?: string): number {
  // Check both the filename and all path/ID segments so that "bfsi" matches
  // filePaths like "graph:mock-drive-documents:mock-file-bfsi-rfp"
  // and local paths like "/docs/BFSI/Digital-Banking-RFP.pdf"
  const text = [
    fileName.toLowerCase().replace(/\.(pdf|pptx)$/i, ""),
    (filePath ?? "").toLowerCase(),
  ].join(" ");
  const parts = text.split(/\W+/).filter(Boolean);
  let hits = 0;
  for (const term of queryTerms) {
    if (parts.some((p) => p.includes(term) || term.includes(p))) hits++;
  }
  return hits / Math.max(queryTerms.length, 1);
}

function reciprocalRankFusion(rankings: number[][], k = 60): number[] {
  const scores = new Map<number, number>();
  for (const list of rankings) {
    list.forEach((idx, rank) => {
      scores.set(idx, (scores.get(idx) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i);
}

export async function retrieve(
  query: string,
  queryEmbedding: number[] | null,
  sourceKey: string,
  topK = 10,
  expandedQuery?: string
): Promise<RetrievedChunk[]> {

  // ── 1. Semantic: LanceDB ANN vector search ────────────────────────────────
  const semChunks: RagChunk[] = queryEmbedding?.length
    ? await vectorSearch(sourceKey, queryEmbedding, topK * 3).catch(() => [])
    : [];

  // ── 2. BM25 + filename: fetch all child chunks (text only, no vectors) ────
  const allChildren = await fetchChildChunks(sourceKey).catch(() => [] as RagChunk[]);

  if (!allChildren.length && !semChunks.length) return [];

  // Build a unified child pool: semChunks + allChildren, deduped by id
  const childById = new Map<string, RagChunk>();
  for (const c of [...allChildren, ...semChunks]) childById.set(c.id, c);
  const children = [...childById.values()];

  const avgLen = children.reduce((s, c) => s + c.text.split(/\W+/).length, 0) / children.length;

  const queryTerms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 1);
  const expandedTerms = expandedQuery
    ? [...new Set([...queryTerms, ...expandedQuery.toLowerCase().split(/\W+/).filter((t) => t.length > 1)])]
    : queryTerms;

  // ── Semantic ranking (index within children array) ────────────────────────
  const semIdSet = new Set(semChunks.map((c) => c.id));
  const semRanking = children
    .map((c, i) => ({ i, inSem: semIdSet.has(c.id) }))
    .filter((x) => x.inSem)
    .map((x) => x.i);

  // ── BM25 keyword ranking ──────────────────────────────────────────────────
  const kwRanking = children
    .map((c, i) => ({ i, s: bm25Score(expandedTerms, c.text, avgLen) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);

  // ── Filename ranking ──────────────────────────────────────────────────────
  const fnRanking = children
    .map((c, i) => ({ i, s: filenameScore(queryTerms, c.fileName, c.filePath) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);

  // ── RRF merge ─────────────────────────────────────────────────────────────
  const signals = [
    ...(semRanking.length ? [semRanking.slice(0, 40)] : []),
    ...(kwRanking.length  ? [kwRanking.slice(0, 40)]  : []),
    ...(fnRanking.length  ? [fnRanking.slice(0, 40)]  : []),
  ];

  let finalOrder: number[];
  if (signals.length > 1)     finalOrder = reciprocalRankFusion(signals);
  else if (signals.length === 1) finalOrder = signals[0];
  else                           finalOrder = children.slice(0, topK).map((_, i) => i);

  const kwScores = new Map(children.map((c, i) => [i, bm25Score(expandedTerms, c.text, avgLen)]));
  const fnScores = new Map(children.map((c, i) => [i, filenameScore(queryTerms, c.fileName, c.filePath)]));

  const candidates = finalOrder.slice(0, topK * 4).map((i) => ({
    chunk: children[i],
    score: (semIdSet.has(children[i].id) ? 1 : 0) + (kwScores.get(i) ?? 0) * 0.1 + (fnScores.get(i) ?? 0) * 0.5,
  }));

  // ── Expand children → parent chunks via LanceDB lookup ───────────────────
  const isHierarchical = children.some((c) => c.level === "child");

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

  // ── Legacy: return children directly ─────────────────────────────────────
  return candidates.slice(0, topK).map(({ chunk, score }) => ({ ...chunk, score }));
}
