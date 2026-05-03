"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ServiceLine, Source, AppConfig, Document } from "@/types";
import { DEFAULT_CONFIG } from "@/types";
import { aiAnswer } from "@/data/mockData";
import Sidebar from "@/components/Sidebar";
import ChatInput from "@/components/ChatInput";
import Card from "@/components/Card";
import PreviewPanel from "@/components/PreviewPanel";
import LocalDocPreview from "@/components/LocalDocPreview";
import Settings from "@/components/Settings";
import DocumentBrowser from "@/components/DocumentBrowser";
import {
  loadSessions,
  saveSession,
  deleteSession,
  stripDocsForStorage,
  type ChatSession,
} from "@/lib/chatStorage";

const CONFIG_KEY = "apexon-hub-config";

interface AgentLogEntry {
  iteration: number;
  tool: string;
  query: string;
  found: number;
  tokens?: number;
}

interface TokenUsage {
  agentTokens: number;
  synthesisTokens: number;
  totalTokens: number;
}

interface Turn {
  id: string;
  query: string;
  answer?: string;
  keyPoints?: string[];
  metrics?: string[];
  sources?: Source[];
  docs?: Document[];
  isLoading: boolean;
  agentLog?: AgentLogEntry[];
  tokenUsage?: TokenUsage;
}

const SUGGESTIONS = [
  "Show me BFSI case studies with ROI metrics",
  "What differentiators do we have for healthcare digital transformation?",
  "Find RFP responses mentioning cloud migration",
  "What proof points do we have for data analytics projects?",
];

