import type { RagChunk } from "@/lib/rag/indexer";

export type YearConfidence = "high" | "medium" | "low";

export interface YearMetadata {
  assetYear?: number;
  yearSignals: number[];
  yearConfidence?: YearConfidence;
}

const MIN_YEAR = 2018;
const MAX_FUTURE_ASSET_YEARS = 1;
const COPYRIGHT_FOOTER_PATTERN = /\b(confidential|copyright|©|all rights reserved|intended recipients|footer)\b/i;
const STRONG_YEAR_CONTEXT = /\b(fy|q[1-4]|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|year|roadmap|strategy|plan|overview|proposal|capabilit|meeting|updated|version|v\d+)\b/i;
const PROJECTION_CONTEXT = /\b(by|through|until|target|forecast|project(?:ed|ion)?|market|opportunity|potential|goal|vision|outlook|expected|estimate(?:d)?|value)\b/i;
const RECENT_QUERY_PATTERN = /\b(latest|recent|new|newest|current|updated|fresh|modern|2026|2025|fy26|fy25)\b/i;

export function extractYearMetadata(text: string, fallbackText = ""): YearMetadata {
  const primary = extractYearCandidates(text);
  const fallback = extractYearCandidates(fallbackText);
  const strong = primary.filter((candidate) => candidate.confidence === "high" || candidate.confidence === "medium");
  const chosen = strong[0] ?? primary[0] ?? fallback.find((candidate) => candidate.confidence !== "low") ?? fallback[0];
  const yearSignals = [...new Set([...primary, ...fallback].map((candidate) => candidate.year))]
    .sort((a, b) => b - a);

  return {
    assetYear: chosen?.year,
    yearSignals,
    yearConfidence: chosen?.confidence,
  };
}

export function recencyScore(query: string, chunk: Pick<RagChunk, "assetYear" | "yearSignals" | "yearConfidence">): number {
  const year = normalizeAssetYear(chunk.assetYear);
  if (!year) return 0;

  const explicitYears = extractExplicitYears(query);
  if (explicitYears.length > 0) {
    if (explicitYears.includes(year)) return 1.8;
    if ((chunk.yearSignals ?? []).some((signal) => explicitYears.includes(signal))) return 1.2;
    return -0.35;
  }

  if (!RECENT_QUERY_PATTERN.test(query)) return passiveFreshnessScore(year, chunk.yearConfidence);

  const currentYear = new Date().getFullYear();
  const age = currentYear - year;
  let score = 0;
  if (age <= 0) score = 1.5;
  else if (age === 1) score = 1.15;
  else if (age === 2) score = 0.55;
  else if (age === 3) score = 0.15;
  else score = -0.15;

  if (chunk.yearConfidence === "low") score *= 0.35;
  if (chunk.yearConfidence === "high") score += 0.15;
  return Number(score.toFixed(3));
}

export function isRecencySensitiveQuery(query: string): boolean {
  return RECENT_QUERY_PATTERN.test(query) || extractExplicitYears(query).length > 0;
}

export function describeYear(metadata: Pick<RagChunk, "assetYear" | "yearConfidence">): string | undefined {
  const year = normalizeAssetYear(metadata.assetYear);
  if (!year) return undefined;
  return metadata.yearConfidence === "low" ? `${year} inferred` : String(year);
}

export function normalizeAssetYear(year?: number): number | undefined {
  if (!year) return undefined;
  const maxYear = new Date().getFullYear() + MAX_FUTURE_ASSET_YEARS;
  return year >= MIN_YEAR && year <= maxYear ? year : undefined;
}

function extractExplicitYears(text: string): number[] {
  return [...new Set(Array.from(text.matchAll(/\b(?:fy)?(20[1-3]\d|[2-3]\d)\b/gi))
    .map((match) => normalizeYear(match[1]))
    .filter((year): year is number => Boolean(year)))]
    .sort((a, b) => b - a);
}

function passiveFreshnessScore(year: number, confidence?: YearConfidence): number {
  const age = new Date().getFullYear() - year;
  let score = age <= 0 ? 1.4 : age === 1 ? 0.45 : age === 2 ? 0.15 : 0;
  if (confidence === "high") score += 0.2;
  if (confidence === "low") score *= 0.25;
  return Number(score.toFixed(3));
}

function extractYearCandidates(text: string): Array<{ year: number; confidence: YearConfidence; index: number }> {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const candidates: Array<{ year: number; confidence: YearConfidence; index: number }> = [];
  const matches = cleaned.matchAll(/\b(?:fy\s*)?(20[1-3]\d|[2-3]\d)\b/gi);
  for (const match of matches) {
    const year = normalizeYear(match[1]);
    if (!year) continue;
    const index = match.index ?? 0;
    const context = cleaned.slice(Math.max(0, index - 60), Math.min(cleaned.length, index + 80));
    const early = index < 260;
    const copyrightFooter = COPYRIGHT_FOOTER_PATTERN.test(context);
    const strongContext = STRONG_YEAR_CONTEXT.test(context);
    if (isProjectionYear(year, context)) continue;
    const confidence: YearConfidence = copyrightFooter || early || strongContext
        ? "high"
        : "medium";
    candidates.push({ year, confidence, index });
  }

  return candidates.sort((a, b) => {
    const confidenceDelta = confidenceWeight(b.confidence) - confidenceWeight(a.confidence);
    if (confidenceDelta !== 0) return confidenceDelta;
    if (b.year !== a.year) return b.year - a.year;
    return a.index - b.index;
  });
}

function normalizeYear(raw: string): number | undefined {
  const value = Number(raw);
  const year = value < 100 ? 2000 + value : value;
  return normalizeAssetYear(year);
}

function isProjectionYear(year: number, context: string): boolean {
  return year > new Date().getFullYear() && PROJECTION_CONTEXT.test(context);
}

function confidenceWeight(confidence: YearConfidence): number {
  if (confidence === "high") return 3;
  if (confidence === "medium") return 2;
  return 1;
}
