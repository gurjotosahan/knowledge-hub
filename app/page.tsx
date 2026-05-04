"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { ServiceLine, Source, AppConfig, Document } from "@/types";
import { DEFAULT_CONFIG } from "@/types";
import { aiAnswer } from "@/data/mockData";
import Sidebar from "@/components/Sidebar";
import ChatInput from "@/components/ChatInput";
import Card from "@/components/Card";
import PreviewPanel from "@/components/PreviewPanel";
import LocalDocPreview, { type SlideDeck, type SlideDeckItem } from "@/components/LocalDocPreview";
import Settings from "@/components/Settings";
import DocumentBrowser from "@/components/DocumentBrowser";
import ClientResearch from "@/components/ClientResearch";
import {
  loadSessions,
  saveSession,
  deleteSession,
  stripDocsForStorage,
  type ChatSession,
} from "@/lib/chatStorage";

const CONFIG_KEY = "apexon-hub-config";
const DECKS_KEY = "apexon-hub-slide-decks";

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

function renderAnswerWithCitations(
  text: string,
  sources: Source[],
  onSourceClick: (src: Source) => void
): React.ReactNode[] {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const idx = parseInt(match[1], 10) - 1;
      const src = sources?.[idx];
      if (src) {
        return (
          <button
            key={i}
            onClick={() => onSourceClick(src)}
            className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold align-super mx-0.5 bg-sky-100 text-sky-700 hover:bg-sky-600 hover:text-white transition-colors cursor-pointer"
          >
            {idx + 1}
          </button>
        );
      }
      return <span key={i} className="text-[10px] align-super text-slate-400 mx-0.5">{part}</span>;
    }
    return <span key={i}>{part}</span>;
  });
}

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(getText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="flex justify-end">
      <button
        onClick={handleCopy}
        title="Copy response"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
      >
        {copied ? (
          <>
            <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-emerald-500">Copied</span>
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy
          </>
        )}
      </button>
    </div>
  );
}

const SUGGESTIONS = [
  "Show me BFSI case studies with ROI metrics",
  "What differentiators do we have for healthcare digital transformation?",
  "Find RFP responses mentioning cloud migration",
  "What proof points do we have for data analytics projects?",
];

