"use client";

import { useEffect, useRef, useState } from "react";
import type { AppConfig, Source } from "@/types";
import LocalDocPreview from "@/components/LocalDocPreview";
import { RESEARCH_SECTIONS, RESEARCH_SECTIONS_STORAGE_KEY } from "@/types/research";
import type { ResearchReference, ResearchSectionDef, SavedResearch, ResearchSectionResult } from "@/types/research";

interface Props { config: AppConfig; sourceKey?: string; onExitToHub?: () => void }

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

function pdfSafeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A3\u00A9\u00AE\u00B0\u00B7\u2022]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

interface ChatMessage { role: "user" | "assistant"; content: string; references?: ResearchReference[] }

const RECOMMENDED_SECTION_IDS = ["snapshot", "business", "strategy", "challenges"] as const;

const RESEARCH_AREA_GROUPS: { label: string; sectionIds: string[] }[] = [
  { label: "Company Context",      sectionIds: ["snapshot", "business", "market"] },
  { label: "Strategy & Priorities", sectionIds: ["strategy", "tech", "challenges"] },
  { label: "Sales Intelligence",   sectionIds: ["buying", "intent", "vendors"] },
  { label: "Apexon Plays",         sectionIds: ["hypothesis", "engagement", "apexon_fit"] },
];

const COMPANY_EXAMPLES = ["AstraZeneca", "Kaiser Permanente", "JPMorgan Chase"];

function defaultSelectedIds(sections: ResearchSectionDef[]): Set<string> {
  const ids = new Set(sections.map((s) => s.id));
  const recommended = RECOMMENDED_SECTION_IDS.filter((id) => ids.has(id));
  return new Set(recommended.length ? recommended : sections.map((s) => s.id));
}

function groupResearchSections(sections: ResearchSectionDef[]): { label: string; items: ResearchSectionDef[] }[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const claimed = new Set<string>();
  const groups = RESEARCH_AREA_GROUPS.map((g) => {
    const items: ResearchSectionDef[] = [];
    for (const id of g.sectionIds) {
      const section = byId.get(id);
      if (section) { items.push(section); claimed.add(id); }
    }
    return { label: g.label, items };
  }).filter((g) => g.items.length);

  const leftover = sections.filter((s) => !claimed.has(s.id));
  if (leftover.length) groups.push({ label: "Other", items: leftover });
  return groups;
}

