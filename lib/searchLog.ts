import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

const LOG_DIR = path.join(os.homedir(), ".knowledge-hub", "logs");
const LOG_FILE = path.join(LOG_DIR, "search.jsonl");
const MAX_ENTRIES = 10_000;

export interface SearchLogEntry {
  queryId: string;
  timestamp: string;
  query: string;
  mode: "slides" | "answer";
  sourceKey: string;
  intent: string;
  topicCount: number;
  resultCount: number;
  noResult: boolean;
  weakResult: boolean;
  latencyMs: number;
  usedAgenticRag: boolean;
  suggestions: string[];
  error: string | null;
}

export interface SearchLogAggregates {
  totalSearches: number;
  noResultRate: number;
  weakResultRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  topQueries: Array<{ query: string; count: number }>;
  zeroResultQueries: Array<{ query: string; count: number; lastSeen: string }>;
  slowQueries: Array<{ query: string; latencyMs: number; timestamp: string }>;
  recentEntries: SearchLogEntry[];
}

export function makeSearchLogEntry(
  partial: Omit<SearchLogEntry, "queryId" | "timestamp">
): SearchLogEntry {
  return {
    queryId: randomUUID(),
    timestamp: new Date().toISOString(),
    ...partial,
  };
}

export async function appendSearchLog(entry: SearchLogEntry): Promise<void> {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
    await rotateIfNeeded();
  } catch {
    // Logging must never block or break the search response
  }
}

async function rotateIfNeeded(): Promise<void> {
  try {
    const raw = await fs.readFile(LOG_FILE, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length > MAX_ENTRIES) {
      // Keep the newest MAX_ENTRIES entries
      await fs.writeFile(LOG_FILE, lines.slice(-MAX_ENTRIES).join("\n") + "\n", "utf-8");
    }
  } catch {
    // Non-fatal
  }
}

export async function readSearchLog(): Promise<SearchLogEntry[]> {
  try {
    const raw = await fs.readFile(LOG_FILE, "utf-8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as SearchLogEntry; }
        catch { return null; }
      })
      .filter((entry): entry is SearchLogEntry => entry !== null);
  } catch {
    return [];
  }
}

export async function getSearchLogAggregates(sourceKey?: string): Promise<SearchLogAggregates> {
  const all = await readSearchLog();
  const entries = sourceKey ? all.filter((e) => e.sourceKey === sourceKey) : all;

  const total = entries.length;
  const noResultCount = entries.filter((e) => e.noResult).length;
  const weakCount = entries.filter((e) => e.weakResult && !e.noResult).length;
  const latencies = entries.map((e) => e.latencyMs).sort((a, b) => a - b);
  const avgLatencyMs = total ? Math.round(latencies.reduce((s, l) => s + l, 0) / total) : 0;
  const p95LatencyMs = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

  // Query frequency
  const queryCounts = new Map<string, number>();
  for (const e of entries) {
    const key = e.query.toLowerCase().trim();
    queryCounts.set(key, (queryCounts.get(key) ?? 0) + 1);
  }
  const topQueries = [...queryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([query, count]) => ({ query, count }));

  // Zero-result queries with last-seen
  const zeroMap = new Map<string, { count: number; lastSeen: string }>();
  for (const e of entries.filter((e) => e.noResult)) {
    const key = e.query.toLowerCase().trim();
    const existing = zeroMap.get(key);
    zeroMap.set(key, {
      count: (existing?.count ?? 0) + 1,
      lastSeen: !existing || e.timestamp > existing.lastSeen ? e.timestamp : existing.lastSeen,
    });
  }
  const zeroResultQueries = [...zeroMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([query, { count, lastSeen }]) => ({ query, count, lastSeen }));

  // Slowest individual queries
  const slowQueries = [...entries]
    .filter((e) => e.latencyMs > 3000)
    .sort((a, b) => b.latencyMs - a.latencyMs)
    .slice(0, 10)
    .map((e) => ({ query: e.query, latencyMs: e.latencyMs, timestamp: e.timestamp }));

  const recentEntries = [...entries].reverse().slice(0, 50);

  return {
    totalSearches: total,
    noResultRate: total ? noResultCount / total : 0,
    weakResultRate: total ? weakCount / total : 0,
    avgLatencyMs,
    p95LatencyMs,
    topQueries,
    zeroResultQueries,
    slowQueries,
    recentEntries,
  };
}
