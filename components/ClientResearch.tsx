"use client";

import { useEffect, useRef, useState } from "react";
import type { AppConfig } from "@/types";
import { RESEARCH_SECTIONS } from "@/types/research";
import type { SavedResearch, ResearchSectionResult } from "@/types/research";

interface Props { config: AppConfig }

type View = "home" | "picker" | "researching" | "report";

function renderMarkdown(text: string): React.ReactNode[] {
  return text.split("\n").map((line, i) => {
    // Bold
    const bold = line.replace(/\*\*(.+?)\*\*/g, (_, t) => `<strong>${t}</strong>`);
    if (line.startsWith("- ") || line.startsWith("• ")) {
      return (
        <li key={i} className="ml-4 list-disc text-slate-700"
          dangerouslySetInnerHTML={{ __html: bold.replace(/^[-•]\s/, "") }} />
      );
    }
    if (line.startsWith("## ")) return <h3 key={i} className="font-semibold text-slate-800 mt-2">{line.slice(3)}</h3>;
    if (line.startsWith("# "))  return <h2 key={i} className="font-bold text-slate-900 mt-3">{line.slice(2)}</h2>;
    if (!line.trim()) return <br key={i} />;
    return <p key={i} className="text-slate-700" dangerouslySetInnerHTML={{ __html: bold }} />;
  });
}

interface ChatMessage { role: "user" | "assistant"; content: string }

