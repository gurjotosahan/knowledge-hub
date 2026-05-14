"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import type { AppConfig, SlideSearchGroup, SlideSearchResult, SlideSearchTopicGroup } from "@/types";
import { DEFAULT_CONFIG } from "@/types";
import PptxSlideView from "@/components/PptxSlideView";
import PdfPageCanvas, { clearPdfCache } from "@/components/PdfPageCanvas";

const CONFIG_KEY = "apexon-hub-config";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StagedSlide {
  id: string; // unique key
  filePath: string;
  fileTitle: string;
  slideNumber: number;
  isTemplate: boolean;
}

interface TemplateInfo {
  path: string;
  name: string;
  totalSlides: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, disposition: string | null, fallback: string) {
  const url = URL.createObjectURL(blob);
  const filename = disposition?.match(/filename="([^"]+)"/)?.[1] ?? fallback;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function fetchTotalSlides(filePath: string): Promise<number> {
  const res = await fetch(
    `/api/local/pptx-slide?path=${encodeURIComponent(filePath)}&slide=1`
  );
  if (!res.ok) return 0;
  const data = await res.json();
  return data.totalSlides ?? 0;
}

// ── Slide thumbnail card ──────────────────────────────────────────────────────

function confidenceCls(confidence?: SlideSearchResult["confidence"]): string {
  if (confidence === "High") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (confidence === "Medium") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-500 border-slate-200";
}

