"use client";

import { useEffect, useRef, useState } from "react";
import type { SlideData } from "@/types";
import SlideRenderer from "./SlideRenderer";
import PdfPageCanvas from "./PdfPageCanvas";
import PptxPdfView from "./PptxPdfView";

// SlideRenderer design canvas
const DESIGN_W = 640;
const DESIGN_H = 360;

// Modal display size — larger deck-viewer canvas
const MODAL_W = 1120;
const MODAL_MAX_H = "calc(100vh - 140px)";

export type ModalContent =
  | { kind: "rendered";   data: SlideData; number: number }
  | { kind: "image";      url: string }
  | { kind: "pdf";        fileUrl: string; pageNumber: number }
  | { kind: "pptx";       text: string }
  | { kind: "pptx-view";  filePath: string; slideNumber: number };

interface Props {
  content: ModalContent;
  docTitle: string;
  slideNumber: number;
  caption: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  totalSlides?: number;
  slideLabel?: string;
}

export default function SlideModal({
  content,
  docTitle,
  slideNumber,
  caption,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
  totalSlides,
  slideLabel = "Slide",
}: Props) {
  const slideAreaRef = useRef<HTMLDivElement>(null);
  const [slideWidth, setSlideWidth] = useState(MODAL_W);
  const renderWidth = Math.max(320, Math.round(slideWidth));
  const renderScale = renderWidth / DESIGN_W;

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrevious) onPrevious?.();
      if (e.key === "ArrowRight" && hasNext) onNext?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hasNext, hasPrevious, onClose, onNext, onPrevious]);

  useEffect(() => {
    const node = slideAreaRef.current;
    if (!node) return;

    const updateWidth = () => setSlideWidth(node.clientWidth || MODAL_W);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const isPdf = content.kind === "pdf";

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Modal card — stop propagation so inner clicks don't close it */}
      <div
        className="flex flex-col rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10"
        style={{ width: MODAL_W, maxWidth: "calc(100vw - 48px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Slide area */}
        <div
          ref={slideAreaRef}
          style={{
            width: "100%",
            aspectRatio: isPdf ? undefined : "16 / 9",
            maxHeight: MODAL_MAX_H,
            position: "relative",
            overflow: isPdf ? "auto" : "hidden",
            background: "#0f172a",
            display: isPdf ? "flex" : "block",
            justifyContent: isPdf ? "center" : undefined,
          }}
        >
          {content.kind === "rendered" && (
            <div
              style={{
                width:  DESIGN_W,
                height: DESIGN_H,
                transform: `scale(${renderScale})`,
                transformOrigin: "top left",
                position: "absolute",
                top: 0,
                left: 0,
              }}
            >
              <SlideRenderer data={content.data} slideNumber={content.number} />
            </div>
          )}

          {content.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={content.url}
              alt={caption}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          )}

          {content.kind === "pdf" && (
            <div style={{ width: renderWidth, background: "#f8fafc" }}>
              <PdfPageCanvas
                key={`${content.fileUrl}-${content.pageNumber}-${renderWidth}`}
                fileUrl={content.fileUrl}
                pageNumber={content.pageNumber}
                displayWidth={renderWidth}
              />
            </div>
          )}

          {content.kind === "pptx" && (
            <PptxCard text={content.text} />
          )}

          {content.kind === "pptx-view" && (
            <div style={{ width: "100%", height: "100%" }}>
              <PptxPdfView
                filePath={content.filePath}
                slideNumber={content.slideNumber}
                displayWidth={renderWidth}
              />
            </div>
          )}
        </div>

        {/* Footer bar */}
        <div className="bg-slate-900 px-5 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{docTitle}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {slideLabel} {slideNumber}
              {totalSlides ? ` of ${totalSlides}` : ""}
              {caption && caption !== docTitle ? ` · ${caption}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onPrevious}
              disabled={!hasPrevious}
              aria-label={`Previous ${slideLabel.toLowerCase()}`}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={onNext}
              disabled={!hasNext}
              aria-label={`Next ${slideLabel.toLowerCase()}`}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <span className="text-xs text-slate-500">Press Esc to close</span>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PPTX text card at modal size ──────────────────────────────────────────────
function PptxCard({ text }: { text: string }) {
  const parts = text.split(/\s{3,}|\n/).map((s) => s.trim()).filter(Boolean);
  const heading = parts[0] ?? "";
  const body    = parts.slice(1).join("  ·  ");

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "#0F2B5B",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "40px 56px",
        gap: 16,
        position: "relative",
        overflow: "hidden",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Decorative circle */}
      <div style={{
        position: "absolute", top: -60, right: -60,
        width: 220, height: 220, borderRadius: "50%",
        background: "rgba(201,168,76,0.1)",
      }} />

      {heading && (
        <p style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.35, margin: 0 }}>
          {heading}
        </p>
      )}
      {body && (
        <p style={{ fontSize: 15, color: "rgba(241,245,249,0.65)", lineHeight: 1.7, margin: 0 }}>
          {body.length > 500 ? body.slice(0, 500) + "…" : body}
        </p>
      )}
      {!heading && !body && (
        <p style={{ fontSize: 15, color: "rgba(241,245,249,0.3)", fontStyle: "italic", margin: 0 }}>
          No text extracted from this slide
        </p>
      )}

      {/* Bottom accent */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "#C9A84C" }} />
    </div>
  );
}
