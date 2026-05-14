"use client";

import { useEffect, useState, useCallback } from "react";
import type { LocalSourceEntry } from "@/types";
import type { AIProvider } from "@/types";

interface SessionInfo { signedIn: boolean; name?: string; email?: string }
interface Props {
  embeddingProvider: "ollama" | "google";
  ollamaBaseUrl:  string;
  embedModel:     string;
  enableAssetLlmEnrichment?: boolean;
  aiProvider?: AIProvider;
  ollamaModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  onIndexed?:     () => void;
}

export default function OneDrivePicker({
  embeddingProvider, ollamaBaseUrl, embedModel, enableAssetLlmEnrichment = false,
  aiProvider, ollamaModel, openrouterApiKey, openrouterModel, geminiApiKey, geminiModel, onIndexed,
}: Props) {
  const [session,   setSession]   = useState<SessionInfo | null>(null);
  const [entries,   setEntries]   = useState<LocalSourceEntry[]>([]);
  const [stack,     setStack]     = useState<{ id: string | null; name: string }[]>([{ id: null, name: "My OneDrive" }]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [selected,  setSelected]  = useState<Set<string>>(new Set());
  const [syncing,   setSyncing]   = useState(false);
  const [syncLog,   setSyncLog]   = useState<string[]>([]);
  const [syncError, setSyncError] = useState("");
  const [syncDone,  setSyncDone]  = useState(false);

  const currentFolder = stack[stack.length - 1];

  // Check sign-in status
  useEffect(() => {
    fetch("/api/onedrive/session")
      .then(r => r.json())
      .then(setSession)
      .catch(() => setSession({ signedIn: false }));
  }, []);

  const loadFolder = useCallback(async (itemId: string | null) => {
    setLoading(true); setError(""); setEntries([]);
    try {
      const params = itemId ? `?itemId=${encodeURIComponent(itemId)}` : "";
      const res    = await fetch(`/api/onedrive/files${params}`);
      const data   = await res.json();
      if (data.error) throw new Error(data.error);
      setEntries(data.entries ?? []);
    } catch (e) { setError(String(e)); }
    finally    { setLoading(false); }
  }, []);

  useEffect(() => {
    if (session?.signedIn) loadFolder(currentFolder.id);
  }, [session?.signedIn, currentFolder.id, loadFolder]);

  const navigate = (entry: LocalSourceEntry) => {
    if (entry.kind !== "directory") return;
    const id = entry.path.replace("onedrive:", "");
    setStack(prev => [...prev, { id, name: entry.name }]);
  };

  const goBack = () => setStack(prev => prev.length > 1 ? prev.slice(0, -1) : prev);

  const toggleSelect = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const selectAll = () => {
    const fileIds = entries.filter(e => e.kind === "file" && (e.type === "pdf" || e.type === "pptx")).map(e => e.path);
    setSelected(new Set(fileIds));
  };

  const aiPayload = {
    enableAssetLlmEnrichment,
    aiProvider,
    ollamaModel,
    openrouterApiKey,
    openrouterModel,
    geminiApiKey,
    geminiModel,
  };

  const syncSelected = async () => {
    if (selected.size === 0) return;
    setSyncing(true); setSyncLog([]); setSyncError(""); setSyncDone(false);
    try {
      const itemIds = Array.from(selected).map(p => p.replace("onedrive:", ""));
      const res = await fetch("/api/onedrive/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemIds,
          embeddingProvider, ollamaBaseUrl, embedModel,
          ...aiPayload,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Server error: ${res.status}`);
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.msg)   setSyncLog(p => [...p, evt.msg]);
            if (evt.done)  { setSyncDone(true); onIndexed?.(); }
            if (evt.error) setSyncError(evt.error);
          } catch {}
        }
      }
    } catch (e) { setSyncError(String(e)); }
    finally    { setSyncing(false); }
  };

  const syncFolder = async () => {
    if (!currentFolder.id) return;
    setSyncing(true); setSyncLog([]); setSyncError(""); setSyncDone(false);
    try {
      const res = await fetch("/api/onedrive/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemIds: [],
          folderItemId:  currentFolder.id,
          syncFolderMode: true,
          embeddingProvider, ollamaBaseUrl, embedModel,
          ...aiPayload,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Server error: ${res.status}`);
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.msg)   setSyncLog(p => [...p, evt.msg]);
            if (evt.done)  { setSyncDone(true); onIndexed?.(); }
            if (evt.error) setSyncError(evt.error);
          } catch {}
        }
      }
    } catch (e) { setSyncError(String(e)); }
    finally    { setSyncing(false); }
  };

  if (!session) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session.signedIn) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-sky-100 bg-sky-50 px-4 py-3 text-xs text-sky-700">
          Sign in with your Microsoft account to browse and index files from your OneDrive or SharePoint.
        </div>
        <a
          href="/api/auth/signin/azure-ad"
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 23 23" fill="none">
            <path d="M1 1h10v10H1z" fill="#f25022"/>
            <path d="M12 1h10v10H12z" fill="#7fba00"/>
            <path d="M1 12h10v10H1z" fill="#00a4ef"/>
            <path d="M12 12h10v10H12z" fill="#ffb900"/>
          </svg>
          Sign in with Microsoft
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Signed-in header */}
      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-emerald-200 flex items-center justify-center text-[10px] font-bold text-emerald-700">
            {(session.name ?? session.email ?? "?")[0].toUpperCase()}
          </div>
          <div>
            <p className="text-xs font-semibold text-emerald-800">{session.name ?? session.email}</p>
            {session.name && <p className="text-[10px] text-emerald-600">{session.email}</p>}
          </div>
        </div>
        <a href="/api/auth/signout" className="text-[10px] text-slate-400 hover:text-slate-600 underline">Sign out</a>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-slate-500 flex-wrap">
        {stack.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-300">/</span>}
            <button
              onClick={() => setStack(prev => prev.slice(0, i + 1))}
              className={i === stack.length - 1 ? "font-medium text-slate-700" : "hover:text-sky-600"}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>

      {/* File list */}
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2">
            {stack.length > 1 && (
              <button onClick={goBack} className="text-[11px] text-sky-600 hover:text-sky-700 font-medium flex items-center gap-0.5">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            )}
            <button onClick={selectAll} className="text-[11px] text-slate-500 hover:text-slate-700">Select all files</button>
          </div>
          <span className="text-[10px] text-slate-400">{selected.size} selected</span>
        </div>

        {/* Entries */}
        <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
          {loading && (
            <div className="flex items-center justify-center py-6 gap-2">
              <div className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-slate-400">Loading…</span>
            </div>
          )}
          {error && <p className="px-3 py-3 text-xs text-red-500">{error}</p>}
          {!loading && !error && entries.length === 0 && (
            <p className="px-3 py-4 text-xs text-slate-400 text-center">No PDF or PPTX files found here.</p>
          )}
          {!loading && entries.map((entry) => {
            const isFile   = entry.kind === "file";
            const isDoc    = isFile && (entry.type === "pdf" || entry.type === "pptx");
            const isChosen = selected.has(entry.path);
            return (
              <div
                key={entry.path}
                onClick={() => isDoc ? toggleSelect(entry.path) : navigate(entry)}
                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
                  isChosen ? "bg-sky-50" : "hover:bg-slate-50"
                } ${!isDoc && entry.kind !== "directory" && "opacity-40 cursor-default"}`}
              >
                {/* Icon */}
                {entry.kind === "directory" ? (
                  <svg className="w-4 h-4 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                  </svg>
                ) : entry.type === "pdf" ? (
                  <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                ) : entry.type === "pptx" ? (
                  <svg className="w-4 h-4 text-orange-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                )}

                <span className="flex-1 text-xs text-slate-700 truncate">{entry.name}</span>

                {isDoc && (
                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    isChosen ? "bg-sky-600 border-sky-600" : "border-slate-300"
                  }`}>
                    {isChosen && (
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                )}
                {entry.kind === "directory" && entry.name !== undefined && (
                  <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Sync log */}
      {syncLog.length > 0 && (
        <div className="max-h-28 overflow-y-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs text-slate-300 space-y-0.5">
          {syncLog.map((line, i) => <div key={i}>{line}</div>)}
          {syncing && <div className="text-sky-400 animate-pulse">Syncing…</div>}
          {syncDone && <div className="text-emerald-400 font-semibold">✓ Index complete</div>}
        </div>
      )}
      {syncError && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{syncError}</p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={syncSelected}
          disabled={selected.size === 0 || syncing}
          className="flex-1 py-2 rounded-lg border border-sky-200 bg-sky-50 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {syncing ? "Indexing…" : `Index ${selected.size > 0 ? `${selected.size} selected` : "selected"}`}
        </button>
        {currentFolder.id && (
          <button
            onClick={syncFolder}
            disabled={syncing}
            className="flex-1 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Index entire folder
          </button>
        )}
      </div>
    </div>
  );
}
