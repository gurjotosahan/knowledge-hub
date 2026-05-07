"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { AppConfig, AIProvider, SourceType } from "@/types";
import { RESEARCH_SECTIONS, RESEARCH_SECTIONS_STORAGE_KEY } from "@/types/research";
import type { ResearchSectionDef } from "@/types/research";
import OneDrivePicker from "./OneDrivePicker";

interface SettingsProps {
  config: AppConfig;
  onSave: (config: AppConfig) => void;
  onClose: () => void;
}

interface ModelEntry { id: string; name: string }
interface IndexStatus {
  exists: boolean;
  indexedAt?: string;
  chunks?: number;
  files?: number;
  embedModel?: string;
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
        searchQueryTemplate: section.searchQueryTemplate || defaults?.searchQueryTemplate || "{{client}} research topic 2025",
        prompt: section.prompt || defaults?.prompt || "Describe the output this research component should produce.",
      };
    });
  } catch {
    return RESEARCH_SECTIONS;
  }
}

export default function Settings({ config, onSave, onClose }: SettingsProps) {
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
  const [researchSections, setResearchSections] = useState<ResearchSectionDef[]>(() => loadResearchSections());
  const [activeResearchSectionId, setActiveResearchSectionId] = useState<string>(() => loadResearchSections()[0]?.id ?? "");

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
  const buildIndex = async () => {
    setIndexing(true); setIndexLog([]); setIndexError("");
    try {
      let url: string;
      let bodyPayload: object;

      const embedPayload = {
        embeddingProvider: local.embeddingProvider,
        ollamaBaseUrl:     local.ollamaBaseUrl,
        embedModel:        local.ollamaEmbedModel || "bge-large",
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
        };
      } else {
        url = "/api/local/index";
        bodyPayload = {
          folderPath: local.folderPath,
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

  const handleSave = () => {
    localStorage.setItem(RESEARCH_SECTIONS_STORAGE_KEY, JSON.stringify(researchSections));
    window.dispatchEvent(new Event("research-sections-updated"));
    onSave(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

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
      searchQueryTemplate: "{{client}} research topic 2025",
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

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 z-50 flex w-[min(920px,calc(100vw-32px))] flex-col bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Settings</h2>
            <p className="text-xs text-slate-400 mt-0.5">Configure your data source and AI engine</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">

          {/* ── Section 1: Data Source toggle ── */}
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

          {/* ── Section 2: Search Index ── */}
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

            {indexStatus && (
              <div className={`mb-3 flex items-start gap-2 px-3 py-2.5 rounded-lg border text-xs ${
                indexStatus.exists ? "bg-emerald-50 border-emerald-100 text-emerald-700" : "bg-amber-50 border-amber-100 text-amber-700"
              }`}>
                {indexStatus.exists ? (
                  <><svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm3.707-9.293a1 1 0 0 0-1.414-1.414L9 10.586 7.707 9.293a1 1 0 0 0-1.414 1.414l2 2a1 1 0 0 0 1.414 0l4-4z" clipRule="evenodd" /></svg>
                    <span>{indexStatus.chunks?.toLocaleString()} chunks · {indexStatus.files} files · {indexStatus.embedModel} · {formatDate(indexStatus.indexedAt)}</span></>
                ) : (
                  <><svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-1-8a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0V6a1 1 0 0 0-1-1z" clipRule="evenodd" /></svg>
                    <span>No index yet — build it to enable AI search.</span></>
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
              <button
                onClick={buildIndex}
                disabled={!canIndex}
                className="w-full py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {indexing ? (
                  <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Building index…</>
                ) : indexStatus?.exists ? "Rebuild Index" : "Build Index"}
              </button>
            )}
          </section>

          {/* ── Section 3: AI Engine ── */}
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

          {/* ── Section 4: Web Search ── */}
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

          {/* ── Section 5: Client Research Admin ── */}
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
                    placeholder="{{client}} cloud modernization AI 2025"
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

          {/* ── Status ── */}
          {(local.folderPath || local.sourceType === "sharepoint") && (
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

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
          <button onClick={handleSave} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${saved ? "bg-emerald-500 text-white" : "bg-sky-600 hover:bg-sky-700 text-white"}`}>
            {saved ? "Saved ✓" : "Save Settings"}
          </button>
        </div>
      </div>
    </>
  );
}