export default function ClientResearch({ config }: Props) {
  const [view,          setView]          = useState<View>("home");
  const [clientName,    setClientName]    = useState("");
  const [followUpQuery, setFollowUpQuery] = useState("");
  const [selected,      setSelected]      = useState<Set<string>>(new Set(RESEARCH_SECTIONS.map((s) => s.id)));
  const [sections,      setSections]      = useState<ResearchSectionResult[]>([]);
  const [progress,      setProgress]      = useState<string[]>([]);
  const [error,         setError]         = useState("");
  const [researchId,    setResearchId]    = useState<string | null>(null);
  const [saved,         setSaved]         = useState<SavedResearch[]>([]);
  const [pdfLoading,    setPdfLoading]    = useState(false);

  // Follow-up chat on completed research
  const [chatHistory,   setChatHistory]   = useState<ChatMessage[]>([]);
  const [chatInput,     setChatInput]     = useState("");
  const [chatLoading,   setChatLoading]   = useState(false);

  const progressRef   = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const chatAbortRef  = useRef<AbortController | null>(null);

  const isConfigured =
    (config.aiProvider === "ollama"     && Boolean(config.ollamaModel)) ||
    (config.aiProvider === "openrouter" && Boolean(config.openrouterModel)) ||
    (config.aiProvider === "gemini"     && Boolean(config.geminiModel));

  useEffect(() => {
    fetch("/api/research/list").then((r) => r.json()).then((d) => {
      if (Array.isArray(d)) setSaved(d);
    }).catch(() => {});
  }, [view]);

  useEffect(() => {
    if (progressRef.current) progressRef.current.scrollTop = progressRef.current.scrollHeight;
  }, [progress]);

  const toggleSection = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const startResearch = async () => {
    if (!clientName.trim() || selected.size === 0) return;
    setView("researching");
    setSections([]);
    setProgress([]);
    setError("");
    setResearchId(null);

    try {
      const res = await fetch("/api/ai/client-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName:       clientName.trim(),
          selectedSections: Array.from(selected),
          followUpQuery:    followUpQuery.trim() || undefined,
          aiProvider:       config.aiProvider,
          ollamaBaseUrl:    config.ollamaBaseUrl,
          ollamaModel:      config.ollamaModel,
          openrouterModel:  config.openrouterModel,
          geminiModel:      config.geminiModel,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Server error ${res.status}`);

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
            if (evt.type === "progress") setProgress((p) => [...p, evt.msg]);
            if (evt.type === "section")  setSections((p) => [...p, evt.section]);
            if (evt.type === "done")     { setResearchId(evt.researchId); setView("report"); }
            if (evt.type === "error")    setError(evt.error);
          } catch {}
        }
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const downloadPDF = async (research: SavedResearch | { clientName: string; sections: ResearchSectionResult[]; createdAt: string }) => {
    setPdfLoading(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = 170; // usable width
      let y = 20;

      const addPage = () => { doc.addPage(); y = 20; };
      const checkY = (needed: number) => { if (y + needed > 270) addPage(); };

      // Cover header
      doc.setFillColor(14, 165, 233); // sky-500
      doc.rect(0, 0, 210, 35, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text(`Client Research: ${research.clientName}`, 20, 16);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Generated ${new Date(research.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}  ·  Apexon Knowledge Hub`, 20, 26);

      doc.setTextColor(30, 41, 59); // slate-800
      y = 45;

      for (const section of research.sections) {
        checkY(20);

        // Section header band
        doc.setFillColor(241, 245, 249); // slate-100
        doc.roundedRect(15, y - 5, 180, 12, 2, 2, "F");
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(14, 165, 233);
        doc.text(`${section.emoji}  ${section.title}`, 18, y + 3);
        doc.setTextColor(30, 41, 59);
        y += 12;

        // Section content — strip markdown, split lines
        const plain = section.content
          .replace(/\*\*(.+?)\*\*/g, "$1")
          .replace(/^#{1,3}\s/gm, "");

        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");

        for (const rawLine of plain.split("\n")) {
          const line = rawLine.trim();
          if (!line) { y += 3; continue; }
          const isBullet = line.startsWith("- ") || line.startsWith("• ");
          const text     = isBullet ? line.replace(/^[-•]\s/, "") : line;
          const prefix   = isBullet ? "•  " : "";
          const indent   = isBullet ? 22 : 18;
          const wrapW    = isBullet ? W - 7 : W;
          const wrapped  = doc.splitTextToSize(prefix + text, wrapW);

          checkY(wrapped.length * 5 + 2);
          doc.text(wrapped, indent, y);
          y += wrapped.length * 5 + 1;
        }
        y += 8;
      }

      // Footer on each page
      const totalPages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(`© 2026 Apexon Inc. · Confidential · Page ${i} of ${totalPages}`, 20, 287);
      }

      doc.save(`${research.clientName.replace(/\s+/g, "-")}-research.pdf`);
    } catch (e) {
      console.error("PDF generation failed", e);
    } finally {
      setPdfLoading(false);
    }
  };

  const deleteResearch = async (id: string) => {
    await fetch(`/api/research/delete?id=${id}`, { method: "DELETE" });
    setSaved((p) => p.filter((r) => r.id !== id));
  };

  const loadSaved = (r: SavedResearch) => {
    setClientName(r.clientName);
    setSections(r.sections);
    setResearchId(r.id);
    setChatHistory([]);
    setView("report");
  };

  const resetToHome = () => {
    setView("home");
    setClientName("");
    setFollowUpQuery("");
    setSections([]);
    setProgress([]);
    setError("");
    setResearchId(null);
    setChatHistory([]);
    setSelected(new Set(RESEARCH_SECTIONS.map((s) => s.id)));
  };

  const askFollowUp = async () => {
    const q = chatInput.trim();
    if (!q || chatLoading || sections.length === 0) return;
    const userMsg: ChatMessage = { role: "user", content: q };
    const newHistory = [...chatHistory, userMsg];
    setChatHistory(newHistory);
    setChatInput("");
    setChatLoading(true);
    chatAbortRef.current = new AbortController();
    try {
      const res = await fetch("/api/ai/research-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: chatAbortRef.current.signal,
        body: JSON.stringify({
          clientName,
          sections,
          question:         q,
          history:          chatHistory,
          aiProvider:       config.aiProvider,
          ollamaBaseUrl:    config.ollamaBaseUrl,
          ollamaModel:      config.ollamaModel,
          openrouterModel:  config.openrouterModel,
          geminiModel:      config.geminiModel,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setChatHistory([...newHistory, { role: "assistant", content: data.answer }]);
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      if (!aborted) setChatHistory([...newHistory, { role: "assistant", content: `Error: ${String(e)}` }]);
    } finally {
      setChatLoading(false);
      chatAbortRef.current = null;
    }
  };

  useEffect(() => {
    if (chatBottomRef.current) chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // ── Views ──────────────────────────────────────────────────────────────────

  if (view === "home") {
    return (
      <div className="flex-1 flex flex-col overflow-y-auto px-6 py-6 max-w-3xl mx-auto w-full">
        {/* Hero */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Client Research</h1>
          <p className="text-sm text-slate-500">Generate structured presales intelligence for any prospect. Reports are saved automatically as PDF.</p>
        </div>

        {/* New research card */}
        <button
          onClick={() => setView("picker")}
          disabled={!isConfigured}
          className="flex items-center gap-4 w-full px-5 py-4 rounded-2xl border-2 border-dashed border-sky-200 bg-sky-50 hover:border-sky-400 hover:bg-sky-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed mb-6"
        >
          <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-sky-700">New Client Research</p>
            <p className="text-xs text-sky-500 mt-0.5">
              {isConfigured ? "Enter a company name and choose research sections" : "Configure an AI model in Settings first"}
            </p>
          </div>
        </button>

        {/* Saved research */}
        {saved.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Saved Research</h2>
            <div className="space-y-2">
              {saved.map((r) => (
                <div key={r.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white hover:border-sky-200 hover:shadow-sm transition-all group">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <button onClick={() => loadSaved(r)} className="flex-1 text-left min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{r.clientName}</p>
                    <p className="text-xs text-slate-400">{r.sections.length} sections · {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                  </button>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => downloadPDF(r)}
                      title="Download PDF"
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-sky-600 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => deleteResearch(r.id)}
                      title="Delete"
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {saved.length === 0 && (
          <p className="text-xs text-slate-400 text-center mt-4">No saved research yet. Start a new client research above.</p>
        )}
      </div>
    );
  }

  if (view === "picker") {
    return (
      <div className="flex-1 flex flex-col overflow-y-auto px-6 py-6 max-w-3xl mx-auto w-full">
        <button onClick={resetToHome} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 mb-5">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <h2 className="text-lg font-bold text-slate-800 mb-1">New Client Research</h2>
        <p className="text-sm text-slate-500 mb-5">Enter a company name, select research components, and optionally add a specific question.</p>

        {/* Client name */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-slate-500 mb-1.5">Company / Prospect Name</label>
          <input
            autoFocus
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && clientName.trim() && document.getElementById("research-btn")?.click()}
            placeholder="e.g. JPMorgan Chase, Kaiser Permanente, AstraZeneca…"
            className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        {/* Section selector */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-slate-500">Research Components</label>
            <div className="flex gap-3">
              <button onClick={() => setSelected(new Set(RESEARCH_SECTIONS.map((s) => s.id)))} className="text-xs text-sky-600 hover:text-sky-700">Select all</button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-slate-400 hover:text-slate-600">Clear</button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {RESEARCH_SECTIONS.map((s) => {
              const on = selected.has(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleSection(s.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                    on ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${on ? "bg-sky-600 border-sky-600" : "border-slate-300"}`}>
                    {on && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                  </div>
                  <span className="text-lg shrink-0">{s.emoji}</span>
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold ${on ? "text-sky-700" : "text-slate-700"}`}>{s.title}</p>
                    <p className="text-[10px] text-slate-400 truncate">{s.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Optional specific query */}
        <div className="mb-6">
          <label className="block text-xs font-semibold text-slate-500 mb-1.5">Specific Question <span className="font-normal text-slate-400">(optional)</span></label>
          <input
            type="text"
            value={followUpQuery}
            onChange={(e) => setFollowUpQuery(e.target.value)}
            placeholder="e.g. Do they have any known issues with their data platform?"
            className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <button
          id="research-btn"
          onClick={startResearch}
          disabled={!clientName.trim() || selected.size === 0}
          className="w-full py-3 rounded-xl bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Research {clientName.trim() ? `"${clientName.trim()}"` : ""}
        </button>
      </div>
    );
  }

  if (view === "researching") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 max-w-3xl mx-auto w-full">
        <div className="w-12 h-12 rounded-full border-2 border-sky-200 border-t-sky-500 animate-spin mb-4" />
        <h2 className="text-base font-semibold text-slate-700 mb-1">Researching {clientName}…</h2>
        <p className="text-xs text-slate-400 mb-4">This may take 30–60 seconds</p>
        <div ref={progressRef} className="w-full max-w-sm max-h-40 overflow-y-auto rounded-xl bg-slate-900 px-4 py-3 font-mono text-xs text-slate-300 space-y-1">
          {progress.map((msg, i) => <div key={i} className="text-sky-300">{msg}</div>)}
          {sections.map((s) => <div key={s.id} className="text-emerald-400">✓ {s.title}</div>)}
          <div className="text-sky-400 animate-pulse">Working…</div>
        </div>
        {error && <p className="mt-4 text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
      </div>
    );
  }

  // ── Report view ────────────────────────────────────────────────────────────
  const currentResearch: { clientName: string; sections: ResearchSectionResult[]; createdAt: string } = {
    clientName,
    sections,
    createdAt: new Date().toISOString(),
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Slim header ── */}
      <div className="shrink-0 bg-white border-b border-slate-100 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={resetToHome} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            All Research
          </button>
          <span className="text-slate-200">|</span>
          <h1 className="text-sm font-bold text-slate-800">{clientName}</h1>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">
            {sections.length} sections
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setView("picker"); setSections([]); setProgress([]); setError(""); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2m15.357 2H15" />
            </svg>
            Re-research
          </button>
          <button
            onClick={() => downloadPDF(currentResearch)}
            disabled={pdfLoading || sections.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pdfLoading
              ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            }
            {pdfLoading ? "Generating…" : "Download PDF"}
          </button>
        </div>
      </div>

      {/* ── Unified chat thread ── */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-6">

          {/* Research result — "assistant" message */}
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-full bg-sky-600 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-400 mb-3">
                Research complete · {sections.length} sections
                {researchId && <span className="ml-2 text-emerald-500">✓ Saved</span>}
              </p>
              <div className="space-y-4">
                {sections.map((section) => (
                  <div key={section.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                    <div className="flex items-center gap-2.5 px-4 py-3 bg-slate-50 border-b border-slate-100">
                      <span className="text-lg">{section.emoji}</span>
                      <h3 className="text-sm font-bold text-slate-800">{section.title}</h3>
                    </div>
                    <div className="px-4 py-3 text-sm space-y-1">
                      {renderMarkdown(section.content)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Follow-up Q&A messages */}
          {chatHistory.map((msg, i) => (
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] bg-slate-100 rounded-2xl rounded-br-sm px-4 py-3">
                  <p className="text-sm text-slate-700 leading-relaxed">{msg.content}</p>
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-3 items-start">
                <div className="w-8 h-8 rounded-full bg-sky-600 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0 text-sm text-slate-700 leading-relaxed space-y-1 pt-1">
                  {renderMarkdown(msg.content)}
                </div>
              </div>
            )
          ))}

          {/* Typing indicator */}
          {chatLoading && (
            <div className="flex gap-3 items-start">
              <div className="w-8 h-8 rounded-full bg-sky-600 flex items-center justify-center shrink-0 shadow-sm">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div className="flex items-center gap-1.5 pt-3">
                <span className="w-2 h-2 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}

          <div ref={chatBottomRef} />
        </div>
      </div>

      {/* ── Fixed input bar ── */}
      <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-3">
        <div className={`max-w-3xl mx-auto flex items-center gap-3 border rounded-2xl px-4 py-3 shadow-sm transition-all ${
          chatLoading ? "border-sky-400 ring-2 ring-sky-100" : "border-slate-300 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100"
        }`}>
          {chatLoading && <span className="shrink-0 w-2 h-2 rounded-full bg-sky-500 animate-pulse" />}
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && askFollowUp()}
            placeholder={chatLoading ? "Thinking…" : `Ask a follow-up question about ${clientName}…`}
            disabled={chatLoading}
            className="flex-1 bg-transparent text-sm text-slate-700 placeholder-slate-400 focus:outline-none disabled:opacity-60"
          />
          {chatLoading ? (
            <button
              onClick={() => { chatAbortRef.current?.abort(); setChatLoading(false); }}
              className="shrink-0 w-9 h-9 rounded-xl border-2 border-slate-300 hover:border-red-400 hover:bg-red-50 flex items-center justify-center transition-colors group"
              title="Stop"
            >
              <span className="w-3.5 h-3.5 rounded-sm bg-slate-400 group-hover:bg-red-500 transition-colors block" />
            </button>
          ) : (
            <button
              onClick={askFollowUp}
              disabled={!chatInput.trim()}
              className="shrink-0 w-9 h-9 rounded-xl bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