function SlideThumbnail({
  filePath,
  slideNumber,
  label,
  displayWidth = 220,
  selected,
  onToggle,
  onPreview,
  thumbnailUrl,
}: {
  filePath: string;
  slideNumber: number;
  label?: string;
  displayWidth?: number;
  selected?: boolean;
  onToggle?: () => void;
  onPreview?: () => void;
  thumbnailUrl?: string;
}) {
  return (
    <div
      className={`rounded-xl border bg-white shadow-sm transition-all ${
        selected ? "border-sky-500 ring-2 ring-sky-300" : "border-slate-200 hover:border-slate-300"
      }`}
      style={{ width: displayWidth }}
    >
      {/* slide preview — clicking anywhere on the slide opens the zoom */}
      <div
        onClick={onPreview ?? onToggle}
        className="overflow-hidden rounded-t-xl bg-slate-100 cursor-pointer"
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={`Slide ${slideNumber}`}
            style={{ width: displayWidth }}
            className="block object-cover"
          />
        ) : (
          <PptxSlideView filePath={filePath} slideNumber={slideNumber} displayWidth={displayWidth} />
        )}
      </div>

      {/* footer */}
      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
        <span className="text-[10px] text-slate-500 truncate">
          {label ?? `Slide ${slideNumber}`}
        </span>
        {onToggle && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold transition-colors ${
              selected
                ? "bg-sky-600 text-white hover:bg-sky-700"
                : "bg-slate-100 text-slate-500 hover:bg-sky-50 hover:text-sky-600"
            }`}
            title={selected ? "Remove" : "Add to deck"}
          >
            {selected ? "−" : "+"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Preview modal: converts PPTX → PDF on demand for pixel-accurate render ──
function SlidePreviewModal({
  filePath, slideNumber, onClose,
}: { filePath: string; slideNumber: number; onClose: () => void }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"converting" | "ready" | "error">("converting");
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("converting");
    fetch(`/api/local/pptx-to-pdf?path=${encodeURIComponent(filePath)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setPdfUrl(url);
        setStatus("ready");
      })
      .catch(() => { if (!cancelled) setStatus("error"); });

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        clearPdfCache(blobUrlRef.current);
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [filePath]);

  const displayWidth = Math.min(900, (typeof window !== "undefined" ? window.innerWidth : 1200) - 80);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative rounded-2xl overflow-hidden shadow-2xl bg-white" onClick={(e) => e.stopPropagation()}>
        {status === "ready" && pdfUrl ? (
          <PdfPageCanvas fileUrl={pdfUrl} pageNumber={slideNumber} displayWidth={displayWidth} />
        ) : (
          <div style={{ width: displayWidth, height: Math.round(displayWidth * 9 / 16) }}
               className="flex flex-col items-center justify-center bg-slate-100 gap-3">
            {status === "converting" ? (
              <>
                <div className="w-8 h-8 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
                <span className="text-xs text-slate-500">Rendering slide…</span>
              </>
            ) : (
              <>
                <span className="text-sm text-slate-600 font-medium">Preview unavailable</span>
                <span className="text-xs text-slate-400">PDF conversion failed — falling back to text-only view</span>
                <div className="mt-2">
                  <PptxSlideView filePath={filePath} slideNumber={slideNumber} displayWidth={displayWidth} />
                </div>
              </>
            )}
          </div>
        )}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SlideComposerPage() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

  // Template state
  const [template, setTemplate] = useState<TemplateInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Staging
  const [staged, setStaged] = useState<StagedSlide[]>([]);
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState("");
  const [engine, setEngine] = useState<"automizer" | "aspose" | "aspose-foss" | "zip">("automizer");

  // Search (right panel)
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SlideSearchGroup[]>([]);
  const [searchTopicGroups, setSearchTopicGroups] = useState<SlideSearchTopicGroup[]>([]);
  const [searchError, setSearchError] = useState("");

  // Preview modal
  const [preview, setPreview] = useState<{ filePath: string; slideNumber: number } | null>(null);

  // Tab in left panel: "template" or "staged"
  const [leftTab, setLeftTab] = useState<"template" | "staged">("template");

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      let nextConfig = DEFAULT_CONFIG;

      try {
        const saved = localStorage.getItem(CONFIG_KEY);
        if (saved) nextConfig = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
      } catch {}

      try {
        const res = await fetch("/api/config/defaults");
        if (res.ok) {
          const defaults = await res.json();
          const nonEmptyDefaults = Object.fromEntries(
            Object.entries(defaults).filter(([, value]) => value !== "")
          );
          nextConfig = { ...nextConfig, ...nonEmptyDefaults };
        }
      } catch {}

      if (!cancelled) setConfig(nextConfig);
    };

    loadConfig();
    return () => { cancelled = true; };
  }, []);

  // ── Template upload ──────────────────────────────────────────────────────────

  const handleFileSelect = useCallback(async (file: File) => {
    if (!/\.pptx$/i.test(file.name)) {
      setUploadError("Only PPTX files are supported.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/local/upload-template", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      const totalSlides = await fetchTotalSlides(data.path);
      setTemplate({ path: data.path, name: file.name, totalSlides });
      // Pre-stage all template slides in order
      const initial: StagedSlide[] = [];
      for (let i = 1; i <= totalSlides; i++) {
        initial.push({
          id: `template-${i}`,
          filePath: data.path,
          fileTitle: file.name.replace(/\.pptx$/i, ""),
          slideNumber: i,
          isTemplate: true,
        });
      }
      setStaged(initial);
    } catch (err) {
      setUploadError(String(err));
    } finally {
      setUploading(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  // ── Staging helpers ──────────────────────────────────────────────────────────

  const stagedKey = (filePath: string, slideNumber: number) => `${filePath}::${slideNumber}`;

  const stagedKeys = useMemo(
    () => new Set(staged.map((s) => stagedKey(s.filePath, s.slideNumber))),
    [staged]
  );

  const isStaged = (filePath: string, slideNumber: number) =>
    stagedKeys.has(stagedKey(filePath, slideNumber));

  const addToStaged = (group: SlideSearchGroup, slide: SlideSearchResult) => {
    const key = stagedKey(group.filePath, slide.slideNumber);
    if (stagedKeys.has(key)) return;
    setStaged((prev) => [
      ...prev,
      {
        id: key,
        filePath: group.filePath,
        fileTitle: group.fileTitle,
        slideNumber: slide.slideNumber,
        isTemplate: group.filePath === template?.path,
      },
    ]);
  };

  const removeFromStaged = (id: string) =>
    setStaged((prev) => prev.filter((s) => s.id !== id));

  const moveStaged = (fromIdx: number, toIdx: number) => {
    setStaged((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      return next;
    });
  };

  // ── Search ────────────────────────────────────────────────────────────────────

  const runSearch = useCallback(async () => {
    if (!query.trim() || !config.folderPath) return;
    setSearching(true);
    setSearchError("");
    setSearchResults([]);
    setSearchTopicGroups([]);
    try {
      const res = await fetch("/api/ai/slide-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          sourceKey: config.folderPath,
          folderPath: config.folderPath,
          aiProvider: config.aiProvider,
          ollamaBaseUrl: config.ollamaBaseUrl,
          ollamaModel: config.ollamaModel,
          ollamaEmbedModel: config.ollamaEmbedModel,
          openrouterModel: config.openrouterModel,
          geminiModel: config.geminiModel,
          embeddingProvider: config.embeddingProvider,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setSearchResults(data.groups ?? []);
      setSearchTopicGroups(data.topicGroups ?? []);
    } catch (err) {
      setSearchError(String(err));
    } finally {
      setSearching(false);
    }
  }, [query, config]);

  // ── Compose & Download ────────────────────────────────────────────────────────

  const composeAndDownload = async () => {
    if (!template || staged.length === 0) return;
    setComposing(true);
    setComposeError("");
    try {
      const res = await fetch("/api/local/compose-pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templatePath: template.path,
          slides: staged.map((s) => ({ filePath: s.filePath, slideNumber: s.slideNumber })),
          title: template.name.replace(/\.pptx$/i, ""),
          engine,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Compose failed");
      }
      const blob = await res.blob();
      downloadBlob(blob, res.headers.get("Content-Disposition"), "composed-deck.pptx");
    } catch (err) {
      setComposeError(String(err));
    } finally {
      setComposing(false);
    }
  };

  // ── Drag-and-drop re-ordering in staging tray ─────────────────────────────────

  const dragIdxRef = useRef<number | null>(null);

  // ── Render ────────────────────────────────────────────────────────────────────

  const templateSlideNums = template
    ? Array.from({ length: template.totalSlides }, (_, i) => i + 1)
    : [];

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">

      {/* ── Back nav ── */}
      <div className="absolute top-3 left-3 z-20">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Knowledge Hub
        </Link>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          LEFT PANEL — Template viewer + Staging tray
      ═══════════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col w-[520px] shrink-0 border-r border-slate-200 bg-white">

        {/* Header */}
        <div className="px-5 pt-12 pb-3 border-b border-slate-100">
          <h1 className="text-base font-bold text-slate-800">Slide Composer</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Upload a template, browse slides, search on the right, then compose & download.
          </p>
        </div>

        {/* Upload zone */}
        {!template && (
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            className="mx-4 my-3 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center transition-colors hover:border-sky-400 hover:bg-sky-50"
          >
            <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-slate-700">Drop your PPTX template here</p>
              <p className="text-xs text-slate-400 mt-0.5">or click to browse</p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {uploading ? "Uploading…" : "Choose File"}
            </button>
            {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pptx"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
            />
          </div>
        )}

        {template && (
          <>
            {/* Template name + change button */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center gap-2 min-w-0">
                <svg className="w-4 h-4 shrink-0 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-xs font-semibold text-slate-700 truncate">{template.name}</span>
                <span className="text-xs text-slate-400">· {template.totalSlides} slides</span>
              </div>
              <button
                onClick={() => { setTemplate(null); setStaged([]); }}
                className="shrink-0 text-xs text-slate-400 hover:text-red-500 transition-colors"
              >
                Change
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-100">
              {(["template", "staged"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setLeftTab(tab)}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                    leftTab === tab
                      ? "border-b-2 border-sky-500 text-sky-600"
                      : "text-slate-400 hover:text-slate-600"
                  }`}
                >
                  {tab === "template" ? `Template (${template.totalSlides})` : `Staging (${staged.length})`}
                </button>
              ))}
            </div>

            {/* Template slides grid */}
            {leftTab === "template" && (
              <div className="flex-1 overflow-y-auto p-3">
                <div className="flex flex-wrap gap-3">
                  {templateSlideNums.map((n) => (
                    <SlideThumbnail
                      key={n}
                      filePath={template.path}
                      slideNumber={n}
                      displayWidth={228}
                      label={`Slide ${n}`}
                      selected={isStaged(template.path, n)}
                      onToggle={() => {
                        if (isStaged(template.path, n)) {
                          const s = staged.find((x) => x.filePath === template.path && x.slideNumber === n);
                          if (s) removeFromStaged(s.id);
                        } else {
                          addToStaged(
                            { filePath: template.path, fileTitle: template.name, fileType: "pptx", slides: [] },
                            { slideNumber: n, reason: "", excerpt: "" }
                          );
                        }
                      }}
                      onPreview={() => setPreview({ filePath: template.path, slideNumber: n })}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Staging tray */}
            {leftTab === "staged" && (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex-1 overflow-y-auto p-3">
                  {staged.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-xs text-slate-400 gap-1">
                      <span>No slides staged yet.</span>
                      <span>Toggle slides from Template tab or search results.</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {staged.map((s, idx) => (
                        <div
                          key={s.id}
                          draggable
                          onDragStart={() => { dragIdxRef.current = idx; }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragIdxRef.current !== null && dragIdxRef.current !== idx) {
                              moveStaged(dragIdxRef.current, idx);
                              dragIdxRef.current = null;
                            }
                          }}
                          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-slate-300 cursor-grab active:cursor-grabbing"
                        >
                          {/* drag handle */}
                          <svg className="w-3.5 h-3.5 text-slate-300 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z"/>
                          </svg>
                          <span className="text-[10px] text-slate-400 w-5 text-right shrink-0">{idx + 1}.</span>
                          {/* mini thumb */}
                          <div className="w-14 h-9 shrink-0 overflow-hidden rounded border border-slate-100 bg-slate-50">
                            <PptxSlideView filePath={s.filePath} slideNumber={s.slideNumber} displayWidth={56} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-slate-700 truncate">
                              Slide {s.slideNumber}
                            </p>
                            <p className="text-[10px] text-slate-400 truncate">{s.fileTitle}</p>
                          </div>
                          <button
                            onClick={() => removeFromStaged(s.id)}
                            className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-slate-300 hover:text-red-400 transition-colors"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Compose footer */}
                <div className="border-t border-slate-100 px-4 py-3 shrink-0">
                  {/* Engine selector */}
                  <div className="mb-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Merge engine</p>
                    <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 border border-slate-200">
                      {([
                        { id: "automizer",   label: "Automizer",   hint: "Default" },
                        { id: "aspose",      label: "Aspose",      hint: "Highest fidelity · uses license if ASPOSE_LICENSE_PATH is set" },
                        { id: "aspose-foss", label: "Aspose FOSS", hint: "MIT open-source · no watermark · slides hosted in template master" },
                        { id: "zip",         label: "ZIP",         hint: "Manual merger · no extra deps" },
                      ] as const).map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => setEngine(opt.id)}
                          title={opt.hint}
                          className={`flex-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                            engine === opt.id
                              ? "bg-white text-slate-700 shadow-sm"
                              : "text-slate-500 hover:text-slate-700"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {engine === "aspose" && (
                      <p className="mt-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                        Free tier inserts a watermark slide. Set <code>ASPOSE_LICENSE_PATH</code> to remove.
                      </p>
                    )}
                    {engine === "aspose-foss" && (
                      <p className="mt-1.5 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded">
                        MIT licensed · no watermark · slide content preserved, styled by template master.
                      </p>
                    )}
                  </div>

                  {composeError && (
                    <p className="mb-2 text-xs text-red-500">{composeError}</p>
                  )}
                  <button
                    onClick={composeAndDownload}
                    disabled={staged.length === 0 || composing}
                    className="w-full rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300 transition-colors"
                  >
                    {composing
                      ? "Composing…"
                      : `Download Composed Deck (${staged.length} slide${staged.length !== 1 ? "s" : ""})`}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          RIGHT PANEL — Slide search
      ═══════════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col flex-1 min-w-0 bg-slate-50">
        {/* Search header */}
        <div className="px-5 pt-12 pb-3 border-b border-slate-200 bg-white">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
            Search Slides
          </p>
          <form
            onSubmit={(e) => { e.preventDefault(); runSearch(); }}
            className="flex gap-2"
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                config.folderPath
                  ? "Search for slides by topic, client, keyword…"
                  : "Configure a folder path in Settings first"
              }
              disabled={!config.folderPath}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!query.trim() || !config.folderPath || searching}
              className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300 transition-colors"
            >
              {searching ? "…" : "Search"}
            </button>
          </form>
          {!config.folderPath && (
            <p className="mt-1.5 text-xs text-amber-600">
              Open Settings in the main Knowledge Hub to configure your document folder.
            </p>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {searchError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {searchError}
            </div>
          )}

          {searching && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
              <div className="w-4 h-4 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
              Searching…
            </div>
          )}

          {!searching && searchResults.length === 0 && !searchError && query && (
            <p className="text-sm text-slate-400 py-4">No slides matched. Try different keywords.</p>
          )}

          {!searching && searchResults.length === 0 && !query && (
            <div className="text-center py-12 text-slate-400">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <p className="text-sm">Search for slides to add to your deck</p>
            </div>
          )}

          {(() => {
            const hasTopics = searchTopicGroups.length > 0;
            const topics = hasTopics
              ? searchTopicGroups
              : [{ id: "all", topic: "", groups: searchResults, resultCount: searchResults.reduce((s, g) => s + g.slides.length, 0) }];

            return topics.map((topicGroup) => (
              <div key={topicGroup.id} className="space-y-3">
                {hasTopics && (
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
                    <span className="text-xs font-semibold text-slate-700">Topic: {topicGroup.topic}</span>
                    <span className="ml-auto shrink-0 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-500">
                      {topicGroup.resultCount} result{topicGroup.resultCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
                {topicGroup.groups.map((group) => (
                  <div key={group.filePath} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="px-4 py-3 border-b border-slate-100">
                      <p className="text-sm font-semibold text-slate-800 truncate">{group.fileTitle}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{group.slides.length} result{group.slides.length !== 1 ? "s" : ""}</p>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {group.slides.map((slide) => {
                        const staged_already = isStaged(group.filePath, slide.slideNumber);
                        return (
                          <div key={slide.slideNumber} className="flex items-start gap-4 p-4">
                            <div className="shrink-0">
                              <SlideThumbnail
                                filePath={group.filePath}
                                slideNumber={slide.slideNumber}
                                displayWidth={200}
                                label={`Slide ${slide.slideNumber}`}
                                thumbnailUrl={slide.thumbnailUrl}
                                selected={staged_already}
                                onToggle={() => {
                                  if (staged_already) {
                                    const s = staged.find(
                                      (x) => x.filePath === group.filePath && x.slideNumber === slide.slideNumber
                                    );
                                    if (s) removeFromStaged(s.id);
                                  } else {
                                    addToStaged(group, slide);
                                  }
                                }}
                                onPreview={() => setPreview({ filePath: group.filePath, slideNumber: slide.slideNumber })}
                              />
                            </div>
                            <div className="flex-1 min-w-0 pt-1 space-y-1.5">
                              <div className="flex items-start gap-1.5 flex-wrap">
                                {slide.assetYear && (
                                  <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                                    {slide.yearConfidence === "low" ? `${slide.assetYear} inferred` : slide.assetYear}
                                  </span>
                                )}
                                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${confidenceCls(slide.confidence)}`}>
                                  {slide.confidence ?? "Low"}
                                </span>
                              </div>
                              {slide.reason && (
                                <p className="text-sm text-slate-600 leading-relaxed">{slide.reason}</p>
                              )}
                              {slide.recencyNote && (
                                <p className="text-[11px] font-medium text-sky-700">{slide.recencyNote}</p>
                              )}
                              {slide.excerpt && (
                                <p className="text-xs leading-5 text-slate-400 line-clamp-2">{slide.excerpt}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ));
          })()}
        </div>
      </div>

      {/* ── Slide preview modal ──────────────────────────────────────────────── */}
      {preview && (
        <SlidePreviewModal
          filePath={preview.filePath}
          slideNumber={preview.slideNumber}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
