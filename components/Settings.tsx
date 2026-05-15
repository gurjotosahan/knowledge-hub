"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import type { AppConfig, AIProvider, SourceType } from "@/types";
import { RESEARCH_SECTIONS, RESEARCH_SECTIONS_STORAGE_KEY } from "@/types/research";
import type { ResearchSectionDef } from "@/types/research";
import {
  RFP_ANALYSIS_SECTIONS,
  RFP_RECOMMENDATION_AREAS,
  RFP_RECOMMENDATION_AREAS_STORAGE_KEY,
  RFP_SECTIONS_STORAGE_KEY,
} from "@/types/rfp";
import type { RfpAnalysisSectionDef, RfpRecommendationAreaDef } from "@/types/rfp";
import OneDrivePicker from "./OneDrivePicker";
import { ALL_FEATURES } from "@/lib/auth/permissions";
import type { Feature, UserPermissions } from "@/lib/auth/permissions";
import type { PublicUser } from "@/lib/auth/users";

interface SettingsProps {
  config: AppConfig;
  onSave: (config: AppConfig) => void;
  onClose: () => void;
}

interface ModelEntry { id: string; name: string }

interface SearchAnalytics {
  totalSearches: number;
  noResultRate: number;
  weakResultRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  topQueries: Array<{ query: string; count: number }>;
  zeroResultQueries: Array<{ query: string; count: number; lastSeen: string }>;
  slowQueries: Array<{ query: string; latencyMs: number; timestamp: string }>;
  recentEntries: Array<{ queryId: string; timestamp: string; query: string; mode: string; resultCount: number; noResult: boolean; latencyMs: number; intent: string }>;
}
interface IndexStatus {
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

function loadResearchSections(): ResearchSectionDef[] {
  if (typeof window === "undefined") return RESEARCH_SECTIONS;
  try {
    const raw = localStorage.getItem(RESEARCH_SECTIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as ResearchSectionDef[] : null;
    if (!Array.isArray(parsed) || !parsed.length) return RESEARCH_SECTIONS;
    const defaultsById = new Map(RESEARCH_SECTIONS.map((section) => [section.id, section]));
    return parsed.map((section) => {
      const defaults = defaultsById.get(section.id);
      return {
        ...defaults,
        ...section,
        searchQueryTemplate: section.searchQueryTemplate || defaults?.searchQueryTemplate || "{{client}} research topic 2026 2025",
        prompt: section.prompt || defaults?.prompt || "Describe the output this research component should produce.",
      };
    });
  } catch {
    return RESEARCH_SECTIONS;
  }
}

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

export default function Settings({ config, onSave, onClose }: SettingsProps) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";

  const [local, setLocal] = useState<AppConfig>(config);
  const [models, setModels]           = useState<ModelEntry[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError]     = useState("");
  const [folderPicking, setFolderPicking] = useState(false);
  const [folderPickError, setFolderPickError] = useState("");
  const [saved, setSaved] = useState(false);

  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [indexing, setIndexing]       = useState(false);
  const [indexLog, setIndexLog]       = useState<string[]>([]);
  const [indexError, setIndexError]   = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);
  const saveRef = useRef<() => void>(() => {});
  const [researchSections, setResearchSections] = useState<ResearchSectionDef[]>(() => loadResearchSections());
  const [activeResearchSectionId, setActiveResearchSectionId] = useState<string>(() => loadResearchSections()[0]?.id ?? "");
  const [rfpSections, setRfpSections] = useState<RfpAnalysisSectionDef[]>(() => loadRfpSections());
  const [activeRfpSectionId, setActiveRfpSectionId] = useState<string>(() => loadRfpSections()[0]?.id ?? "");
  const [recommendationAreas, setRecommendationAreas] = useState<RfpRecommendationAreaDef[]>(() => loadRfpRecommendationAreas());
  const [activeRecommendationAreaId, setActiveRecommendationAreaId] = useState<string>(() => loadRfpRecommendationAreas()[0]?.id ?? "");

  const [activeTab, setActiveTab] = useState<"general" | "index" | "ai" | "web" | "research" | "rfp" | "content" | "analytics" | "users">("general");
  const [analytics, setAnalytics] = useState<SearchAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<PublicUser | null>(null);
  const [showNewUserForm, setShowNewUserForm] = useState(false);
  const [userFormData, setUserFormData] = useState({ username: "", displayName: "", password: "", role: "user" as "admin" | "user", permissions: null as UserPermissions | null });
  const [userFormError, setUserFormError] = useState("");
  const [userFormSaving, setUserFormSaving] = useState(false);

  const set = <K extends keyof AppConfig>(key: K, val: AppConfig[K]) =>
    setLocal((prev) => ({ ...prev, [key]: val }));

  // ── Derive sourceKey for index status ─────────────────────────────────────
  const sourceKey =
    local.sourceType === "sharepoint"
      ? `graph:${local.graphDriveId || "mock-drive-documents"}`
      : local.folderPath;

