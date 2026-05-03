"use client";

import { useEffect, useRef, useState } from "react";
import type { Source, LocalFile } from "@/types";
import PdfPageCanvas from "./PdfPageCanvas";
import SlideModal, { type ModalContent } from "./SlideModal";

// Panel content width = 400px panel − 32px padding
const DISPLAY_W = 368;

interface Props {
  source: Source;
}

export default function LocalDocPreview({ source }: Props) {
  const { filePath, fileType, slide: activePage, title } = source;
  const activeRef = useRef<HTMLDivElement>(null);

  const [doc, setDoc]       = useState<LocalFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const [modal, setModal]   = useState<{
    slideNumber: number;
  } | null>(null);

  // Load all slides/pages for this file
  useEffect(() => {
    if (!filePath) return;
    setDoc(null);
    setError("");
    setLoading(true);

    fetch(`/api/local/extract?path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDoc(data as LocalFile);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [filePath]);

  // Auto-scroll to the referenced slide after content loads
  useEffect(() => {
    if (doc && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [doc]);

  const fileUrl = filePath
    ? `/api/local/serve?path=${encodeURIComponent(filePath)}`
    : "";

  const slideLabel = fileType === "pdf" ? "Page" : "Slide";
  const modalSlide = modal && doc
    ? doc.slides.find((sl) => sl.number === modal.slideNumber)
    : null;
  const modalContent: ModalContent | null = modalSlide
    ? fileType === "pdf"
      ? { kind: "pdf", fileUrl, pageNumber: modalSlide.number }
      : { kind: "pptx", text: modalSlide.text }
    : null;

  return (
    <aside
      className="flex flex-col h-screen shrink-0 bg-white border-l border-slate-200"
      style={{ width: 400 }}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 shrink-0">
        <div className="flex items-start gap-2">
          {/* File type badge */}
          <span
            className={`mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
              fileType === "pdf"
                ? "bg-red-50 text-red-600 border border-red-200"
                : "bg-orange-50 text-orange-600 border border-orange-200"
            }`}
          >
            {fileType}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-800 truncate">{title}</h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {doc && (
                <span className="text-xs text-slate-400">
                  {doc.totalSlides} {slideLabel.toLowerCase()}s
                </span>
              )}
              <span className="text-slate-200">·</span>
              <span className="text-xs text-sky-600 font-medium">
                {slideLabel} {activePage} referenced
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-8 h-8 border-2 border-sky-200 border-t-sky-500 rounded-full animate-spin" />
            <p className="text-xs text-slate-400">Extracting content…</p>
          </div>
        )}

        {error && (
          <div className="m-4 p-3 rounded-lg bg-red-50 border border-red-100">
            <p className="text-xs text-red-600 font-medium">Failed to load document</p>
            <p className="text-xs text-red-400 mt-1 font-mono break-all">{error}</p>
          </div>
        )}

        {doc && !loading && (
          <div className="flex flex-col gap-4 p-4">
            {doc.slides.map((sl) => {
              const isActive = sl.number === activePage;
              return (
                <div
                  key={sl.number}
                  ref={isActive ? activeRef : null}
                  className={`rounded-xl overflow-hidden border-2 transition-all duration-200 cursor-pointer hover:border-sky-300 hover:shadow-md ${
                    isActive
                      ? "border-sky-500 shadow-lg shadow-sky-100"
                      : "border-transparent"
                  }`}
                  onClick={() => setModal({ slideNumber: sl.number })}
                >
                  {/* Slide number row */}
                  <div
                    className={`flex items-center justify-between px-3 py-1.5 text-xs font-medium shrink-0 ${
                      isActive ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <span>{slideLabel} {sl.number}</span>
                    {isActive && (
                      <span className="flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd"
                            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm3.707-9.293a1 1 0 0 0-1.414-1.414L9 10.586 7.707 9.293a1 1 0 0 0-1.414 1.414l2 2a1 1 0 0 0 1.414 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Referenced
                      </span>
                    )}
                  </div>

                  {/* Slide content */}
                  {fileType === "pdf" ? (
                    // Render actual PDF page using pdfjs-dist + canvas
                    <div style={{ width: DISPLAY_W, background: "#f8fafc" }}>
                      <PdfPageCanvas
                        fileUrl={fileUrl}
                        pageNumber={sl.number}
                        displayWidth={DISPLAY_W}
                      />
                    </div>
                  ) : (
                    // PPTX: render extracted text as a styled slide card
                    <PptxSlideCard text={sl.text} isActive={isActive} />
                  )}

                  {/* Excerpt from AI citation */}
                  {isActive && source.excerpt && (
                    <div className="px-3 py-2 bg-sky-50 border-t border-sky-100">
                      <p className="text-xs text-sky-700 italic">
                        &ldquo;{source.excerpt}&rdquo;
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modal && doc && modalContent && (
        <SlideModal
          content={modalContent}
          docTitle={title}
          slideNumber={modal.slideNumber}
          caption={`${slideLabel} ${modal.slideNumber}`}
          onClose={() => setModal(null)}
          onPrevious={() => setModal((prev) => prev ? { slideNumber: prev.slideNumber - 1 } : prev)}
          onNext={() => setModal((prev) => prev ? { slideNumber: prev.slideNumber + 1 } : prev)}
          hasPrevious={modal.slideNumber > 1}
          hasNext={modal.slideNumber < doc.slides.length}
          totalSlides={doc.slides.length}
          slideLabel={slideLabel}
        />
      )}
    </aside>
  );
}

// ── PPTX text slide card ──────────────────────────────────────────────────────

function PptxSlideCard({ text, isActive }: { text: string; isActive: boolean }) {
  // Split extracted text into title (first meaningful chunk) and body
  const parts = text.split(/\s{3,}|\n/).map((s) => s.trim()).filter(Boolean);
  const heading = parts[0] ?? "";
  const body = parts.slice(1).join("  ·  ");

  return (
    <div
      style={{
        width: DISPLAY_W,
        minHeight: Math.round(DISPLAY_W * 9 / 16),
        background: isActive ? "#0F2B5B" : "#1e293b",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "20px 22px",
        gap: 8,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative corner accent */}
      <div style={{
        position: "absolute",
        top: -20,
        right: -20,
        width: 80,
        height: 80,
        borderRadius: "50%",
        background: isActive ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.04)",
      }} />

      {heading ? (
        <p style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.4, margin: 0 }}>
          {heading}
        </p>
      ) : null}

      {body ? (
        <p style={{ fontSize: 11, color: "rgba(241,245,249,0.6)", lineHeight: 1.6, margin: 0 }}>
          {body.length > 220 ? body.slice(0, 220) + "…" : body}
        </p>
      ) : (
        <p style={{ fontSize: 11, color: "rgba(241,245,249,0.3)", fontStyle: "italic", margin: 0 }}>
          No text extracted from this slide
        </p>
      )}

      {/* Bottom accent */}
      <div style={{
        position: "absolute",
        bottom: 0, left: 0, right: 0,
        height: 2,
        background: isActive ? "#C9A84C" : "rgba(255,255,255,0.08)",
      }} />
    </div>
  );
}