function newDeckName(count: number): string {
  return `Deck ${count + 1}`;
}

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
    const sanitized = {
      ...next,
      graphClientSecret: "",
      openrouterApiKey: "",
      geminiApiKey: "",
      tavilyApiKey: "",
    };
    setConfig(sanitized);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(sanitized));
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
  const [appMode,          setAppMode]          = useState<"knowledge" | "research">("knowledge");
  const [selectedLine,     setSelectedLine]     = useState<ServiceLine | null>(null);
  const [selectedSource,   setSelectedSource]   = useState<Source | null>(null);
  const [view,             setView]             = useState<"chat" | "source">("chat");
  const [turns,            setTurns]            = useState<Turn[]>([]);
  const [searchMode,       setSearchMode]       = useState<"rag" | "mixed">("rag");
  const [sessions,         setSessions]         = useState<ChatSession[]>([]);
  const [activeSessionId,  setActiveSessionId]  = useState<string | null>(null);
  const [slideDecks,       setSlideDecks]       = useState<SlideDeck[]>([]);
  const [activeDeckId,     setActiveDeckId]     = useState<string>("");
  const [deckExporting,    setDeckExporting]    = useState(false);
  const [deckError,        setDeckError]        = useState("");

  // Keep a stable ref to activeSessionId so callbacks don't need it in deps
  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSessionId;

  const searchAbortRef = useRef<AbortController | null>(null);

  const currentTurn  = turns[turns.length - 1] ?? null;
  const isAnyLoading = currentTurn?.isLoading ?? false;
  const bottomRef    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, isAnyLoading]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DECKS_KEY);
      const parsed = raw ? JSON.parse(raw) as { decks?: SlideDeck[]; activeDeckId?: string } : null;
      const decks = parsed?.decks?.length
        ? parsed.decks
        : [{ id: `deck-${Date.now()}`, name: "Deck 1", items: [] }];
      setSlideDecks(decks);
      setActiveDeckId(parsed?.activeDeckId && decks.some((deck) => deck.id === parsed.activeDeckId)
        ? parsed.activeDeckId
        : decks[0].id);
    } catch {
      const deck = { id: `deck-${Date.now()}`, name: "Deck 1", items: [] };
      setSlideDecks([deck]);
      setActiveDeckId(deck.id);
    }
  }, []);

  useEffect(() => {
    if (slideDecks.length === 0 || !activeDeckId) return;
    localStorage.setItem(DECKS_KEY, JSON.stringify({ decks: slideDecks, activeDeckId }));
  }, [slideDecks, activeDeckId]);

  // ── Derived config ────────────────────────────────────────────────────────
  const sourceKey =
    config.sourceType === "sharepoint"
      ? `graph:${config.graphDriveId || "mock-drive-documents"}`
      : config.sourceType === "onedrive"
      ? "onedrive:me"
      : config.folderPath;

  const hasDocumentSource =
    config.sourceType === "sharepoint" ||
    config.sourceType === "onedrive" ||
    Boolean(config.folderPath);

  const isLocalMode =
    hasDocumentSource &&
    ((config.aiProvider === "ollama"     && Boolean(config.ollamaModel)) ||
     (config.aiProvider === "openrouter" && Boolean(config.openrouterModel)) ||
     (config.aiProvider === "gemini"     && Boolean(config.geminiModel)));

  const activeDeck = slideDecks.find((deck) => deck.id === activeDeckId) ?? slideDecks[0];

  const createSlideDeck = () => {
    const deck: SlideDeck = {
      id: `deck-${Date.now()}`,
      name: newDeckName(slideDecks.length),
      items: [],
    };
    setSlideDecks((prev) => [...prev, deck]);
    setActiveDeckId(deck.id);
    setDeckError("");
  };

  const toggleDeckSlide = (item: Omit<SlideDeckItem, "id">, deckId = activeDeckId) => {
    setDeckError("");
    const targetDeck = slideDecks.find((deck) => deck.id === deckId);
    const alreadyInDeck = targetDeck?.items.some(
      (existing) => existing.filePath === item.filePath && existing.slideNumber === item.slideNumber
    );
    const deckHasAnotherSource = Boolean(
      targetDeck?.items.length &&
      !targetDeck.items.some((existing) => existing.filePath === item.filePath)
    );
    if (!alreadyInDeck && deckHasAnotherSource) {
      setDeckError("This deck already uses another source PPTX. Create a new deck for this file.");
      return;
    }

    let targetDeckId = deckId;
    if (!targetDeckId) {
      const deck: SlideDeck = { id: `deck-${Date.now()}`, name: "Deck 1", items: [] };
      setSlideDecks([deck]);
      setActiveDeckId(deck.id);
      targetDeckId = deck.id;
    }

    setSlideDecks((prev) =>
      prev.map((deck) => {
        if (deck.id !== targetDeckId) return deck;
        const exists = deck.items.some(
          (existing) => existing.filePath === item.filePath && existing.slideNumber === item.slideNumber
        );
        return {
          ...deck,
          items: exists
            ? deck.items.filter((existing) => !(existing.filePath === item.filePath && existing.slideNumber === item.slideNumber))
            : [...deck.items, { ...item, id: `${item.filePath}::${item.slideNumber}` }],
        };
      })
    );
  };

  const clearActiveDeck = () => {
    if (!activeDeckId) return;
    setSlideDecks((prev) => prev.map((deck) => deck.id === activeDeckId ? { ...deck, items: [] } : deck));
    setDeckError("");
  };

  const exportActiveDeck = async () => {
    if (!activeDeck || activeDeck.items.length === 0) return;
    setDeckExporting(true);
    setDeckError("");
    try {
      const res = await fetch("/api/local/create-pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: activeDeck.name,
          items: activeDeck.items.map((item) => ({
            filePath: item.filePath,
            fileTitle: item.fileTitle,
            slideNumber: item.slideNumber,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Server error ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `${activeDeck.name.replace(/\W+/g, "-")}.pptx`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDeckError(String(err));
    } finally {
      setDeckExporting(false);
    }
  };

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
      searchAbortRef.current = new AbortController();
      const timer = setTimeout(() => searchAbortRef.current?.abort(), 270_000);
      const res = await fetch("/api/ai/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: searchAbortRef.current.signal,
        body: JSON.stringify({
          query: q,
          conversationHistory,
          sourceKey,
          searchMode,
          aiProvider:        config.aiProvider,
          ollamaBaseUrl:     config.ollamaBaseUrl,
          ollamaModel:       config.ollamaModel,
          ollamaEmbedModel:  config.ollamaEmbedModel,
          openrouterModel:   config.openrouterModel,
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
      const aborted = (err instanceof DOMException && err.name === "AbortError");
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? { ...t, isLoading: false, answer: aborted ? undefined : `Error: ${String(err)}`, keyPoints: [], metrics: [], sources: [], docs: [] }
            : t
        )
      );
    } finally {
      searchAbortRef.current = null;
    }
  };

  const handleStop = () => {
    searchAbortRef.current?.abort();
  };

  const goHome = () => { setTurns([]); setView("chat"); setActiveSessionId(null); setAppMode("knowledge"); };

  const handleNewChat = () => {
    setTurns([]);
    setView("chat");
    setActiveSessionId(null);
    setSelectedSource(null);
    setAppMode("knowledge");
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
        appMode={appMode}
        onSetAppMode={setAppMode}
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

            {/* ── Client Research mode ──────────────────────────────────── */}
            {appMode === "research" && (
              <ClientResearch config={config} />
            )}

            {/* ── Knowledge Hub chat ───────────────────────────────────── */}
            <div className={`flex-1 overflow-y-auto${appMode !== "knowledge" ? " hidden" : ""}`}>
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

                    {/* ── Mode toggle — center stage ── */}
                    <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl shadow-inner">
                      <button
                        onClick={() => setAppMode("knowledge")}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                          appMode === "knowledge"
                            ? "bg-white text-slate-800 shadow-md"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        Knowledge Hub
                      </button>
                      <button
                        onClick={() => setAppMode("research")}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                          appMode === "research"
                            ? "bg-white text-slate-800 shadow-md"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        Client Research
                      </button>
                    </div>

                    <p className="text-sm text-slate-500">
                      {appMode === "research"
                        ? "Generate structured presales intelligence for any prospect"
                        : isLocalMode
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
                              {/* Answer prose with inline citation badges */}
                              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                                {renderAnswerWithCitations(
                                  turn.answer ?? aiAnswer.answer,
                                  turn.sources ?? aiAnswer.sources,
                                  setSelectedSource
                                )}
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

                              {/* Copy button */}
                              <CopyButton
                                getText={() => {
                                  const answer = (turn.answer ?? aiAnswer.answer).replace(/\[\d+\]/g, "").trim();
                                  const metrics = (turn.metrics ?? []).map(m => `• ${m}`).join("\n");
                                  const keyPoints = (turn.keyPoints ?? []).map(k => `• ${k}`).join("\n");
                                  return [answer, metrics, keyPoints].filter(Boolean).join("\n\n");
                                }}
                              />

                              {/* Source citations — grouped by document */}
                              {((turn.sources?.length ?? 0) > 0 || (!isLocalMode && aiAnswer.sources.length > 0)) && (() => {
                                const allSources = turn.sources ?? aiAnswer.sources;

                                // Build RAG groups: docId → { first source, list of {refNum, src} }
                                type RefEntry = { refNum: number; src: Source };
                                type DocGroup = { primary: Source; refs: RefEntry[] };
                                const ragGroups: Record<string, DocGroup> = {};
                                allSources.forEach((src, i) => {
                                  if (src.sourceType === "web") return;
                                  if (!ragGroups[src.docId]) ragGroups[src.docId] = { primary: src, refs: [] };
                                  ragGroups[src.docId].refs.push({ refNum: i + 1, src });
                                });

                                const webSources = allSources
                                  .map((src, i) => ({ src, refNum: i + 1 }))
                                  .filter(({ src }) => src.sourceType === "web");

                                return (
                                  <div>
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Sources</p>
                                    <div className="flex flex-wrap gap-2">
                                      {/* RAG sources — one button per document */}
                                      {Object.values(ragGroups).map(({ primary, refs }) => {
                                        const isSelected = refs.some(r => selectedSource?.id === r.src.id);
                                        return (
                                          <button
                                            key={primary.docId}
                                            onClick={() => setSelectedSource(refs[0].src)}
                                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                                              isSelected
                                                ? "bg-sky-600 text-white border-sky-600 shadow-sm"
                                                : "bg-white text-sky-700 border-sky-200 hover:bg-sky-50 hover:border-sky-400"
                                            }`}
                                          >
                                            {/* Reference number badges */}
                                            <span className="flex items-center gap-0.5 shrink-0">
                                              {refs.map(({ refNum }) => (
                                                <span
                                                  key={refNum}
                                                  className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold"
                                                  style={isSelected
                                                    ? { backgroundColor: "rgba(255,255,255,0.2)", color: "white" }
                                                    : { backgroundColor: "#e0f2fe", color: "#0369a1" }}
                                                >
                                                  {refNum}
                                                </span>
                                              ))}
                                            </span>
                                            {primary.title}
                                            <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${isSelected ? "bg-white/20 text-white" : "bg-sky-100 text-sky-600"}`}>RAG</span>
                                          </button>
                                        );
                                      })}

                                      {/* Web sources — one per URL */}
                                      {webSources.map(({ src, refNum }) => (
                                        <a
                                          key={src.id}
                                          href={src.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all bg-white text-violet-700 border-violet-200 hover:bg-violet-50 hover:border-violet-400"
                                        >
                                          <span
                                            className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                                            style={{ backgroundColor: "#f3e8ff", color: "#7c3aed" }}
                                          >
                                            {refNum}
                                          </span>
                                          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                                          </svg>
                                          {src.title}
                                          <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-violet-100 text-violet-600">WEB</span>
                                        </a>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}

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
            <div className={`shrink-0 border-t border-slate-100 bg-white px-6 pt-3 pb-4${appMode !== "knowledge" ? " hidden" : ""}`}>
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
                  {searchMode === "mixed" && (
                    <button
                      onClick={() => setShowSettings(true)}
                      className="text-[11px] text-violet-700 bg-violet-50 border border-violet-200 px-2.5 py-1 rounded-full hover:bg-violet-100 transition-colors"
                    >
                      Uses server Tavily key when configured
                    </button>
                  )}
                </div>
                <ChatInput onSend={handleSearch} onStop={handleStop} isLoading={isAnyLoading} />
              </div>
            </div>

          </div>
        )}
      </main>

      {/* Right panel */}
      {showLocalPreview && selectedSource ? (
        <LocalDocPreview
          source={selectedSource}
          activeDeck={activeDeck}
          decks={slideDecks}
          activeDeckId={activeDeckId}
          onSetActiveDeck={(deckId) => { setActiveDeckId(deckId); setDeckError(""); }}
          onCreateDeck={createSlideDeck}
          onToggleDeckSlide={toggleDeckSlide}
          onClearDeck={clearActiveDeck}
          onExportDeck={exportActiveDeck}
          deckExporting={deckExporting}
          deckError={deckError}
        />
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