  // ── Fetch models ──────────────────────────────────────────────────────────
  const fetchModels = useCallback(async () => {
    setModelsLoading(true); setModelsError(""); setModels([]);
    try {
      const params = new URLSearchParams({ provider: local.aiProvider });
      if (local.aiProvider === "ollama") params.set("baseUrl", local.ollamaBaseUrl);
      const res  = await fetch(`/api/ai/models?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setModels(data.models ?? []);
    } catch (err) { setModelsError(String(err)); }
    finally      { setModelsLoading(false); }
  }, [local.aiProvider, local.ollamaBaseUrl]);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  // ── Fetch index status ────────────────────────────────────────────────────
  const fetchIndexStatus = useCallback(async (key: string) => {
    if (!key) { setIndexStatus(null); return; }
    try {
      const res  = await fetch(`/api/local/index?folderPath=${encodeURIComponent(key)}`);
      const data = await res.json();
      setIndexStatus(data);
    } catch { setIndexStatus(null); }
  }, []);

  useEffect(() => { fetchIndexStatus(sourceKey); }, [sourceKey, fetchIndexStatus]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [indexLog]);

  // ── Build index ───────────────────────────────────────────────────────────
  const buildIndex = async (force = false) => {
    setIndexing(true); setIndexLog([]); setIndexError("");
    try {
      let url: string;
      let bodyPayload: object;

      const embedPayload = {
        embeddingProvider: local.embeddingProvider,
        ollamaBaseUrl:     local.ollamaBaseUrl,
        embedModel:        local.ollamaEmbedModel || "bge-large",
        generateSlidePreviews: local.generateSlidePreviews,
        enableAssetLlmEnrichment: local.enableAssetLlmEnrichment,
        enableVisionIndexing: local.enableVisionIndexing,
        visionModel: local.visionModel,
        visionWordThreshold: local.visionWordThreshold,
        aiProvider: local.aiProvider,
        ollamaModel: local.ollamaModel,
        openrouterApiKey: local.openrouterApiKey,
        openrouterModel: local.openrouterModel,
        geminiApiKey: local.geminiApiKey,
        geminiModel: local.geminiModel,
      };

      if (local.sourceType === "sharepoint") {
        url = "/api/graph/index";
        bodyPayload = {
          driveId:      local.graphDriveId || "mock-drive-documents",
          mockMode:     local.graphMockMode,
          tenantId:     local.graphTenantId,
          clientId:     local.graphClientId,
          siteUrl:      local.graphSiteUrl,
          ...embedPayload,
          generateSlidePreviews: false,
        };
      } else {
        url = "/api/local/index";
        bodyPayload = {
          folderPath: local.folderPath,
          forceRebuild: force,
          ...embedPayload,
        };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      });
      if (!res.ok || !res.body) throw new Error(`Server error: ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.msg)   setIndexLog((p) => [...p, event.msg]);
            if (event.done)  fetchIndexStatus(sourceKey);
            if (event.error) setIndexError(event.error);
          } catch {}
        }
      }
    } catch (err) {
      setIndexError(String(err));
    } finally {
      setIndexing(false);
    }
  };

  // ── Folder picker ─────────────────────────────────────────────────────────
  const chooseFolder = async () => {
    setFolderPicking(true); setFolderPickError("");
    try {
      const res  = await fetch("/api/local/pick-folder", { method: "POST" });
      const data = await res.json();
      if (data.cancelled) return;
      if (data.error) throw new Error(data.error);
      set("folderPath", data.folderPath);
    } catch (err) { setFolderPickError(String(err)); }
    finally      { setFolderPicking(false); }
  };

  const save = () => {
    localStorage.setItem(RESEARCH_SECTIONS_STORAGE_KEY, JSON.stringify(researchSections));
    localStorage.setItem(RFP_SECTIONS_STORAGE_KEY, JSON.stringify(rfpSections));
    localStorage.setItem(RFP_RECOMMENDATION_AREAS_STORAGE_KEY, JSON.stringify(recommendationAreas));
    window.dispatchEvent(new Event("research-sections-updated"));
    window.dispatchEvent(new Event("rfp-sections-updated"));
    window.dispatchEvent(new Event("rfp-recommendation-areas-updated"));
    onSave(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  // Keep saveRef current so the debounce timer always calls the latest closure
  saveRef.current = save;

  // Auto-save 800 ms after any setting changes; skip the initial mount
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => saveRef.current(), 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, researchSections, rfpSections, recommendationAreas]);

  useEffect(() => {
    if (activeTab !== "analytics") return;
    setAnalyticsLoading(true);
    fetch(`/api/logs/search${sourceKey ? `?sourceKey=${encodeURIComponent(sourceKey)}` : ""}`)
      .then((r) => r.json())
      .then((data) => setAnalytics(data as SearchAnalytics))
      .catch(() => {})
      .finally(() => setAnalyticsLoading(false));
  }, [activeTab, sourceKey]);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch { setUsers([]); }
    finally { setUsersLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === "users" && isAdmin) fetchUsers();
  }, [activeTab, isAdmin, fetchUsers]);

  const updateResearchSection = (id: string, patch: Partial<ResearchSectionDef>) => {
    setResearchSections((prev) => prev.map((section) => section.id === id ? { ...section, ...patch } : section));
  };

  const addResearchSection = () => {
    const id = `custom-${Date.now()}`;
    const section: ResearchSectionDef = {
      id,
      title: "New Research Component",
      emoji: "📌",
      description: "Describe what this component should research",
      searchQueryTemplate: "{{client}} research topic 2026 2025",
      prompt: "Describe the output this research component should produce. Include the structure, facts to prioritize, and how to connect insights to Apexon opportunities.",
    };
    setResearchSections((prev) => [...prev, section]);
    setActiveResearchSectionId(id);
  };

  const deleteResearchSection = (id: string) => {
    setResearchSections((prev) => {
      const next = prev.filter((section) => section.id !== id);
      if (activeResearchSectionId === id) setActiveResearchSectionId(next[0]?.id ?? "");
      return next;
    });
  };

  const moveResearchSection = (id: string, direction: -1 | 1) => {
    setResearchSections((prev) => {
      const index = prev.findIndex((section) => section.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const resetResearchSections = () => {
    setResearchSections(RESEARCH_SECTIONS);
    setActiveResearchSectionId(RESEARCH_SECTIONS[0]?.id ?? "");
  };

  const updateRfpSection = (id: string, patch: Partial<RfpAnalysisSectionDef>) => {
    setRfpSections((prev) => prev.map((section) => section.id === id ? { ...section, ...patch } : section));
  };

  const addRfpSection = () => {
    const id = `custom-rfp-${Date.now()}`;
    const section: RfpAnalysisSectionDef = {
      id,
      name: "New RFP Intelligence Block",
      description: "Describe what this RFP block should analyze",
      query: "requirements scope risk evaluation",
      categories: ["Project Overview"],
      prompt: "Describe the output this RFP analysis block should produce. Include expected structure, evidence requirements, and proposal-team implications.",
    };
    setRfpSections((prev) => [...prev, section]);
    setActiveRfpSectionId(id);
  };

  const deleteRfpSection = (id: string) => {
    setRfpSections((prev) => {
      const next = prev.filter((section) => section.id !== id);
      if (activeRfpSectionId === id) setActiveRfpSectionId(next[0]?.id ?? "");
      return next;
    });
  };

  const moveRfpSection = (id: string, direction: -1 | 1) => {
    setRfpSections((prev) => {
      const index = prev.findIndex((section) => section.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const resetRfpSections = () => {
    setRfpSections(RFP_ANALYSIS_SECTIONS);
    setActiveRfpSectionId(RFP_ANALYSIS_SECTIONS[0]?.id ?? "");
  };

  const updateRecommendationArea = (id: string, patch: Partial<RfpRecommendationAreaDef>) => {
    setRecommendationAreas((prev) => prev.map((area) => area.id === id ? { ...area, ...patch } : area));
  };

  const addRecommendationArea = () => {
    const id = `custom-recommendation-${Date.now()}`;
    const area: RfpRecommendationAreaDef = {
      id,
      name: "New Recommendation Area",
      description: "Describe which internal content this area should find",
      queryTemplate: "{{profile}} reusable proposal content",
      desiredAssetTypes: ["pdf", "pptx", "docx"],
      prompt: "Find source-backed internal content that can support this RFP response area.",
      enabled: true,
    };
    setRecommendationAreas((prev) => [...prev, area]);
    setActiveRecommendationAreaId(id);
  };

  const deleteRecommendationArea = (id: string) => {
    setRecommendationAreas((prev) => {
      const next = prev.filter((area) => area.id !== id);
      if (activeRecommendationAreaId === id) setActiveRecommendationAreaId(next[0]?.id ?? "");
      return next;
    });
  };

  const moveRecommendationArea = (id: string, direction: -1 | 1) => {
    setRecommendationAreas((prev) => {
      const index = prev.findIndex((area) => area.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const resetRecommendationAreas = () => {
    setRecommendationAreas(RFP_RECOMMENDATION_AREAS);
    setActiveRecommendationAreaId(RFP_RECOMMENDATION_AREAS[0]?.id ?? "");
  };

  const sourceTab = (s: SourceType, label: string) => (
    <button
      onClick={() => set("sourceType", s)}
      className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
        local.sourceType === s
          ? "bg-sky-600 text-white shadow-sm"
          : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {label}
    </button>
  );

  const providerTab = (p: AIProvider, label: string) => (
    <button
      onClick={() => set("aiProvider", p)}
      className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
        local.aiProvider === p
          ? "bg-sky-600 text-white shadow-sm"
          : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {label}
    </button>
  );

  const formatDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

  const canIndex =
    !indexing &&
    local.sourceType !== "onedrive" &&
    (local.sourceType === "sharepoint"
      ? Boolean(local.graphDriveId || local.graphMockMode)
      : Boolean(local.folderPath));

  const activeResearchSection =
    researchSections.find((section) => section.id === activeResearchSectionId) ?? researchSections[0];
  const activeRfpSection =
    rfpSections.find((section) => section.id === activeRfpSectionId) ?? rfpSections[0];
  const activeRecommendationArea =
    recommendationAreas.find((area) => area.id === activeRecommendationAreaId) ?? recommendationAreas[0];

  type NavItem = { id: typeof activeTab; label: string; icon: React.ReactNode };
  const navItems: NavItem[] = [
    { id: "general",  label: "General",        icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7h18M3 12h18M3 17h12" /> },
    { id: "index",    label: "Search Index",   icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2m15.357 2H15" /> },
    { id: "ai",       label: "AI Engine",      icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.663 17h4.673M12 3v1m6.364 1.636-.707.707M21 12h-1M4 12H3m3.343-5.657-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /> },
    { id: "web",      label: "Web Search",     icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" /> },
    { id: "research", label: "Client Research",icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" /> },
    { id: "rfp",      label: "RFP Analyzer",   icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414A1 1 0 0 1 19 9.414V19a2 2 0 0 1-2 2z" /> },
    { id: "content",  label: "Content Areas",  icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19.428 15.428A8 8 0 1 1 8.572 4.572M12 8v4l3 3" /> },
    { id: "analytics", label: "Search Analytics", icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z" /> },
    ...(isAdmin ? [{ id: "users" as const, label: "Users", icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a4 4 0 0 0-3-3.87M9 20H4v-2a4 4 0 0 1 3-3.87m6 5.87a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /> }] : []),
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="flex w-full max-w-4xl h-[calc(100vh-64px)] max-h-[780px] rounded-2xl bg-white shadow-2xl overflow-hidden">

          {/* ── Left sidebar ── */}
          <div className="w-52 shrink-0 bg-slate-50 border-r border-slate-200 flex flex-col">
            <div className="px-5 py-5 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-800">Settings</h2>
            </div>
            <nav className="flex-1 overflow-y-auto py-2 px-2">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left mb-0.5 ${
                    activeTab === item.id
                      ? "bg-slate-200 text-slate-900"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
                  }`}
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {item.icon}
                  </svg>
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="px-4 py-4 border-t border-slate-200 space-y-2">
              <button onClick={onClose} className="w-full py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
                Close
              </button>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="w-full py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 transition-colors"
              >
                Sign out
              </button>
              {saved && (
                <p className="text-center text-xs text-emerald-600 font-medium py-1">✓ Saved</p>
              )}
              {session?.user && (
                <p className="text-center text-xs text-slate-400 truncate">{session.user.name ?? session.user.email}</p>
              )}
            </div>
          </div>

          {/* ── Right content ── */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Section header */}
            <div className="flex items-center justify-between px-7 py-5 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-800">
                {navItems.find(n => n.id === activeTab)?.label}
              </h3>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-6">

          {activeTab === "general" && (<>
          {/* ── Data Source ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h7" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-700">Data Source</h3>
            </div>

            <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-4">
              {sourceTab("local",      "Local Folder")}
              {sourceTab("onedrive",   "OneDrive")}
              {sourceTab("sharepoint", "SharePoint")}
            </div>

            {local.sourceType === "local" ? (
              /* ── Local folder ── */
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Folder path (PDF &amp; PPTX)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={local.folderPath}
                    onChange={(e) => set("folderPath", e.target.value)}
                    placeholder="/Users/you/Documents/SharePoint"
                    className="min-w-0 flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                  />
                  <button
                    onClick={chooseFolder}
                    disabled={folderPicking}
                    className="shrink-0 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 transition-colors"
                  >
                    {folderPicking ? "Choosing…" : "Choose"}
                  </button>
                </div>
                {folderPickError && (
                  <p className="mt-1.5 text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{folderPickError}</p>
                )}
                <p className="mt-1.5 text-xs text-slate-400">
                  Scans recursively for <code className="text-sky-600">.pdf</code> and <code className="text-sky-600">.pptx</code> files.
                </p>
              </div>
            ) : local.sourceType === "onedrive" ? (
              /* ── OneDrive OAuth ── */
              <OneDrivePicker
                embeddingProvider={local.embeddingProvider}
                ollamaBaseUrl={local.ollamaBaseUrl}
                embedModel={local.ollamaEmbedModel || "bge-large"}
                enableAssetLlmEnrichment={local.enableAssetLlmEnrichment}
                aiProvider={local.aiProvider}
                ollamaModel={local.ollamaModel}
                openrouterApiKey={local.openrouterApiKey}
                openrouterModel={local.openrouterModel}
                geminiApiKey={local.geminiApiKey}
                geminiModel={local.geminiModel}
                onIndexed={() => fetchIndexStatus("onedrive:me")}
              />
            ) : (
              /* ── SharePoint / Graph ── */
              <div className="space-y-3">
                {/* Mock mode toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-sky-50 border border-sky-100">
                  <div>
                    <p className="text-xs font-semibold text-sky-800">Mock Mode</p>
                    <p className="text-xs text-sky-600 mt-0.5">Use realistic demo documents instead of a real SharePoint tenant</p>
                  </div>
                  <button
                    onClick={() => set("graphMockMode", !local.graphMockMode)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${local.graphMockMode ? "bg-sky-600" : "bg-slate-300"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow ${local.graphMockMode ? "translate-x-4" : "translate-x-1"}`} />
                  </button>
                </div>

                {!local.graphMockMode && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1.5">Tenant ID</label>
                      <input type="text" value={local.graphTenantId} onChange={(e) => set("graphTenantId", e.target.value)}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1.5">Client ID</label>
                      <input type="text" value={local.graphClientId} onChange={(e) => set("graphClientId", e.target.value)}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" />
                    </div>
                    <p className="text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                      Client secret is read server-side from <code className="text-slate-600">AZURE_CLIENT_SECRET</code> or <code className="text-slate-600">GRAPH_CLIENT_SECRET</code>.
                    </p>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1.5">SharePoint Site URL</label>
                      <input type="text" value={local.graphSiteUrl} onChange={(e) => set("graphSiteUrl", e.target.value)}
                        placeholder="https://contoso.sharepoint.com/sites/knowledge"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" />
                    </div>
                  </>
                )}

                {local.graphMockMode && (
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">
                    7 demo documents ready across BFSI, Healthcare, and Life Sciences — no SharePoint credentials required.
                  </div>
                )}
              </div>
            )}
          </section>
          </>)}

          {activeTab === "index" && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-700">Search Index</h3>
            </div>

            {/* Embedding provider toggle */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Embedding provider</label>
              <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
                {(["ollama", "google"] as const).map((p) => (
                  <button key={p} type="button"
                    onClick={() => set("embeddingProvider", p)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      local.embeddingProvider === p
                        ? "bg-white shadow text-slate-800"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {p === "ollama" ? "Ollama (local)" : "Google text-embedding-004"}
                  </button>
                ))}
              </div>
            </div>

            {local.embeddingProvider === "ollama" ? (
              <div className="mb-3">
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Embed model</label>
                <input type="text" value={local.ollamaEmbedModel}
                  onChange={(e) => set("ollamaEmbedModel", e.target.value)}
                  placeholder="bge-large"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" />
                <p className="mt-1 text-xs text-slate-400">
                  Run <code className="text-slate-600">ollama pull bge-large</code> before indexing.
                </p>
              </div>
            ) : (
              <div className="mb-3 flex items-start gap-2 p-3 rounded-lg bg-sky-50 border border-sky-100">
                <svg className="w-4 h-4 text-sky-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM9 9a1 1 0 0 0 0 2v3a1 1 0 0 0 2 0v-3a1 1 0 0 0-1-1H9z" clipRule="evenodd" />
                </svg>
                <p className="text-xs text-sky-700">
                  Uses your Google AI Studio API key · <strong>text-embedding-004</strong> · 768 dims · Free tier · No Ollama required for embeddings.
                </p>
              </div>
            )}

            <div className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div>
                <p className="text-xs font-semibold text-slate-700">Pre-render slide previews</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  During local folder indexing, use LibreOffice once per PPTX and cache previews for faster Slide Search.
                </p>
              </div>
              <button
                type="button"
                onClick={() => set("generateSlidePreviews", !local.generateSlidePreviews)}
                disabled={local.sourceType !== "local"}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  local.generateSlidePreviews ? "bg-sky-600" : "bg-slate-300"
                } disabled:cursor-not-allowed disabled:opacity-50`}
                aria-pressed={local.generateSlidePreviews}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  local.generateSlidePreviews ? "translate-x-6" : "translate-x-1"
                }`} />
              </button>
            </div>

            <div className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div>
                <p className="text-xs font-semibold text-slate-700">LLM asset intelligence</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  During indexing, use the selected chat model to classify reusable assets. Rule-based indexing remains as fallback.
                </p>
              </div>
              <button
                type="button"
                onClick={() => set("enableAssetLlmEnrichment", !local.enableAssetLlmEnrichment)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  local.enableAssetLlmEnrichment ? "bg-sky-600" : "bg-slate-300"
                }`}
                aria-pressed={local.enableAssetLlmEnrichment}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  local.enableAssetLlmEnrichment ? "translate-x-6" : "translate-x-1"
                }`} />
              </button>
            </div>

            {/* Vision indexing */}
            <div className="flex items-start justify-between gap-3 py-2">
              <div>
                <p className="text-xs font-semibold text-slate-700">Vision Indexing</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Describes slide visuals using your selected AI provider. Uses the vision model below (overrides the chat model). Requires slide previews to be enabled.
                </p>
              </div>
              <button
                type="button"
                onClick={() => set("enableVisionIndexing", !local.enableVisionIndexing)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  local.enableVisionIndexing ? "bg-sky-600" : "bg-slate-300"
                }`}
                aria-pressed={local.enableVisionIndexing}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  local.enableVisionIndexing ? "translate-x-6" : "translate-x-1"
                }`} />
              </button>
            </div>

            {local.enableVisionIndexing && (
              <div className="mb-1">
                <label className="block text-xs font-medium text-slate-500 mb-1">Vision word threshold</label>
                <input
                  type="number"
                  min={1}
                  value={local.visionWordThreshold}
                  onChange={(e) => set("visionWordThreshold", Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <p className="mt-1 text-[10px] text-slate-400">Slides at or below this word count get vision-described using the model selected in AI Engine. Set above your largest slide&apos;s word count to cover all slides.</p>
              </div>
            )}

            {indexStatus && (
              <div className={`mb-3 flex items-start gap-2 px-3 py-2.5 rounded-lg border text-xs ${
                indexStatus.exists && !indexStatus.missingFiles ? "bg-emerald-50 border-emerald-100 text-emerald-700" : "bg-amber-50 border-amber-100 text-amber-700"
              }`}>
                {indexStatus.exists ? (
                  <><svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm3.707-9.293a1 1 0 0 0-1.414-1.414L9 10.586 7.707 9.293a1 1 0 0 0-1.414 1.414l2 2a1 1 0 0 0 1.414 0l4-4z" clipRule="evenodd" /></svg>
                    <span>
                      {indexStatus.chunks?.toLocaleString()} chunks · {indexStatus.files} files · {indexStatus.embedModel} · {formatDate(indexStatus.indexedAt)}
                      {indexStatus.missingFiles ? ` · ${indexStatus.missingFiles} supported file${indexStatus.missingFiles === 1 ? "" : "s"} not indexed` : ""}
                      {indexStatus.missingFileNames?.length ? ` (${indexStatus.missingFileNames.join(", ")})` : ""}
                    </span></>
                ) : (
                  <><svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-1-8a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0V6a1 1 0 0 0-1-1z" clipRule="evenodd" /></svg>
                    <span>
                      {indexStatus.needsRebuild
                        ? `Index needs rebuild · ${indexStatus.chunks?.toLocaleString() ?? 0} old chunks · ${indexStatus.files ?? 0} files`
                        : "No index yet — build it to enable AI search."}
                      {indexStatus.missingFiles ? ` · ${indexStatus.missingFiles} supported file${indexStatus.missingFiles === 1 ? "" : "s"} not indexed` : ""}
                      {indexStatus.missingFileNames?.length ? ` (${indexStatus.missingFileNames.join(", ")})` : ""}
                    </span></>
                )}
              </div>
            )}

            {indexLog.length > 0 && (
              <div ref={logRef} className="mb-3 h-28 overflow-y-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs text-slate-300 space-y-0.5">
                {indexLog.map((line, i) => <div key={i}>{line}</div>)}
                {indexing && <div className="text-sky-400 animate-pulse">Indexing…</div>}
              </div>
            )}

            {indexError && (
              <p className="mb-3 text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{indexError}</p>
            )}

            {local.sourceType !== "onedrive" && (
              <div className="flex gap-2">
                <button
                  onClick={() => buildIndex(false)}
                  disabled={!canIndex}
                  className="flex-1 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {indexing ? (
                    <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Building index…</>
                  ) : indexStatus?.exists ? "Rebuild Index" : "Build Index"}
                </button>
                {indexStatus?.exists && (
                  <button
                    onClick={() => buildIndex(true)}
                    disabled={!canIndex}
                    title="Discard existing index and rebuild all files from scratch"
                    className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-500 hover:bg-red-50 hover:border-red-200 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    Force rebuild
                  </button>
                )}
              </div>
            )}
          </section>
          )}

          {activeTab === "ai" && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636-.707.707M21 12h-1M4 12H3m3.343-5.657-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-700">AI Engine</h3>
            </div>

            <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-4">
              {providerTab("ollama",     "Ollama (Local)")}
              {providerTab("openrouter", "OpenRouter")}
              {providerTab("gemini",     "Gemini")}
            </div>

            {local.aiProvider === "ollama" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Ollama base URL</label>
                  <input type="text" value={local.ollamaBaseUrl} onChange={(e) => set("ollamaBaseUrl", e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-500">Chat model</label>
                    <button onClick={fetchModels} className="text-xs text-sky-600 hover:text-sky-700 font-medium">{modelsLoading ? "Loading…" : "Refresh"}</button>
                  </div>
                  {modelsError ? (
                    <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg border border-red-100">{modelsError}</p>
                  ) : (
                    <select value={local.ollamaModel} onChange={(e) => set("ollamaModel", e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500">
                      <option value="">{modelsLoading ? "Fetching…" : models.length === 0 ? "No models found" : "Select a model"}</option>
                      {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  )}
                  <p className="mt-1.5 text-xs text-slate-400">
                    Run <code className="text-slate-600">ollama pull llama3.2</code> to get started.
                  </p>
                </div>
              </div>
            )}

            {local.aiProvider === "openrouter" && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                  OpenRouter key is read server-side from <code className="text-slate-600">OPENROUTER_API_KEY</code>.
                </p>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-500">Model</label>
                    <button onClick={fetchModels} className="text-xs text-sky-600 hover:text-sky-700 font-medium">{modelsLoading ? "Loading…" : "Fetch models"}</button>
                  </div>
                  {modelsError ? (
                    <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg border border-red-100">{modelsError}</p>
                  ) : (
                    <select value={local.openrouterModel} onChange={(e) => set("openrouterModel", e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500">
                      <option value="">{modelsLoading ? "Fetching…" : models.length === 0 ? "Set server API key and click Fetch" : "Select a model"}</option>
                      {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  )}
                </div>
              </div>
            )}

            {local.aiProvider === "gemini" && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                  Gemini key is read server-side from <code className="text-slate-600">GEMINI_API_KEY</code> or <code className="text-slate-600">GOOGLE_API_KEY</code>.
                </p>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-500">Model</label>
                    <button onClick={fetchModels} className="text-xs text-sky-600 hover:text-sky-700 font-medium">{modelsLoading ? "Loading…" : "Fetch models"}</button>
                  </div>
                  {modelsError ? (
                    <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg border border-red-100">{modelsError}</p>
                  ) : (
                    <select value={local.geminiModel} onChange={(e) => set("geminiModel", e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500">
                      <option value="">{modelsLoading ? "Fetching…" : models.length === 0 ? "Set server API key and click Fetch" : "Select a model"}</option>
                      {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  )}
                </div>
              </div>
            )}
          </section>
          )}

          {activeTab === "web" && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-700">Web Search <span className="text-slate-400 font-normal">(Optional)</span></h3>
            </div>

            <p className="text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
              Enable the <strong className="text-slate-500">+ Web</strong> toggle in chat to mix RAG results with live web search. Tavily is read server-side from <code className="text-slate-600">TAVILY_API_KEY</code>.
            </p>
          </section>
          )}

          {activeTab === "research" && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-700">Client Research Admin</h3>
                  <p className="text-xs text-slate-400">Manage research components and module prompts</p>
                </div>
              </div>
              <button
                type="button"
                onClick={addResearchSection}
                className="px-2.5 py-1.5 rounded-lg bg-sky-600 text-xs font-semibold text-white hover:bg-sky-700"
              >
                Add
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 bg-white">
                {researchSections.map((section, index) => {
                  const active = section.id === activeResearchSection?.id;
                  return (
                    <div
                      key={section.id}
                      className={`flex items-center gap-2 px-3 py-2 transition-colors ${
                        active ? "bg-sky-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveResearchSectionId(section.id)}
                        className="min-w-0 flex flex-1 items-center gap-2 text-left"
                      >
                        <span className="text-base">{section.emoji}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-xs font-semibold ${active ? "text-sky-700" : "text-slate-700"}`}>{section.title}</span>
                          <span className="block truncate text-[10px] text-slate-400">{section.description}</span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveResearchSection(section.id, -1)}
                          disabled={index === 0}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                          title="Move up"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveResearchSection(section.id, 1)}
                          disabled={index === researchSections.length - 1}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                          title="Move down"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {activeResearchSection ? (
              <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="grid grid-cols-[56px_1fr] gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Icon</label>
                    <input
                      type="text"
                      value={activeResearchSection.emoji}
                      onChange={(e) => updateResearchSection(activeResearchSection.id, { emoji: e.target.value })}
                      className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Title</label>
                    <input
                      type="text"
                      value={activeResearchSection.title}
                      onChange={(e) => updateResearchSection(activeResearchSection.id, { title: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Description</label>
                  <input
                    type="text"
                    value={activeResearchSection.description}
                    onChange={(e) => updateResearchSection(activeResearchSection.id, { description: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Search query template</label>
                  <input
                    type="text"
                    value={activeResearchSection.searchQueryTemplate}
                    onChange={(e) => updateResearchSection(activeResearchSection.id, { searchQueryTemplate: e.target.value })}
                    placeholder="{{client}} cloud modernization AI 2026 2025"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">Use <code className="text-slate-600">{"{{client}}"}</code> where the company name should be inserted.</p>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Module output prompt</label>
                  <textarea
                    rows={6}
                    value={activeResearchSection.prompt}
                    onChange={(e) => updateResearchSection(activeResearchSection.id, { prompt: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 leading-relaxed"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => deleteResearchSection(activeResearchSection.id)}
                    disabled={researchSections.length <= 1}
                    className="flex-1 py-2 rounded-lg border border-red-200 bg-white text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Delete Component
                  </button>
                  <button
                    type="button"
                    onClick={resetResearchSections}
                    className="flex-1 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    Reset Defaults
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-400">No research components configured.</p>
            )}
          </section>
          )}

          {activeTab === "rfp" && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414A1 1 0 0 1 19 9.414V19a2 2 0 0 1-2 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-700">RFP Analyzer Admin</h3>
                  <p className="text-xs text-slate-400">Manage analyzer blocks, retrieval hints, and section prompts</p>
                </div>
              </div>
              <button
                type="button"
                onClick={addRfpSection}
                className="px-2.5 py-1.5 rounded-lg bg-sky-600 text-xs font-semibold text-white hover:bg-sky-700"
              >
                Add
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 bg-white">
                {rfpSections.map((section, index) => {
                  const active = section.id === activeRfpSection?.id;
                  return (
                    <div key={section.id} className={`flex items-center gap-2 px-3 py-2 transition-colors ${active ? "bg-sky-50" : "hover:bg-slate-50"}`}>
                      <button type="button" onClick={() => setActiveRfpSectionId(section.id)} className="min-w-0 flex flex-1 items-center gap-2 text-left">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-semibold text-slate-500">{index + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-xs font-semibold ${active ? "text-sky-700" : "text-slate-700"}`}>{section.name}</span>
                          <span className="block truncate text-[10px] text-slate-400">{section.description}</span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveRfpSection(section.id, -1)}
                          disabled={index === 0}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                          title="Move up"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveRfpSection(section.id, 1)}
                          disabled={index === rfpSections.length - 1}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                          title="Move down"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {activeRfpSection ? (
              <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Block title</label>
                  <input
                    type="text"
                    value={activeRfpSection.name}
                    onChange={(e) => updateRfpSection(activeRfpSection.id, { name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Description</label>
                  <input
                    type="text"
                    value={activeRfpSection.description}
                    onChange={(e) => updateRfpSection(activeRfpSection.id, { description: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Retrieval query hints</label>
                  <input
                    type="text"
                    value={activeRfpSection.query}
                    onChange={(e) => updateRfpSection(activeRfpSection.id, { query: e.target.value })}
                    placeholder="requirements mandatory scope risk pricing"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Categories</label>
                  <input
                    type="text"
                    value={activeRfpSection.categories.join(", ")}
                    onChange={(e) => updateRfpSection(activeRfpSection.id, { categories: e.target.value.split(",").map(item => item.trim()).filter(Boolean) })}
                    placeholder="Scope, Technical Requirements, Risks"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">Comma-separated retrieval categories used to find the best RFP chunks for this block.</p>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Section prompt</label>
                  <textarea
                    rows={7}
                    value={activeRfpSection.prompt}
                    onChange={(e) => updateRfpSection(activeRfpSection.id, { prompt: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 leading-relaxed"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => deleteRfpSection(activeRfpSection.id)}
                    disabled={rfpSections.length <= 1}
                    className="flex-1 py-2 rounded-lg border border-red-200 bg-white text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Delete Block
                  </button>
                  <button
                    type="button"
                    onClick={resetRfpSections}
                    className="flex-1 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    Reset Defaults
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-400">No RFP analyzer blocks configured.</p>
            )}
          </section>
          )}

          {activeTab === "content" && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428A8 8 0 1 1 8.572 4.572M12 8v4l3 3" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-700">RFP Recommendation Areas</h3>
                  <p className="text-xs text-slate-400">Manage internal content searches after RFP analysis</p>
                </div>
              </div>
              <button
                type="button"
                onClick={addRecommendationArea}
                className="px-2.5 py-1.5 rounded-lg bg-sky-600 text-xs font-semibold text-white hover:bg-sky-700"
              >
                Add
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 bg-white">
                {recommendationAreas.map((area, index) => {
                  const active = area.id === activeRecommendationArea?.id;
                  return (
                    <div key={area.id} className={`flex items-center gap-2 px-3 py-2 transition-colors ${active ? "bg-sky-50" : "hover:bg-slate-50"}`}>
                      <button type="button" onClick={() => setActiveRecommendationAreaId(area.id)} className="min-w-0 flex flex-1 items-center gap-2 text-left">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold ${area.enabled ? "bg-slate-100 text-slate-500" : "bg-slate-50 text-slate-300"}`}>{index + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-xs font-semibold ${active ? "text-sky-700" : "text-slate-700"}`}>{area.name}</span>
                          <span className="block truncate text-[10px] text-slate-400">{area.enabled ? area.description : "Disabled"}</span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveRecommendationArea(area.id, -1)}
                          disabled={index === 0}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30"
                          title="Move up"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveRecommendationArea(area.id, 1)}
                          disabled={index === recommendationAreas.length - 1}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30"
                          title="Move down"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {activeRecommendationArea ? (
              <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <span>
                    <span className="block text-xs font-semibold text-slate-700">Enabled</span>
                    <span className="block text-[10px] text-slate-400">Include this area when finding recommended content</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={activeRecommendationArea.enabled}
                    onChange={(e) => updateRecommendationArea(activeRecommendationArea.id, { enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                </label>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Area title</label>
                  <input
                    type="text"
                    value={activeRecommendationArea.name}
                    onChange={(e) => updateRecommendationArea(activeRecommendationArea.id, { name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Description</label>
                  <input
                    type="text"
                    value={activeRecommendationArea.description}
                    onChange={(e) => updateRecommendationArea(activeRecommendationArea.id, { description: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Retrieval query template</label>
                  <input
                    type="text"
                    value={activeRecommendationArea.queryTemplate}
                    onChange={(e) => updateRecommendationArea(activeRecommendationArea.id, { queryTemplate: e.target.value })}
                    placeholder="{{profile}} capability slides"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">Use <code className="text-slate-600">{"{{profile}}"}</code> for the extracted RFP opportunity terms.</p>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Desired asset types</label>
                  <input
                    type="text"
                    value={activeRecommendationArea.desiredAssetTypes.join(", ")}
                    onChange={(e) => updateRecommendationArea(activeRecommendationArea.id, { desiredAssetTypes: e.target.value.split(",").map(item => item.trim().toLowerCase()).filter(Boolean) })}
                    placeholder="pptx, pdf, docx"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Ranking guidance</label>
                  <textarea
                    rows={5}
                    value={activeRecommendationArea.prompt}
                    onChange={(e) => updateRecommendationArea(activeRecommendationArea.id, { prompt: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 leading-relaxed"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => deleteRecommendationArea(activeRecommendationArea.id)}
                    disabled={recommendationAreas.length <= 1}
                    className="flex-1 py-2 rounded-lg border border-red-200 bg-white text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Delete Area
                  </button>
                  <button
                    type="button"
                    onClick={resetRecommendationAreas}
                    className="flex-1 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    Reset Defaults
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-400">No recommendation areas configured.</p>
            )}
          </section>
          )}

          {activeTab === "analytics" && (
          <section className="space-y-5">
            {analyticsLoading && <p className="text-xs text-slate-400">Loading analytics…</p>}
            {!analyticsLoading && !analytics && <p className="text-xs text-slate-400">No search data yet. Run some searches first.</p>}
            {analytics && analytics.totalSearches === 0 && <p className="text-xs text-slate-400">No searches logged yet.</p>}
            {analytics && analytics.totalSearches > 0 && (<>
              {/* Summary stats */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Total Searches", value: analytics.totalSearches.toLocaleString() },
                  { label: "Zero-result Rate", value: `${(analytics.noResultRate * 100).toFixed(1)}%`, warn: analytics.noResultRate > 0.1 },
                  { label: "Avg Latency", value: `${analytics.avgLatencyMs.toLocaleString()}ms`, warn: analytics.avgLatencyMs > 3000 },
                  { label: "p95 Latency", value: `${analytics.p95LatencyMs.toLocaleString()}ms`, warn: analytics.p95LatencyMs > 5000 },
                ].map(({ label, value, warn }) => (
                  <div key={label} className={`rounded-lg border px-3 py-2.5 text-center ${warn ? "border-amber-100 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                    <p className={`text-base font-semibold ${warn ? "text-amber-700" : "text-slate-800"}`}>{value}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              {/* Zero-result queries */}
              {analytics.zeroResultQueries.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Zero-result Queries — review these</h4>
                  <div className="rounded-lg border border-red-100 bg-red-50 divide-y divide-red-100">
                    {analytics.zeroResultQueries.slice(0, 10).map(({ query, count, lastSeen }) => (
                      <div key={query} className="flex items-center justify-between px-3 py-2 gap-3">
                        <span className="text-xs text-slate-700 truncate flex-1">"{query}"</span>
                        <span className="text-[10px] text-red-500 shrink-0">×{count}</span>
                        <span className="text-[10px] text-slate-400 shrink-0">{new Date(lastSeen).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top queries */}
              {analytics.topQueries.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Top Queries</h4>
                  <div className="rounded-lg border border-slate-100 divide-y divide-slate-100">
                    {analytics.topQueries.slice(0, 10).map(({ query, count }) => (
                      <div key={query} className="flex items-center justify-between px-3 py-2 gap-3">
                        <span className="text-xs text-slate-700 truncate flex-1">"{query}"</span>
                        <span className="text-[10px] text-slate-500 shrink-0">{count} searches</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Slow queries */}
              {analytics.slowQueries.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Slow Queries (&gt;3s)</h4>
                  <div className="rounded-lg border border-amber-100 bg-amber-50 divide-y divide-amber-100">
                    {analytics.slowQueries.slice(0, 5).map(({ query, latencyMs, timestamp }) => (
                      <div key={`${query}-${timestamp}`} className="flex items-center justify-between px-3 py-2 gap-3">
                        <span className="text-xs text-slate-700 truncate flex-1">"{query}"</span>
                        <span className="text-[10px] text-amber-600 shrink-0">{(latencyMs / 1000).toFixed(1)}s</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent activity */}
              <div>
                <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Recent Searches</h4>
                <div className="rounded-lg border border-slate-100 divide-y divide-slate-100 max-h-64 overflow-y-auto">
                  {analytics.recentEntries.slice(0, 20).map((e) => (
                    <div key={e.queryId} className="flex items-center gap-3 px-3 py-2">
                      <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${e.noResult ? "bg-red-400" : "bg-emerald-400"}`} />
                      <span className="text-xs text-slate-700 truncate flex-1">"{e.query}"</span>
                      <span className="text-[10px] text-slate-400 shrink-0">{e.mode}</span>
                      <span className="text-[10px] text-slate-400 shrink-0">{e.resultCount} results</span>
                      <span className="text-[10px] text-slate-400 shrink-0">{e.latencyMs}ms</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Refresh */}
              <button
                onClick={() => {
                  setAnalytics(null);
                  setAnalyticsLoading(true);
                  fetch(`/api/logs/search${sourceKey ? `?sourceKey=${encodeURIComponent(sourceKey)}` : ""}`)
                    .then((r) => r.json())
                    .then((data) => setAnalytics(data as SearchAnalytics))
                    .catch(() => {})
                    .finally(() => setAnalyticsLoading(false));
                }}
                className="text-xs text-sky-600 hover:text-sky-700 font-medium"
              >
                Refresh
              </button>
            </>)}
          </section>
          )}

          {activeTab === "users" && isAdmin && (
            <section className="space-y-4">
              {/* Header row */}
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">{users.length} user{users.length !== 1 ? "s" : ""}</p>
                <button
                  onClick={() => { setShowNewUserForm(true); setEditingUser(null); setUserFormData({ username: "", displayName: "", password: "", role: "user", permissions: null }); setUserFormError(""); }}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add user
                </button>
              </div>

              {usersLoading && <p className="text-xs text-slate-400">Loading users…</p>}

              {/* New user form */}
              {showNewUserForm && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-slate-700">New user</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">Username</label>
                      <input
                        value={userFormData.username}
                        onChange={(e) => setUserFormData((p) => ({ ...p, username: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                        placeholder="username"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">Display Name</label>
                      <input
                        value={userFormData.displayName}
                        onChange={(e) => setUserFormData((p) => ({ ...p, displayName: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                        placeholder="Full name"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">Password</label>
                      <input
                        type="password"
                        value={userFormData.password}
                        onChange={(e) => setUserFormData((p) => ({ ...p, password: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                        placeholder="Min 8 chars"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">Role</label>
                      <select
                        value={userFormData.role}
                        onChange={(e) => setUserFormData((p) => ({ ...p, role: e.target.value as "admin" | "user" }))}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </div>
                  {/* Feature checkboxes */}
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1.5 block">Feature access</label>
                    <div className="flex flex-wrap gap-2">
                      {ALL_FEATURES.map((f) => {
                        const perms = userFormData.permissions;
                        const enabled = perms ? perms.features.includes(f.id) : userFormData.role === "admin";
                        return (
                          <label key={f.id} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(e) => {
                                setUserFormData((p) => {
                                  const base = p.permissions ?? { features: ALL_FEATURES.map((x) => x.id), allowedSourceKeys: ["*"], canManageIndex: false };
                                  const features = e.target.checked
                                    ? [...new Set([...base.features, f.id])]
                                    : base.features.filter((x) => x !== f.id);
                                  return { ...p, permissions: { ...base, features } };
                                });
                              }}
                              className="rounded"
                            />
                            <span className="text-xs text-slate-700">{f.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  {userFormError && <p className="text-xs text-red-600">{userFormError}</p>}
                  <div className="flex gap-2">
                    <button
                      disabled={userFormSaving}
                      onClick={async () => {
                        setUserFormError("");
                        if (!userFormData.username || !userFormData.password) { setUserFormError("Username and password are required."); return; }
                        if (userFormData.password.length < 8) { setUserFormError("Password must be at least 8 characters."); return; }
                        setUserFormSaving(true);
                        try {
                          const res = await fetch("/api/admin/users", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              username: userFormData.username,
                              displayName: userFormData.displayName || userFormData.username,
                              password: userFormData.password,
                              role: userFormData.role,
                              permissions: userFormData.permissions ?? undefined,
                            }),
                          });
                          if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
                          setShowNewUserForm(false);
                          await fetchUsers();
                        } catch (err) { setUserFormError((err as Error).message); }
                        finally { setUserFormSaving(false); }
                      }}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {userFormSaving ? "Creating…" : "Create"}
                    </button>
                    <button onClick={() => setShowNewUserForm(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* User list */}
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                {users.map((u) => (
                  <div key={u.id} className="flex items-start gap-3 px-4 py-3 bg-white hover:bg-slate-50">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-blue-700">{(u.displayName || u.username)[0].toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-800 truncate">{u.displayName}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${u.role === "admin" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{u.role}</span>
                        {u.id === session?.user?.id && <span className="text-xs text-slate-400">(you)</span>}
                      </div>
                      <p className="text-xs text-slate-500">{u.username}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {u.permissions.features.map((f) => (
                          <span key={f} className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{f}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Edit button */}
                      <button
                        onClick={() => {
                          setEditingUser(u);
                          setShowNewUserForm(false);
                          setUserFormData({ username: u.username, displayName: u.displayName, password: "", role: u.role, permissions: u.permissions });
                          setUserFormError("");
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                        title="Edit"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5m-1.414-9.414a2 2 0 1 1 2.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {/* Delete button — disabled for self */}
                      {u.id !== session?.user?.id && (
                        <button
                          onClick={async () => {
                            if (!confirm(`Delete user "${u.displayName}"? This cannot be undone.`)) return;
                            await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
                            await fetchUsers();
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                          title="Delete"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {/* Inline edit form */}
                {editingUser && (
                  <div className="px-4 py-4 bg-blue-50 border-t border-blue-100 space-y-3">
                    <h4 className="text-xs font-semibold text-slate-700">Edit {editingUser.displayName}</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">Display Name</label>
                        <input
                          value={userFormData.displayName}
                          onChange={(e) => setUserFormData((p) => ({ ...p, displayName: e.target.value }))}
                          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">Role</label>
                        <select
                          value={userFormData.role}
                          onChange={(e) => setUserFormData((p) => ({ ...p, role: e.target.value as "admin" | "user" }))}
                          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">New password <span className="text-slate-400">(leave blank to keep)</span></label>
                        <input
                          type="password"
                          value={userFormData.password}
                          onChange={(e) => setUserFormData((p) => ({ ...p, password: e.target.value }))}
                          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                          placeholder="••••••••"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1.5 block">Feature access</label>
                      <div className="flex flex-wrap gap-2">
                        {ALL_FEATURES.map((f) => {
                          const perms = userFormData.permissions ?? editingUser.permissions;
                          const enabled = perms.features.includes(f.id);
                          return (
                            <label key={f.id} className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(e) => {
                                  setUserFormData((p) => {
                                    const base = p.permissions ?? editingUser.permissions;
                                    const features = e.target.checked
                                      ? [...new Set([...base.features, f.id])]
                                      : base.features.filter((x) => x !== f.id);
                                    return { ...p, permissions: { ...base, features } };
                                  });
                                }}
                                className="rounded"
                              />
                              <span className="text-xs text-slate-700">{f.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    {userFormError && <p className="text-xs text-red-600">{userFormError}</p>}
                    <div className="flex gap-2">
                      <button
                        disabled={userFormSaving}
                        onClick={async () => {
                          setUserFormError("");
                          setUserFormSaving(true);
                          try {
                            const patch: Record<string, unknown> = {
                              displayName: userFormData.displayName,
                              role: userFormData.role,
                              permissions: userFormData.permissions ?? editingUser.permissions,
                            };
                            if (userFormData.password) patch.password = userFormData.password;
                            const res = await fetch(`/api/admin/users/${editingUser.id}`, {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(patch),
                            });
                            if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
                            setEditingUser(null);
                            await fetchUsers();
                          } catch (err) { setUserFormError((err as Error).message); }
                          finally { setUserFormSaving(false); }
                        }}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                      >
                        {userFormSaving ? "Saving…" : "Save changes"}
                      </button>
                      <button onClick={() => setEditingUser(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === "general" && (local.folderPath || local.sourceType === "sharepoint") && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-100">
              <svg className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm3.707-9.293a1 1 0 0 0-1.414-1.414L9 10.586 7.707 9.293a1 1 0 0 0-1.414 1.414l2 2a1 1 0 0 0 1.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <p className="text-xs text-emerald-700">
                {local.sourceType === "sharepoint"
                  ? `SharePoint source${local.graphMockMode ? " (mock)" : ""} · `
                  : "Local folder · "}
                <strong>{
                  local.aiProvider === "ollama"     ? `Ollama (${local.ollamaModel || "no model"})` :
                  local.aiProvider === "gemini"     ? `Gemini (${local.geminiModel || "no model"})` :
                  `OpenRouter (${local.openrouterModel || "no model"})`
                }</strong>
              </p>
            </div>
          )}
        </div>
          </div>
        </div>
      </div>
    </>
  );
}
