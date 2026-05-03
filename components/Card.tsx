"use client";

import { useState, useRef, useEffect } from "react";
import type { Document } from "@/types";

interface CardProps {
  doc: Document;
  onView: (doc: Document) => void;
  onAskAI: (doc: Document, prompt: string) => void;
}

const TYPE_COLORS: Record<string, string> = {
  RFP:           "bg-blue-50 text-blue-700 border-blue-200",
  POV:           "bg-violet-50 text-violet-700 border-violet-200",
  "Case Study":  "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Trend Report":"bg-amber-50 text-amber-700 border-amber-200",
};

const SUGGESTIONS = [
  "Summarize the key findings and recommendations",
  "What metrics and proof points are mentioned?",
  "List the main differentiators and win themes",
  "What risks or challenges are highlighted?",
  "Extract reusable bullets for a proposal",
  "What client outcomes or case examples are cited?",
];

export default function Card({ doc, onView, onAskAI }: CardProps) {
  const [open,   setOpen]   = useState(false);
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 60);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => { setOpen(false); setPrompt(""); };

  const submit = () => {
    const q = prompt.trim();
    if (!q) return;
    onAskAI(doc, q);
    close();
  };

  return (
    <>
      <article className="flex flex-col bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow duration-200 group">
        {/* Type badge */}
        <div className="flex items-center gap-2 mb-3">
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${TYPE_COLORS[doc.type] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
            {doc.type}
          </span>
          <span className="text-xs text-slate-400">{doc.serviceLine}</span>
        </div>

        {/* Title */}
        <h3 className="text-sm font-semibold text-slate-800 leading-snug mb-2 group-hover:text-sky-700 transition-colors line-clamp-2">
          {doc.title}
        </h3>

        {/* Summary */}
        <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 flex-1 mb-4">
          {doc.summary}
        </p>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {doc.tags.map((tag) => (
            <span key={tag} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-xs">
              {tag}
            </span>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-auto">
          <button
            onClick={() => onView(doc)}
            className="flex-1 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            View
          </button>
          <button
            onClick={() => setOpen(true)}
            className="flex-1 py-1.5 rounded-lg bg-sky-600 text-xs font-medium text-white hover:bg-sky-700 transition-colors"
          >
            Ask AI
          </button>
        </div>
      </article>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">

            {/* Header */}
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
                <div className="flex items-center gap-2 mt-1">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${TYPE_COLORS[doc.type] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
                    {doc.type}
                  </span>
                  <span className="text-[10px] text-slate-400">{doc.summary}</span>
                </div>
              </div>
              <button
                onClick={close}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 flex flex-col gap-4">
              {/* Suggestion chips */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Quick prompts</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setPrompt(s);
                        textareaRef.current?.focus();
                      }}
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

              {/* Textarea */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Your question</p>
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                  }}
                  placeholder="e.g. What cloud migration approach was used and what were the outcomes?"
                  rows={4}
                  className="w-full text-sm px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-400 resize-none placeholder-slate-400 leading-relaxed"
                />
                <p className="text-[10px] text-slate-400 mt-1">⌘ Enter to submit</p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                onClick={close}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
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
