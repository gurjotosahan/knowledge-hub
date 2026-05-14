"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AIProvider, DocumentCategory, LocalSourceEntry, ServiceLine, Source, SourceType } from "@/types";

interface DocumentBrowserProps {
  rootFolder: string;
  sourceType?: SourceType;
  graphDriveId?: string;
  graphMockMode?: boolean;
  graphTenantId?: string;
  graphClientId?: string;
  graphSiteUrl?: string;
  selectedLine?: ServiceLine | null;
  selectedCategory?: DocumentCategory | null;
  selectedSourceId: string | null;
  onSourceSelect: (source: Source) => void;
  onAskDocument: (query: string) => void;
  onOpenSettings: () => void;
  ollamaBaseUrl?: string;
  ollamaEmbedModel?: string;
  enableAssetLlmEnrichment?: boolean;
  aiProvider?: AIProvider;
  ollamaModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
}

function formatBytes(size?: number) {
  if (size == null) return "";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024, unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i++) { value /= 1024; unit = units[i]; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function formatDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function titleFromFileName(name: string) {
  return name.replace(/\.(pdf|pptx|docx)$/i, "").replace(/[-_]/g, " ");
}

function categoryBadge(category?: DocumentCategory | null) {
  if (category === "RFPs") return "RFP";
  if (category === "POVs") return "POV";
  if (category === "Case Studies") return "CASE STUDY";
  if (category === "Latest Trends") return "TREND";
  return "DOC";
}

// Extract Graph driveId + itemId from an encoded path like "graph:{driveId}:{itemId}"
function parseGraphPath(path: string): { driveId: string; itemId: string } | null {
  const parts = path.match(/^graph:([^:]+):(.+)$/);
  if (!parts) return null;
  return { driveId: parts[1], itemId: parts[2] };
}

type IndexState = "idle" | "indexing" | "done" | "error";

const ASK_SUGGESTIONS = [
  "Summarize the key findings and recommendations",
  "What metrics and proof points are mentioned?",
  "List the main differentiators and win themes",
  "What risks or challenges are highlighted?",
  "Extract reusable bullets for a proposal",
  "What client outcomes or case examples are cited?",
];

export default function DocumentBrowser({
  rootFolder,
  sourceType = "local",
  graphDriveId = "mock-drive-documents",
  graphMockMode = true,
  graphTenantId = "",
  graphClientId = "",
  graphSiteUrl = "",
  selectedLine = null,
  selectedCategory = null,
  selectedSourceId,
  onSourceSelect,
  onAskDocument,
  onOpenSettings,
  ollamaBaseUrl = "http://localhost:11434",
  ollamaEmbedModel = "nomic-embed-text",
  enableAssetLlmEnrichment = false,
  aiProvider,
  ollamaModel,
  openrouterApiKey,
  openrouterModel,
  geminiApiKey,
  geminiModel,
}: DocumentBrowserProps) {
  const isGraph = sourceType === "sharepoint";

  // Local navigation state
  const [folder, setFolder]       = useState(rootFolder);
  // Graph navigation state: stack of { name, itemId } for breadcrumbs
  const [graphStack, setGraphStack] = useState<Array<{ name: string; itemId?: string }>>([{ name: "Documents" }]);

  const [entries, setEntries]     = useState<(LocalSourceEntry & { webUrl?: string })[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [indexState, setIndexState] = useState<IndexState>("idle");
  const [indexMsg, setIndexMsg]     = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const askTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [askEntry, setAskEntry] = useState<LocalSourceEntry | null>(null);
  const [askPrompt, setAskPrompt] = useState("");

  const categoryMatches = (entry: LocalSourceEntry & { webUrl?: string }): boolean => {
    if (!selectedCategory) return true;
    if (entry.kind !== "file") return false;
    const haystack = `${entry.name} ${entry.path}`.toLowerCase();
    switch (selectedCategory) {
      case "RFPs":
        return /\brfp\b|request[-_\s]?for[-_\s]?proposal|proposal|response/.test(haystack);
      case "POVs":
        return /\bpov\b|point[-_\s]?of[-_\s]?view|whitepaper|thought[-_\s]?leadership/.test(haystack);
      case "Case Studies":
        return /case[-_\s]?stud(y|ies)|customer[-_\s]?story|success[-_\s]?story|reference|proof[-_\s]?point/.test(haystack);
      case "Latest Trends":
        return /trend|insight|market|analyst|forecast|latest|outlook|report/.test(haystack);
      default:
        return true;
    }
  };

  const serviceMatches = (entry: LocalSourceEntry & { webUrl?: string }): boolean => {
    if (!selectedLine) return true;
    const haystack = `${entry.name} ${entry.path}`.toLowerCase();
    const serviceSignals = {
      BFSI: /\bbfsi\b|bank|banking|financial|fintech|insurance|lending|payment|wealth|capital[-_\s]?markets/,
      Healthcare: /healthcare|health[-_\s]?care|provider|payer|hospital|clinical|patient|claims/,
      "Life Sciences": /life[-_\s]?sciences|lifesciences|pharma|biotech|medical[-_\s]?device|cro|clinical[-_\s]?trial|iqvia/,
    } satisfies Record<ServiceLine, RegExp>;
    const hasAnyServiceSignal = Object.values(serviceSignals).some((regex) => regex.test(haystack));
    return serviceSignals[selectedLine].test(haystack) || !hasAnyServiceSignal;
  };

  const visibleEntries = useMemo(
    () => entries.filter((entry) => categoryMatches(entry) && serviceMatches(entry)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, selectedCategory, selectedLine]
  );

  useEffect(() => { if (!isGraph) setFolder(rootFolder); }, [rootFolder, isGraph]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [indexMsg]);

  // ── Fetch file list ───────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    let url: string;
    if (isGraph) {
      const currentItemId = graphStack[graphStack.length - 1]?.itemId;
      const params = new URLSearchParams({ driveId: graphDriveId, mockMode: String(graphMockMode) });
      if (currentItemId) params.set("itemId", currentItemId);
      if (!graphMockMode) {
        if (graphTenantId)     params.set("tenantId",     graphTenantId);
        if (graphClientId)     params.set("clientId",     graphClientId);
        if (graphSiteUrl)      params.set("siteUrl",      graphSiteUrl);
      }
      url = `/api/graph/files?${params}`;
    } else {
      if (!folder) { setLoading(false); return; }
      const params = new URLSearchParams({ folder });
      if (selectedCategory) params.set("recursive", "true");
      url = `/api/local/files?${params}`;
    }

    fetch(url, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEntries(data.entries ?? data.files ?? []);
      })
      .catch((err) => { if (!controller.signal.aborted) { setError(String(err)); setEntries([]); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGraph, folder, graphStack, graphDriveId, graphMockMode, refreshKey, selectedCategory]);

  // ── Local breadcrumbs ─────────────────────────────────────────────────────
  const localPathParts = useMemo(() => {
    if (isGraph) return [];
    const normalized = folder.replace(/\/+$/, "");
    const root = rootFolder.replace(/\/+$/, "");
    if (!normalized.startsWith(root)) return [{ label: normalized, path: normalized }];
    const relative = normalized.slice(root.length).replace(/^\/+/, "");
    const parts = relative ? relative.split("/") : [];
    const crumbs = [{ label: "Source", path: rootFolder }];
    let current = rootFolder.replace(/\/+$/, "");
    parts.forEach((part) => { current = `${current}/${part}`; crumbs.push({ label: part, path: current }); });
    return crumbs;
  }, [folder, rootFolder, isGraph]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const navigateInto = (entry: LocalSourceEntry & { webUrl?: string }) => {
    if (isGraph) {
      const parsed = parseGraphPath(entry.path);
      if (parsed) setGraphStack((s) => [...s, { name: entry.name, itemId: parsed.itemId }]);
    } else {
      setFolder(entry.path);
    }
  };

  const graphNavigateTo = (index: number) => {
    setGraphStack((s) => s.slice(0, index + 1));
  };

  // ── File open / ask ───────────────────────────────────────────────────────
  const openFile = (entry: LocalSourceEntry & { webUrl?: string }) => {
    if (isGraph) {
      // Open in SharePoint web view; no in-app binary preview for Graph files
      if (entry.webUrl) window.open(entry.webUrl, "_blank", "noopener");
      return;
    }
    if (!entry.type) return;
    onSourceSelect({
      id: `browse-${entry.path}`,
      docId: entry.name,
      title: titleFromFileName(entry.name),
      slide: 1,
      serviceLine: "BFSI",
      filePath: entry.path,
      fileType: entry.type,
    });
  };

  useEffect(() => {
    if (askEntry) setTimeout(() => askTextareaRef.current?.focus(), 60);
  }, [askEntry]);

  const closeAsk = () => {
    setAskEntry(null);
    setAskPrompt("");
  };

  const submitAsk = () => {
    const query = askPrompt.trim();
    if (!query) return;
    onAskDocument(query);
    closeAsk();
  };

  // ── Refresh index ─────────────────────────────────────────────────────────
  const refreshIndex = async () => {
    if (indexState === "indexing") return;
    setIndexState("indexing");
    setIndexMsg("Starting…");
    try {
      let url: string;
      let bodyPayload: object;

      if (isGraph) {
        url = "/api/graph/index";
        bodyPayload = {
          driveId: graphDriveId,
          mockMode: graphMockMode,
          tenantId: graphTenantId,
          clientId: graphClientId,
          siteUrl: graphSiteUrl,
          ollamaBaseUrl,
          embedModel: ollamaEmbedModel,
          enableAssetLlmEnrichment,
          aiProvider,
          ollamaModel,
          openrouterApiKey,
          openrouterModel,
          geminiApiKey,
          geminiModel,
        };
      } else {
        url = "/api/local/index";
        bodyPayload = {
          folderPath: rootFolder,
          ollamaBaseUrl,
          embedModel: ollamaEmbedModel,
          enableAssetLlmEnrichment,
          aiProvider,
          ollamaModel,
          openrouterApiKey,
          openrouterModel,
          geminiApiKey,
          geminiModel,
        };
      }

      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyPayload) });
      if (!res.ok || !res.body) throw new Error(`Server error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.msg)   setIndexMsg(event.msg);
            if (event.done)  setIndexState("done");
            if (event.error) { setIndexMsg(event.error); setIndexState("error"); }
          } catch {}
        }
      }
      setIndexState((s) => (s === "indexing" ? "done" : s));
    } catch (err) {
      setIndexMsg(String(err));
      setIndexState("error");
    }
  };

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!isGraph && !rootFolder) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold text-slate-800">No source folder configured</h2>
          <p className="mt-2 text-sm text-slate-500">Add a local folder or connect SharePoint in Settings.</p>
          <button onClick={onOpenSettings} className="mt-5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">Open settings</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-8 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-800">
                {selectedCategory
                  ? `${selectedLine ?? "All"} ${selectedCategory}`
                  : isGraph ? "SharePoint Documents" : "Document Source"}
              </h1>
              {isGraph && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-100">
                  {graphMockMode ? "Mock" : "Live"}
                </span>
              )}
            </div>

            {/* Breadcrumbs */}
            <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-slate-500">
              {isGraph ? (
                graphStack.map((crumb, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-slate-300">/</span>}
                    <button
                      onClick={() => graphNavigateTo(i)}
                      className="rounded-md px-1.5 py-0.5 hover:bg-slate-100 hover:text-slate-700"
                    >
                      {crumb.name}
                    </button>
                  </span>
                ))
              ) : (
                localPathParts.map((part, i) => (
                  <span key={part.path} className="flex items-center gap-1">
                    {i > 0 && <span className="text-slate-300">/</span>}
                    <button onClick={() => setFolder(part.path)} className="max-w-[180px] truncate rounded-md px-1.5 py-0.5 hover:bg-slate-100 hover:text-slate-700" title={part.path}>
                      {part.label}
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex shrink-0 items-center gap-2">
            {!isGraph && !selectedCategory && (
              <button onClick={() => setFolder(rootFolder)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">Root</button>
            )}
            <button onClick={() => setRefreshKey((k) => k + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">Refresh</button>
            <button
              onClick={refreshIndex}
              disabled={indexState === "indexing"}
              title="Re-index all documents (picks up new files)"
              className="flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
            >
              {indexState === "indexing" ? (
                <><svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Indexing…</>
              ) : (
                <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2m15.357 2H15" /></svg>Refresh Index</>
              )}
            </button>
          </div>
        </div>

        {/* Index status bar */}
        {indexState !== "idle" && (
          <div className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${indexState === "error" ? "bg-red-50 text-red-700" : indexState === "done" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>
            {indexState === "indexing"
              ? <div ref={logRef} className="flex-1 font-mono truncate">{indexMsg}</div>
              : <><span className="flex-1">{indexMsg}</span><button onClick={() => setIndexState("idle")} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">✕</button></>
            }
          </div>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {loading && (
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">Loading…</div>
        )}
        {error && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-4">
            <p className="text-sm font-semibold text-red-700">Could not load files</p>
            <p className="mt-1 break-all font-mono text-xs text-red-500">{error}</p>
          </div>
        )}
        {!loading && !error && visibleEntries.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-10 text-center">
            <p className="text-sm font-semibold text-slate-700">
              {selectedCategory ? `No ${selectedCategory.toLowerCase()} documents found.` : "No supported documents found here."}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {selectedCategory ? "Matching is based on file names and folder paths." : "This browser shows folders plus PDF and PPTX files."}
            </p>
          </div>
        )}
        {!loading && !error && visibleEntries.length > 0 && selectedCategory && (
          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-400">Related Documents</p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {visibleEntries.filter((entry) => entry.kind === "file").map((entry) => {
                const sourceId = `browse-${entry.path}`;
                const isSelected = selectedSourceId === sourceId;
                return (
                  <article
                    key={entry.path}
                    className={`rounded-lg border bg-white p-4 shadow-sm transition-colors ${
                      isSelected ? "border-sky-300 ring-2 ring-sky-100" : "border-slate-200 hover:border-sky-200"
                    }`}
                  >
                    <div className="mb-3 flex items-center gap-2">
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold text-blue-700">
                        {categoryBadge(selectedCategory)}
                      </span>
                      <span className="text-xs font-medium text-slate-400">{selectedLine ?? "All"}</span>
                    </div>

                    <h2 className="min-h-[2.5rem] text-sm font-bold leading-snug text-slate-800">
                      {titleFromFileName(entry.name)}
                    </h2>

                    <p className="mt-3 text-xs text-slate-500">
                      {[formatBytes(entry.sizeBytes), entry.type?.toUpperCase()].filter(Boolean).join(" · ")}
                    </p>

                    <div className="mt-5 flex items-center gap-3">
                      <span className="mr-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
                        {entry.type?.toUpperCase()}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => openFile(entry)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        View
                      </button>
                      <button
                        onClick={() => setAskEntry(entry)}
                        className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
                      >
                        Ask AI
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
        {!loading && !error && visibleEntries.length > 0 && !selectedCategory && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[minmax(0,1fr)_120px_120px_160px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <span>Name</span><span>Type</span><span>Size</span><span>Modified</span>
            </div>
            <div className="divide-y divide-slate-100">
              {visibleEntries.map((entry) => {
                const sourceId = `browse-${entry.path}`;
                const isSelected = selectedSourceId === sourceId;
                return (
                  <div key={entry.path} className={`grid grid-cols-[minmax(0,1fr)_120px_120px_160px] items-center gap-3 px-4 py-3 transition-colors ${isSelected ? "bg-sky-50" : "hover:bg-slate-50"}`}>
                    <button onClick={() => entry.kind === "directory" ? navigateInto(entry) : openFile(entry)} className="flex min-w-0 items-center gap-3 text-left">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${entry.kind === "directory" ? "bg-amber-50 text-amber-700" : entry.type === "pdf" ? "bg-red-50 text-red-600" : "bg-orange-50 text-orange-600"}`}>
                        {entry.kind === "directory" ? "DIR" : entry.type?.toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-700">{entry.name}</span>
                        <span className="block truncate text-xs text-slate-400">
                          {isGraph ? (entry.webUrl ?? entry.path) : entry.path}
                        </span>
                      </span>
                    </button>
                    <span className="text-xs font-medium text-slate-500">{entry.kind === "directory" ? "Folder" : entry.type?.toUpperCase()}</span>
                    <span className="text-xs text-slate-400">{formatBytes(entry.sizeBytes)}</span>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-400">{formatDate(entry.modifiedAt)}</span>
                      {entry.kind === "file" && (
                        <button onClick={() => setAskEntry(entry)} className="rounded-md bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700">Ask AI</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {askEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeAsk(); }}
        >
          <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start gap-4 border-b border-slate-100 px-6 py-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-600">
                <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-sky-600">Ask AI about</p>
                <h2 className="line-clamp-2 text-sm font-bold leading-snug text-slate-800">{titleFromFileName(askEntry.name)}</h2>
                <p className="mt-1 truncate text-[10px] text-slate-400">{askEntry.path}</p>
              </div>
              <button
                onClick={closeAsk}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col gap-4 px-6 py-5">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Quick prompts</p>
                <div className="flex flex-wrap gap-2">
                  {ASK_SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setAskPrompt(suggestion);
                        askTextareaRef.current?.focus();
                      }}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                        askPrompt === suggestion
                          ? "border-sky-600 bg-sky-600 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                      }`}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Your question</p>
                <textarea
                  ref={askTextareaRef}
                  value={askPrompt}
                  onChange={(e) => setAskPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitAsk();
                  }}
                  placeholder="e.g. What metrics and proof points are mentioned?"
                  rows={4}
                  className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none transition-all placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-50"
                />
                <p className="mt-2 text-[11px] text-slate-400">Press Cmd/Ctrl + Enter to ask</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button
                onClick={closeAsk}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={submitAsk}
                disabled={!askPrompt.trim()}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Ask AI
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
