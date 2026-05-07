"use client";

import { useEffect, useRef, useState } from "react";
import type { Source, LocalFile } from "@/types";
import PdfPageCanvas, { clearPdfCache } from "./PdfPageCanvas";
import PptxSlideView from "./PptxSlideView";
import SlideModal, { type ModalContent } from "./SlideModal";

const DISPLAY_W = 368;
const PLACEHOLDER_H = Math.round(DISPLAY_W * 9 / 16);

// Defers rendering children until the element scrolls within 300px of the viewport.
// Pass eager=true for the active slide so it loads immediately regardless.
function LazySlide({ children, eager }: { children: React.ReactNode; eager?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager ?? false);

  useEffect(() => {
    if (eager) { setVisible(true); return; }
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: "300px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [eager, visible]);

  if (!visible) {
    return (
      <div
        ref={ref}
        style={{ width: DISPLAY_W, height: PLACEHOLDER_H, background: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <div className="w-5 h-5 rounded-full border-2 border-slate-600 border-t-slate-400 animate-spin" />
      </div>
    );
  }
  return <>{children}</>;
}

export interface SlideDeckItem {
  id: string;
  filePath: string;
  fileTitle: string;
  slideNumber: number;
}

export interface SlideDeck {
  id: string;
  name: string;
  items: SlideDeckItem[];
}

interface Props {
  source: Source;
  activeDeck?: SlideDeck;
  onToggleDeckSlide?: (item: Omit<SlideDeckItem, "id">) => void;
  onClearDeck?: () => void;
  onExportDeck?: () => void;
  onClose?: () => void;
  deckExporting?: boolean;
  deckError?: string;
}

type PptxStatus = "idle" | "converting" | "ready" | "no-libreoffice" | "error";

export default function LocalDocPreview({
  source,
  activeDeck,
  onToggleDeckSlide,
  onClearDeck,
  onExportDeck,
  onClose,
  deckExporting = false,
  deckError = "",
}: Props) {
  const { filePath, fileType, slide: activePage, title } = source;
  const activeRef = useRef<HTMLDivElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  const [doc,     setDoc]     = useState<LocalFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  // PPTX → PDF conversion state
  const [pptxStatus,   setPptxStatus]   = useState<PptxStatus>("idle");
  const [pptxPdfUrl,   setPptxPdfUrl]   = useState<string | null>(null);
  const [convProgress, setConvProgress] = useState(0);

  const [modal, setModal] = useState<{ slideNumber: number } | null>(null);

  // Load slide list (text extraction, used for slide count / scroll)
  useEffect(() => {
    if (!filePath) return;
    setDoc(null); setError(""); setLoading(true);
    fetch(`/api/local/extract?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(data => { if (data.error) throw new Error(data.error); setDoc(data as LocalFile); })
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, [filePath]);

  // Convert PPTX → PDF via LibreOffice when source changes
  useEffect(() => {
    if (!filePath || fileType !== "pptx") return;

    // Revoke previous blob URL and clear its pdfjs document from the shared cache
    if (blobUrlRef.current) { clearPdfCache(blobUrlRef.current); URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    setPptxPdfUrl(null);
    setPptxStatus("converting");

    fetch(`/api/local/pptx-to-pdf?path=${encodeURIComponent(filePath)}`)
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          const msg: string = j.error ?? `HTTP ${r.status}`;
          if (msg.includes("not installed") || msg.includes("not found") || r.status === 503) {
            setPptxStatus("no-libreoffice");
          } else {
            setPptxStatus("error");
          }
          return;
        }
        const blob = await r.blob();
        const url  = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setPptxPdfUrl(url);
        setPptxStatus("ready");
      })
      .catch(() => setPptxStatus("error"));

    return () => {
      if (blobUrlRef.current) { clearPdfCache(blobUrlRef.current); URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    };
  }, [filePath, fileType]);

  // Auto-scroll to referenced slide whenever the active slide number changes
  useEffect(() => {
    if (!activeRef.current) return;
    // Small rAF delay so React has painted the new active ref before we scroll
    const id = requestAnimationFrame(() => {
      activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(id);
  }, [activePage, doc, pptxStatus]);

  // Simulated progress bar — crawls during conversion, snaps to 100 on ready
  useEffect(() => {
    if (pptxStatus === "converting") {
      setConvProgress(5);
      const id = setInterval(() => {
        setConvProgress((p) => {
          if (p < 40) return p + 4;
          if (p < 65) return p + 2;
          if (p < 82) return p + 0.8;
          if (p < 90) return p + 0.2;
          return p;
        });
      }, 400);
      return () => clearInterval(id);
    }
    if (pptxStatus === "ready") {
      setConvProgress(100);
      const t = setTimeout(() => setConvProgress(0), 900);
      return () => clearTimeout(t);
    }
    setConvProgress(0);
  }, [pptxStatus]);

  const fileUrl    = filePath ? `/api/local/serve?path=${encodeURIComponent(filePath)}` : "";
  const slideLabel = fileType === "pdf" ? "Page" : fileType === "pptx" ? "Slide" : "Section";
  const canComposeDeck = fileType === "pptx" && Boolean(filePath);
  const selectedSlides = activeDeck?.items
    .filter((item) => item.filePath === filePath)
    .map((item) => item.slideNumber) ?? [];
  const selectedSlideList = [...selectedSlides].sort((a, b) => a - b).join(", ");
  const modalSlide = modal && doc ? doc.slides.find(sl => sl.number === modal.slideNumber) : null;
  const modalContent: ModalContent | null = modalSlide
    ? fileType === "pdf"
      ? { kind: "pdf", fileUrl, pageNumber: modalSlide.number }
      : fileType === "pptx" && pptxPdfUrl
        ? { kind: "pdf", fileUrl: pptxPdfUrl, pageNumber: modalSlide.number }
        : fileType === "pptx"
          ? { kind: "pptx-view", filePath: filePath ?? "", slideNumber: modalSlide.number }
          : null
    : null;

  const selectAllSlides = () => {
    if (!doc || !filePath || !onToggleDeckSlide) return;
    const alreadySelected = new Set(selectedSlides);
    for (const sl of doc.slides) {
      if (!alreadySelected.has(sl.number)) {
        onToggleDeckSlide({ filePath, fileTitle: title, slideNumber: sl.number });
      }
    }
  };

  return (
    <aside className="relative flex flex-col w-full md:w-[400px] h-screen shrink-0 bg-white border-l border-slate-200">

      {/* ── Top progress bar (PPT → PDF loading) ── */}
      {convProgress > 0 && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-slate-100 z-30">
          <div
            className="h-full bg-sky-500 transition-all ease-out"
            style={{ width: `${convProgress}%`, transitionDuration: convProgress === 100 ? "200ms" : "400ms" }}
          />
        </div>
      )}

      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 shrink-0">
        <div className="flex items-start gap-2">
          <span className={`mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
            fileType === "pdf"
              ? "bg-red-50 text-red-600 border border-red-200"
              : fileType === "docx"
              ? "bg-blue-50 text-blue-600 border border-blue-200"
              : "bg-orange-50 text-orange-600 border border-orange-200"
          }`}>{fileType}</span>

          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-800 truncate">{title}</h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {doc && <span className="text-xs text-slate-400">{doc.totalSlides} {slideLabel.toLowerCase()}s</span>}
              <span className="text-slate-200">·</span>
              <span className="text-xs text-sky-600 font-medium">{slideLabel} {activePage} referenced</span>
              {fileType === "pptx" && pptxStatus === "converting" && (
                <span className="text-xs text-amber-500 flex items-center gap-1">
                  <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Loading, have patience…
                </span>
              )}
              {fileType === "pptx" && pptxStatus === "ready" && (
                <span className="text-xs text-emerald-500 font-medium">PDF ready</span>
              )}
              {canComposeDeck && selectedSlides.length > 0 && (
                <span className="text-xs text-violet-600 font-medium">{selectedSlides.length} selected</span>
              )}
            </div>
          </div>

          {filePath && (
            <a href={`/api/local/serve?path=${encodeURIComponent(filePath)}`} download={title}
              title="Download file"
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </a>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              aria-label="Close preview"
              title="Close preview"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {canComposeDeck && doc && (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={selectAllSlides}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Select all
            </button>
            <button
              onClick={onClearDeck}
              disabled={selectedSlides.length === 0}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Clear
            </button>
            <button
              onClick={onExportDeck}
              disabled={selectedSlides.length === 0 || deckExporting}
              className="ml-auto px-3 py-1.5 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {deckExporting && (
                <span className="w-3 h-3 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />
              )}
              Export slides
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 truncate">
            Selected slides: {selectedSlideList || "None"}
          </p>
          {deckError && (
            <p className="mt-2 text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-2 py-1.5">
              {deckError}
            </p>
          )}
        </div>
      )}

      {/* LibreOffice not installed banner */}
      {fileType === "pptx" && pptxStatus === "no-libreoffice" && (
        <div className="mx-4 mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 shrink-0">
          <p className="text-xs font-semibold text-amber-800 mb-1">Install LibreOffice for full slide preview</p>
          <p className="text-[11px] text-amber-700 leading-relaxed">
            <span className="font-mono bg-amber-100 px-1 rounded">brew install --cask libreoffice</span>
            &nbsp;· or download from&nbsp;
            <a href="https://www.libreoffice.org" target="_blank" rel="noopener noreferrer" className="underline">libreoffice.org</a>
          </p>
          <p className="text-[11px] text-amber-600 mt-1">Showing best-effort preview below.</p>
        </div>
      )}

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
              const isSelected = selectedSlides.includes(sl.number);
              return (
                <div
                  key={sl.number}
                  ref={isActive ? activeRef : null}
                  className={`relative rounded-xl overflow-visible border-2 transition-all duration-200 cursor-pointer hover:border-sky-300 hover:shadow-md ${
                    isSelected
                      ? "border-violet-500 shadow-lg shadow-violet-100"
                      : isActive ? "border-sky-500 shadow-lg shadow-sky-100" : "border-transparent"
                  }`}
                  onClick={() => fileType === "docx" ? undefined : setModal({ slideNumber: sl.number })}
                >
                  {/* Label row */}
                  <div className={`flex items-center justify-between px-3 py-1.5 text-xs font-medium shrink-0 ${
                    isSelected
                      ? "bg-violet-600 text-white"
                      : isActive ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-500"
                  }`}>
                    <span>{slideLabel} {sl.number}</span>
                    <div className="flex items-center gap-2">
                      {isActive && (
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm3.707-9.293a1 1 0 0 0-1.414-1.414L9 10.586 7.707 9.293a1 1 0 0 0-1.414 1.414l2 2a1 1 0 0 0 1.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          Referenced
                        </span>
                      )}
                      {canComposeDeck && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => {
                            if (filePath) onToggleDeckSlide?.({ filePath, fileTitle: title, slideNumber: sl.number });
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                          title={isSelected ? "Remove slide from export" : "Add slide to export"}
                        />
                      )}
                    </div>
                  </div>

                  {/* Slide content — active slide loads eagerly, others lazily */}
                  <LazySlide eager={isActive}>
                    {fileType === "pdf" ? (
                      <div style={{ width: DISPLAY_W, background: "#f8fafc" }}>
                        <PdfPageCanvas fileUrl={fileUrl} pageNumber={sl.number} displayWidth={DISPLAY_W} />
                      </div>
                    ) : fileType === "docx" ? (
                      <div className="bg-white px-4 py-3">
                        <p className="text-xs leading-relaxed text-slate-600 whitespace-pre-wrap line-clamp-[12]">
                          {sl.text || "No text extracted from this section."}
                        </p>
                      </div>
                    ) : pptxStatus === "ready" && pptxPdfUrl ? (
                      <div style={{ width: DISPLAY_W, background: "#f8fafc" }}>
                        <PdfPageCanvas fileUrl={pptxPdfUrl} pageNumber={sl.number} displayWidth={DISPLAY_W} />
                      </div>
                    ) : pptxStatus === "converting" ? (
                      <div style={{ width: DISPLAY_W, height: PLACEHOLDER_H, background: "#1e293b", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                        <div className="w-5 h-5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                        <span style={{ fontSize: 10, color: "rgba(241,245,249,0.5)" }}>Loading, have patience…</span>
                      </div>
                    ) : (
                      <PptxSlideView filePath={filePath ?? ""} slideNumber={sl.number} displayWidth={DISPLAY_W} />
                    )}
                  </LazySlide>

                  {/* Excerpt */}
                  {isActive && source.excerpt && (
                    <div className="px-3 py-2 bg-sky-50 border-t border-sky-100">
                      <p className="text-xs text-sky-700 italic">&ldquo;{source.excerpt}&rdquo;</p>
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
          onPrevious={() => setModal(prev => prev ? { slideNumber: prev.slideNumber - 1 } : prev)}
          onNext={() => setModal(prev => prev ? { slideNumber: prev.slideNumber + 1 } : prev)}
          hasPrevious={modal.slideNumber > 1}
          hasNext={modal.slideNumber < doc.slides.length}
          totalSlides={doc.slides.length}
          slideLabel={slideLabel}
        />
      )}
    </aside>
  );
}
