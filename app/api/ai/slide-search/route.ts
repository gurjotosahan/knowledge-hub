import { NextRequest, NextResponse } from "next/server";
import { loadIndex } from "@/lib/rag/indexer";
import { getEmbedding, type AgentConfig } from "@/lib/rag/agent";
import { retrieve, type RetrievedChunk } from "@/lib/rag/retriever";
import { ftsSearch, fetchFileParents } from "@/lib/rag/store";
import { resolveAiConfig } from "@/lib/serverConfig";
import type { SlideSearchGroup, SlideSearchResult, SlideSearchTopicGroup } from "@/types";

export const maxDuration = 300;

interface SlideSearchBody {
  query: string;
  sourceKey?: string;
  folderPath?: string;
  aiProvider?: "ollama" | "openrouter" | "gemini";
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaEmbedModel?: string;
  openrouterModel?: string;
  geminiModel?: string;
  embeddingProvider?: "ollama" | "google";
}

interface SlideCandidate extends SlideSearchResult {
  filePath: string;
  fileTitle: string;
  rawText: string;
  deckText?: string;
}

interface AgenticSlideChoice {
  id: string;
  reason: string;
}

interface AgenticSlideResponse {
  interpretation?: string;
  choices?: AgenticSlideChoice[];
}

interface SearchProfile {
  terms: string[];
  focusTerms: string[];
  topicPhrases: string[];
  wantsCaseStudy: boolean;
  wantsMetrics: boolean;
}

const GENERIC_QUERY_TERMS = new Set([
  "a", "an", "and", "any", "are", "as", "at", "be", "by", "can", "deck", "decks",
  "do", "document", "documents", "find", "for", "from", "get", "give", "have", "i",
  "in", "is", "it", "list", "me", "of", "on", "or", "our", "ppt", "pptx", "show",
  "slide", "slides", "that", "the", "their", "this", "to", "us", "we", "what",
  "with", "you",
  // Domain-wide words: useful for embeddings, too broad for exact-match ranking.
  "ai", "genai", "gen", "apexon", "case", "cases", "study", "studies",
]);

const CASE_STUDY_MARKERS = [
  "case study", "customer story", "client:", "client |", "challenge:", "solution:",
  "outcome:", "impact:", "results:", "benefits:", "business impact", "success story",
  "reference", "proof point",
];

const METRIC_MARKERS = [
  "reduction", "reduced", "savings", "saved", "roi", "cost", "faster", "increase",
  "improved", "efficiency", "productivity", "throughput", "accuracy", "payback",
];

const DETAIL_MARKERS = [
  "what is", "overview", "at a glance", "approach", "architecture", "framework",
  "capabilities", "features", "benefits", "use case", "use cases", "workflow",
  "operating model", "implementation", "integration", "roadmap", "outcomes",
  "challenge", "solution", "impact", "how it works", "components",
];

const LOW_INFORMATION_MARKERS = [
  "agenda", "table of contents", "thank you", "appendix", "disclaimer", "confidential",
  "cover", "title", "contents",
];

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/\W+/)
        .filter((term) => term.length > 1)
    ),
  ];
}

function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(text: string, term: string): boolean {
  if (!term) return false;
  const lower = text.toLowerCase();
  const normalizedTerm = term.toLowerCase();
  if (normalizedTerm.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}([^a-z0-9]|$)`, "i").test(lower);
  }
  return lower.includes(normalizedTerm);
}

function containsPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  if (!phrase.includes(" ") && phrase.length <= 3) return containsTerm(text, phrase);
  return text.toLowerCase().includes(phrase.toLowerCase());
}

function firstMatchIndex(text: string, terms: string[]): number | undefined {
  const lower = text.toLowerCase();
  const indexes = terms
    .map((term) => {
      if (term.length <= 3 && !term.includes(" ")) {
        const match = lower.match(new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`, "i"));
        return match?.index;
      }
      return lower.indexOf(term.toLowerCase());
    })
    .filter((idx): idx is number => idx != null && idx >= 0)
    .sort((a, b) => a - b);
  return indexes[0];
}

