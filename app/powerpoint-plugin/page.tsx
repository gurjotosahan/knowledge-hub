"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig, SlideSearchGroup, SlideSearchResult, SlideSearchTopicGroup } from "@/types";
import { DEFAULT_CONFIG } from "@/types";
import PptxSlideView from "@/components/PptxSlideView";

const CONFIG_KEY = "apexon-hub-config";

interface WorkingDeck {
  path: string;
  name: string;
  totalSlides: number;
}

interface PickedSlide {
  id: string;
  filePath: string;
  fileTitle: string;
  slideNumber: number;
  topic?: string;
}

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
  const res = await fetch(`/api/local/pptx-slide?path=${encodeURIComponent(filePath)}&slide=1`);
  if (!res.ok) return 0;
  const data = await res.json();
  return data.totalSlides ?? 0;
}

function confidenceClass(confidence?: SlideSearchResult["confidence"]) {
  if (confidence === "High") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (confidence === "Medium") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-500 border-slate-200";
}

export default function PowerPointPluginPage() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [workingDeck, setWorkingDeck] = useState<WorkingDeck | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [groups, setGroups] = useState<SlideSearchGroup[]>([]);
  const [topicGroups, setTopicGroups] = useState<SlideSearchTopicGroup[]>([]);
  const [picked, setPicked] = useState<PickedSlide[]>([]);
  const [preview, setPreview] = useState<{ filePath: string; slideNumber: number } | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CONFIG_KEY);
      if (saved) setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(saved) });
    } catch {}
  }, []);

  const pickedKeys = useMemo(
    () => new Set(picked.map((slide) => `${slide.filePath}::${slide.slideNumber}`)),
    [picked]
  );

  const resultTopicGroups = topicGroups.length
    ? topicGroups
    : groups.length
      ? [{ id: "all", topic: "Best matches", groups, resultCount: groups.reduce((sum, group) => sum + group.slides.length, 0) }]
      : [];

  const uploadWorkingDeck = async (file: File) => {
    if (!/\.pptx$/i.test(file.name)) {
      setUploadError("Upload a PowerPoint .pptx file.");
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
      setWorkingDeck({ path: data.path, name: file.name, totalSlides });
      setPicked([]);
    } catch (err) {
      setUploadError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setUploading(false);
    }
  };

  const runSearch = async () => {
    if (!query.trim() || !config.folderPath) return;
    setSearching(true);
    setSearchError("");
    setGroups([]);
    setTopicGroups([]);
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
      setGroups(data.groups ?? []);
      setTopicGroups(data.topicGroups ?? []);
    } catch (err) {
      setSearchError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setSearching(false);
    }
  };

  const togglePicked = (group: SlideSearchGroup, slide: SlideSearchResult, topic?: string) => {
    const id = `${group.filePath}::${slide.slideNumber}`;
    setPicked((prev) =>
      prev.some((item) => item.id === id)
        ? prev.filter((item) => item.id !== id)
        : [...prev, { id, filePath: group.filePath, fileTitle: group.fileTitle, slideNumber: slide.slideNumber, topic }]
    );
  };

  const composeWorkingDeck = async () => {
    if (!workingDeck || picked.length === 0) return;
    setComposing(true);
    setComposeError("");
    try {
      const res = await fetch("/api/local/compose-pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templatePath: workingDeck.path,
          slides: picked.map((slide) => ({ filePath: slide.filePath, slideNumber: slide.slideNumber })),
          title: workingDeck.name.replace(/\.pptx$/i, ""),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Unable to update working deck.");
      }
      const blob = await res.blob();
      downloadBlob(blob, res.headers.get("Content-Disposition"), "working-deck-updated.pptx");
    } catch (err) {
      setComposeError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setComposing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[520px] flex-col border-x border-slate-200 bg-white">
        <header className="shrink-0 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-sm font-bold text-slate-900">Apexon Slide Search</h1>
              <p className="text-xs text-slate-500">PowerPoint task pane</p>
            </div>
            <span className="rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-bold uppercase text-orange-700">
              PPT
            </span>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col">
          <section className="shrink-0 border-b border-slate-100 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Working deck</p>
                {workingDeck ? (
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {workingDeck.name}
                    <span className="ml-1 font-normal text-slate-400">· {workingDeck.totalSlides} slides</span>
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">Upload the deck you are building.</p>
                )}
              </div>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {workingDeck ? "Change" : uploading ? "Uploading..." : "Upload"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".pptx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadWorkingDeck(file);
                  e.currentTarget.value = "";
                }}
              />
            </div>
            {uploadError && <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-600">{uploadError}</p>}
          </section>

          <section className="shrink-0 border-b border-slate-100 px-4 py-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runSearch();
              }}
              className="flex gap-2"
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={config.folderPath ? "Search topics or slide intents..." : "Configure folder in Apexon KM360"}
                disabled={!config.folderPath}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!query.trim() || !config.folderPath || searching}
                className="rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {searching ? "..." : "Search"}
              </button>
            </form>
            {!config.folderPath && (
              <p className="mt-2 text-xs text-amber-600">Open the main app settings and configure a local indexed folder first.</p>
            )}
          </section>

          <section className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {searchError && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{searchError}</p>}
            {searching && (
              <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                <span className="h-4 w-4 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
                Searching with slide intelligence...
              </div>
            )}
            {!searching && resultTopicGroups.length === 0 && (
              <div className="py-10 text-center text-sm text-slate-400">
                Search for topics, use cases, architectures, or proof points.
              </div>
            )}

            <div className="space-y-4">
              {resultTopicGroups.map((topic) => (
                <div key={topic.id} className="space-y-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-slate-800">{topic.topic}</h2>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500 border border-slate-200">
                        {topic.resultCount}
                      </span>
                    </div>
                  </div>

                  {topic.groups.map((group) => (
                    <div key={`${topic.id}-${group.filePath}`} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                      <div className="border-b border-slate-100 px-3 py-2">
                        <p className="truncate text-xs font-semibold text-slate-700">{group.fileTitle}</p>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {group.slides.map((slide) => {
                          const isPicked = pickedKeys.has(`${group.filePath}::${slide.slideNumber}`);
                          return (
                            <div key={slide.slideNumber} className="p-3">
                              <div className="mb-2 overflow-hidden rounded-lg border border-slate-100 bg-slate-50">
                                <button
                                  type="button"
                                  onClick={() => setPreview({ filePath: group.filePath, slideNumber: slide.slideNumber })}
                                  className="block w-full"
                                >
                                  <PptxSlideView filePath={group.filePath} slideNumber={slide.slideNumber} displayWidth={360} />
                                </button>
                              </div>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="mb-1 flex items-center gap-2">
                                    <span className="text-xs font-bold text-sky-700">Slide {slide.slideNumber}</span>
                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${confidenceClass(slide.confidence)}`}>
                                      {slide.confidence ?? "Low"}
                                    </span>
                                  </div>
                                  <p className="line-clamp-2 text-xs leading-5 text-slate-500">{slide.reason}</p>
                                </div>
                                <button
                                  onClick={() => togglePicked(group, slide, topic.topic)}
                                  className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                                    isPicked
                                      ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                      : "bg-sky-600 text-white hover:bg-sky-700"
                                  }`}
                                >
                                  {isPicked ? "Added" : "Add"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </main>

        <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-500">
              Selected slides
              <span className="ml-1 text-slate-400">{picked.length}</span>
            </p>
            {picked.length > 0 && (
              <button onClick={() => setPicked([])} className="text-xs font-medium text-slate-400 hover:text-red-500">
                Clear
              </button>
            )}
          </div>
          {picked.length > 0 && (
            <div className="mb-3 max-h-24 space-y-1 overflow-y-auto">
              {picked.map((slide, index) => (
                <div key={slide.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                  <span className="w-5 shrink-0 text-right text-[10px] text-slate-400">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-600">
                    Slide {slide.slideNumber} · {slide.fileTitle}
                  </span>
                  <button
                    onClick={() => setPicked((prev) => prev.filter((item) => item.id !== slide.id))}
                    className="shrink-0 text-slate-300 hover:text-red-500"
                    aria-label="Remove slide"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          {composeError && <p className="mb-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-600">{composeError}</p>}
          <button
            onClick={composeWorkingDeck}
            disabled={!workingDeck || picked.length === 0 || composing}
            className="w-full rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {composing ? "Updating deck..." : `Build working deck (${picked.length})`}
          </button>
        </footer>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div className="relative overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <PptxSlideView
              filePath={preview.filePath}
              slideNumber={preview.slideNumber}
              displayWidth={Math.min(900, (typeof window !== "undefined" ? window.innerWidth : 960) - 48)}
            />
            <button
              onClick={() => setPreview(null)}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
              aria-label="Close preview"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
