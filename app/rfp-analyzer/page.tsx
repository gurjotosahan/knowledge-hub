"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { DEFAULT_CONFIG, type AgentHarnessReport, type AppConfig } from "@/types";
import {
  RFP_ANALYSIS_SECTIONS,
  RFP_RECOMMENDATION_AREAS,
  RFP_RECOMMENDATION_AREAS_STORAGE_KEY,
  RFP_SECTIONS_STORAGE_KEY,
} from "@/types/rfp";
import type {
  RfpAnalysisSectionDef,
  RfpRecommendationAreaDef,
  RfpRecommendationGroup,
} from "@/types/rfp";

interface UploadedFile {
  name: string;
  size: number;
  type: string;
}

interface WorkspaceDocument {
  id: string;
  name: string;
  kind: "Primary RFP" | "Transcript" | "Addendum" | "Pricing" | "Notes" | "Other";
  size: number;
  text: string;
  addedAt: string;
}

interface AnalysisSection {
  id: string;
  name: string;
  status: "pending" | "in_progress" | "completed";
  content?: string;
  fallback?: boolean;
  warning?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface HarnessSectionRun {
  id: string;
  name: string;
  status: "completed" | "fallback" | "failed";
  attempts: string[];
  retrievedChunks: number;
  evidenceRefs: number;
  usedFallback: boolean;
  warning?: string;
  durationMs: number;
}

interface HarnessReport {
  status: "pass" | "review" | "fail";
  summary: string;
  chunkCount: number;
  selectedSectionCount: number;
  fallbackCount: number;
  sectionsWithoutEvidence: string[];
  warnings: string[];
  sectionRuns: HarnessSectionRun[];
}

interface PursuitMemory {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  file: UploadedFile | null;
  fileContent: string;
  pasteText: string;
  workspaceDocs: WorkspaceDocument[];
  selectedSectionIds: string[];
  sections: AnalysisSection[];
  finalContent: Record<string, string>;
  harnessReport: HarnessReport | null;
  recommendations: RfpRecommendationGroup[];
  recommendationHarness: AgentHarnessReport | null;
  recommendationsGeneratedAt: string;
  chatMessages: ChatMessage[];
  llmUsed: string;
}

const PURSUIT_MEMORY_STORAGE_KEY = "apexon-hub-rfp-pursuit-memory";
const MAX_PURSUIT_MEMORIES = 25;

function loadRfpSections(): RfpAnalysisSectionDef[] {
  if (typeof window === "undefined") return RFP_ANALYSIS_SECTIONS;
  try {
    const raw = localStorage.getItem(RFP_SECTIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as RfpAnalysisSectionDef[] : null;
    if (!Array.isArray(parsed) || !parsed.length) return RFP_ANALYSIS_SECTIONS;
    const defaultsById = new Map(RFP_ANALYSIS_SECTIONS.map((section) => [section.id, section]));
    return parsed.map((section) => {
      const defaults = defaultsById.get(section.id);
      return {
        ...defaults,
        ...section,
        name: section.name || defaults?.name || "RFP Analysis Area",
        description: section.description || defaults?.description || "Describe what this section should analyze",
        query: section.query || defaults?.query || "requirements scope risk evaluation",
        categories: Array.isArray(section.categories) && section.categories.length ? section.categories : defaults?.categories || ["Project Overview"],
        prompt: section.prompt || defaults?.prompt || "Describe the output this RFP analysis section should produce.",
      };
    });
  } catch {
    return RFP_ANALYSIS_SECTIONS;
  }
}

function loadRfpRecommendationAreas(): RfpRecommendationAreaDef[] {
  if (typeof window === "undefined") return RFP_RECOMMENDATION_AREAS;
  try {
    const raw = localStorage.getItem(RFP_RECOMMENDATION_AREAS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as RfpRecommendationAreaDef[] : null;
    if (!Array.isArray(parsed) || !parsed.length) return RFP_RECOMMENDATION_AREAS;
    const defaultsById = new Map(RFP_RECOMMENDATION_AREAS.map((area) => [area.id, area]));
    return parsed.map((area) => {
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
    });
  } catch {
    return RFP_RECOMMENDATION_AREAS;
  }
}

function loadPursuitMemories(): PursuitMemory[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PURSUIT_MEMORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as PursuitMemory[] : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(memory => memory && typeof memory.id === "string" && typeof memory.name === "string")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, MAX_PURSUIT_MEMORIES);
  } catch {
    return [];
  }
}

function savePursuitMemories(memories: PursuitMemory[]): { ok: true } | { ok: false; error: string } {
  if (typeof window === "undefined") return { ok: true };
  try {
    const ordered = memories
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, MAX_PURSUIT_MEMORIES);
    localStorage.setItem(PURSUIT_MEMORY_STORAGE_KEY, JSON.stringify(ordered));
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Unable to save pursuit memory. Browser storage may be full because the workspace documents are large.",
    };
  }
}

function toAnalysisSections(defs: RfpAnalysisSectionDef[]): AnalysisSection[] {
  return defs.map((section) => ({ id: section.id, name: section.name, status: "pending" }));
}

const PROGRESS_STEPS = [
  "Extracting document content",
  "Identifying opportunity context",
  "Extracting scope and requirements",
  "Detecting mandatory items and submission instructions",
  "Analyzing evaluation criteria",
  "Identifying risks and clarification questions",
  "Generating response strategy",
  "Creating opportunity intelligence brief",
];

const SUGGESTED_QUESTIONS = [
  "Summarize this RFP in 5 bullets",
  "What are the mandatory requirements?",
  "What is unclear?",
  "Generate clarification questions",
  "Create requirement matrix",
  "What should the response storyline be?",
  "What are the top risks?",
  "Create proposal outline",
  "Create submission checklist",
];

const RECOMMENDED_SECTION_IDS = [
  "executive_brief",
  "opportunity_snapshot",
  "scope_intelligence",
  "requirement_intelligence",
  "mandatory_items",
  "risks_assumptions",
  "response_strategy",
];

const ANALYSIS_GROUPS: { label: string; sectionIds: string[] }[] = [
  { label: "Opportunity", sectionIds: ["executive_brief", "opportunity_snapshot", "client_objective", "pain_points"] },
  { label: "Requirements", sectionIds: ["scope_intelligence", "requirement_intelligence", "mandatory_items", "evaluation_criteria"] },
  { label: "Proposal Ops", sectionIds: ["submission_intelligence", "commercial_intelligence", "delivery_governance"] },
  { label: "Solution & Risk", sectionIds: ["technical_intelligence", "security_compliance", "risks_assumptions", "clarification_questions", "response_strategy"] },
];

