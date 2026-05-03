"use client";

import { useMemo, useState } from "react";
import type { DocType, Document, Source } from "@/types";
import { aiAnswer } from "@/data/mockData";
import Card from "./Card";

interface ResultsProps {
  query: string;
  docs: Document[];
  onSourceSelect: (source: Source) => void;
  selectedSourceId: string | null;
  answer?: string;
  keyPoints?: string[];
  metrics?: string[];
  sources?: Source[];
  isLoading?: boolean;
  onDocumentQuestion: (query: string) => void;
}

export default function Results({
  query,
  docs,
  onSourceSelect,
  selectedSourceId,
  answer,
  keyPoints,
  metrics,
  sources,
  isLoading,
  onDocumentQuestion,
}: ResultsProps) {
  const [typeFilter, setTypeFilter] = useState<DocType | "All">("All");
  const displayAnswer  = answer  ?? aiAnswer.answer;
  const displaySources = sources ?? aiAnswer.sources;
  const docTypes = useMemo(
    () => Array.from(new Set(docs.map((doc) => doc.type))),
    [docs]
  );
  const filteredDocs = typeFilter === "All"
    ? docs
    : docs.filter((doc) => doc.type === typeFilter);

  return (
    <div className="flex flex-col gap-6">
      {/* Query header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-700">
            Results for{" "}
            <span className="text-sky-600">&ldquo;{query}&rdquo;</span>
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {filteredDocs.length === docs.length
              ? `${docs.length} documents`
              : `${filteredDocs.length} of ${docs.length} documents`}
          </p>
        </div>
        {docTypes.length > 1 && (
          <div className="flex shrink-0 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            {(["All", ...docTypes] as Array<DocType | "All">).map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  typeFilter === type
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* AI Answer */}
      <section className="rounded-2xl bg-gradient-to-br from-sky-50 to-indigo-50 border border-sky-100 p-5 flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-sky-600 flex items-center justify-center shrink-0">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-sky-800">Presales Insights</span>
          {isLoading ? (
            <span className="text-xs text-sky-500 bg-sky-100 px-2 py-0.5 rounded-full flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              Searching documents…
            </span>
          ) : (
            <span className="text-xs text-sky-500 bg-sky-100 px-2 py-0.5 rounded-full">
              {sources ? "From your documents" : "Generated"}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[100, 85, 70, 55].map((w) => (
              <div key={w} className="h-3 rounded-full bg-sky-100 animate-pulse" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : (
          <>
            {/* Executive summary */}
            <p className="text-sm text-slate-700 leading-relaxed">{displayAnswer}</p>

            {/* Metrics — proof points */}
            {metrics && metrics.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Proof Points</p>
                <div className="flex flex-wrap gap-2">
                  {metrics.map((m, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800"
                    >
                      <svg className="w-3 h-3 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Key points — reusable proposal bullets */}
            {keyPoints && keyPoints.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Reusable Bullets</p>
                <ul className="flex flex-col gap-1.5">
                  {keyPoints.map((kp, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
                      {kp}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Citations */}
            {displaySources.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Source Slides</p>
                <div className="flex flex-wrap gap-2">
                  {displaySources.map((src, i) => {
                    const isSelected = selectedSourceId === src.id;
                    return (
                      <button
                        key={src.id}
                        onClick={() => onSourceSelect(src)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          isSelected
                            ? "bg-sky-600 text-white border-sky-600 shadow-sm"
                            : "bg-white text-sky-700 border-sky-200 hover:bg-sky-50 hover:border-sky-400"
                        }`}
                      >
                        <span
                          className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                          style={
                            isSelected
                              ? { backgroundColor: "rgba(255,255,255,0.2)", color: "white" }
                              : { backgroundColor: "#e0f2fe", color: "#0369a1" }
                          }
                        >
                          {i + 1}
                        </span>
                        {src.title}
                        <span className={isSelected ? "text-sky-100" : "text-slate-400"}>
                          · {src.fileType === "pdf" ? "p." : "slide"} {src.slide}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* Document cards */}
      {docs.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-600">Related Documents</h3>
            {typeFilter !== "All" && (
              <button
                onClick={() => setTypeFilter("All")}
                className="text-xs font-medium text-sky-600 hover:text-sky-700"
              >
                Clear filter
              </button>
            )}
          </div>

          {filteredDocs.length > 0 ? (
            <div className="grid grid-cols-3 gap-4">
              {filteredDocs.map((doc) => (
                <Card
                  key={doc.id}
                  doc={doc}
                  onView={(d) => {
                    onSourceSelect({
                      id: `view-${d.id}`,
                      docId: d.id,
                      title: d.title,
                      slide: 1,
                      serviceLine: d.serviceLine,
                      filePath: (d as Document & { filePath?: string }).filePath,
                      fileType: (d as Document & { fileType?: "pdf" | "pptx" }).fileType,
                    });
                  }}
                  onAskAI={(_, prompt) => {
                    onDocumentQuestion(prompt);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center">
              <p className="text-sm font-medium text-slate-600">No documents match this filter.</p>
              <button
                onClick={() => setTypeFilter("All")}
                className="mt-2 text-xs font-semibold text-sky-600 hover:text-sky-700"
              >
                Show all documents
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