function extractTopicText(query: string): string {
  return query
    .toLowerCase()
    .replace(/\b(show|find|get|give|list|suggest|recommend|download|export|select)\b/g, " ")
    .replace(/\b(maximum|max|top|best|relevant|detailed|detail|information|info)\b/g, " ")
    .replace(/\b(slides?|decks?|pptx?|presentation|document|documents|topic|about|on|for|around|related to)\b/g, " ")
    .replace(/\b(which|that|where|with|has|have|contains?|explain|explains?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIntentTopic(text: string): string {
  return text
    .replace(/^\s*(\d+[\).:-]?|[-•])\s*/g, "")
    .replace(/^\s*(and|also)\s+/i, "")
    .replace(/\b(show|find|get|give|list|suggest|recommend|download|export|select)\b/gi, " ")
    .replace(/\b(slides?|decks?|pptx?|presentations?|documents?|docs?)\b/gi, " ")
    .replace(/\b(on|about|around|related to|for)\b/gi, " ")
    .replace(/[.?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decomposeSearchIntents(query: string): string[] {
  const cleaned = query
    .replace(/\r/g, "\n")
    .replace(/\band\b\s+(?=(?:[^,]*,){2,})/gi, "")
    .trim();

  const hasListPunctuation = /[,;\n]/.test(cleaned);
  let parts = cleaned
    .split(/[,;\n]+/g)
    .map(normalizeIntentTopic)
    .filter(Boolean);

  if (hasListPunctuation) {
    parts = parts.flatMap((part) =>
      /\s+\band\b\s+/i.test(part)
        ? part.split(/\s+\band\b\s+/i).map(normalizeIntentTopic).filter(Boolean)
        : [part]
    );
  }

  const seen = new Set<string>();
  const intents = parts
    .filter((part) => {
      const key = compact(part);
      if (key.length < 3 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);

  return intents.length >= 2 ? intents : [query.trim()];
}

function makeSearchProfile(query: string): SearchProfile {
  const terms = queryTerms(query);
  const lower = query.toLowerCase();
  const wantsCaseStudy = /\b(case stud(?:y|ies)|customer stor(?:y|ies)|proof points?|examples?|references?|wins?)\b/.test(lower);
  const wantsMetrics = /\b(roi|saving|savings|cost|reduction|reduced|metrics?|outcomes?|impact|benefits?)\b/.test(lower);
  const focusTerms = terms.filter((term) => !GENERIC_QUERY_TERMS.has(term));
  const topicText = extractTopicText(query);
  const topicPhrases = [
    topicText,
    compact(topicText),
    focusTerms.join(" "),
    compact(focusTerms.join(" ")),
  ].filter((phrase, index, arr) => phrase.length > 1 && arr.indexOf(phrase) === index);
  return { terms, focusTerms, topicPhrases, wantsCaseStudy, wantsMetrics };
}

function countIncludes(text: string, markers: string[]): number {
  return markers.reduce((count, marker) => count + (text.includes(marker) ? 1 : 0), 0);
}

function hasMetric(text: string): boolean {
  return /(\d+(\.\d+)?\s?%|\$\s?\d+|\d+(\.\d+)?\s?(x|m|k|tb|gb|hrs?|hours?|days?|weeks?))/i.test(text);
}

function intentScore(text: string, profile: SearchProfile): number {
  let score = 0;
  const lower = text.toLowerCase();
  if (profile.wantsCaseStudy) {
    score += Math.min(countIncludes(lower, CASE_STUDY_MARKERS), 4) * 0.9;
    if (/\b(client|customer|bank|payer|provider|pharma|laboratory|cro|insurer)\b/i.test(text)) score += 0.6;
  }
  if (profile.wantsMetrics) {
    score += Math.min(countIncludes(lower, METRIC_MARKERS), 4) * 0.7;
    if (hasMetric(text)) score += 1.2;
  }
  return score;
}

function topicEvidenceScore(slideText: string, deckText: string, fileText: string, profile: SearchProfile): number {
  const slideLower = slideText.toLowerCase();
  const deckLower = deckText.toLowerCase();
  const fileLower = fileText.toLowerCase();
  const slideCompact = compact(slideText);
  const deckCompact = compact(deckText);
  const fileCompact = compact(fileText);

  let score = 0;
  for (const phrase of profile.topicPhrases) {
    const isCompactPhrase = !phrase.includes(" ");
    if (isCompactPhrase) {
      if (phrase.length <= 3) {
        if (containsTerm(slideText, phrase)) score += 4.5;
        else if (containsTerm(deckText, phrase)) score += 2;
        else if (containsTerm(fileText, phrase)) score += 1.5;
      } else if (slideCompact.includes(phrase)) score += 4.5;
      else if (deckCompact.includes(phrase)) score += 2;
      else if (fileCompact.includes(phrase)) score += 1.5;
    } else {
      if (containsPhrase(slideLower, phrase)) score += 4;
      else if (containsPhrase(deckLower, phrase)) score += 1.8;
      else if (containsPhrase(fileLower, phrase)) score += 1.2;
    }
  }

  const slideFocusHits = profile.focusTerms.filter((term) => containsTerm(slideLower, term)).length;
  const deckFocusHits = profile.focusTerms.filter((term) => containsTerm(deckLower, term) || containsTerm(fileLower, term)).length;
  score += slideFocusHits * 1.3;
  score += deckFocusHits * 0.55;
  return score;
}

function detailScore(text: string): number {
  const lower = text.toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const markerHits = Math.min(countIncludes(lower, DETAIL_MARKERS), 5);
  const metricBoost = hasMetric(text) ? 0.8 : 0;
  const structureBoost = Math.min((text.match(/[•\-–]\s|\d+\./g) ?? []).length, 8) * 0.12;
  const lowInfoPenalty = countIncludes(lower, LOW_INFORMATION_MARKERS) * 1.2;

  let score = Math.min(wordCount / 70, 2.2);
  score += markerHits * 0.45;
  score += metricBoost + structureBoost;
  score -= lowInfoPenalty;
  if (wordCount < 18) score -= 1.5;
  return score;
}

function makeExcerpt(text: string, terms: string[]): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  const lower = cleaned.toLowerCase();
  const firstHit = firstMatchIndex(lower, terms);

  const start = firstHit == null ? 0 : Math.max(0, firstHit - 80);
  const excerpt = cleaned.slice(start, start + 260);
  return `${start > 0 ? "... " : ""}${excerpt}${start + 260 < cleaned.length ? " ..." : ""}`;
}

function makeReason(candidate: SlideCandidate, profile: SearchProfile): string {
  const slideText = candidate.rawText.toLowerCase();
  const deckText = (candidate.deckText ?? "").toLowerCase();
  const slideMatches = profile.focusTerms.filter((term) => containsTerm(slideText, term)).slice(0, 3);
  const deckMatches = profile.focusTerms
    .filter((term) => !containsTerm(slideText, term) && containsTerm(deckText, term))
    .slice(0, 3);

  const depth = detailScore(candidate.rawText);

  if (profile.wantsCaseStudy && profile.wantsMetrics && intentScore(candidate.rawText, profile) > 1) {
    return "Looks like a case-study or proof-point slide with measurable outcome language.";
  }
  if (profile.wantsCaseStudy && intentScore(candidate.rawText, profile) > 0) {
    return "Looks like a case-study or client proof slide.";
  }
  if (depth >= 2.2) {
    return "Detailed topic slide with explanatory content.";
  }
  if (deckMatches.length > 0 && slideMatches.length > 0) {
    return `Deck context supports ${deckMatches.join(", ")}; slide explains ${slideMatches.join(", ")}.`;
  }
  if (deckMatches.length > 0) {
    return `Deck context supports ${deckMatches.join(", ")}.`;
  }
  if (slideMatches.length > 0) {
    return `Slide explains ${slideMatches.join(", ")}.`;
  }
  return "Relevant topic slide based on semantic similarity and deck context.";
}

async function addDeckContext(candidates: SlideCandidate[], sourceKey: string): Promise<SlideCandidate[]> {
  const filePaths = [...new Set(candidates.map((candidate) => candidate.filePath))];
  const contextEntries = await Promise.all(
    filePaths.map(async (filePath) => {
      const parents = await fetchFileParents(sourceKey, filePath).catch(() => []);
      const deckText = parents
        .sort((a, b) => a.page - b.page || a.chunkIndex - b.chunkIndex)
        .map((chunk) => chunk.text)
        .join(" ")
        .slice(0, 20_000);
      return [filePath, deckText] as const;
    })
  );
  const deckTextByPath = new Map(contextEntries);
  return candidates.map((candidate) => ({
    ...candidate,
    deckText: deckTextByPath.get(candidate.filePath) ?? "",
  }));
}

function rescoreCandidate(candidate: SlideCandidate, profile: SearchProfile): SlideCandidate {
  const slideText = candidate.rawText.toLowerCase();
  const deckText = (candidate.deckText ?? "").toLowerCase();
  const fileText = `${candidate.fileTitle} ${candidate.filePath}`.toLowerCase();
  const combinedDeckText = `${deckText} ${fileText}`;

  const slideFocusHits = profile.focusTerms.filter((term) => containsTerm(slideText, term)).length;
  const deckFocusHits = profile.focusTerms.filter((term) => containsTerm(combinedDeckText, term)).length;
  const topicScore = topicEvidenceScore(candidate.rawText, candidate.deckText ?? "", fileText, profile);
  const genericHits = profile.terms
    .filter((term) => GENERIC_QUERY_TERMS.has(term))
    .filter((term) => containsTerm(slideText, term) || containsTerm(combinedDeckText, term)).length;

  const slideIntent = intentScore(candidate.rawText, profile);
  const deckIntent = intentScore(combinedDeckText, profile) * 0.35;
  const depth = detailScore(candidate.rawText);
  const focusRequired = profile.focusTerms.length > 0;
  const hasFocusContext = slideFocusHits > 0 || deckFocusHits > 0 || topicScore > 0;

  let score = (candidate.score ?? 0) * 0.35;
  score += topicScore;
  score += slideFocusHits * 0.9;
  score += deckFocusHits * 0.35;
  score += Math.min(genericHits, 3) * 0.04;
  score += depth * 1.3;
  score += slideIntent + deckIntent;

  if (focusRequired && !hasFocusContext) score = -10;
  if (depth < 0.8) score -= 2;
  if (profile.wantsCaseStudy && slideIntent === 0) score -= 2.2;
  if (profile.wantsMetrics && !hasMetric(candidate.rawText)) score -= 0.8;

  return {
    ...candidate,
    score,
    reason: makeReason(candidate, profile),
    excerpt: makeExcerpt(
      candidate.rawText,
      profile.topicPhrases.length ? profile.topicPhrases : profile.focusTerms.length ? profile.focusTerms : profile.terms
    ),
  };
}

async function toSlideCandidates(chunks: RetrievedChunk[], query: string, sourceKey: string): Promise<SlideCandidate[]> {
  const profile = makeSearchProfile(query);
  const bySlide = new Map<string, SlideCandidate>();

  for (const chunk of chunks) {
    if (chunk.fileType !== "pptx" || !chunk.filePath || !chunk.page) continue;

    const key = `${chunk.filePath}::${chunk.page}`;
    const candidate: SlideCandidate = {
      filePath: chunk.filePath,
      fileTitle: chunk.fileName.replace(/\.pptx$/i, ""),
      slideNumber: chunk.page,
      reason: "",
      excerpt: "",
      score: chunk.score,
      rawText: chunk.text,
    };

    const existing = bySlide.get(key);
    if (!existing || (candidate.score ?? 0) > (existing.score ?? 0)) {
      bySlide.set(key, candidate);
    }
  }

  const withDeckContext = await addDeckContext([...bySlide.values()], sourceKey);
  return withDeckContext
    .map((candidate) => rescoreCandidate(candidate, profile))
    .filter((candidate) => (candidate.score ?? 0) > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function confidenceForScore(score = 0): "High" | "Medium" | "Low" {
  if (score >= 7) return "High";
  if (score >= 3.5) return "Medium";
  return "Low";
}

function groupCandidates(candidates: SlideCandidate[], maxCandidates = 10): SlideSearchGroup[] {
  const groups = new Map<string, SlideSearchGroup>();
  const topCandidates = candidates.slice(0, maxCandidates);

  for (const candidate of topCandidates) {
    if (!groups.has(candidate.filePath)) {
      groups.set(candidate.filePath, {
        filePath: candidate.filePath,
        fileTitle: candidate.fileTitle,
        fileType: "pptx",
        slides: [],
      });
    }

    groups.get(candidate.filePath)!.slides.push({
      slideNumber: candidate.slideNumber,
      reason: candidate.reason,
      excerpt: candidate.excerpt,
      score: candidate.score,
      confidence: confidenceForScore(candidate.score),
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      slides: group.slides.sort((a, b) => a.slideNumber - b.slideNumber),
    }));
}

function candidateId(candidate: SlideCandidate): string {
  return `${candidate.filePath}::${candidate.slideNumber}`;
}

function truncateForPrompt(text: string, max = 900): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max)}...`;
}

function canUseReasoningModel(config: AgentConfig): boolean {
  if (config.aiProvider === "ollama") return Boolean(config.ollamaModel);
  if (config.aiProvider === "openrouter") return Boolean(config.openrouterApiKey && config.openrouterModel);
  if (config.aiProvider === "gemini") return Boolean(config.geminiApiKey && config.geminiModel);
  return false;
}

async function callReasoningJson(prompt: string, config: AgentConfig, maxChoices = 10): Promise<AgenticSlideResponse | null> {
  const system = `You are a slide-finder agent for a sales knowledge hub.
Choose slides that actually answer the user's topic, not slides that merely contain matching words.

Rules:
- Return only valid JSON.
- Select only the slides that are genuinely useful. This can be 1 slide, 3 slides, 10 slides, or none.
- Do not pad the result list. A single excellent slide is better than several weak slides.
- Select at most ${maxChoices} slides.
- Prefer slides with detailed information: overview, approach, capabilities, architecture, workflow, challenge/solution/outcome, metrics, or proof points.
- Reject cover, agenda, divider, appendix, disclaimer, and low-information slides.
- For acronym topics like EV, S&P, SOM, or CoE, the acronym must be present as a real token in the slide, deck title, or deck context.
- For "case study" queries, select only real customer/client proof slides with challenge, solution, outcome, or comparable evidence.
- If none are genuinely relevant, return an empty choices array.

JSON shape:
{
  "interpretation": "short explanation of what the user is asking for",
  "choices": [
    {"id": "candidate id", "reason": "why this slide answers the topic"}
  ]
}`;

  if (config.aiProvider === "ollama") {
    const res = await fetch(`${config.ollamaBaseUrl ?? "http://localhost:11434"}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        stream: false,
        format: "json",
        options: { temperature: 0, num_predict: 1400 },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return JSON.parse(data.message?.content ?? "{}") as AgenticSlideResponse;
  }

  const [url, auth, model] = config.aiProvider === "gemini"
    ? [
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        `Bearer ${config.geminiApiKey}`,
        config.geminiModel,
      ]
    : [
        "https://openrouter.ai/api/v1/chat/completions",
        `Bearer ${config.openrouterApiKey}`,
        config.openrouterModel,
      ];

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
      ...(config.aiProvider === "openrouter" && {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Apexon Knowledge Hub",
      }),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      max_tokens: 1400,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as AgenticSlideResponse;
}

async function agenticRerankSlides(
  query: string,
  candidates: SlideCandidate[],
  config: AgentConfig,
  maxChoices = 10
): Promise<SlideCandidate[]> {
  if (!canUseReasoningModel(config) || candidates.length === 0) return candidates.slice(0, maxChoices);

  const candidatePayload = candidates.slice(0, 30).map((candidate) => ({
    id: candidateId(candidate),
    deck: candidate.fileTitle,
    slide: candidate.slideNumber,
    deterministicScore: Number((candidate.score ?? 0).toFixed(2)),
    currentReason: candidate.reason,
    slideText: truncateForPrompt(candidate.rawText),
    deckContext: truncateForPrompt(candidate.deckText ?? "", 500),
  }));

  const prompt = `User request: ${query}

Candidate slides:
${JSON.stringify(candidatePayload, null, 2)}

Choose the slides that best answer the user's request. Return only the JSON object.`;

  const response = await callReasoningJson(prompt, config, maxChoices).catch(() => null);
  const choices = response?.choices?.slice(0, maxChoices) ?? [];
  if (choices.length === 0 && response) return [];
  if (choices.length === 0) return candidates.slice(0, Math.min(3, maxChoices));

  const byId = new Map(candidates.map((candidate) => [candidateId(candidate), candidate]));
  const selected: SlideCandidate[] = [];
  for (const choice of choices) {
    const candidate = byId.get(choice.id);
    if (!candidate) continue;
    selected.push({
      ...candidate,
      reason: choice.reason || candidate.reason,
    });
  }

  return selected;
}

async function exactTopicChunks(sourceKey: string, profile: SearchProfile): Promise<RetrievedChunk[]> {
  if (profile.focusTerms.length === 0) return [];
  const ftsQuery = profile.focusTerms.join(" ");
  const chunks = await ftsSearch(sourceKey, ftsQuery, 120).catch(() => []);
  return chunks
    .filter((chunk) => chunk.fileType === "pptx")
    .map((chunk) => ({ ...chunk, score: (chunk as RetrievedChunk).score ?? 0.8 }));
}

async function searchSlidesForTopic(
  topic: string,
  sourceKey: string,
  agentConfig: AgentConfig,
  maxResults: number
): Promise<SlideCandidate[]> {
  const queryEmbedding = await getEmbedding(topic, agentConfig).catch(() => null);
  const profile = makeSearchProfile(topic);
  const [retrievedChunks, exactChunks] = await Promise.all([
    retrieve(topic, queryEmbedding, sourceKey, 80).catch(() => [] as RetrievedChunk[]),
    exactTopicChunks(sourceKey, profile),
  ]);
  const chunks = [...new Map([...exactChunks, ...retrievedChunks].map((chunk) => [chunk.id, chunk])).values()];
  const candidates = (await toSlideCandidates(chunks, topic, sourceKey)).slice(0, 24);
  return agenticRerankSlides(topic, candidates, agentConfig, maxResults);
}

function topicId(topic: string, index: number): string {
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return slug || `topic-${index + 1}`;
}

function makeTopicGroup(topic: string, index: number, candidates: SlideCandidate[], maxResults: number): SlideSearchTopicGroup {
  const groups = groupCandidates(candidates, maxResults);
  return {
    id: topicId(topic, index),
    topic,
    groups,
    resultCount: groups.reduce((sum, group) => sum + group.slides.length, 0),
  };
}

export async function POST(req: NextRequest) {
  let body: SlideSearchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = body.query?.trim();
  const sourceKey = body.sourceKey ?? body.folderPath ?? "";
  if (!query || !sourceKey) {
    return NextResponse.json({ error: "Missing query or sourceKey" }, { status: 400 });
  }

  const indexMeta = await loadIndex(sourceKey);
  if (!indexMeta) {
    return NextResponse.json(
      { error: "No search index found. Open Settings and click Build Index first." },
      { status: 404 }
    );
  }

  const agentConfig: AgentConfig = resolveAiConfig({
    ...body,
    ollamaEmbedModel: body.ollamaEmbedModel ?? indexMeta.embedModel,
  });

  const topics = decomposeSearchIntents(query);
  const multiTopic = topics.length > 1;
  const perTopicLimit = multiTopic ? 3 : 10;
  const topicCandidates = await Promise.all(
    topics.map((topic) => searchSlidesForTopic(topic, sourceKey, agentConfig, perTopicLimit))
  );
  const topicGroups = topicCandidates
    .map((candidates, index) => makeTopicGroup(topics[index], index, candidates, perTopicLimit))
    .filter((group) => group.resultCount > 0);
  const selectedCandidates = topicCandidates.flat().slice(0, 30);

  return NextResponse.json({
    topics,
    topicGroups,
    groups: groupCandidates(selectedCandidates, multiTopic ? 30 : 10),
  });
}