function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-strong-${index}`} className="font-semibold text-slate-800">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={`${keyPrefix}-text-${index}`}>{part}</React.Fragment>;
  });
}

function parseMarkdownTable(lines: string[], startIndex: number): { rows: string[][]; nextIndex: number; hasHeader: boolean } {
  const rows: string[][] = [];
  let index = startIndex;
  let hasHeader = false;

  while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
    const cells = lines[index]
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map(cell => cell.trim());

    const isSeparator = cells.every(cell => /^:?-{3,}:?$/.test(cell));
    if (isSeparator) {
      hasHeader = rows.length === 1;
      index += 1;
      continue;
    }

    rows.push(cells);
    index += 1;
  }

  return { rows, nextIndex: index, hasHeader };
}

function stripMarkdownFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function humanizeMarkdownKey(key: string): string {
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

function jsonRowsToMarkdownTable(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "Not specified";
  const preferredKeys = ["category", "requirement", "mandatory_optional_unclear", "priority", "evidence", "response_implication"];
  const allKeys = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
  const keys = [...preferredKeys.filter(key => allKeys.includes(key)), ...allKeys.filter(key => !preferredKeys.includes(key))].slice(0, 7);
  const header = `| ${keys.map(humanizeMarkdownKey).join(" | ")} |`;
  const separator = `| ${keys.map(() => "---").join(" | ")} |`;
  const body = rows.map(row => `| ${keys.map(key => String(row[key] ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").trim()).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function normalizeRenderableMarkdown(content: string): string {
  const stripped = stripMarkdownFences(content);
  try {
    const parsed = JSON.parse(stripped);
    const matrix = parsed.requirement_matrix || parsed.requirements || parsed.items;
    if (Array.isArray(matrix) && matrix.every(item => item && typeof item === "object" && !Array.isArray(item))) {
      return jsonRowsToMarkdownTable(matrix as Record<string, unknown>[]);
    }
    return Object.entries(parsed as Record<string, unknown>)
      .map(([key, value]) => {
        if (Array.isArray(value) && value.every(item => item && typeof item === "object" && !Array.isArray(item))) {
          return `### ${humanizeMarkdownKey(key)}\n\n${jsonRowsToMarkdownTable(value as Record<string, unknown>[])}`;
        }
        return `**${humanizeMarkdownKey(key)}:** ${Array.isArray(value) ? value.join(", ") : String(value ?? "Not specified")}`;
      })
      .join("\n\n");
  } catch {
    return stripped;
  }
}

function renderMarkdownContent(content: string, options: { preview?: boolean } = {}): React.ReactNode[] {
  const rawLines = normalizeRenderableMarkdown(content).split("\n");
  const lines = options.preview ? rawLines.slice(0, 18) : rawLines;
  const nodes: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const key = `md-${index}`;

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      const table = parseMarkdownTable(lines, index);
      nodes.push(
        <div key={key} className="my-4 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <tbody className="divide-y divide-slate-100">
              {table.rows.map((row, rowIndex) => {
                const isHeader = table.hasHeader && rowIndex === 0;
                return (
                  <tr key={`${key}-row-${rowIndex}`} className={isHeader ? "bg-slate-50" : "bg-white"}>
                    {row.map((cell, cellIndex) => {
                      const Cell = isHeader ? "th" : "td";
                      return (
                        <Cell
                          key={`${key}-cell-${rowIndex}-${cellIndex}`}
                          className={`px-3 py-2 align-top ${isHeader ? "font-semibold text-slate-800" : "text-slate-600"}`}
                        >
                          {renderInlineMarkdown(cell, `${key}-${rowIndex}-${cellIndex}`)}
                        </Cell>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
      index = table.nextIndex;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{2,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      nodes.push(
        <h4
          key={key}
          className={`${level === 2 ? "mt-5 text-base" : "mt-4 text-sm"} mb-2 font-semibold text-slate-900`}
        >
          {renderInlineMarkdown(headingText, key)}
        </h4>
      );
      index += 1;
      continue;
    }

    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      nodes.push(
        <div key={key} className="my-3 flex gap-3 text-slate-700">
          <span className="mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
            {numberedMatch[1]}
          </span>
          <p className="leading-7">{renderInlineMarkdown(numberedMatch[2], key)}</p>
        </div>
      );
      index += 1;
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      nodes.push(
        <div key={key} className="my-2 flex gap-3 text-slate-700">
          <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
          <p className="leading-7">{renderInlineMarkdown(bulletMatch[1], key)}</p>
        </div>
      );
      index += 1;
      continue;
    }

    nodes.push(
      <p key={key} className="my-3 leading-7 text-slate-700">
        {renderInlineMarkdown(trimmed, key)}
      </p>
    );
    index += 1;
  }

  return nodes;
}

export default function RFPAnalyzerPage() {
  const [view, setView] = useState<"upload" | "analyzing" | "results">("upload");
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [pasteText, setPasteText] = useState("");
  const [isExtractingFile, setIsExtractingFile] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [rfpSections, setRfpSections] = useState<RfpAnalysisSectionDef[]>(() => loadRfpSections());
  const [recommendationAreas, setRecommendationAreas] = useState<RfpRecommendationAreaDef[]>(() => loadRfpRecommendationAreas());
  const [sections, setSections] = useState<AnalysisSection[]>(() => toAnalysisSections(loadRfpSections()));
  const [finalContent, setFinalContent] = useState<Record<string, string>>({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedSectionIds, setSelectedSectionIds] = useState<Set<string>>(() => new Set(RECOMMENDED_SECTION_IDS));
  const [analysisLog, setAnalysisLog] = useState<string[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [workspaceName, setWorkspaceName] = useState<string>("");
  const [workspaceDocs, setWorkspaceDocs] = useState<WorkspaceDocument[]>([]);
  const [isAddingWorkspaceDoc, setIsAddingWorkspaceDoc] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [llmUsed, setLlmUsed] = useState<string>("");
  const [harnessReport, setHarnessReport] = useState<HarnessReport | null>(null);
  const [recommendations, setRecommendations] = useState<RfpRecommendationGroup[]>([]);
  const [recommendationHarness, setRecommendationHarness] = useState<AgentHarnessReport | null>(null);
  const [recommendationsGeneratedAt, setRecommendationsGeneratedAt] = useState("");
  const [isFindingRecommendations, setIsFindingRecommendations] = useState(false);
  const [recommendationError, setRecommendationError] = useState("");
  const [pursuitMemories, setPursuitMemories] = useState<PursuitMemory[]>(() => loadPursuitMemories());
  const [memoryError, setMemoryError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const resultsRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const refreshRfpSections = () => {
      const next = loadRfpSections();
      setRfpSections(next);
      setSections((prev) => {
        const prevById = new Map(prev.map((section) => [section.id, section]));
        return next.map((section) => ({
          ...prevById.get(section.id),
          id: section.id,
          name: section.name,
          status: prevById.get(section.id)?.status || "pending",
        }));
      });
      setSelectedSectionIds((prev) => {
        const validIds = new Set(next.map((section) => section.id));
        const kept = [...prev].filter((id) => validIds.has(id));
        if (kept.length) return new Set(kept);
        const recommended = RECOMMENDED_SECTION_IDS.filter((id) => validIds.has(id));
        return new Set(recommended.length ? recommended : next.map((section) => section.id));
      });
    };

    window.addEventListener("rfp-sections-updated", refreshRfpSections);
    refreshRfpSections();
    return () => window.removeEventListener("rfp-sections-updated", refreshRfpSections);
  }, []);

  useEffect(() => {
    const refreshRecommendationAreas = () => setRecommendationAreas(loadRfpRecommendationAreas());
    window.addEventListener("rfp-recommendation-areas-updated", refreshRecommendationAreas);
    refreshRecommendationAreas();
    return () => window.removeEventListener("rfp-recommendation-areas-updated", refreshRecommendationAreas);
  }, []);

  useEffect(() => {
    if (view === "results" && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [view, finalContent]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages]);

  const buildCurrentMemory = useCallback((overrides: Partial<PursuitMemory> = {}): PursuitMemory => {
    const now = new Date().toISOString();
    const existing = workspaceId ? loadPursuitMemories().find(memory => memory.id === workspaceId) : undefined;
    const id = overrides.id || workspaceId || `opp-${Date.now()}`;
    const name = (overrides.name || workspaceName || file?.name?.replace(/\.[^.]+$/, "") || "RFP Workspace").trim();

    return {
      id,
      name,
      createdAt: overrides.createdAt || existing?.createdAt || now,
      updatedAt: now,
      file,
      fileContent,
      pasteText,
      workspaceDocs,
      selectedSectionIds: [...selectedSectionIds],
      sections,
      finalContent,
      harnessReport,
      recommendations,
      recommendationHarness,
      recommendationsGeneratedAt,
      chatMessages,
      llmUsed,
      ...overrides,
    };
  }, [
    chatMessages,
    file,
    fileContent,
    finalContent,
    harnessReport,
    llmUsed,
    pasteText,
    recommendationHarness,
    recommendations,
    recommendationsGeneratedAt,
    sections,
    selectedSectionIds,
    workspaceDocs,
    workspaceId,
    workspaceName,
  ]);

  const persistPursuitMemory = useCallback((memory: PursuitMemory) => {
    const existing = loadPursuitMemories();
    const next = [memory, ...existing.filter(item => item.id !== memory.id)];
    const result = savePursuitMemories(next);
    if (!result.ok) {
      setMemoryError(result.error);
      return false;
    }
    setPursuitMemories(loadPursuitMemories());
    setMemoryError("");
    setLastSavedAt(memory.updatedAt);
    return true;
  }, []);

  const saveCurrentPursuitMemory = useCallback(() => {
    const memory = buildCurrentMemory();
    setWorkspaceId(memory.id);
    setWorkspaceName(memory.name);
    return persistPursuitMemory(memory);
  }, [buildCurrentMemory, persistPursuitMemory]);

  const openPursuitMemory = (memory: PursuitMemory) => {
    setWorkspaceId(memory.id);
    setWorkspaceName(memory.name);
    setFile(memory.file);
    setFileContent(memory.fileContent || "");
    setPasteText(memory.pasteText || "");
    setWorkspaceDocs(memory.workspaceDocs || []);
    setSelectedSectionIds(new Set(memory.selectedSectionIds || RECOMMENDED_SECTION_IDS));
    setSections(memory.sections?.length ? memory.sections : toAnalysisSections(rfpSections));
    setFinalContent(memory.finalContent || {});
    setHarnessReport(memory.harnessReport || null);
    setRecommendations(memory.recommendations || []);
    setRecommendationHarness(memory.recommendationHarness || null);
    setRecommendationsGeneratedAt(memory.recommendationsGeneratedAt || "");
    setRecommendationError("");
    setChatMessages(memory.chatMessages || []);
    setLlmUsed(memory.llmUsed || "");
    setAnalysisLog([]);
    setMemoryError("");
    setLastSavedAt(memory.updatedAt);
    setView(Object.keys(memory.finalContent || {}).length ? "results" : "upload");
  };

  const deletePursuitMemory = (id: string) => {
    const next = pursuitMemories.filter(memory => memory.id !== id);
    const result = savePursuitMemories(next);
    if (!result.ok) {
      setMemoryError(result.error);
      return;
    }
    setPursuitMemories(loadPursuitMemories());
    if (workspaceId === id) {
      setLastSavedAt("");
    }
  };

  const resetToNewPursuit = () => {
    setView("upload");
    setFile(null);
    setFileContent("");
    setPasteText("");
    setIsExtractingFile(false);
    setIsAnalyzing(false);
    setProgressStep(0);
    setSections(toAnalysisSections(rfpSections));
    setFinalContent({});
    setIsStreaming(false);
    setAnalysisLog([]);
    setWorkspaceId("");
    setWorkspaceName("");
    setWorkspaceDocs([]);
    setChatMessages([]);
    setChatInput("");
    setIsChatLoading(false);
    setLlmUsed("");
    setHarnessReport(null);
    setRecommendations([]);
    setRecommendationHarness(null);
    setRecommendationsGeneratedAt("");
    setRecommendationError("");
    setIsFindingRecommendations(false);
    setMemoryError("");
    setLastSavedAt("");
  };

  useEffect(() => {
    if (!workspaceId || workspaceDocs.length === 0) return;
    const timeout = window.setTimeout(() => {
      persistPursuitMemory(buildCurrentMemory());
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [
    buildCurrentMemory,
    chatMessages,
    finalContent,
    harnessReport,
    llmUsed,
    persistPursuitMemory,
    recommendationHarness,
    recommendations,
    recommendationsGeneratedAt,
    selectedSectionIds,
    sections,
    workspaceDocs,
    workspaceId,
    workspaceName,
  ]);

  const extractFileText = async (selectedFile: File): Promise<string> => {
    const ext = selectedFile.name.split(".").pop()?.toLowerCase();
    const allowedExts = ["pdf", "docx", "pptx", "txt", "md", "markdown"];
    
    if (!ext || !allowedExts.includes(ext)) {
      throw new Error("Unsupported file type. Please upload PDF, DOCX, PPTX, TXT, or Markdown files.");
    }

    if (["txt", "md", "markdown"].includes(ext)) {
      return selectedFile.text();
    }

    const formData = new FormData();
    formData.append("file", selectedFile);

    const res = await fetch("/api/local/extract-rfp", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Unable to extract text from this file. Please try another file or paste the content.");
    }

    const data = await res.json();
    return data.text || "";
  };

  const inferDocumentKind = (name: string): WorkspaceDocument["kind"] => {
    const lower = name.toLowerCase();
    if (lower.includes("transcript") || lower.includes("meeting")) return "Transcript";
    if (lower.includes("addendum") || lower.includes("clarification") || lower.includes("q&a")) return "Addendum";
    if (lower.includes("price") || lower.includes("pricing") || lower.includes("commercial")) return "Pricing";
    if (lower.includes("note")) return "Notes";
    return "Other";
  };

  const handleFileSelect = async (selectedFile: File) => {
    setFile({
      name: selectedFile.name,
      size: selectedFile.size,
      type: selectedFile.type,
    });
    setFileContent("");

    setIsExtractingFile(true);
    try {
      setFileContent(await extractFileText(selectedFile));
    } catch (err) {
      alert(String(err instanceof Error ? err.message : err));
      setFile(null);
    } finally {
      setIsExtractingFile(false);
    }
  };

  const getStoredConfig = (): AppConfig => {
    try {
      const stored = localStorage.getItem("apexon-hub-config");
      if (stored) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
      }
    } catch {}
    return DEFAULT_CONFIG;
  };

  const sourceKeyFromConfig = (config: AppConfig): string => {
    if (config.sourceType === "sharepoint") return `graph:${config.graphDriveId || "mock-drive-documents"}`;
    if (config.sourceType === "onedrive") return "onedrive:me";
    return config.folderPath;
  };

  const getFallbackContent = (sectionId: string): string => {
    const section = rfpSections.find(item => item.id === sectionId);
    return `## ${section?.name || "Analysis Area"}

**Analysis unavailable:** The AI analysis request did not complete, so this section is not a valid final intelligence output.

**Next action:** Retry the analysis or check the configured model/API key. The app will no longer substitute a generic proposal template as if it were an RFP-specific answer.`;
  };

  const generateFallbackResults = async (_text: string, selectedSections?: AnalysisSection[]) => {
    setIsStreaming(true);
    const targetSections = selectedSections?.length ? selectedSections : toAnalysisSections(rfpSections).filter(section => selectedSectionIds.has(section.id));
    const sectionIds = targetSections.map(s => s.id);
    
    for (let i = 0; i < sectionIds.length; i++) {
      const sectionId = sectionIds[i];
      setSections(prev => prev.map(s => 
        s.id === sectionId ? { ...s, status: "in_progress" } : s
      ));
      
      await new Promise(resolve => setTimeout(resolve, 400));
      
      const content = getFallbackContent(sectionId);
      setFinalContent(prev => ({ ...prev, [sectionId]: content }));
      setSections(prev => prev.map(s => 
        s.id === sectionId
          ? { ...s, status: "completed", content, fallback: true, warning: "Client-side fallback used after the analysis request failed." }
          : s
      ));
    }
    
    setHarnessReport({
      status: "review",
      summary: "Client-side fallback was used because the analysis request failed before the server harness could complete.",
      chunkCount: 0,
      selectedSectionCount: targetSections.length,
      fallbackCount: targetSections.length,
      sectionsWithoutEvidence: [],
      warnings: ["Analysis request failed before server-side harness checks completed."],
      sectionRuns: targetSections.map((section) => ({
        id: section.id,
        name: section.name,
        status: "fallback",
        attempts: ["client-side fallback"],
        retrievedChunks: 0,
        evidenceRefs: 0,
        usedFallback: true,
        warning: "Client-side fallback used after analysis request failure.",
        durationMs: 0,
      })),
    });
    setIsStreaming(false);
    setView("results");
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, []);

  const toggleAnalysisSection = (id: string) => {
    setSelectedSectionIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllSections = () => {
    setSelectedSectionIds(new Set(rfpSections.map(section => section.id)));
  };

  const selectRecommendedSections = () => {
    setSelectedSectionIds(new Set(RECOMMENDED_SECTION_IDS));
  };

  const ensureWorkspace = (primaryText: string): WorkspaceDocument[] => {
    const now = new Date().toISOString();
    const nextWorkspaceId = workspaceId || `opp-${Date.now()}`;
    const primaryName = file?.name || "Pasted RFP";
    const existingSupportingDocs = workspaceDocs.filter(doc => doc.kind !== "Primary RFP");
    const primaryDoc: WorkspaceDocument = {
      id: `primary-${Date.now()}`,
      name: primaryName,
      kind: "Primary RFP",
      size: primaryText.length,
      text: primaryText,
      addedAt: now,
    };
    const docs = [primaryDoc, ...existingSupportingDocs];
    setWorkspaceId(nextWorkspaceId);
    setWorkspaceName(prev => prev || primaryName.replace(/\.[^.]+$/, ""));
    setWorkspaceDocs(docs);
    return docs;
  };

  const buildWorkspaceText = (docs: WorkspaceDocument[]): string => {
    return docs
      .map(doc => `# ${doc.kind}: ${doc.name}\n\n${doc.text}`)
      .join("\n\n--- WORKSPACE DOCUMENT BREAK ---\n\n");
  };

  const runAnalysis = async (contentToAnalyze: string, selectedSections: AnalysisSection[]) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);
    const storedConfig = getStoredConfig();

    const res = await fetch("/api/ai/rfp-analyzer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: contentToAnalyze,
        sections: selectedSections.map(s => s.id),
        rfpSections,
        config: {
          aiProvider: storedConfig.aiProvider,
          ollamaBaseUrl: storedConfig.ollamaBaseUrl,
          ollamaModel: storedConfig.ollamaModel,
          openrouterApiKey: storedConfig.openrouterApiKey,
          openrouterModel: storedConfig.openrouterModel,
          geminiApiKey: storedConfig.geminiApiKey,
          geminiModel: storedConfig.geminiModel,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return res;
  };

  const consumeAnalysisStream = async (res: Response, selectedSections: AnalysisSection[]) => {
    if (!res.body) throw new Error("No response body");
    setIsStreaming(true);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completedSections = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const evt = JSON.parse(line.slice(6));
        if (evt.type === "progress") {
          setAnalysisLog(prev => [...prev, evt.msg]);
        }
        if (evt.type === "section-start") {
          setSections(prev => prev.map(section =>
            section.id === evt.section.id
              ? { ...section, status: "in_progress", content: "", fallback: false, warning: undefined }
              : section
          ));
          setFinalContent(prev => ({ ...prev, [evt.section.id]: "" }));
        }
        if (evt.type === "section-delta") {
          setFinalContent(prev => ({ ...prev, [evt.sectionId]: `${prev[evt.sectionId] || ""}${evt.delta}` }));
          setSections(prev => prev.map(section =>
            section.id === evt.sectionId
              ? { ...section, status: "in_progress", content: `${section.content || ""}${evt.delta}` }
              : section
          ));
        }
        if (evt.type === "section") {
          completedSections += 1;
          setProgressStep(Math.min(PROGRESS_STEPS.length - 1, Math.ceil((completedSections / selectedSections.length) * (PROGRESS_STEPS.length - 1))));
          setFinalContent(prev => ({ ...prev, [evt.section.id]: evt.section.content }));
          setSections(prev => prev.map(section =>
            section.id === evt.section.id
              ? {
                  ...section,
                  status: "completed",
                  content: evt.section.content,
                  fallback: Boolean(evt.section.fallback),
                  warning: evt.section.warning,
                }
              : section
          ));
        }
        if (evt.type === "done") {
          if (evt.harness) {
            setHarnessReport(evt.harness);
          }
          if (evt.verification?.verificationStatus === "Needs correction") {
            console.log("Verification issues:", evt.verification.issues);
          }
        }
        if (evt.type === "error") {
          throw new Error(evt.error);
        }
      }
    }

    setIsStreaming(false);
  };

  const addWorkspaceFile = async (selectedFile: File) => {
    setIsAddingWorkspaceDoc(true);
    try {
      const text = await extractFileText(selectedFile);
      const doc: WorkspaceDocument = {
        id: `${Date.now()}-${selectedFile.name}`,
        name: selectedFile.name,
        kind: inferDocumentKind(selectedFile.name),
        size: selectedFile.size,
        text,
        addedAt: new Date().toISOString(),
      };
      setWorkspaceDocs(prev => [...prev, doc]);
    } catch (err) {
      alert(String(err instanceof Error ? err.message : err));
    } finally {
      setIsAddingWorkspaceDoc(false);
    }
  };

  const rebuildWorkspaceIntelligence = async () => {
    if (!workspaceDocs.length) return;
    setView("analyzing");
    setIsAnalyzing(true);
    setProgressStep(0);
    setAnalysisLog(["Rebuilding opportunity intelligence across workspace documents..."]);

    const selectedSections = toAnalysisSections(rfpSections).filter((section) => selectedSectionIds.has(section.id));
    setSections(selectedSections.map(s => ({ ...s, status: "pending" })));
    setFinalContent({});
    setHarnessReport(null);
    setRecommendations([]);
    setRecommendationHarness(null);
    setRecommendationsGeneratedAt("");
    setRecommendationError("");

    try {
      const res = await runAnalysis(buildWorkspaceText(workspaceDocs), selectedSections);
      if (res.ok) {
        await consumeAnalysisStream(res, selectedSections);
        const config = getStoredConfig();
        const provider = config.aiProvider || "Unknown";
        const modelName =
          provider === "ollama" ? config.ollamaModel :
          provider === "openrouter" ? config.openrouterModel :
          provider === "gemini" ? config.geminiModel : "";
        setLlmUsed(modelName ? `${provider} (${modelName})` : provider);
        setView("results");
      } else {
        setLlmUsed("Fallback (Rule-based)");
        await generateFallbackResults(buildWorkspaceText(workspaceDocs), selectedSections);
      }
    } catch (err) {
      console.error("Workspace rebuild error:", err);
      setLlmUsed("Fallback (Rule-based)");
      await generateFallbackResults(buildWorkspaceText(workspaceDocs), selectedSections);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const findRecommendedContent = async () => {
    const config = getStoredConfig();
    const sourceKey = sourceKeyFromConfig(config);
    if (!sourceKey) {
      setRecommendationError("No internal knowledge source is configured. Set a local or SharePoint source in Settings and build the index first.");
      return;
    }
    if (!Object.keys(finalContent).length) {
      setRecommendationError("Run RFP analysis before finding recommended internal content.");
      return;
    }

    setIsFindingRecommendations(true);
    setRecommendationError("");
    try {
      const res = await fetch("/api/ai/rfp-recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspaceId || `opp-${Date.now()}`,
          workspaceName: workspaceName || file?.name?.replace(/\.[^.]+$/, "") || "RFP Workspace",
          rfpText: workspaceDocs.length ? buildWorkspaceText(workspaceDocs) : fileContent || pasteText,
          finalContent,
          selectedSections: [...selectedSectionIds],
          sourceKey,
          recommendationAreas,
          config: {
            aiProvider: config.aiProvider,
            ollamaBaseUrl: config.ollamaBaseUrl,
            ollamaModel: config.ollamaModel,
            ollamaEmbedModel: config.ollamaEmbedModel,
            openrouterApiKey: config.openrouterApiKey,
            openrouterModel: config.openrouterModel,
            geminiApiKey: config.geminiApiKey,
            geminiModel: config.geminiModel,
            embeddingProvider: config.embeddingProvider,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Recommendation request failed: ${res.status}`);
      setRecommendations(data.groups || []);
      setRecommendationHarness(data.harness || null);
      setRecommendationsGeneratedAt(data.generatedAt || new Date().toISOString());
    } catch (err) {
      setRecommendationError(String(err instanceof Error ? err.message : err));
    } finally {
      setIsFindingRecommendations(false);
    }
  };

  const handleAnalyze = async () => {
    const contentToAnalyze = fileContent || pasteText;
    if (!contentToAnalyze.trim()) {
      alert("Please upload a file or paste RFP text.");
      return;
    }
    if (selectedSectionIds.size === 0) {
      alert("Please select at least one analysis area.");
      return;
    }

    setView("analyzing");
    setIsAnalyzing(true);
    setProgressStep(0);
    setAnalysisLog([]);

    const selectedSections = toAnalysisSections(rfpSections).filter((section) => selectedSectionIds.has(section.id));
    setSections(selectedSections.map(s => ({ ...s, status: "pending" })));
    setFinalContent({});
    setHarnessReport(null);
    setRecommendations([]);
    setRecommendationHarness(null);
    setRecommendationsGeneratedAt("");
    setRecommendationError("");

    const progressInterval = setInterval(() => {
      setProgressStep(prev => {
        const waitingStep = PROGRESS_STEPS.length - 2;
        if (prev >= waitingStep) {
          return prev;
        }
        return prev + 1;
      });
    }, 1500);

    try {
      const workspaceDocuments = ensureWorkspace(contentToAnalyze);
      const res = await runAnalysis(buildWorkspaceText(workspaceDocuments), selectedSections);

      clearInterval(progressInterval);
      setProgressStep(PROGRESS_STEPS.length - 1);

      if (res.ok) {
        await consumeAnalysisStream(res, selectedSections);
        
        setIsStreaming(false);
        
        // Track which LLM was used
        const config = getStoredConfig();
        const provider = config.aiProvider || "Unknown";
        const modelName = 
          provider === "ollama" ? config.ollamaModel :
          provider === "openrouter" ? config.openrouterModel :
          provider === "gemini" ? config.geminiModel : "";
        setLlmUsed(modelName ? `${provider} (${modelName})` : provider);
        
        setView("results");
      } else {
        setLlmUsed("Fallback (Rule-based)");
        generateFallbackResults(contentToAnalyze, selectedSections);
      }
    } catch (err) {
      console.error("Analysis error:", err);
      clearInterval(progressInterval);
      setLlmUsed("Fallback (Rule-based)");
      generateFallbackResults(contentToAnalyze, selectedSections);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleChatSubmit = async (question?: string) => {
    const finalQuestion = question || chatInput;
    if (!finalQuestion.trim()) return;

    setChatMessages(prev => [...prev, { role: "user", content: finalQuestion }]);
    setChatInput("");
    setIsChatLoading(true);

    try {
      const storedConfig = getStoredConfig();
      
      const res = await fetch("/api/ai/rfp-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: finalQuestion,
          rfpText: fileContent || pasteText,
          workspaceDocuments: workspaceDocs.map(doc => ({
            name: doc.name,
            kind: doc.kind,
            text: doc.text,
          })),
          analysis: finalContent,
          history: chatMessages,
          config: {
            aiProvider: storedConfig.aiProvider,
            ollamaBaseUrl: storedConfig.ollamaBaseUrl,
            ollamaModel: storedConfig.ollamaModel,
            openrouterApiKey: storedConfig.openrouterApiKey,
            openrouterModel: storedConfig.openrouterModel,
            geminiApiKey: storedConfig.geminiApiKey,
            geminiModel: storedConfig.geminiModel,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setChatMessages(prev => [...prev, { role: "assistant", content: data.answer }]);
      }
    } catch (err) {
      console.error("Chat error:", err);
      setChatMessages(prev => [...prev, { 
        role: "assistant", 
        content: "Sorry, I couldn't process your question. Please try again." 
      }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleCopyFullBrief = () => {
    const content = Object.entries(finalContent)
      .map(([id, text]) => {
        const section = rfpSections.find(s => s.id === id);
        return `## ${section?.name || id}\n\n${text}`;
      })
      .join("\n\n---\n\n");
    
    navigator.clipboard.writeText(content);
    alert("Brief copied to clipboard!");
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatMemoryDate = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Not saved yet";
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const fallbackSectionCount = sections.filter(section => section.fallback).length;
  const recommendationCount = recommendations.reduce((sum, group) => sum + group.cards.length, 0);

  if (view === "upload") {
    return (
      <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
        <header className="bg-white border-b border-slate-200 px-6 py-4 shrink-0">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-slate-500 hover:text-slate-700">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold text-slate-800">RFP Analyzer</h1>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-2xl mx-auto px-6 py-12 overflow-y-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Upload an RFP</h2>
            <p className="text-slate-500">Upload an RFP document to generate a detailed opportunity intelligence brief.</p>
          </div>

          {memoryError && (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {memoryError}
            </div>
          )}

          {pursuitMemories.length > 0 && (
            <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Reusable Pursuit Memory</h3>
                  <p className="mt-1 text-xs text-slate-500">Resume an opportunity workspace with its documents, intelligence, harness checks, and chat history.</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {pursuitMemories.length} saved
                </span>
              </div>
              <div className="space-y-2">
                {pursuitMemories.slice(0, 5).map((memory) => (
                  <div key={memory.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                    <button
                      type="button"
                      onClick={() => openPursuitMemory(memory)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-semibold text-slate-800">{memory.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Updated {formatMemoryDate(memory.updatedAt)} · {memory.workspaceDocs.length} docs · {Object.keys(memory.finalContent || {}).length} blocks
                      </p>
                    </button>
                    <div className="flex items-center gap-2">
                      {memory.harnessReport && (
                        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                          memory.harnessReport.status === "pass"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }`}>
                          {memory.harnessReport.status === "pass" ? "Ready" : "Review"}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => openPursuitMemory(memory)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => deletePursuitMemory(memory.id)}
                        className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div
            className="border-2 border-dashed border-slate-300 rounded-2xl p-12 text-center hover:border-sky-400 hover:bg-sky-50/50 transition-colors cursor-pointer"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => document.getElementById("file-input")?.click()}
          >
            <input
              id="file-input"
              type="file"
              className="hidden"
              accept=".pdf,.docx,.pptx,.txt,.md,.markdown"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            />
            <div className="w-16 h-16 bg-sky-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="text-slate-700 font-medium mb-1">Drag and drop RFP here</p>
            <p className="text-slate-500 text-sm">Or click to upload</p>
            <p className="text-slate-400 text-xs mt-4">Supported files: PDF, DOCX, PPTX, TXT, Markdown</p>
          </div>

          <div className="mt-6 text-center">
            <p className="text-slate-500 text-sm mb-2">Or</p>
            <button
              onClick={() => document.getElementById("paste-area")?.classList.toggle("hidden")}
              className="text-sky-600 hover:text-sky-700 font-medium text-sm"
            >
              Paste RFP text
            </button>
          </div>

          <div id="paste-area" className="hidden mt-4">
            <textarea
              className="w-full h-48 p-4 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              placeholder="Paste your RFP text here..."
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
          </div>

          {file && (
            <div className="mt-8 p-4 bg-white border border-slate-200 rounded-xl">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-800">{file.name}</p>
                  <p className="text-sm text-slate-500">{formatFileSize(file.size)} · {file.type || "File"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    isExtractingFile
                      ? "bg-sky-100 text-sky-700"
                      : fileContent.trim()
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                  }`}>
                    {isExtractingFile ? "Extracting content" : fileContent.trim() ? "Ready to analyze" : "No text extracted"}
                  </span>
                  <button
                    onClick={() => { setFile(null); setFileContent(""); setIsExtractingFile(false); }}
                    className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}

          {pasteText.trim() && (
            <div className="mt-8 p-4 bg-white border border-slate-200 rounded-xl">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-800">Pasted Text</p>
                  <p className="text-sm text-slate-500">{pasteText.length} characters</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">
                    Ready to analyze
                  </span>
                  <button
                    onClick={() => setPasteText("")}
                    className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Analysis Areas</h3>
                <p className="text-xs text-slate-500 mt-1">Choose the parts of the RFP brief you want generated.</p>
              </div>
              <div className="flex gap-3 shrink-0">
                <button onClick={selectRecommendedSections} className="text-xs font-medium text-sky-600 hover:text-sky-700">
                  Recommended
                </button>
                <button onClick={selectAllSections} className="text-xs font-medium text-sky-600 hover:text-sky-700">
                  Select all
                </button>
                <button onClick={() => setSelectedSectionIds(new Set())} className="text-xs font-medium text-slate-400 hover:text-slate-600">
                  Clear
                </button>
              </div>
            </div>

            <div className="space-y-5">
              {ANALYSIS_GROUPS.map(group => (
                <div key={group.label}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">{group.label}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {group.sectionIds.map(sectionId => {
                      const section = rfpSections.find(item => item.id === sectionId);
                      if (!section) return null;
                      const selected = selectedSectionIds.has(section.id);
                      const recommended = RECOMMENDED_SECTION_IDS.includes(section.id);
                      return (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => toggleAnalysisSection(section.id)}
                          aria-pressed={selected}
                          className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                            selected
                              ? "border-sky-300 bg-sky-50"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? "border-sky-600 bg-sky-600" : "border-slate-300"}`}>
                            {selected && (
                              <svg className="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block text-xs font-semibold ${selected ? "text-sky-700" : "text-slate-700"}`}>{section.name}</span>
                            {recommended && <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-600">Recommended</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {rfpSections.some(section => !ANALYSIS_GROUPS.some(group => group.sectionIds.includes(section.id))) && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Custom</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {rfpSections
                      .filter(section => !ANALYSIS_GROUPS.some(group => group.sectionIds.includes(section.id)))
                      .map(section => {
                        const selected = selectedSectionIds.has(section.id);
                        return (
                          <button
                            key={section.id}
                            type="button"
                            onClick={() => toggleAnalysisSection(section.id)}
                            aria-pressed={selected}
                            className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                              selected
                                ? "border-sky-300 bg-sky-50"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? "border-sky-600 bg-sky-600" : "border-slate-300"}`}>
                              {selected && (
                                <svg className="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={`block text-xs font-semibold ${selected ? "text-sky-700" : "text-slate-700"}`}>{section.name}</span>
                              <span className="mt-1 block truncate text-[10px] text-slate-400">{section.description}</span>
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            <p className="mt-4 text-xs font-medium text-slate-500">
              {selectedSectionIds.size} {selectedSectionIds.size === 1 ? "area" : "areas"} selected
            </p>
          </div>

          <div className="mt-8 text-center">
            <p className="text-xs text-slate-400 mb-4">
              You can upload the main RFP first. Addendums, pricing templates, evaluation criteria, or clarification notes can be added later.
            </p>
            <button
              onClick={handleAnalyze}
              disabled={isExtractingFile || selectedSectionIds.size === 0 || (!fileContent.trim() && !pasteText.trim())}
              className={`px-8 py-3 rounded-xl font-semibold transition-all ${
                !isExtractingFile && selectedSectionIds.size > 0 && (fileContent.trim() || pasteText.trim())
                  ? "bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-200"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed"
              }`}
            >
              {isExtractingFile ? "Extracting..." : "Analyze RFP"}
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (view === "analyzing") {
    return (
      <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
        <header className="bg-white border-b border-slate-200 px-6 py-4 shrink-0">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <div className="w-8 h-8 bg-sky-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-800">RFP Analyzer</h1>
          </div>
        </header>

        <main className="flex-1 max-w-2xl mx-auto px-6 py-12 overflow-y-auto">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-sky-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-sky-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">Analyzing the uploaded RFP...</h2>
            <p className="text-slate-500">This may take a few moments</p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">Analysis Progress</h3>
            <div className="space-y-3">
              {PROGRESS_STEPS.map((step, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  {idx < progressStep ? (
                    <svg className="w-5 h-5 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : idx === progressStep ? (
                    <svg className="w-5 h-5 text-sky-600 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <div className="w-5 h-5 border-2 border-slate-200 rounded-full shrink-0" />
                  )}
                  <span className={`text-sm ${idx <= progressStep ? "text-slate-700" : "text-slate-400"}`}>
                    {step}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">Sections Analyzed</h3>
            <div className="grid grid-cols-2 gap-3">
              {sections.map((section) => (
                <div
                  key={section.id}
                  className="flex items-center gap-2 text-sm"
                >
                  {section.status === "completed" ? (
                    <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : section.status === "in_progress" ? (
                    <svg className="w-4 h-4 text-sky-600 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <div className="w-4 h-4 border-2 border-slate-200 rounded-full shrink-0" />
                  )}
                  <span className={section.status === "completed" ? "text-slate-700" : section.status === "in_progress" ? "text-sky-700" : "text-slate-400"}>
                    {section.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {analysisLog.length > 0 && (
            <div className="mt-8 rounded-xl bg-slate-900 px-4 py-3 font-mono text-xs text-sky-300 max-h-32 overflow-y-auto">
              {analysisLog.map((msg, index) => (
                <div key={index}>{msg}</div>
              ))}
            </div>
          )}

          {Object.keys(finalContent).length > 0 && (
            <div className="mt-8 space-y-4">
              {sections.map((section) => {
                const content = finalContent[section.id] || section.content || "";
                if (!content && section.status === "pending") return null;
                return (
                  <div key={section.id} className="bg-white rounded-xl border border-slate-200 p-5">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <h3 className="text-sm font-semibold text-slate-800">{section.name}</h3>
                      <div className="flex items-center gap-2">
                        {section.fallback && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Fallback</span>
                        )}
                        {section.status === "in_progress" && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-600 animate-pulse">Writing</span>
                        )}
                      </div>
                    </div>
                    {section.fallback && section.warning && (
                      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {section.warning}
                      </div>
                    )}
                    <div className="max-w-none text-sm text-slate-700">
                      {content
                        ? renderMarkdownContent(content, { preview: true })
                        : <p className="text-slate-400 animate-pulse">Preparing section...</p>}
                      {section.status === "in_progress" && <span className="inline-block h-4 w-1.5 rounded-sm bg-sky-500 animate-pulse" />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
      <header className="bg-white border-b border-slate-200 px-6 py-4 shrink-0">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-500 hover:text-slate-700">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-sky-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-slate-800">RFP Analyzer</h1>
            </div>
            {file && (
              <span className="text-sm text-slate-500 ml-2">- {file.name}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={resetToNewPursuit}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              New pursuit
            </button>
            <button
              onClick={saveCurrentPursuitMemory}
              className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-100"
            >
              Save memory
            </button>
            <button
              onClick={handleCopyFullBrief}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy Full Brief
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto px-6 py-8 overflow-y-auto">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-slate-800">RFP Opportunity Intelligence Brief</h2>
            {llmUsed && (
              <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {llmUsed}
              </span>
            )}
          </div>
          <p className="text-slate-500 text-sm">
            {fallbackSectionCount > 0
              ? `${fallbackSectionCount} section${fallbackSectionCount === 1 ? "" : "s"} used source-derived fallback because model generation did not complete. Treat those as triage, not final strategy.`
              : "Analysis complete. Below is the detailed breakdown across the selected intelligence areas."}
          </p>
        </div>

        <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Opportunity Intelligence Workspace</p>
              <input
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder="RFP Workspace"
                className="mt-1 w-full rounded-lg border border-transparent bg-transparent px-0 text-base font-semibold text-slate-800 outline-none focus:border-sky-200 focus:bg-sky-50 focus:px-2"
                aria-label="Workspace name"
              />
              <p className="mt-1 text-xs text-slate-500">
                {workspaceDocs.length} source {workspaceDocs.length === 1 ? "document" : "documents"} available for follow-up questions and rebuilds.
              </p>
              <p className={`mt-1 text-[10px] ${memoryError ? "text-amber-700" : "text-slate-400"}`}>
                {memoryError || (lastSavedAt ? `Saved to pursuit memory ${formatMemoryDate(lastSavedAt)}` : "Auto-saves after the workspace is created.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                id="workspace-doc-input"
                type="file"
                className="hidden"
                accept=".pdf,.docx,.pptx,.txt,.md,.markdown"
                multiple
                onChange={async (event) => {
                  const files = Array.from(event.target.files ?? []);
                  for (const selectedFile of files) {
                    await addWorkspaceFile(selectedFile);
                  }
                  event.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => document.getElementById("workspace-doc-input")?.click()}
                disabled={isAddingWorkspaceDoc}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {isAddingWorkspaceDoc ? "Adding..." : "Add docs"}
              </button>
              <button
                type="button"
                onClick={rebuildWorkspaceIntelligence}
                disabled={workspaceDocs.length === 0 || isAddingWorkspaceDoc}
                className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                Rebuild intelligence
              </button>
            </div>
          </div>

          {workspaceDocs.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {workspaceDocs.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-700">{doc.name}</p>
                    <p className="text-[10px] text-slate-400">{doc.kind} · {doc.text.length.toLocaleString()} chars</p>
                  </div>
                  {doc.kind !== "Primary RFP" && (
                    <button
                      type="button"
                      onClick={() => setWorkspaceDocs(prev => prev.filter(item => item.id !== doc.id))}
                      className="text-xs font-medium text-slate-400 hover:text-red-500"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {harnessReport && (
          <section className={`mb-8 rounded-xl border p-5 ${
            harnessReport.status === "pass"
              ? "border-emerald-200 bg-emerald-50"
              : "border-amber-200 bg-amber-50"
          }`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wide ${
                  harnessReport.status === "pass" ? "text-emerald-700" : "text-amber-700"
                }`}>
                  Agent Harness
                </p>
                <h3 className="mt-1 text-base font-semibold text-slate-900">
                  {harnessReport.status === "pass" ? "Ready for review" : "Needs human review"}
                </h3>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">{harnessReport.summary}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white/80 px-3 py-2">
                  <p className="text-lg font-semibold text-slate-900">{harnessReport.selectedSectionCount}</p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Blocks</p>
                </div>
                <div className="rounded-lg bg-white/80 px-3 py-2">
                  <p className="text-lg font-semibold text-slate-900">{harnessReport.fallbackCount}</p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Fallbacks</p>
                </div>
                <div className="rounded-lg bg-white/80 px-3 py-2">
                  <p className="text-lg font-semibold text-slate-900">{harnessReport.chunkCount}</p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Chunks</p>
                </div>
              </div>
            </div>

            {harnessReport.warnings.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-white/70 px-3 py-2">
                <p className="mb-1 text-xs font-semibold text-amber-800">Review warnings</p>
                <div className="space-y-1">
                  {harnessReport.warnings.slice(0, 5).map((warning, index) => (
                    <p key={index} className="text-xs text-slate-600">- {warning}</p>
                  ))}
                  {harnessReport.warnings.length > 5 && (
                    <p className="text-xs text-slate-400">+ {harnessReport.warnings.length - 5} more warnings</p>
                  )}
                </div>
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {harnessReport.sectionRuns.map((run) => (
                <div key={run.id} className="rounded-lg border border-white/70 bg-white/75 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-slate-700">{run.name}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      run.usedFallback ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                    }`}>
                      {run.usedFallback ? "Fallback" : "Model"}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {run.retrievedChunks} retrieved chunks · {run.evidenceRefs} evidence refs · {run.attempts.join(" -> ")}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <div ref={resultsRef} className="space-y-6">
          {rfpSections.map((section) => {
            const content = finalContent[section.id];
            if (!content) return null;
            const runtimeSection = sections.find(item => item.id === section.id);

            return (
              <div key={section.id} className="bg-white rounded-xl border border-slate-200 p-6">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                    <svg className="w-5 h-5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {section.name}
                  </h3>
                  {runtimeSection?.fallback && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      Source fallback
                    </span>
                  )}
                </div>
                {runtimeSection?.fallback && runtimeSection.warning && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {runtimeSection.warning}
                  </div>
                )}
                <div className="max-w-none text-sm text-slate-700">
                  {renderMarkdownContent(content)}
                </div>
              </div>
            );
          })}
        </div>

        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recommended Internal Content</p>
              <h3 className="mt-1 text-base font-semibold text-slate-900">Reusable assets for this pursuit</h3>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
                Find source-backed proposals, capability slides, case studies, delivery models, solution assets, and commercial references from the indexed knowledge base.
              </p>
              {recommendationsGeneratedAt && (
                <p className="mt-1 text-[10px] text-slate-400">
                  Generated {formatMemoryDate(recommendationsGeneratedAt)} · {recommendationCount} recommendation{recommendationCount === 1 ? "" : "s"}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={findRecommendedContent}
              disabled={isFindingRecommendations || !Object.keys(finalContent).length}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isFindingRecommendations ? "Finding..." : recommendations.length ? "Refresh recommendations" : "Find recommended content"}
            </button>
          </div>

          {recommendationError && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {recommendationError}
            </div>
          )}

          {recommendationHarness && (
            <details className={`mt-4 rounded-lg border p-3 ${
              recommendationHarness.status === "pass"
                ? "border-emerald-200 bg-emerald-50"
                : "border-amber-200 bg-amber-50"
            }`}>
              <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                Recommendation Harness · {recommendationHarness.status === "pass" ? "Ready" : "Needs review"} · {recommendationHarness.retrievedItems} assets
              </summary>
              <div className="mt-3 space-y-2">
                {recommendationHarness.warnings.length > 0 && (
                  <div className="rounded-md bg-white/70 px-3 py-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Warnings</p>
                    {recommendationHarness.warnings.slice(0, 6).map((warning, index) => (
                      <p key={index} className="text-xs text-slate-600">- {warning}</p>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {recommendationHarness.agentTrace.map((entry, index) => (
                    <div key={index} className="rounded-md bg-white/75 px-3 py-2">
                      <p className="text-xs font-semibold text-slate-700">{entry.step} · {entry.tool}</p>
                      <p className="mt-1 line-clamp-2 text-[10px] text-slate-500">
                        {entry.query || entry.note || "No query"}{typeof entry.found === "number" ? ` · ${entry.found} found` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}

          {recommendations.length > 0 && (
            <div className="mt-5 space-y-5">
              {recommendations.map((group) => (
                <div key={group.id} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-800">{group.name}</h4>
                      <p className="mt-1 text-xs text-slate-500">{group.description}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {group.cards.length} found
                    </span>
                  </div>

                  {group.cards.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-400">
                      No source-backed matches found for this recommendation area.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      {group.cards.map((card) => (
                        <article key={card.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                          <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr]">
                            <div className="flex min-h-[120px] items-center justify-center bg-slate-100">
                              {card.thumbnailUrl ? (
                                <img src={card.thumbnailUrl} alt="" className="h-full max-h-40 w-full object-contain" />
                              ) : (
                                <div className="px-4 text-center text-xs font-medium text-slate-400">
                                  {card.fileType?.toUpperCase() || "Asset"}
                                </div>
                              )}
                            </div>
                            <div className="p-4">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-slate-800">{card.title}</p>
                                  <p className="mt-1 text-[10px] text-slate-400">
                                    {card.assetType} · {card.fileName}{card.page ? ` · Page/Slide ${card.page}` : ""}
                                  </p>
                                </div>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                  card.confidence === "High"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : card.confidence === "Medium"
                                      ? "bg-sky-100 text-sky-700"
                                      : "bg-slate-100 text-slate-500"
                                }`}>
                                  {card.confidence}
                                </span>
                              </div>
                              <p className="mt-3 text-xs leading-relaxed text-slate-600">{card.matchReason}</p>
                              {(card.sectionAssetType || card.documentAssetType || card.proofStrength || card.assetYear || card.technologies?.length || card.serviceLines?.length) && (
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                  {card.assetYear && (
                                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                                      {card.yearConfidence === "low" ? `${card.assetYear} inferred` : card.assetYear}
                                    </span>
                                  )}
                                  {card.sectionAssetType && (
                                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                                      {card.sectionAssetType.replace(/_/g, " ")}
                                    </span>
                                  )}
                                  {card.documentAssetType && (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                      {card.documentAssetType.replace(/_/g, " ")}
                                    </span>
                                  )}
                                  {card.proofStrength && card.proofStrength !== "none" && (
                                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                      {card.proofStrength} proof
                                    </span>
                                  )}
                                  {card.serviceLines?.slice(0, 2).map((item) => (
                                    <span key={item} className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">{item}</span>
                                  ))}
                                  {card.technologies?.slice(0, 3).map((item) => (
                                    <span key={item} className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{item}</span>
                                  ))}
                                </div>
                              )}
                              {card.assetSummary && (
                                <p className="mt-2 text-xs leading-relaxed text-slate-500">{card.assetSummary}</p>
                              )}
                              {card.recencyNote && (
                                <p className="mt-2 text-xs font-medium text-sky-700">{card.recencyNote}</p>
                              )}
                              <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">{card.excerpt}</p>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-700">
                                  {card.suggestedReuse}
                                </span>
                                {card.previewPdfUrl && (
                                  <a
                                    href={card.previewPdfUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-full border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-500 hover:bg-slate-50"
                                  >
                                    Open preview
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <div className={`mt-8 p-4 rounded-xl border ${fallbackSectionCount > 0 ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
          <p className={`font-medium text-center ${fallbackSectionCount > 0 ? "text-amber-800" : "text-emerald-800"}`}>
            {fallbackSectionCount > 0 ? "RFP analysis completed with fallback sections." : "RFP analysis complete."}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-2 justify-center">
          {SUGGESTED_QUESTIONS.map((q, i) => (
            <button
              key={i}
              onClick={() => handleChatSubmit(q)}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-full text-sm text-slate-600 hover:bg-slate-50 hover:border-sky-300 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>

        <div className="mt-8 bg-white rounded-xl border border-slate-200">
          <div className="p-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Ask follow-up questions</h3>
          </div>
          <div className="p-4 max-h-96 overflow-y-auto space-y-4">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] p-3 rounded-xl ${
                  msg.role === "user" 
                    ? "bg-sky-600 text-white" 
                    : "bg-slate-100 text-slate-700"
                }`}>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}
            {isChatLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 p-3 rounded-xl">
                  <div className="flex items-center gap-2 text-slate-500">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="text-sm">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="p-4 border-t border-slate-100">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleChatSubmit()}
                placeholder="Ask anything about this RFP..."
                className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                disabled={isChatLoading}
              />
              <button
                onClick={() => handleChatSubmit()}
                disabled={!chatInput.trim() || isChatLoading}
                className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