export default function Page() {
  // ── Config ────────────────────────────────────────────────────────────────
  const [config, setConfig]           = useState<AppConfig>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CONFIG_KEY);
      if (saved) setConfig(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  const saveConfig = (next: AppConfig) => {
    setConfig(next);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    setShowSettings(false);
  };

  // ── Session persistence ───────────────────────────────────────────────────

  // Load sessions on mount and restore most recent
  useEffect(() => {
    const stored = loadSessions();
    setSessions(stored);
    if (stored.length > 0) {
      const latest = stored[0];
      setActiveSessionId(latest.id);
      setTurns(latest.turns.map((t) => ({ ...t, isLoading: false, docs: t.docs as unknown as Document[] })));
    }
  }, []);

  // Persist current session whenever completed turns change
  const persistTurns = useCallback((completedTurns: Turn[], sessionId: string) => {
    if (completedTurns.length === 0) return;
    const session: ChatSession = {
      id:        sessionId,
      title:     completedTurns[0].query.slice(0, 80),
      createdAt: new Date().toISOString(),
      turns:     completedTurns.map((t) => ({
        id:         t.id,
        query:      t.query,
        answer:     t.answer,
        keyPoints:  t.keyPoints,
        metrics:    t.metrics,
        sources:    t.sources,
        docs:       stripDocsForStorage(t.docs),
        agentLog:   t.agentLog,
        tokenUsage: t.tokenUsage,
      })),
    };
    saveSession(session);
    setSessions(loadSessions());
  }, []);

  const newSessionId = () => `session-${Date.now()}`;

  // ── State ─────────────────────────────────────────────────────────────────
  const [selectedLine,     setSelectedLine]     = useState<ServiceLine | null>(null);
  const [selectedSource,   setSelectedSource]   = useState<Source | null>(null);
  const [view,             setView]             = useState<"chat" | "source">("chat");
  const [turns,            setTurns]            = useState<Turn[]>([]);
  const [searchMode,       setSearchMode]       = useState<"rag" | "mixed">("rag");
  const [sessions,         setSessions]         = useState<ChatSession[]>([]);
  const [activeSessionId,  setActiveSessionId]  = useState<string | null>(null);

  // Keep a stable ref to activeSessionId so callbacks don't need it in deps
  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSessionId;

  const currentTurn  = turns[turns.length - 1] ?? null;
  const isAnyLoading = currentTurn?.isLoading ?? false;
  const bottomRef    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, isAnyLoading]);

  // ── Derived config ────────────────────────────────────────────────────────
  const sourceKey =
    config.sourceType === "sharepoint"
      ? `graph:${config.graphDriveId || "mock-drive-documents"}`
      : config.folderPath;

  const hasDocumentSource =
    config.sourceType === "sharepoint" || Boolean(config.folderPath);

  const isLocalMode =
    hasDocumentSource &&
    ((config.aiProvider === "ollama"     && Boolean(config.ollamaModel)) ||
     (config.aiProvider === "openrouter" && Boolean(config.openrouterModel)) ||
     (config.aiProvider === "gemini"     && Boolean(config.geminiModel)));

  // ── Search ────────────────────────────────────────────────────────────────
  const handleSearch = async (q: string) => {
    setView("chat");
    setSelectedSource(null);

    // Create a new session if none is active
    let sessionId = activeSessionIdRef.current;
    if (!sessionId) {
      sessionId = newSessionId();
      setActiveSessionId(sessionId);
    }

    const turnId = `turn-${Date.now()}`;
    const completedTurns = turns.filter((t) => !t.isLoading && t.answer);
    const conversationHistory = completedTurns.flatMap((t) => [
      { role: "user",      content: t.query },
      { role: "assistant", content: t.answer ?? "" },
    ]);

    setTurns((prev) => [...prev, { id: turnId, query: q, isLoading: true }]);

    if (!isLocalMode) {
      setTurns((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, isLoading: false } : t))
      );
      return;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 270_000);
      const res = await fetch("/api/ai/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          query: q,
          conversationHistory,
          sourceKey,
          searchMode,
          tavilyApiKey:      config.tavilyApiKey,
          aiProvider:        config.aiProvider,
          ollamaBaseUrl:     config.ollamaBaseUrl,
          ollamaModel:       config.ollamaModel,
          ollamaEmbedModel:  config.ollamaEmbedModel,
          openrouterApiKey:  config.openrouterApiKey,
          openrouterModel:   config.openrouterModel,
          geminiApiKey:      config.geminiApiKey,
          geminiModel:       config.geminiModel,
          embeddingProvider: config.embeddingProvider,
        }),
      });
      clearTimeout(timer);

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setTurns((prev) => {
        const next = prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                isLoading:  false,
                answer:     data.answer,
                keyPoints:  data.keyPoints  ?? [],
                metrics:    data.metrics    ?? [],
                sources:    data.sources    ?? [],
                docs:       data.documents  ?? [],
                agentLog:   data.agentLog,
                tokenUsage: data.tokenUsage,
              }
            : t
        );
        // Persist after state update
        const completed = next.filter((t) => !t.isLoading && t.answer);
        if (sessionId) persistTurns(completed, sessionId);
        return next;
      });
    } catch (err) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? { ...t, isLoading: false, answer: `Error: ${String(err)}`, keyPoints: [], metrics: [], sources: [], docs: [] }
            : t
        )
      );
    }
  };

  const goHome = () => { setTurns([]); setView("chat"); setActiveSessionId(null); };

  const handleNewChat = () => {
    setTurns([]);
    setView("chat");
    setActiveSessionId(null);
    setSelectedSource(null);
  };

  const handleSelectSession = (id: string) => {
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    setActiveSessionId(id);
    setTurns(session.turns.map((t) => ({ ...t, isLoading: false, docs: t.docs as unknown as Document[] })));
    setView("chat");
    setSelectedSource(null);
  };

  const handleDeleteSession = (id: string) => {
    deleteSession(id);
    setSessions(loadSessions());
    if (activeSessionId === id) {
      setTurns([]);
      setActiveSessionId(null);
    }
  };

  // ── Right panel ───────────────────────────────────────────────────────────
  const showLocalPreview = selectedSource?.filePath != null;

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* Sidebar */}
      <Sidebar
        selectedLine={selectedLine}
        onSelect={setSelectedLine}
        config={config}
        onOpenSettings={() => setShowSettings(true)}
        onGoHome={goHome}
        onNewChat={handleNewChat}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
      />

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {view === "source" ? (
          <DocumentBrowser
            rootFolder={config.folderPath}
            sourceType={config.sourceType}
            graphDriveId={config.graphDriveId || "mock-drive-documents"}
            graphMockMode={config.graphMockMode}
            graphTenantId={config.graphTenantId}
            graphClientId={config.graphClientId}
            graphClientSecret={config.graphClientSecret}
            graphSiteUrl={config.graphSiteUrl}
            selectedSourceId={selectedSource?.id ?? null}
            onSourceSelect={setSelectedSource}
            onAskDocument={handleSearch}
            onOpenSettings={() => setShowSettings(true)}
            ollamaBaseUrl={config.ollamaBaseUrl}
            ollamaEmbedModel={config.ollamaEmbedModel}
          />
        ) : (
          <div className="flex flex-col h-full overflow-hidden">

            {/* ── Slim top bar ─────────────────────────────────────────── */}
            <div className="shrink-0 flex items-center justify-between px-6 py-2.5 border-b border-slate-100 bg-white">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                    isLocalMode
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-slate-100 text-slate-500 border-slate-200"
                  }`}
                >
                  {isLocalMode
                    ? `● ${config.aiProvider === "ollama" ? config.ollamaModel : config.aiProvider === "gemini" ? config.geminiModel : config.openrouterModel}`
                    : "Mock mode"}
                </span>
                {turns.length > 0 && (
                  <span className="text-xs text-slate-400">
                    {turns.length} message{turns.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <button
                onClick={() => setView("source")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                </svg>
                Browse docs
              </button>
            </div>

            {/* ── Scrollable messages ───────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">
              {turns.length === 0 ? (
                /* ── Landing / empty state ── */
                <div className="max-w-2xl mx-auto px-6 flex flex-col items-center justify-center h-full gap-8 pb-24">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-sky-600 flex items-center justify-center shadow-lg">
                      <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-slate-800">Apexon Knowledge Hub</h1>
                    <p className="text-sm text-slate-500">
                      {isLocalMode
                        ? "Search your documents — ask follow-up questions in the same conversation"
                        : "AI-powered search across RFPs, POVs, and case studies"}
                    </p>
                    {!hasDocumentSource && (
                      <button
                        onClick={() => setShowSettings(true)}
                        className="mt-1 px-4 py-2 rounded-full bg-sky-50 border border-sky-200 text-xs font-semibold text-sky-700 hover:bg-sky-100 transition-colors"
                      >
                        ⚙ Configure folder &amp; AI to get started
                      </button>
                    )}
                  </div>

                  {/* Quick-start suggestions */}
                  <div className="w-full grid grid-cols-2 gap-3">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => handleSearch(s)}
                        className="text-left px-4 py-3 rounded-xl border border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50 text-xs text-slate-600 font-medium transition-all shadow-sm"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* ── Chat messages ── */
                <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-8">
                  {turns.map((turn, idx) => (
                    <div key={turn.id} className="flex flex-col gap-3">

                      {/* User message */}
                      <div className="flex justify-end">
                        <div className="max-w-[75%] bg-slate-100 rounded-2xl rounded-br-sm px-4 py-3">
                          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{turn.query}</p>
                        </div>
                      </div>

                      {/* AI message */}
                      <div className="flex gap-3 items-start">
                        {/* Avatar */}
                        <div className="w-8 h-8 rounded-full bg-sky-600 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 flex flex-col gap-3">
                          {turn.isLoading ? (
                            <div className="flex flex-col gap-2 pt-1">
                              {[90, 75, 55].map((w) => (
                                <div key={w} className="h-3 rounded-full bg-slate-100 animate-pulse" style={{ width: `${w}%` }} />
                              ))}
                            </div>
                          ) : (turn.answer ?? (isLocalMode ? null : aiAnswer.answer)) ? (
                            <>
                              {/* Answer prose */}
                              <p className="text-sm text-slate-700 leading-relaxed">
                                {turn.answer ?? aiAnswer.answer}
                              </p>

                              {/* Proof points */}
                              {(turn.metrics?.length ?? 0) > 0 && (
                                <div className="flex flex-wrap gap-2">
                                  {turn.metrics!.map((m, i) => (
                                    <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
                                      <svg className="w-2.5 h-2.5 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                      </svg>
                                      {m}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Key points */}
                              {(turn.keyPoints?.length ?? 0) > 0 && (
                                <ul className="flex flex-col gap-1.5 pl-1">
                                  {turn.keyPoints!.map((kp, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
                                      {kp}
                                    </li>
                                  ))}
                                </ul>
                              )}

                              {/* Source citations */}
                              {((turn.sources?.length ?? 0) > 0 || (!isLocalMode && aiAnswer.sources.length > 0)) && (
                                <div>
                                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Sources</p>
                                  <div className="flex flex-wrap gap-2">
                                    {(turn.sources ?? aiAnswer.sources).map((src, i) => {
                                      if (src.sourceType === "web") {
                                        return (
                                          <a
                                            key={src.id}
                                            href={src.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all bg-white text-violet-700 border-violet-200 hover:bg-violet-50 hover:border-violet-400"
                                          >
                                            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                                            </svg>
                                            {src.title}
                                            <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-violet-100 text-violet-600">WEB</span>
                                          </a>
                                        );
                                      }
                                      const isSelected = selectedSource?.id === src.id;
                                      return (
                                        <button
                                          key={src.id}
                                          onClick={() => setSelectedSource(src)}
                                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                                            isSelected
                                              ? "bg-sky-600 text-white border-sky-600 shadow-sm"
                                              : "bg-white text-sky-700 border-sky-200 hover:bg-sky-50 hover:border-sky-400"
                                          }`}
                                        >
                                          <span
                                            className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                                            style={isSelected
                                              ? { backgroundColor: "rgba(255,255,255,0.2)", color: "white" }
                                              : { backgroundColor: "#e0f2fe", color: "#0369a1" }}
                                          >
                                            {i + 1}
                                          </span>
                                          {src.title}
                                          <span className={isSelected ? "text-sky-100" : "text-slate-400"}>
                                            · {src.fileType === "pdf" ? "p." : "slide"} {src.slide}
                                          </span>
                                          <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${isSelected ? "bg-white/20 text-white" : "bg-sky-100 text-sky-600"}`}>RAG</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Agent trace + token usage */}
                              {(turn.agentLog?.length || turn.tokenUsage) && (
                                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 flex flex-col gap-1.5">
                                  {turn.agentLog?.map((entry, i) => (
                                    <div key={i} className="flex items-center gap-2 text-[11px] text-slate-500">
                                      {entry.tool === "search_web" ? (
                                        <svg className="w-3 h-3 shrink-0 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9" />
                                        </svg>
                                      ) : (
                                        <svg className="w-3 h-3 shrink-0 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                        </svg>
                                      )}
                                      <span className={entry.tool === "search_web" ? "text-violet-500 font-medium" : "text-sky-600 font-medium"}>
                                        {entry.tool === "search_web" ? "web" : "docs"}
                                      </span>
                                      <span className="truncate max-w-[200px] text-slate-400">"{entry.query}"</span>
                                      <span className="shrink-0 text-slate-400">→ {entry.found} result{entry.found !== 1 ? "s" : ""}</span>
                                      {(entry.tokens ?? 0) > 0 && (
                                        <span className="shrink-0 text-slate-300">· {entry.tokens!.toLocaleString()} tk</span>
                                      )}
                                    </div>
                                  ))}
                                  {turn.tokenUsage && (
                                    <div className="flex items-center gap-3 pt-1 border-t border-slate-100 mt-0.5">
                                      <span className="text-[11px] font-semibold text-slate-400">Tokens</span>
                                      {turn.tokenUsage.agentTokens > 0 && (
                                        <span className="text-[11px] text-slate-400">
                                          agent <span className="text-slate-600 font-medium">{turn.tokenUsage.agentTokens.toLocaleString()}</span>
                                        </span>
                                      )}
                                      {turn.tokenUsage.synthesisTokens > 0 && (
                                        <span className="text-[11px] text-slate-400">
                                          synthesis <span className="text-slate-600 font-medium">{turn.tokenUsage.synthesisTokens.toLocaleString()}</span>
                                        </span>
                                      )}
                                      <span className="ml-auto text-[11px] font-semibold text-slate-600">
                                        {turn.tokenUsage.totalTokens.toLocaleString()} total
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Document cards */}
                              {(turn.docs?.length ?? 0) > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Related documents</p>
                                  <div className="grid grid-cols-2 gap-3">
                                    {(idx === turns.length - 1 ? turn.docs! : turn.docs!.slice(0, 2)).map((doc) => (
                                      <Card
                                        key={doc.id}
                                        doc={doc}
                                        onView={(d) =>
                                          setSelectedSource({
                                            id: `view-${d.id}`,
                                            docId: d.id,
                                            title: d.title,
                                            slide: 1,
                                            serviceLine: d.serviceLine,
                                            filePath: (d as Document & { filePath?: string }).filePath,
                                            fileType: (d as Document & { fileType?: "pdf" | "pptx" }).fileType,
                                          })
                                        }
                                        onAskAI={(_, prompt) => handleSearch(prompt)}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            !isLocalMode ? null : (
                              <p className="text-sm text-slate-400 italic">No response received.</p>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  <div ref={bottomRef} />
                </div>
              )}
            </div>

            {/* ── Fixed input bar ───────────────────────────────────────── */}
            <div className="shrink-0 border-t border-slate-100 bg-white px-6 pt-3 pb-4">
              <div className="max-w-3xl mx-auto flex flex-col gap-2">
                {/* Search mode toggle */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-0.5 p-1 rounded-full bg-slate-100 border border-slate-200">
                    <button
                      onClick={() => setSearchMode("rag")}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                        searchMode === "rag"
                          ? "bg-white text-slate-700 shadow-sm"
                          : "text-slate-400 hover:text-slate-600"
                      }`}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Documents
                    </button>
                    <button
                      onClick={() => setSearchMode("mixed")}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                        searchMode === "mixed"
                          ? "bg-white text-violet-700 shadow-sm"
                          : "text-slate-400 hover:text-slate-600"
                      }`}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                      </svg>
                      + Web
                    </button>
                  </div>
                  {searchMode === "mixed" && !config.tavilyApiKey && (
                    <button
                      onClick={() => setShowSettings(true)}
                      className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full hover:bg-amber-100 transition-colors"
                    >
                      Add Tavily key in Settings →
                    </button>
                  )}
                  {searchMode === "mixed" && config.tavilyApiKey && (
                    <span className="text-[11px] text-violet-600 bg-violet-50 border border-violet-200 px-2.5 py-1 rounded-full">
                      ● Web search active
                    </span>
                  )}
                </div>
                <ChatInput onSend={handleSearch} isLoading={isAnyLoading} />
              </div>
            </div>

          </div>
        )}
      </main>

      {/* Right panel */}
      {showLocalPreview && selectedSource ? (
        <LocalDocPreview source={selectedSource} />
      ) : (
        <PreviewPanel source={selectedSource} />
      )}

      {/* Settings */}
      {showSettings && (
        <Settings
          config={config}
          onSave={saveConfig}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
