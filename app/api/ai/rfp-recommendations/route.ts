import { NextRequest, NextResponse } from "next/server";
import { getIndexStatus, loadIndex } from "@/lib/rag/indexer";
import { getEmbedding, type AgentConfig } from "@/lib/rag/agent";
import { retrieve, type RetrievedChunk } from "@/lib/rag/retriever";
import { ftsSearch } from "@/lib/rag/store";
import { buildAgentHarnessReport, type AgentHarnessTraceEntry } from "@/lib/agentHarness";
import { describeYear, isRecencySensitiveQuery, recencyScore } from "@/lib/recency";
import {
  RFP_RECOMMENDATION_AREAS,
  type RfpRecommendationAreaDef,
  type RfpRecommendationCard,
  type RfpRecommendationGroup,
} from "@/types/rfp";

export const maxDuration = 300;

interface RecommendationBody {
  workspaceId?: string;
  workspaceName?: string;
  rfpText?: string;
  finalContent?: Record<string, string>;
  selectedSections?: string[];
  sourceKey?: string;
  folderPath?: string;
  recommendationAreas?: RfpRecommendationAreaDef[];
  config?: AgentConfig;
}

const STOP_WORDS = new Set([
  "about", "across", "after", "against", "also", "and", "are", "based", "been", "both",
  "client", "could", "delivery", "from", "have", "into", "must", "need", "needs", "not",
  "proposal", "provide", "required", "requirements", "response", "rfp", "scope", "shall",
  "should", "solution", "support", "that", "the", "their", "this", "through", "with", "will",
]);

const SERVICE_TERMS = [
  "salesforce", "aws", "azure", "gcp", "cloud", "data", "analytics", "migration", "testing",
  "automation", "quality", "qa", "ui", "ux", "design", "mobile", "web", "integration",
  "api", "microservices", "devops", "cicd", "security", "compliance", "healthcare", "life",
  "sciences", "banking", "insurance", "retail", "agentic", "ai", "genai", "managed",
  "services", "governance", "operating", "model", "architecture", "accelerator",
];

function localServeUrl(filePath?: string): string | undefined {
  return filePath ? `/api/local/serve?path=${encodeURIComponent(filePath)}` : undefined;
}

function normalizeAreas(raw?: RfpRecommendationAreaDef[]): RfpRecommendationAreaDef[] {
  const source = Array.isArray(raw) && raw.length ? raw : RFP_RECOMMENDATION_AREAS;
  const defaultsById = new Map(RFP_RECOMMENDATION_AREAS.map((area) => [area.id, area]));
  return source
    .map((area) => {
      const defaults = defaultsById.get(area.id);
      return {
        ...defaults,
        ...area,
        name: area.name || defaults?.name || "Recommended Content",
        description: area.description || defaults?.description || "Reusable internal content",
        queryTemplate: area.queryTemplate || defaults?.queryTemplate || "{{profile}}",
        desiredAssetTypes: Array.isArray(area.desiredAssetTypes) && area.desiredAssetTypes.length
          ? area.desiredAssetTypes
          : defaults?.desiredAssetTypes || ["pdf", "pptx", "docx"],
        prompt: area.prompt || defaults?.prompt || "Find source-backed reusable content.",
        enabled: area.enabled !== false,
      };
    })
    .filter((area) => area.enabled);
}