function sourceFromReference(ref: ResearchReference): Source {
  return {
    id: ref.id,
    docId: ref.filePath,
    title: ref.title,
    slide: ref.page,
    serviceLine: "BFSI",
    filePath: ref.filePath,
    fileType: ref.fileType,
    excerpt: ref.excerpt,
    sourceType: "rag",
  };
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

export default function ClientResearch({ config, sourceKey, onExitToHub }: Props) {
  const [view,          setView]          = useState<View>("home");
  const [clientName,    setClientName]    = useState("");
  const [followUpQuery, setFollowUpQuery] = useState("");
  const [researchSections, setResearchSections] = useState<ResearchSectionDef[]>(() => loadResearchSections());
  const [selected,      setSelected]      = useState<Set<string>>(() => defaultSelectedIds(loadResearchSections()));
  const [sections,      setSections]      = useState<ResearchSectionResult[]>([]);
  const [progress,      setProgress]      = useState<string[]>([]);
  const [error,         setError]         = useState("");
  const [researchId,    setResearchId]    = useState<string | null>(null);
  const [saved,         setSaved]         = useState<SavedResearch[]>([]);
  const [pdfLoading,    setPdfLoading]    = useState(false);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);

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
    const refreshSections = () => setResearchSections(loadResearchSections());
    window.addEventListener("research-sections-updated", refreshSections);
    window.addEventListener("storage", refreshSections);
    return () => {
      window.removeEventListener("research-sections-updated", refreshSections);
      window.removeEventListener("storage", refreshSections);
    };
  }, []);

  useEffect(() => {
    const validIds = new Set(researchSections.map((s) => s.id));
    setSelected((prev) => {
      const kept = [...prev].filter((id) => validIds.has(id));
      return new Set(kept.length ? kept : [...defaultSelectedIds(researchSections)]);
    });
  }, [researchSections]);

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
          researchSections,
          followUpQuery:    followUpQuery.trim() || undefined,
          sourceKey,
          aiProvider:       config.aiProvider,
          ollamaBaseUrl:    config.ollamaBaseUrl,
          ollamaModel:      config.ollamaModel,
          ollamaEmbedModel: config.ollamaEmbedModel,
          openrouterModel:  config.openrouterModel,
          geminiModel:      config.geminiModel,
          embeddingProvider: config.embeddingProvider,
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
            if (evt.type === "section-start") {
              setSections((prev) => {
                const exists = prev.some((section) => section.id === evt.section.id);
                return exists ? prev : [...prev, evt.section];
              });
            }
            if (evt.type === "section-delta") {
              setSections((prev) => prev.map((section) =>
                section.id === evt.sectionId
                  ? { ...section, content: `${section.content}${evt.delta}` }
                  : section
              ));
            }
            if (evt.type === "section") {
              setSections((prev) => {
                const exists = prev.some((section) => section.id === evt.section.id);
                return exists
                  ? prev.map((section) => section.id === evt.section.id ? evt.section : section)
                  : [...prev, evt.section];
              });
            }
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
      doc.text(`Client Research: ${pdfSafeText(research.clientName)}`, 20, 16);
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
        doc.text(pdfSafeText(section.title), 18, y + 3);
        doc.setTextColor(30, 41, 59);
        y += 12;

        // Section content — strip markdown, split lines
        const plain = pdfSafeText(section.content)
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
    setSelected(defaultSelectedIds(researchSections));
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
          sourceKey,
          aiProvider:       config.aiProvider,
          ollamaBaseUrl:    config.ollamaBaseUrl,
          ollamaModel:      config.ollamaModel,
          ollamaEmbedModel: config.ollamaEmbedModel,
          openrouterModel:  config.openrouterModel,
          geminiModel:      config.geminiModel,
          embeddingProvider: config.embeddingProvider,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setChatHistory([...newHistory, { role: "assistant", content: data.answer, references: data.references ?? [] }]);
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

  const HubBackLink = onExitToHub ? (
    <button
      type="button"
      onClick={onExitToHub}
      title="Return to normal document search"
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors"
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      Knowledge Hub
    </button>
  ) : null;

  if (view === "home") {
    return (
      <div className="flex-1 flex flex-col overflow-y-auto px-6 py-6 max-w-3xl mx-auto w-full">
        {HubBackLink && <div className="mb-4">{HubBackLink}</div>}
        {/* Hero */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Client Research</h1>
          <p className="text-sm text-slate-500">Generate structured presales intelligence for any prospect. Reports are saved automatically as PDF.</p>
        </div>

        {/* New research button */}
        <button
          onClick={() => setView("picker")}
          disabled={!isConfigured}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-xl border border-slate-200 bg-white hover:border-sky-300 hover:shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed mb-6"
        >
          <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-slate-700">New Research</p>
            <p className="text-xs text-slate-400">
              {isConfigured ? "Enter a company name to get started" : "Configure an AI model in Settings first"}
            </p>
          </div>
        </button>

        {/* Historical research done */}
        {saved.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Historical Research Done</h2>
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
    const recommendedSet = new Set<string>(RECOMMENDED_SECTION_IDS);
    const groupedSections = groupResearchSections(researchSections);
    const selectedCount = selected.size;
    const canSubmit = clientName.trim().length > 0 && selectedCount > 0;

    return (
      <div className="flex-1 flex flex-col overflow-hidden w-full bg-slate-50/40">
        {/* ── Header (fixed) ── */}
        <div className="shrink-0 px-4 sm:px-6 pt-6 pb-4 max-w-3xl mx-auto w-full">
          <div className="flex items-center gap-2 mb-4">
            {HubBackLink}
            <button onClick={resetToHome} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              All Research
            </button>
          </div>

          <h2 className="text-xl font-bold text-slate-900 mb-1">Client Research Brief</h2>
          <p className="text-sm text-slate-500">Generate a structured account research brief for sales, presales, and pursuit planning.</p>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto w-full pb-8 space-y-8">

            {/* Step 1: Company / Prospect */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-sky-600 text-white text-[10px] font-bold">1</span>
                <h3 className="text-sm font-semibold text-slate-800">Company / Prospect</h3>
              </div>
              <input
                autoFocus
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSubmit && document.getElementById("research-btn")?.click()}
                placeholder="Enter company or prospect name"
                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="mt-1.5 text-xs text-slate-400">Use the official company name for better results.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="text-[11px] text-slate-400 mr-1 self-center">Try:</span>
                {COMPANY_EXAMPLES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setClientName(name)}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-700 transition-colors"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </section>

            {/* Step 2: Research Areas */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-sky-600 text-white text-[10px] font-bold">2</span>
                  <h3 className="text-sm font-semibold text-slate-800">Research Areas</h3>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setSelected(new Set(researchSections.map((s) => s.id)))} className="text-xs text-sky-600 hover:text-sky-700">Select all areas</button>
                  <button onClick={() => setSelected(new Set())} className="text-xs text-slate-400 hover:text-slate-600">Clear</button>
                </div>
              </div>

              <div className="space-y-5">
                {groupedSections.map((group) => (
                  <div key={group.label}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">{group.label}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {group.items.map((s) => {
                        const on = selected.has(s.id);
                        const recommended = recommendedSet.has(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleSection(s.id)}
                            aria-pressed={on}
                            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left transition-all ${
                              on
                                ? "border-sky-300 bg-sky-50 shadow-[0_0_0_1px_rgba(14,165,233,0.15)]"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? "bg-sky-600 border-sky-600" : "border-slate-300"}`}>
                              {on && <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                            </div>
                            <span className="text-base shrink-0 leading-none">{s.emoji}</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <p className={`text-xs font-semibold truncate ${on ? "text-sky-700" : "text-slate-700"}`}>{s.title}</p>
                                {recommended && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 font-semibold uppercase tracking-wide shrink-0">Rec</span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-400 truncate">{s.description}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Step 3: Specific Focus Area */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-sky-600 text-white text-[10px] font-bold">3</span>
                <h3 className="text-sm font-semibold text-slate-800">Specific Focus Area <span className="font-normal text-slate-400">(optional)</span></h3>
              </div>
              <input
                type="text"
                value={followUpQuery}
                onChange={(e) => setFollowUpQuery(e.target.value)}
                placeholder="e.g. Known data platform issues, AI strategy, cloud migration, regulatory pressure…"
                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="mt-1.5 text-xs text-slate-400">Optional: add a focused question to tailor the research brief.</p>
            </section>
          </div>
        </div>

        {/* ── Sticky footer ── */}
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 sm:px-6 py-3">
          <div className="max-w-3xl mx-auto w-full flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-700">{selectedCount} {selectedCount === 1 ? "area" : "areas"} selected</p>
              <p className="text-[11px] text-slate-400 truncate">Generates a structured brief with company context, priorities, risks, opportunities, and sales angles.</p>
            </div>
            <button
              id="research-btn"
              onClick={startResearch}
              disabled={!canSubmit}
              className={`w-full sm:w-auto px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                canSubmit
                  ? "bg-sky-600 text-white hover:bg-sky-700 shadow-sm"
                  : "bg-slate-100 text-slate-400 cursor-not-allowed"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Generate Research Brief
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "researching") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 max-w-3xl mx-auto w-full overflow-y-auto">
        <div className="w-12 h-12 rounded-full border-2 border-sky-200 border-t-sky-500 animate-spin mb-4" />
        <h2 className="text-base font-semibold text-slate-700 mb-1">Researching {clientName}…</h2>
        <p className="text-xs text-slate-400 mb-4">
          {sections.length ? "Writing the report live" : "Gathering context and sources"}
        </p>
        <div ref={progressRef} className="w-full max-w-xl max-h-36 overflow-y-auto rounded-xl bg-slate-900 px-4 py-3 font-mono text-xs text-slate-300 space-y-1">
          {progress.map((msg, i) => <div key={i} className="text-sky-300">{msg}</div>)}
          {sections.map((s) => <div key={s.id} className="text-emerald-400">Writing {s.title}</div>)}
          <div className="text-sky-400 animate-pulse">Working…</div>
        </div>
        {sections.length > 0 && (
          <div className="mt-6 w-full space-y-4">
            {sections.map((section) => (
              <div key={section.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                <div className="flex items-center gap-2.5 px-4 py-3 bg-slate-50 border-b border-slate-100">
                  <span className="text-lg">{section.emoji}</span>
                  <h3 className="text-sm font-bold text-slate-800">{section.title}</h3>
                  {!section.content && <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-sky-500">Starting</span>}
                </div>
                <div className="px-4 py-3 text-sm space-y-1 min-h-12">
                  {section.content
                    ? renderMarkdown(section.content)
                    : <p className="text-slate-400 animate-pulse">Preparing section…</p>}
                  {section.content && (
                    <span className="inline-block ml-0.5 h-4 w-1.5 translate-y-0.5 rounded-sm bg-sky-500 animate-pulse" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
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

  const renderReferenceLinks = (references?: ResearchReference[]) => {
    if (!references?.length) return null;
    return (
      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Internal references</p>
        <div className="flex flex-wrap gap-2">
          {references.map((ref) => (
            <button
              key={`${ref.id}-${ref.filePath}-${ref.page}`}
              type="button"
              onClick={() => setSelectedSource(sourceFromReference(ref))}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-sky-200 bg-white text-xs font-medium text-sky-700 hover:bg-sky-50 hover:border-sky-400 transition-colors"
              title={ref.excerpt}
            >
              <span className="w-5 h-5 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-[10px] font-bold">
                {ref.marker}
              </span>
              <span className="max-w-[220px] truncate">{ref.title}</span>
              <span className="px-1 py-0.5 rounded bg-sky-100 text-[9px] font-bold uppercase text-sky-600">
                {ref.fileType === "pptx" ? `Slide ${ref.page}` : ref.fileType === "pdf" ? `Page ${ref.page}` : "Doc"}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex overflow-hidden">
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
                      {section.harness && (
                        <div className={`mb-3 rounded-xl border px-3 py-2 ${
                          section.harness.status === "pass"
                            ? "border-emerald-100 bg-emerald-50"
                            : "border-amber-100 bg-amber-50"
                        }`}>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Agent harness · {section.harness.status === "pass" ? "Ready" : "Needs review"}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {section.harness.retrievedItems} retrieved · {section.harness.evidenceRefs} evidence refs · {section.harness.fallbacks} fallbacks
                          </p>
                          {section.harness.warnings.slice(0, 2).map((warning, index) => (
                            <p key={index} className="mt-1 text-[11px] text-amber-700">- {warning}</p>
                          ))}
                          {section.harness.agentTrace.length > 0 && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-[11px] font-semibold text-slate-500">Trace</summary>
                              <div className="mt-1 space-y-0.5">
                                {section.harness.agentTrace.map((entry, index) => (
                                  <p key={index} className="text-[11px] text-slate-500">
                                    {entry.step} · {entry.tool}{entry.query ? ` · "${entry.query}"` : ""}{typeof entry.found === "number" ? ` -> ${entry.found}` : ""}
                                  </p>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      )}
                      {renderMarkdown(section.content)}
                      {renderReferenceLinks(section.references)}
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
                  {renderReferenceLinks(msg.references)}
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

      {selectedSource && (
        <div className="fixed inset-0 z-50 md:static md:inset-auto md:z-auto flex">
          <LocalDocPreview
            source={selectedSource}
            onClose={() => setSelectedSource(null)}
          />
        </div>
      )}
    </div>
  );
}
