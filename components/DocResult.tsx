"use client";

import { useState, useRef, useEffect } from "react";
import type { Document, SearchableFileType } from "@/types";

interface RichDoc extends Document {
  filePath?: string;
  fileType?: SearchableFileType;
  totalSlides?: number;
  slides?: { number: number; text: string }[];
}

interface DocResultProps {
  doc: Document;
  index: number;
  onView: (doc: Document) => void;
  onAskAI: (doc: Document, prompt: string) => void;
}

const SUGGESTIONS = [
  "Summarize the key findings and recommendations",
  "What metrics and proof points are mentioned?",
  "List the main differentiators and win themes",
  "Extract reusable bullets for a proposal",
];

const TYPE_COLORS: Record<string, string> = {
  RFP:           "bg-blue-50 text-blue-700",
  POV:           "bg-violet-50 text-violet-700",
  "Case Study":  "bg-emerald-50 text-emerald-700",
  "Trend Report":"bg-amber-50 text-amber-700",
};

export default function DocResult({ doc, index, onView, onAskAI }: DocResultProps) {
  const rich       = doc as RichDoc;
  const fileType   = rich.fileType ?? "pdf";
  const filePath   = rich.filePath ?? "";
  const totalSlides = rich.totalSlides ?? 0;

  // Build a readable breadcrumb from the file path
  const pathParts  = filePath.split(/[/\\:]/g).filter(Boolean);
  const breadcrumb = pathParts.length > 1
    ? pathParts.slice(-3, -1).join(" › ")   // parent folder(s)
    : doc.serviceLine;

  // Snippet: first slide text, fall back to summary
  const rawSnippet = rich.slides?.[0]?.text ?? doc.summary ?? "";
  const snippet    = rawSnippet.length > 230 ? rawSnippet.slice(0, 230) + "…" : rawSnippet;

  // Ask AI modal state
  const [open,   setOpen]   = useState(false);
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 60);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close  = () => { setOpen(false); setPrompt(""); };
  const submit = () => {
    const q = prompt.trim();
    if (!q) return;
    onAskAI(doc, q);
    close();
  };

  return (
    <>
      <div className="group py-4 border-b border-slate-100 last:border-0">
        {/* Breadcrumb + file type */}
        <div className="flex items-center gap-2 mb-1">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
            fileType === "pdf" ? "bg-red-50 text-red-600" : fileType === "docx" ? "bg-blue-50 text-blue-600" : "bg-orange-50 text-orange-600"
          }`}>
            {fileType}
          </span>
          <span className="text-xs text-emerald-700 truncate">
            {breadcrumb}
            {totalSlides > 0 && (
              <span className="text-slate-400 ml-1">
                · {totalSlides} {fileType === "pdf" ? "pages" : fileType === "pptx" ? "slides" : "sections"}
              </span>
            )}
          </span>
        </div>

        {/* Title — Google blue link style */}
        <button
          onClick={() => onView(doc)}
          className="block text-left text-[17px] font-semibold text-sky-700 hover:underline leading-snug mb-1.5 line-clamp-1"
        >
          {index}. {doc.title}
        </button>

        {/* Snippet */}
        {snippet && (
          <p className="text-sm text-slate-600 leading-relaxed line-clamp-2 mb-2">
            {snippet}
          </p>
        )}

        {/* Meta + actions row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Type badge */}
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
            TYPE_COLORS[doc.type] ?? "bg-slate-100 text-slate-600"
          }`}>
            {doc.type}
          </span>

          {/* Tags */}
          {doc.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px]">
              {tag}
            </span>
          ))}

          {/* Actions — visible on hover */}
          <div className="ml-auto flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onView(doc)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              View
            </button>
            <button
              onClick={() => setOpen(true)}
              className="px-2.5 py-1 rounded-lg bg-sky-600 text-xs font-medium text-white hover:bg-sky-700 transition-colors"
            >
              Ask AI
            </button>
          </div>
        </div>
      </div>

      {/* Ask AI modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-sky-600 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-sky-600 uppercase tracking-wide mb-0.5">Ask AI about</p>
                <h2 className="text-sm font-bold text-slate-800 leading-snug line-clamp-2">{doc.title}</h2>
              </div>
              <button onClick={close} className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 flex flex-col gap-4">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Quick prompts</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setPrompt(s); textareaRef.current?.focus(); }}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        prompt === s
                          ? "bg-sky-600 text-white border-sky-600"
                          : "bg-white text-slate-600 border-slate-200 hover:border-sky-300 hover:text-sky-700 hover:bg-sky-50"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Your question</p>
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
                  placeholder="e.g. What cloud migration approach was used and what were the outcomes?"
                  rows={4}
                  className="w-full text-sm px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-400 resize-none placeholder-slate-400 leading-relaxed"
                />
                <p className="text-[10px] text-slate-400 mt-1">⌘ Enter to submit</p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={close} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!prompt.trim()}
                className="px-5 py-2 rounded-lg bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Search documents
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