function compactText(value: string, max = 7000): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function extractProfileTerms(text: string): string[] {
  const lower = text.toLowerCase();
  const explicit = SERVICE_TERMS.filter((term) => new RegExp(`\\b${term.replace(/\s+/g, "\\s+")}\\b`, "i").test(lower));
  const frequent = lower
    .split(/[^a-z0-9+#.-]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 4 && !STOP_WORDS.has(term))
    .reduce((counts, term) => counts.set(term, (counts.get(term) ?? 0) + 1), new Map<string, number>());

  const topFrequent = [...frequent.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([term]) => term);

  return [...new Set([...explicit, ...topFrequent])].slice(0, 24);
}

function buildOpportunityProfile(body: RecommendationBody): string {
  const finalContent = Object.entries(body.finalContent ?? {})
    .map(([id, content]) => `## ${id}\n${content}`)
    .join("\n\n");
  const source = `${body.workspaceName ?? ""}\n\n${finalContent}\n\n${body.rfpText ?? ""}`;
  const terms = extractProfileTerms(source);
  return terms.length ? terms.join(" ") : compactText(source, 900);
}

function fillTemplate(template: string, profile: string, body: RecommendationBody): string {
  return template
    .replace(/\{\{profile\}\}/g, profile)
    .replace(/\{\{workspace\}\}/g, body.workspaceName || body.workspaceId || "RFP opportunity")
    .replace(/\s+/g, " ")
    .trim();
}

function assetType(chunk: RetrievedChunk): string {
  if (chunk.sectionAssetType) return humanize(chunk.sectionAssetType);
  if (chunk.documentAssetType) return humanize(chunk.documentAssetType);
  const name = `${chunk.fileName} ${chunk.filePath ?? ""}`.toLowerCase();
  if (chunk.fileType === "pptx") return "Slide";
  if (/\b(case study|customer story|success story|proof point)\b/.test(name)) return "Case Study";
  if (/\b(rfp|proposal|sow|response)\b/.test(name)) return "Proposal / RFP";
  if (/\b(operating model|delivery model|governance)\b/.test(name)) return "Operating Model";
  if (/\b(solution|architecture|accelerator|platform)\b/.test(name)) return "Solution Asset";
  if (/\b(pricing|commercial|rate card)\b/.test(name)) return "Commercial Reference";
  return chunk.fileType?.toUpperCase() || "Knowledge Asset";
}

function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function reuseLabel(areaId: string, chunk: RetrievedChunk): string {
  if (areaId === "case_studies") return "Use as proof point";
  if (areaId === "capability_slides") return "Use as capability slide";
  if (areaId === "operating_model") return "Use as delivery model";
  if (areaId === "solution_assets") return "Use as solution reference";
  if (areaId === "commercial_pricing") return "Use as commercial reference";
  if (chunk.fileType === "pptx") return "Use as reusable slide";
  return "Use as win theme";
}

function matchTerms(query: string, text: string): string[] {
  const queryTerms = extractProfileTerms(query).filter((term) => term.length > 2);
  const lower = text.toLowerCase();
  return queryTerms.filter((term) => lower.includes(term.toLowerCase())).slice(0, 6);
}

function scoreChunk(chunk: RetrievedChunk, area: RfpRecommendationAreaDef, query: string): number {
  const haystack = `${chunk.fileName} ${chunk.filePath ?? ""} ${chunk.text}`.toLowerCase();
  const hits = matchTerms(query, haystack).length;
  const metadataText = [
    chunk.documentAssetType,
    chunk.sectionAssetType,
    chunk.proofStrength,
    ...(chunk.industries ?? []),
    ...(chunk.serviceLines ?? []),
    ...(chunk.technologies ?? []),
    ...(chunk.reusableFor ?? []),
  ].join(" ").toLowerCase();
  const metadataHits = matchTerms(query, metadataText).length;
  const desiredTypeBoost = area.desiredAssetTypes.includes(chunk.fileType) ? 1.4 : -0.6;
  const slideBoost = chunk.fileType === "pptx" && area.desiredAssetTypes.includes("pptx") ? 0.9 : 0;
  const caseBoost = area.id === "case_studies" && (chunk.sectionAssetType === "case_study" || chunk.sectionAssetType === "proof_point" || /\b(case study|customer|client|outcome|results?|impact|roi|reduced|improved)\b/i.test(haystack)) ? 1.2 : 0;
  const operatingBoost = area.id === "operating_model" && (chunk.sectionAssetType === "operating_model" || chunk.sectionAssetType === "governance" || chunk.sectionAssetType === "delivery_plan") ? 1.1 : 0;
  const solutionBoost = area.id === "solution_assets" && (chunk.sectionAssetType === "solution_architecture" || chunk.sectionAssetType === "capability") ? 1.1 : 0;
  const commercialBoost = area.id === "commercial_pricing" && chunk.sectionAssetType === "commercial_pricing" ? 1.1 : 0;
  const proofBoost = chunk.proofStrength === "high" ? 0.8 : chunk.proofStrength === "medium" ? 0.45 : 0;
  const detailBoost = Math.min(chunk.text.split(/\s+/).filter(Boolean).length / 90, 1.4);
  const recencyBoost = recencyScore(query, chunk) * (isRecencySensitiveQuery(query) ? 1.0 : 0.35);
  const score = (chunk.score ?? 0) + hits * 0.55 + metadataHits * 0.7 + desiredTypeBoost + slideBoost + caseBoost + operatingBoost + solutionBoost + commercialBoost + proofBoost + detailBoost + recencyBoost;
  return Number(score.toFixed(3));
}

function excerptFor(chunk: RetrievedChunk, query: string): string {
  const text = chunk.text.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const terms = extractProfileTerms(query);
  const lower = text.toLowerCase();
  const first = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const start = first == null ? 0 : Math.max(0, first - 90);
  const excerpt = text.slice(start, start + 320);
  return `${start > 0 ? "... " : ""}${excerpt}${start + 320 < text.length ? " ..." : ""}`;
}

function confidence(score: number): "High" | "Medium" | "Low" {
  if (score >= 5.2) return "High";
  if (score >= 3.4) return "Medium";
  return "Low";
}

function toCard(area: RfpRecommendationAreaDef, chunk: RetrievedChunk, query: string, score: number): RfpRecommendationCard {
  const terms = matchTerms(query, `${chunk.fileName} ${chunk.text}`);
  const title = chunk.fileType === "pptx"
    ? `${chunk.fileName.replace(/\.pptx$/i, "")} - Slide ${chunk.page}`
    : chunk.fileName;
  return {
    id: `${area.id}:${chunk.id}`,
    title,
    assetType: assetType(chunk),
    fileName: chunk.fileName,
    filePath: chunk.filePath,
    fileType: chunk.fileType,
    page: chunk.page,
    matchReason: terms.length
      ? `Matches ${terms.join(", ")} from the RFP opportunity profile.${recencyScore(query, chunk) > 0.7 ? ` Recent ${describeYear(chunk) ?? "asset"} also supports reuse.` : ""}`
      : "Semantically close to the RFP opportunity profile.",
    excerpt: excerptFor(chunk, query),
    confidence: confidence(score),
    suggestedReuse: reuseLabel(area.id, chunk),
    documentAssetType: chunk.documentAssetType,
    sectionAssetType: chunk.sectionAssetType,
    industries: chunk.industries,
    serviceLines: chunk.serviceLines,
    technologies: chunk.technologies,
    reusableFor: chunk.reusableFor,
    proofStrength: chunk.proofStrength,
    hasMetrics: chunk.hasMetrics,
    assetSummary: chunk.assetSummary,
    thumbnailUrl: localServeUrl(chunk.thumbnailPath),
    previewPdfUrl: localServeUrl(chunk.previewPdfPath),
    previewStatus: chunk.previewStatus,
    assetYear: chunk.assetYear,
    yearConfidence: chunk.yearConfidence,
    recencyNote: recencyScore(query, chunk) > 0.7 ? `Recent ${describeYear(chunk) ?? "asset"} boosted this recommendation.` : undefined,
    score,
  };
}

async function retrieveForArea(
  area: RfpRecommendationAreaDef,
  query: string,
  sourceKey: string,
  agentConfig: AgentConfig
): Promise<RetrievedChunk[]> {
  const embedding = await getEmbedding(query, agentConfig).catch(() => null);
  const [semantic, exact] = await Promise.all([
    retrieve(query, embedding, sourceKey, 18).catch(() => [] as RetrievedChunk[]),
    ftsSearch(sourceKey, query, 30).then((chunks) => chunks as RetrievedChunk[]).catch(() => [] as RetrievedChunk[]),
  ]);
  const merged = new Map<string, RetrievedChunk>();
  for (const chunk of [...semantic, ...exact]) {
    const existing = merged.get(chunk.id);
    if (!existing || (chunk.score ?? 0) > (existing.score ?? 0)) merged.set(chunk.id, chunk);
  }
  return [...merged.values()]
    .filter((chunk) => chunk.text?.trim())
    .filter((chunk) => area.desiredAssetTypes.includes(chunk.fileType) || area.desiredAssetTypes.length === 0);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as RecommendationBody;
    const sourceKey = body.sourceKey || body.folderPath || "";
    if (!sourceKey) return NextResponse.json({ error: "Missing sourceKey" }, { status: 400 });

    const index = await loadIndex(sourceKey);
    if (!index) {
      const status = await getIndexStatus(sourceKey);
      const error = status.needsRebuild
        ? "Knowledge index needs rebuild. Open Settings and click Build Index once, then run recommendations again."
        : "Knowledge index not found. Open Settings, choose your internal knowledge source, and build the index first.";
      return NextResponse.json({ error, indexStatus: status }, { status: status.needsRebuild ? 409 : 404 });
    }

    const areas = normalizeAreas(body.recommendationAreas);
    const profile = buildOpportunityProfile(body);
    const agentConfig: AgentConfig = {
      aiProvider: body.config?.aiProvider ?? "ollama",
      ollamaBaseUrl: body.config?.ollamaBaseUrl ?? "http://localhost:11434",
      ollamaModel: body.config?.ollamaModel,
      ollamaEmbedModel: body.config?.ollamaEmbedModel ?? index.embedModel,
      openrouterApiKey: body.config?.openrouterApiKey,
      openrouterModel: body.config?.openrouterModel,
      geminiApiKey: body.config?.geminiApiKey,
      geminiModel: body.config?.geminiModel,
      embeddingProvider: body.config?.embeddingProvider ?? "ollama",
    };

    const trace: AgentHarnessTraceEntry[] = [
      { step: "profile", tool: "opportunity_profile", query: profile, found: profile ? 1 : 0, status: profile ? "ok" : "warning" },
    ];
    const groups: RfpRecommendationGroup[] = [];

    for (const area of areas) {
      const query = fillTemplate(area.queryTemplate, profile, body);
      const chunks = await retrieveForArea(area, query, sourceKey, agentConfig);
      const cards = chunks
        .map((chunk) => ({ chunk, score: scoreChunk(chunk, area, query) }))
        .filter(({ score }) => score > 1.6)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(({ chunk, score }) => toCard(area, chunk, query, score));

      trace.push({
        step: "retrieve",
        tool: "internal_knowledge",
        query,
        found: cards.length,
        status: cards.length ? "ok" : "warning",
        note: area.name,
      });

      groups.push({
        id: area.id,
        name: area.name,
        description: area.description,
        query,
        cards,
      });
    }

    const cardCount = groups.reduce((sum, group) => sum + group.cards.length, 0);
    const warnings = [
      ...(cardCount === 0 ? ["No source-backed internal content recommendations were found."] : []),
      ...groups.filter((group) => group.cards.length === 0).map((group) => `${group.name}: no source-backed matches found`),
    ];

    return NextResponse.json({
      groups,
      generatedAt: new Date().toISOString(),
      harness: buildAgentHarnessReport({
        intent: "find_assets",
        toolsUsed: ["opportunity_profile", "internal_knowledge", "slide_search"],
        retrievedItems: cardCount,
        evidenceRefs: cardCount,
        warnings,
        agentTrace: trace,
      }),
    });
  } catch (err) {
    console.error("RFP recommendations error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
