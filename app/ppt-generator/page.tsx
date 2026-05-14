"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { AppConfig } from "@/types";
import { DEFAULT_CONFIG } from "@/types";
import type { PptQualityResult, PptSlideDraft, PptSlideKind, PptSlideLayout } from "@/types/ppt-intelligence";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Menu, Pencil, Share2, SquarePen, MoreHorizontal,
  ChevronLeft, ChevronRight, Cpu, FileText, Briefcase, Package,
  BookOpen, BarChart3, FileQuestion, Paperclip, Plus, Star,
  ChevronDown, Mic, Sparkles, LayoutGrid,
} from "lucide-react";

const CONFIG_KEY = "apexon-hub-config";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PptxTheme {
  colors: {
    bg: string; text: string;
    accent1: string; accent2: string; accent3: string;
    accent4: string; accent5: string; accent6: string;
  };
  fonts: { major: string; minor: string };
  slideSize: { widthIn: number; heightIn: number };
}

type SlideKind = PptSlideKind;
type SlideLayout = PptSlideLayout;
type CapabilityCategory = { name: string; items: string[] };
type RiskItem = { risk: string; impact?: string; mitigation?: string };
type SlideDesign = { visualPattern?: string; iconHints?: string[]; style?: string; template?: string };
type SlideDraft = PptSlideDraft & { id: string; bullets: string[]; pillars?: Array<{ title: string; body: string }>; stats?: Array<{ value: string; label: string }>; quote?: { text?: string; author?: string; attribution?: string }; comparison?: { left?: { heading?: string; items?: string[] }; right?: { heading?: string; items?: string[] } }; timeline?: Array<{ phase?: string; description?: string; label?: string; year?: string }>; matrix?: { axisX?: string; axisY?: string; topLeft?: string; topRight?: string; bottomLeft?: string; bottomRight?: string }; org?: { leader: string; roles?: string[] }; infographic?: { items?: Array<{ value: string; label: string }> }; fullbleed?: { overlayText?: string; caption?: string }; case_study?: { challenge?: string; solution?: string; role?: string; benefits?: string }; architecture?: { components?: Array<{ name: string; description?: string }> }; capability?: { categories?: CapabilityCategory[] }; risk?: { items?: RiskItem[] }; story_intent?: unknown; audience?: unknown; slide_type?: string; design?: SlideDesign };

interface TemplateInfo {
  path: string;
  name: string;
}

interface GenerationResult {
  path: string;
  filename: string;
  slideCount: number;
}

interface StyleLibraryState {
  decks: number;
  slides: number;
  uploading: boolean;
  clearing: boolean;
  error: string;
}

interface QualityState {
  content: PptQualityResult | null;
  visual: PptQualityResult | null;
  loading: boolean;
  error: string;
}

type Step = 1 | 2 | 3 | 4;

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_THEME: PptxTheme = {
  colors: {
    bg: "FFFFFF", text: "1F2937",
    accent1: "0EA5E9", accent2: "8B5CF6", accent3: "10B981",
    accent4: "F59E0B", accent5: "EF4444", accent6: "6366F1",
  },
  fonts: { major: "Calibri", minor: "Calibri" },
  slideSize: { widthIn: 13.333, heightIn: 7.5 },
};

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function parseOutline(raw: string): SlideDraft[] {
  const lines = raw.split("\n");
  const slides: SlideDraft[] = [];
  let current: (Omit<SlideDraft, "slideNumber" | "content"> & { slideNumber?: number; content?: string }) | null = null;

  const flush = () => { if (current) slides.push(current as SlideDraft); };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    // Heading lines — # / ## start a new slide
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    const bulletMatch  = line.match(/^\s*[-*•]\s+(.+)$/);

    if (headingMatch) {
      flush();
      current = {
        id: uid(),
        kind: slides.length === 0 ? "cover" : "content",
        title: headingMatch[2].trim(),
        bullets: [],
        content: "",
        slideNumber: 0,
      };
    } else if (bulletMatch && current) {
      current.bullets.push(bulletMatch[1].trim());
    } else if (current) {
      // Treat plain lines as bullets when we're inside a slide
      current.bullets.push(line.trim());
    } else {
      // First non-heading line — make it the cover title
      current = { id: uid(), kind: "cover", title: line.trim(), bullets: [], content: "", slideNumber: 0 };
    }
  }
  flush();

  if (slides.length === 0) return [];

  // If user didn't include a closing slide, leave as-is — they can add one.
  return slides;
}

function downloadFromUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function deckToJson(title: string, slides: SlideDraft[]): string {
  return JSON.stringify({
    title,
    slides: slides.map(({ id: _id, ...slide }) => slide),
  }, null, 2);
}

function jsonToDeck(raw: string): { title: string; slides: SlideDraft[] } {
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.slides)) throw new Error("JSON must include a slides array");
  return {
    title: String(parsed.title || "Presentation"),
    slides: parsed.slides.map((s: SlideDraft) => ({
      id: uid(),
      kind: (s.kind && ["cover", "section", "content", "closing"].includes(s.kind as any)) ? s.kind : "content",
      layout: s.layout,
      kicker: s.kicker,
      title: String(s.title || "Untitled slide"),
      subtitle: s.subtitle,
      bullets: Array.isArray(s.bullets) ? s.bullets : [],
      pillars: s.pillars,
      stats: s.stats,
      quote: s.quote,
      comparison: s.comparison,
      timeline: s.timeline,
      matrix: s.matrix,
      org: s.org,
      infographic: s.infographic,
      fullbleed: s.fullbleed,
      case_study: s.case_study,
      architecture: s.architecture,
      capability: s.capability,
      risk: s.risk,
      story_intent: s.story_intent,
      audience: s.audience,
      slide_type: s.slide_type,
      takeaway: s.takeaway,
      design: s.design,
      notes: s.notes,
    })),
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PptGeneratorPage() {
  const [config, setConfig]       = useState<AppConfig>(DEFAULT_CONFIG);
  const [mode, setMode]           = useState<"wizard" | "canvas">("wizard");
  const [step, setStep]           = useState<Step>(2);

  const [template, setTemplate]   = useState<TemplateInfo | null>(null);
  const [theme,    setTheme]      = useState<PptxTheme>(DEFAULT_THEME);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [styleLibrary, setStyleLibrary] = useState<StyleLibraryState>({ decks: 0, slides: 0, uploading: false, clearing: false, error: "" });

  const [contentMode, setContentMode] = useState<"paste" | "ai" | "json">("ai");
  const [pasteText,   setPasteText]   = useState("");
  const [jsonInput, setJsonInput] = useState("");
  const [jsonInputError, setJsonInputError] = useState("");

  const [aiTopic,    setAiTopic]    = useState("");
  const [aiAudience, setAiAudience] = useState("");
  const [aiCount,    setAiCount]    = useState(8);
  const [aiTone,     setAiTone]     = useState("professional");
  const [aiMode,     setAiMode]     = useState<"standard" | "agentic">("standard");
  const [aiLoading,  setAiLoading]  = useState(false);
  const [aiError,    setAiError]    = useState("");
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionError, setRevisionError] = useState("");

  const [deckTitle, setDeckTitle] = useState("Presentation");
  const [slides,    setSlides]    = useState<SlideDraft[]>([]);

  const [generating, setGenerating] = useState(false);
  const [genError,   setGenError]   = useState("");
  const [result,     setResult]     = useState<GenerationResult | null>(null);
  const [quality, setQuality] = useState<QualityState>({ content: null, visual: null, loading: false, error: "" });

  // Load app config from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (raw) setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(raw) });
    } catch {}
    fetch("/api/local/reference-slide-library")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) setStyleLibrary((prev) => ({ ...prev, decks: data.decks ?? 0, slides: data.slides ?? 0 }));
      })
      .catch(() => undefined);
  }, []);

  const isAiConfigured =
    (config.aiProvider === "ollama"     && Boolean(config.ollamaModel)) ||
    (config.aiProvider === "openrouter" && Boolean(config.openrouterModel)) ||
    (config.aiProvider === "gemini"     && Boolean(config.geminiModel));

  // ── Step 1: upload template ────────────────────────────────────────────────

  const handleTemplateUpload = async (file: File) => {
    setUploading(true);
    setUploadErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const upRes = await fetch("/api/local/upload-template", { method: "POST", body: fd });
      const upData = await upRes.json();
      if (!upRes.ok) throw new Error(upData.error || "Upload failed");

      const themeRes = await fetch(`/api/local/extract-pptx-theme?path=${encodeURIComponent(upData.path)}`);
      const themeData = await themeRes.json();
      if (!themeRes.ok) throw new Error(themeData.error || "Theme extraction failed");

      setTemplate({ path: upData.path, name: upData.name });
      setTheme(themeData);
    } catch (e) {
      setUploadErr(String(e));
    } finally {
      setUploading(false);
    }
  };

  const skipTemplate = () => {
    setTemplate(null);
    setTheme(DEFAULT_THEME);
    setStep(2);
  };

  const handleReferenceUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setStyleLibrary((prev) => ({ ...prev, uploading: true, error: "" }));
    try {
      const fd = new FormData();
      Array.from(files).forEach((file) => fd.append("files", file));
      const res = await fetch("/api/local/reference-slide-library", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reference upload failed");
      setStyleLibrary({ decks: data.totalDecks ?? 0, slides: data.totalSlides ?? 0, uploading: false, clearing: false, error: "" });
    } catch (e) {
      setStyleLibrary((prev) => ({ ...prev, uploading: false, error: String(e) }));
    }
  };

  const handleReferenceClear = async () => {
    if (styleLibrary.slides === 0 || styleLibrary.clearing) return;
    setStyleLibrary((prev) => ({ ...prev, clearing: true, error: "" }));
    try {
      const res = await fetch("/api/local/reference-slide-library", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Remove index failed");
      setStyleLibrary({ decks: 0, slides: 0, uploading: false, clearing: false, error: "" });
    } catch (e) {
      setStyleLibrary((prev) => ({ ...prev, clearing: false, error: String(e) }));
    }
  };

  // ── Step 2: content ────────────────────────────────────────────────────────

  const buildFromPaste = () => {
    const parsed = parseOutline(pasteText);
    if (parsed.length === 0) return;
    setSlides(parsed);
    setDeckTitle(parsed[0]?.title || "Presentation");
    setStep(3);
  };

  const buildFromJson = () => {
    setJsonInputError("");
    try {
      const parsed = jsonToDeck(jsonInput);
      setDeckTitle(parsed.title);
      setSlides(parsed.slides);
      setStep(3);
    } catch (e) {
      setJsonInputError(String(e));
    }
  };

  const applyDeckDraft = (data: { title?: string; slides: SlideDraft[] }) => {
    const drafts: SlideDraft[] = data.slides.map((s: SlideDraft) => ({
      id: uid(),
      kind: s.kind,
      layout: s.layout,
      kicker: s.kicker,
      title: s.title,
      subtitle: s.subtitle,
      content: "",
      slideNumber: 0,
      bullets: Array.isArray(s.bullets) ? s.bullets : [],
      pillars: s.pillars,
      stats: s.stats,
      quote: s.quote,
      comparison: s.comparison,
      takeaway: s.takeaway,
      design: s.design,
      notes: s.notes,
    }));
    setSlides(drafts);
    setDeckTitle(data.title || drafts[0]?.title || "Presentation");
  };

  const buildFromAi = async () => {
    if (!aiTopic.trim()) return;
    setAiLoading(true);
    setAiError("");

    const endpoint = aiMode === "agentic" ? "/api/ai/ppt-agent" : "/api/ai/generate-deck-content";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic:    aiTopic.trim(),
          audience: aiAudience.trim() || undefined,
          slideCount: aiCount,
          tone:     aiTone,
          aiProvider:      config.aiProvider,
          ollamaBaseUrl:   config.ollamaBaseUrl,
          ollamaModel:     config.ollamaModel,
          openrouterModel: config.openrouterModel,
          geminiModel:     config.geminiModel,
          useStyleLibrary: styleLibrary.slides > 0,
        }),
      });
      const data = await res.json();

      // Agentic mode returns deck differently
      if (aiMode === "agentic") {
        if (!res.ok || !data.deck?.slides) throw new Error(data.error || "Agentic generation failed");
        applyDeckDraft(data.deck);
        if (data.message) {
          setAiError(""); // Clear any previous error
        }
      } else {
        if (!res.ok || !Array.isArray(data.slides)) throw new Error(data.error || "Generation failed");
        applyDeckDraft(data);
      }
      setStep(3);
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiLoading(false);
    }
  };

  const reviseContentDraft = async () => {
    if (!revisionInstruction.trim() || slides.length === 0) return;
    setRevisionLoading(true);
    setRevisionError("");
    try {
      const res = await fetch("/api/ai/generate-deck-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: deckTitle || aiTopic.trim() || "Presentation",
          audience: aiAudience.trim() || undefined,
          slideCount: slides.length,
          tone: aiTone,
          currentSlides: slides.map((s) => ({
            kind: s.kind,
            layout: s.layout,
            kicker: s.kicker,
            title: s.title,
            subtitle: s.subtitle,
            bullets: s.bullets,
            pillars: s.pillars,
            stats: s.stats,
            quote: s.quote,
            comparison: s.comparison,
            timeline: s.timeline,
            matrix: s.matrix,
            org: s.org,
            infographic: s.infographic,
            fullbleed: s.fullbleed,
            case_study: s.case_study,
            architecture: s.architecture,
            capability: s.capability,
            risk: s.risk,
            story_intent: s.story_intent,
            audience: s.audience,
            slide_type: s.slide_type,
            takeaway: s.takeaway,
            design: s.design,
            notes: s.notes,
          })),
          revisionInstruction: revisionInstruction.trim(),
          aiProvider:      config.aiProvider,
          ollamaBaseUrl:   config.ollamaBaseUrl,
          ollamaModel:     config.ollamaModel,
          openrouterModel: config.openrouterModel,
          geminiModel:     config.geminiModel,
          useStyleLibrary: styleLibrary.slides > 0,
        }),
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.slides)) throw new Error(data.error || "Revision failed");
      applyDeckDraft(data);
      setRevisionInstruction("");
    } catch (e) {
      setRevisionError(String(e));
    } finally {
      setRevisionLoading(false);
    }
  };

  // ── Step 3: edit slides ────────────────────────────────────────────────────

  const updateSlide = (id: string, patch: Partial<SlideDraft>) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const addSlide = (kind: SlideKind = "content") => {
    setSlides((prev) => [...prev, { id: uid(), kind, title: "New slide", bullets: [], content: "", slideNumber: 0 }]);
  };

  const removeSlide = (id: string) => {
    setSlides((prev) => prev.filter((s) => s.id !== id));
  };

  const moveSlide = (id: string, dir: -1 | 1) => {
    setSlides((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  // ── Step 4: generate + preview ─────────────────────────────────────────────

  const generateDeck = async () => {
    setGenerating(true);
    setGenError("");
    setResult(null);
    try {
      const payload = {
        title: deckTitle,
        slides: slides.map((s) => ({
          kind: s.kind,
          layout: s.layout,
          kicker: s.kicker,
          title: s.title,
          subtitle: s.subtitle,
          bullets: s.bullets.filter((b) => b.trim()),
          pillars: s.pillars,
          stats: s.stats,
          quote: s.quote,
          comparison: s.comparison,
          timeline: s.timeline,
          matrix: s.matrix,
          org: s.org,
          infographic: s.infographic,
          fullbleed: s.fullbleed,
          case_study: s.case_study,
          architecture: s.architecture,
          capability: s.capability,
          risk: s.risk,
          story_intent: s.story_intent,
          audience: s.audience,
          slide_type: s.slide_type,
          takeaway: s.takeaway,
          design: s.design,
          notes: s.notes,
        })),
        theme,
      };
      let endpoint = "/api/local/generate-themed-pptx";
      let res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data = await res.json();
      if (!res.ok) {
        res = await fetch("/api/local/generate-visual-pptx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        data = await res.json();
      }
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setResult(data);
      setStep(4);
    } catch (e) {
      setGenError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const runQualityChecks = async (draftSlides = slides) => {
    if (draftSlides.length === 0) return;
    setQuality((prev) => ({ ...prev, loading: true, error: "" }));
    const slidePayload = draftSlides.map(({ id: _id, ...slide }) => slide);
    const themePayload = {
      primary: `#${theme.colors.accent1}`,
      accent: `#${theme.colors.accent2}`,
      background: `#${theme.colors.bg}`,
      colors: Object.values(theme.colors).map((color) => `#${color}`),
    };

    try {
      const [contentRes, visualRes] = await Promise.all([
        fetch("/api/local/quality-check-pptx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slides: slidePayload }),
        }),
        fetch("/api/local/visual-quality-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slides: slidePayload, theme: themePayload }),
        }),
      ]);
      const [content, visual] = await Promise.all([contentRes.json(), visualRes.json()]);
      if (!contentRes.ok) throw new Error(content.error || "Content quality check failed");
      if (!visualRes.ok) throw new Error(visual.error || "Visual quality check failed");
      setQuality({ content, visual, loading: false, error: "" });
    } catch (e) {
      setQuality((prev) => ({ ...prev, loading: false, error: String(e) }));
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-slate-50 flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="shrink-0 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors"
            title="Return to normal document search"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Knowledge Hub
          </Link>
          <span className="text-slate-200">|</span>
          <h1 className="text-sm font-bold text-slate-800">PPT Generator</h1>
          <div className="ml-4 flex items-center bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setMode("wizard")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                mode === "wizard" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Wizard
            </button>
            <button
              onClick={() => setMode("canvas")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                mode === "canvas" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Canvas
            </button>
          </div>
        </div>
        {mode === "wizard" && <Stepper step={step} onJump={(s) => { if (s <= step) setStep(s); }} />}
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {mode === "canvas" ? (
          <SlidesCanvasView onModeChange={setMode} />
        ) : (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 w-full pb-16">

          {step === 1 && (
            <Step1Template
              template={template}
              uploading={uploading}
              uploadErr={uploadErr}
              theme={theme}
              styleLibrary={styleLibrary}
              onUpload={handleTemplateUpload}
              onReferenceUpload={handleReferenceUpload}
              onReferenceClear={handleReferenceClear}
              onSkip={skipTemplate}
              onNext={() => setStep(2)}
            />
          )}

          {step === 2 && (
            <Step2Content
              isAiConfigured={isAiConfigured}
              contentMode={contentMode}
              setContentMode={setContentMode}
              pasteText={pasteText}
              setPasteText={setPasteText}
              buildFromPaste={buildFromPaste}
              jsonInput={jsonInput}
              setJsonInput={setJsonInput}
              jsonInputError={jsonInputError}
              buildFromJson={buildFromJson}
              aiTopic={aiTopic}    setAiTopic={setAiTopic}
              aiAudience={aiAudience} setAiAudience={setAiAudience}
              aiCount={aiCount}    setAiCount={setAiCount}
              aiTone={aiTone}      setAiTone={setAiTone}
              aiMode={aiMode}      setAiMode={setAiMode}
              aiLoading={aiLoading} aiError={aiError}
              buildFromAi={buildFromAi}
              onBack={() => setStep(1)}
            />
          )}

          {step === 3 && (
            <Step3Edit
              deckTitle={deckTitle}
              setDeckTitle={setDeckTitle}
              slides={slides}
              theme={theme}
              updateSlide={updateSlide}
              addSlide={addSlide}
              removeSlide={removeSlide}
              moveSlide={moveSlide}
              revisionInstruction={revisionInstruction}
              setRevisionInstruction={setRevisionInstruction}
              onRevise={reviseContentDraft}
              revisionLoading={revisionLoading}
              revisionError={revisionError}
              canRevise={isAiConfigured}
              applyJsonDraft={(raw) => {
                const parsed = jsonToDeck(raw);
                setDeckTitle(parsed.title);
                setSlides(parsed.slides);
              }}
              quality={quality}
              onQualityCheck={runQualityChecks}
              onBack={() => setStep(2)}
              onGenerate={generateDeck}
              generating={generating}
              genError={genError}
            />
          )}

          {step === 4 && result && (
            <Step4Preview
              result={result}
              deckTitle={deckTitle}
              slideCount={slides.length}
              onBack={() => setStep(3)}
              onRestart={() => {
                setStep(1); setTemplate(null); setTheme(DEFAULT_THEME);
                setPasteText(""); setAiTopic(""); setAiAudience("");
                setSlides([]); setResult(null);
              }}
            />
          )}
          </div>
        )}
        </main>
      </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function Stepper({ step, onJump }: { step: Step; onJump: (s: Step) => void }) {
  const labels: Array<{ n: Step; label: string }> = [
    { n: 1, label: "Style" },
    { n: 2, label: "JSON" },
    { n: 3, label: "Draft" },
    { n: 4, label: "Export" },
  ];
  return (
    <div className="hidden sm:flex items-center gap-2">
      {labels.map(({ n, label }, i) => {
        const active   = step === n;
        const complete = step > n;
        return (
          <React.Fragment key={n}>
            <button
              onClick={() => onJump(n)}
              disabled={n > step}
              className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                n > step ? "text-slate-300 cursor-not-allowed" : "text-slate-600 hover:text-sky-600"
              }`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                active ? "bg-sky-600 text-white" :
                complete ? "bg-emerald-500 text-white" :
                "bg-slate-200 text-slate-500"
              }`}>
                {complete ? "✓" : n}
              </span>
              {label}
            </button>
            {i < labels.length - 1 && <span className="w-4 h-px bg-slate-200" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function ThemeSwatch({ theme }: { theme: PptxTheme }) {
  const swatches: Array<{ key: keyof PptxTheme["colors"]; label: string }> = [
    { key: "accent1", label: "Accent 1" },
    { key: "accent2", label: "Accent 2" },
    { key: "accent3", label: "Accent 3" },
    { key: "text",    label: "Text" },
  ];
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {swatches.map((s) => (
        <div key={s.key} className="flex items-center gap-1.5">
          <span
            className="w-5 h-5 rounded-md border border-slate-200 shadow-sm"
            style={{ background: `#${theme.colors[s.key]}` }}
          />
          <span className="text-[11px] text-slate-500">{s.label}</span>
        </div>
      ))}
      <span className="text-[11px] text-slate-400">· {theme.fonts.major}</span>
    </div>
  );
}

function Step1Template({
  template, uploading, uploadErr, theme, styleLibrary, onUpload, onReferenceUpload, onReferenceClear, onSkip, onNext,
}: {
  template: TemplateInfo | null;
  uploading: boolean;
  uploadErr: string;
  theme: PptxTheme;
  styleLibrary: StyleLibraryState;
  onUpload: (f: File) => void;
  onReferenceUpload: (files: FileList | null) => void;
  onReferenceClear: () => void;
  onSkip: () => void;
  onNext: () => void;
}) {
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Optional · Style memory</h2>
        <p className="text-sm text-slate-500">The generator is JSON-based. Reference decks are optional signals for AI style selection, not required templates.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-slate-800">AI style memory</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {styleLibrary.slides > 0
                ? `${styleLibrary.slides} reference slides indexed from ${styleLibrary.decks} deck${styleLibrary.decks === 1 ? "" : "s"}.`
                : "Upload strong PPTX examples. AI will pick layouts, visual patterns, and icon hints from them."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {styleLibrary.slides > 0 && (
              <button
                type="button"
                onClick={onReferenceClear}
                disabled={styleLibrary.clearing || styleLibrary.uploading}
                className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                  styleLibrary.clearing || styleLibrary.uploading
                    ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                    : "border-red-200 bg-white text-red-600 hover:bg-red-50"
                }`}
              >
                {styleLibrary.clearing ? "Removing..." : "Remove index"}
              </button>
            )}
            <label
              htmlFor="reference-files"
              className={`px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer ${
                styleLibrary.clearing ? "pointer-events-none opacity-50" : ""
              }`}
            >
              <input
                id="reference-files"
                type="file"
                accept=".pptx"
                multiple
                className="hidden"
                onChange={(e) => onReferenceUpload(e.target.files)}
              />
              {styleLibrary.uploading ? "Indexing..." : "Upload reference decks"}
            </label>
          </div>
        </div>
        {styleLibrary.error && <p className="text-xs text-red-500 mt-2">{styleLibrary.error}</p>}
      </div>

      <label
        htmlFor="tmpl-file"
        className="block border-2 border-dashed border-slate-300 rounded-2xl bg-white px-6 py-10 text-center cursor-pointer hover:border-sky-400 hover:bg-sky-50/30 transition-colors"
      >
        <input
          id="tmpl-file"
          type="file"
          accept=".pptx"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
        />
        <svg className="w-10 h-10 mx-auto text-slate-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.9 5 5 0 119.66 2.6M7 16h10a4 4 0 100-8M12 12v8m0 0l-3-3m3 3l3-3" />
        </svg>
        <p className="text-sm font-semibold text-slate-700">Optional: upload .pptx theme</p>
        <p className="text-xs text-slate-400 mt-1">Only used for fallback editable export</p>
        {uploading && <p className="text-xs text-sky-600 mt-3">Uploading & extracting theme…</p>}
        {uploadErr && <p className="text-xs text-red-500 mt-3">{uploadErr}</p>}
      </label>

      {template && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-700 truncate">✓ {template.name}</p>
            <div className="mt-1.5"><ThemeSwatch theme={theme} /></div>
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
        <button onClick={onSkip} className="text-xs text-slate-500 hover:text-slate-700 underline-offset-2 hover:underline">
          Use JSON visual generator
        </button>
        <button
          onClick={onNext}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors bg-sky-600 text-white hover:bg-sky-700 shadow-sm"
        >
          Continue to JSON
        </button>
      </div>
    </section>
  );
}

function Step2Content({
  isAiConfigured, contentMode, setContentMode,
  pasteText, setPasteText, buildFromPaste,
  jsonInput, setJsonInput, jsonInputError, buildFromJson,
  aiTopic, setAiTopic, aiAudience, setAiAudience,
  aiCount, setAiCount, aiTone, setAiTone,
  aiMode, setAiMode,
  aiLoading, aiError, buildFromAi, onBack,
}: {
  isAiConfigured: boolean;
  contentMode: "paste" | "ai" | "json";
  setContentMode: (m: "paste" | "ai" | "json") => void;
  pasteText: string; setPasteText: (s: string) => void;
  buildFromPaste: () => void;
  jsonInput: string; setJsonInput: (s: string) => void;
  jsonInputError: string;
  buildFromJson: () => void;
  aiTopic: string; setAiTopic: (s: string) => void;
  aiAudience: string; setAiAudience: (s: string) => void;
  aiCount: number; setAiCount: (n: number) => void;
  aiTone: string; setAiTone: (s: string) => void;
  aiMode: "standard" | "agentic"; setAiMode: (m: "standard" | "agentic") => void;
  aiLoading: boolean; aiError: string;
  buildFromAi: () => void;
  onBack: () => void;
}) {
  const tabClass = (active: boolean) =>
    `flex-1 px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
      active ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
    }`;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Step 1 · Generate JSON content</h2>
        <p className="text-sm text-slate-500">Create or paste deck JSON first. PowerPoint is generated only after the JSON draft is approved.</p>
      </div>

      <div className="bg-slate-100 p-1 rounded-xl flex gap-1 max-w-2xl">
        <button onClick={() => setContentMode("ai")}    className={tabClass(contentMode === "ai")}>Generate JSON</button>
        <button onClick={() => setContentMode("json")}  className={tabClass(contentMode === "json")}>Paste JSON</button>
        <button onClick={() => setContentMode("paste")} className={tabClass(contentMode === "paste")}>Paste outline</button>
      </div>

      {contentMode === "ai" ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          {!isAiConfigured && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No AI model configured. Open Settings on the Knowledge Hub home page first.
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Topic / brief</label>
            <textarea
              rows={3}
              value={aiTopic}
              onChange={(e) => setAiTopic(e.target.value)}
              placeholder="e.g. A 10-minute pitch on how Apexon helps mid-market banks modernize their core systems with cloud + AI."
              className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Audience</label>
              <input
                type="text"
                value={aiAudience}
                onChange={(e) => setAiAudience(e.target.value)}
                placeholder="e.g. CIO, banking"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Slides</label>
              <input
                type="number"
                min={1}
                max={20}
                value={aiCount}
                onChange={(e) => setAiCount(Number(e.target.value) || 8)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Tone</label>
              <select
                value={aiTone}
                onChange={(e) => setAiTone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white"
              >
                <option value="professional">Professional</option>
                <option value="conversational">Conversational</option>
                <option value="bold">Bold</option>
                <option value="academic">Academic</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Mode</label>
              <select
                value={aiMode}
                onChange={(e) => setAiMode(e.target.value as "standard" | "agentic")}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white"
              >
                <option value="standard">Standard</option>
                <option value="agentic">Agentic</option>
              </select>
            </div>
          </div>
          {aiMode === "agentic" && (
            <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Agentic mode decomposes content, validates structure, and auto-fixes issues
            </div>
          )}
          {aiError && <p className="text-xs text-red-500">{aiError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onBack} className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">Back</button>
            <button
              onClick={buildFromAi}
              disabled={!aiTopic.trim() || aiLoading || !isAiConfigured}
              className={`px-5 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors ${
                !aiTopic.trim() || !isAiConfigured ? "bg-slate-100 text-slate-400 cursor-not-allowed" :
                "bg-sky-600 text-white hover:bg-sky-700 shadow-sm"
              }`}
            >
              {aiLoading ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Drafting deck…
                </>
              ) : "Generate outline"}
            </button>
          </div>
        </div>
      ) : contentMode === "json" ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Deck JSON</label>
            <textarea
              rows={18}
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder={`{\n  "title": "Performance Testing",\n  "slides": [\n    {\n      "kind": "content",\n      "layout": "bullets",\n      "kicker": "QUALITY ENGINEERING",\n      "title": "Performance testing improves release confidence",\n      "bullets": ["Baseline service-level targets", "Shift tests into CI/CD", "Monitor production-like flows"],\n      "takeaway": "Earlier validation reduces production risk.",\n      "design": {\n        "style": "dark_technical",\n        "template": "dark_capability_map",\n        "iconHints": ["stability", "scalability", "monitoring", "reliability"]\n      }\n    }\n  ]\n}`}
              className="w-full px-4 py-2.5 text-xs font-mono border border-slate-200 rounded-xl bg-slate-950 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
              spellCheck={false}
            />
          </div>
          {jsonInputError && <p className="text-xs text-red-500">{jsonInputError}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onBack} className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">Style options</button>
            <button
              onClick={buildFromJson}
              disabled={!jsonInput.trim()}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${
                !jsonInput.trim() ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-sky-600 text-white hover:bg-sky-700 shadow-sm"
              }`}
            >
              Review JSON
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Outline (markdown)</label>
            <textarea
              rows={14}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`# Apexon Cloud Modernization\n\n## Why now\n- Legacy systems slow innovation\n- Customer expectations have shifted\n- Cloud-native unlocks AI\n\n## Our approach\n- Discover\n- Modernize\n- Operate\n\n## Outcomes\n- 30% faster delivery\n- 40% TCO reduction`}
              className="w-full px-4 py-2.5 text-sm font-mono border border-slate-200 rounded-xl bg-white text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <p className="text-[11px] text-slate-400 mt-1.5">Use # / ## headings to start a slide. Lines starting with - / * become bullets.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onBack} className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">Back</button>
            <button
              onClick={buildFromPaste}
              disabled={!pasteText.trim()}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${
                !pasteText.trim() ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-sky-600 text-white hover:bg-sky-700 shadow-sm"
              }`}
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Step3Edit({
  deckTitle, setDeckTitle, slides, theme,
  updateSlide, addSlide, removeSlide, moveSlide,
  revisionInstruction, setRevisionInstruction, onRevise, revisionLoading, revisionError, canRevise,
  applyJsonDraft,
  quality, onQualityCheck,
  onBack, onGenerate, generating, genError,
}: {
  deckTitle: string;
  setDeckTitle: (s: string) => void;
  slides: SlideDraft[];
  theme: PptxTheme;
  updateSlide: (id: string, patch: Partial<SlideDraft>) => void;
  addSlide: (kind?: SlideKind) => void;
  removeSlide: (id: string) => void;
  moveSlide: (id: string, dir: -1 | 1) => void;
  revisionInstruction: string;
  setRevisionInstruction: (s: string) => void;
  onRevise: () => void;
  revisionLoading: boolean;
  revisionError: string;
  canRevise: boolean;
  applyJsonDraft: (raw: string) => void;
  quality: QualityState;
  onQualityCheck: () => void;
  onBack: () => void;
  onGenerate: () => void;
  generating: boolean;
  genError: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(slides[0]?.id ?? null);
  const [jsonDraft, setJsonDraft] = useState(deckToJson(deckTitle, slides));
  const [jsonError, setJsonError] = useState("");
  useEffect(() => { if (!slides.find((s) => s.id === activeId)) setActiveId(slides[0]?.id ?? null); }, [slides, activeId]);
  useEffect(() => { setJsonDraft(deckToJson(deckTitle, slides)); setJsonError(""); }, [deckTitle, slides]);
  const active = slides.find((s) => s.id === activeId) ?? null;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Step 3 · Content draft</h2>
        <p className="text-sm text-slate-500">The generated JSON is the source of truth. Review, revise, or edit the JSON before creating slides.</p>
      </div>

      <QualityPanel quality={quality} onRun={onQualityCheck} slideCount={slides.length} />

      <div className="bg-sky-50 border border-sky-100 rounded-2xl p-4">
        <h3 className="text-sm font-bold text-slate-800">Structure-first generation guide</h3>
        <p className="text-xs text-slate-600 mt-1">
          The AI should preserve the source shape first, then choose a visual template. A process keeps its real stage count,
          a comparison stays two-sided, metrics become KPI cards, and frameworks stay as capability maps or executive summaries.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3 text-[11px] text-slate-600">
          <div className="rounded-xl bg-white border border-sky-100 px-3 py-2"><span className="font-semibold text-slate-800">Process</span> → `process_timeline`, up to 9 stages</div>
          <div className="rounded-xl bg-white border border-sky-100 px-3 py-2"><span className="font-semibold text-slate-800">Comparison</span> → `comparison_matrix`, left/right columns</div>
          <div className="rounded-xl bg-white border border-sky-100 px-3 py-2"><span className="font-semibold text-slate-800">Metrics</span> → `metric_dashboard`, KPI cards</div>
          <div className="rounded-xl bg-white border border-sky-100 px-3 py-2"><span className="font-semibold text-slate-800">Framework</span> → capability map or summary</div>
          <div className="rounded-xl bg-white border border-sky-100 px-3 py-2"><span className="font-semibold text-slate-800">Recommendation</span> → `executive_summary`</div>
          <div className="rounded-xl bg-white border border-sky-100 px-3 py-2"><span className="font-semibold text-slate-800">Principle</span> → `quote_focus`</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Generated deck JSON</h3>
            <p className="text-xs text-slate-500 mt-0.5">Edit this directly when you want precise control over titles, bullets, layout, style, icons, and takeaways.</p>
          </div>
          <button
            onClick={() => {
              try {
                applyJsonDraft(jsonDraft);
                setJsonError("");
              } catch (e) {
                setJsonError(String(e));
              }
            }}
            className="px-3 py-2 rounded-xl bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700"
          >
            Apply JSON
          </button>
        </div>
        <textarea
          rows={10}
          value={jsonDraft}
          onChange={(e) => setJsonDraft(e.target.value)}
          className="w-full max-h-[42vh] overflow-auto resize-y px-3 py-2 text-xs font-mono border border-slate-200 rounded-xl bg-slate-950 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
          spellCheck={false}
        />
        {jsonError && <p className="text-xs text-red-500">{jsonError}</p>}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Ask AI to revise the draft</h3>
            <p className="text-xs text-slate-500 mt-0.5">Examples: add more technical depth, make it CFO-focused, include risks, reduce text, or change the angle.</p>
          </div>
          {!canRevise && <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">Configure AI in Settings</span>}
        </div>
        <textarea
          rows={3}
          value={revisionInstruction}
          onChange={(e) => setRevisionInstruction(e.target.value)}
          placeholder="e.g. Make this more focused on performance testing for cloud-hosted apps and add tool recommendations."
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        {revisionError && <p className="text-xs text-red-500">{revisionError}</p>}
        <div className="flex justify-end">
          <button
            onClick={onRevise}
            disabled={!canRevise || revisionLoading || !revisionInstruction.trim() || slides.length === 0}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
              !canRevise || revisionLoading || !revisionInstruction.trim() || slides.length === 0
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : "bg-slate-900 text-white hover:bg-slate-800"
            }`}
          >
            {revisionLoading ? "Revising content..." : "Revise content"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* Slide list */}
        <aside className="bg-white border border-slate-200 rounded-2xl p-3 max-h-[60vh] overflow-y-auto">
          <div className="mb-2">
            <input
              type="text"
              value={deckTitle}
              onChange={(e) => setDeckTitle(e.target.value)}
              placeholder="Deck title"
              className="w-full px-2.5 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg bg-white"
            />
          </div>
          <ul className="space-y-1.5">
            {slides.map((s, idx) => (
              <li key={s.id}>
                <button
                  onClick={() => setActiveId(s.id)}
                  className={`w-full text-left rounded-lg px-2.5 py-2 border flex items-start gap-2 transition-colors ${
                    activeId === s.id ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <span className={`shrink-0 mt-0.5 w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center text-white`}
                        style={{ background: `#${kindAccent(s.kind || "content", theme)}` }}>
                    {idx + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{s.kind}</span>
                    <span className="block text-xs font-medium text-slate-800 truncate">{s.title || "(untitled)"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={() => addSlide("content")}
            className="w-full mt-2 px-2.5 py-2 rounded-lg border border-dashed border-slate-300 text-xs font-medium text-slate-500 hover:border-sky-300 hover:text-sky-600"
          >
            + Add slide
          </button>
        </aside>

        {/* Editor */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          {active ? (
            <SlideEditor
              slide={active}
              onChange={(patch) => updateSlide(active.id, patch)}
              onRemove={() => removeSlide(active.id)}
              onMoveUp={() => moveSlide(active.id, -1)}
              onMoveDown={() => moveSlide(active.id, 1)}
              theme={theme}
            />
          ) : (
            <p className="text-sm text-slate-400">No slides — add one to begin.</p>
          )}
        </div>
      </div>

      {genError && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{genError}</p>}

      <div className="flex justify-between items-center gap-3 pt-2">
        <button onClick={onBack} className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">Back</button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{slides.length} slides</span>
          <button
            onClick={onGenerate}
            disabled={generating || slides.length === 0}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors ${
              generating || slides.length === 0 ? "bg-slate-100 text-slate-400 cursor-not-allowed" :
              "bg-sky-600 text-white hover:bg-sky-700 shadow-sm"
            }`}
          >
            {generating ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating…
              </>
            ) : "Create PowerPoint →"}
          </button>
        </div>
      </div>
    </section>
  );
}

function kindAccent(kind: SlideKind, theme: PptxTheme): string {
  switch (kind) {
    case "cover":   return theme.colors.accent1;
    case "section": return theme.colors.text;
    case "closing": return theme.colors.accent2;
    default:        return theme.colors.accent3;
  }
}

function scoreTone(score?: number): string {
  if (score == null) return "text-slate-400";
  if (score >= 80) return "text-emerald-600";
  if (score >= 65) return "text-amber-600";
  return "text-red-600";
}

function QualityPanel({ quality, onRun, slideCount }: { quality: QualityState; onRun: () => void; slideCount: number }) {
  const contentIssues = quality.content ? [...quality.content.critical, ...quality.content.warning, ...quality.content.info] : [];
  const visualIssues = quality.visual ? [...quality.visual.critical, ...quality.visual.warning, ...quality.visual.info] : [];
  const issues = [
    ...contentIssues.map((issue) => ({ ...issue, source: "Story" as const, severity: issue.type })),
    ...visualIssues.map((issue) => ({ ...issue, source: "Visual" as const, severity: issue.type })),
  ]
    .sort((a, b) => {
      const rank = { critical: 0, warning: 1, info: 2 } as const;
      return rank[a.severity] - rank[b.severity];
    })
    .slice(0, 8);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Deck intelligence check</h3>
          <p className="text-xs text-slate-500 mt-0.5">Scores story quality, structure, visual hygiene, and repair actions before export.</p>
        </div>
        <button
          onClick={onRun}
          disabled={quality.loading || slideCount === 0}
          className={`px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
            quality.loading || slideCount === 0
              ? "bg-slate-100 text-slate-400 cursor-not-allowed"
              : "bg-slate-900 text-white hover:bg-slate-800"
          }`}
        >
          {quality.loading ? "Checking..." : "Run quality check"}
        </button>
      </div>
      {quality.error && <p className="mt-2 text-xs text-red-500">{quality.error}</p>}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Story</p>
          <p className={`text-2xl font-bold ${scoreTone(quality.content?.score)}`}>{quality.content?.overall ?? "--"}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Visual</p>
          <p className={`text-2xl font-bold ${scoreTone(quality.visual?.score)}`}>{quality.visual?.overall ?? "--"}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Warnings</p>
          <p className="text-2xl font-bold text-amber-600">{(quality.content?.warning.length ?? 0) + (quality.visual?.warning.length ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Critical</p>
          <p className="text-2xl font-bold text-red-600">{(quality.content?.critical.length ?? 0) + (quality.visual?.critical.length ?? 0)}</p>
        </div>
      </div>
      {issues.length > 0 && (
        <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
          {issues.map((issue, index) => (
            <div key={`${issue.source}-${issue.slide}-${index}`} className="px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  issue.severity === "critical" ? "bg-red-50 text-red-700" :
                  issue.severity === "warning" ? "bg-amber-50 text-amber-700" :
                  "bg-slate-100 text-slate-500"
                }`}>
                  {issue.source}
                </span>
                <span className="font-semibold text-slate-700">{issue.slide >= 0 ? `Slide ${issue.slide + 1}` : "Theme"}</span>
              </div>
              <p className="mt-1 text-slate-600">{issue.message}</p>
              {issue.suggestion && <p className="mt-0.5 text-slate-400">{issue.suggestion}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SlideEditor({
  slide, onChange, onRemove, onMoveUp, onMoveDown, theme,
}: {
  slide: SlideDraft;
  onChange: (patch: Partial<SlideDraft>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  theme: PptxTheme;
}) {
  const updateBullet = (idx: number, val: string) => {
    const next = [...slide.bullets];
    next[idx] = val;
    onChange({ bullets: next });
  };
  const addBullet = () => onChange({ bullets: [...slide.bullets, ""] });
  const removeBullet = (idx: number) => onChange({ bullets: slide.bullets.filter((_, i) => i !== idx) });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mr-1">Type</span>
          {(["cover", "section", "content", "closing"] as SlideKind[]).map((k) => (
            <button
              key={k}
              onClick={() => onChange({ kind: k })}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                slide.kind === k ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp}   className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500" title="Move up">↑</button>
          <button onClick={onMoveDown} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500" title="Move down">↓</button>
          <button onClick={onRemove}   className="w-7 h-7 rounded-lg hover:bg-red-50 text-red-500" title="Delete">×</button>
        </div>
      </div>

      {/* Visual preview */}
      <VisualJsonPreview slide={slide} />

      {!!slide.design?.visualPattern && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">AI selected style</p>
          <p className="text-xs text-slate-700 mt-1">{String(slide.design?.visualPattern)}</p>
          {Array.isArray(slide.design?.iconHints) && slide.design.iconHints.length ? (
            <p className="text-[11px] text-slate-500 mt-1">Icons: {(slide.design.iconHints as string[]).join(", ")}</p>
          ) : null}
        </div>
      )}

      {/* Kicker (content slides) */}
      {slide.kind !== "section" && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5">Kicker <span className="font-normal text-slate-400">(small uppercase tag)</span></label>
          <input
            type="text"
            value={slide.kicker ?? ""}
            onChange={(e) => onChange({ kicker: e.target.value })}
            placeholder="e.g. CONTEXT · DIAGNOSIS · RECOMMENDATION"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl"
          />
        </div>
      )}

      {/* Title */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1.5">
          {slide.kind === "content" ? "Action title (full insight sentence)" : "Title"}
        </label>
        <input
          type="text"
          value={slide.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl"
        />
      </div>

      {/* Content layout selector */}
      {slide.kind === "content" && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5">Layout</label>
          <div className="flex flex-wrap gap-1.5">
            {(["bullets", "pillars", "stats", "quote", "comparison", "timeline", "matrix", "org", "infographic", "fullbleed", "four_column_case", "architecture", "capability", "risk_matrix"] as SlideLayout[]).map((l) => {
              const active = (slide.layout ?? "bullets") === l;
              const supported = l === "bullets"
                || (l === "pillars" && (slide.pillars?.length ?? 0) > 0)
                || (l === "stats"   && (slide.stats?.length   ?? 0) > 0)
                || (l === "quote"   && Boolean(slide.quote?.text))
                || (l === "comparison" && Boolean(slide.comparison))
                || (l === "timeline" && (slide.timeline?.length ?? 0) > 0)
                || (l === "matrix" && Boolean(slide.matrix))
                || (l === "org" && Boolean(slide.org))
                || (l === "infographic" && (slide.infographic?.items?.length ?? 0) > 0)
                || (l === "fullbleed" && Boolean(slide.fullbleed))
                || (l === "four_column_case" && Boolean(slide.case_study))
                || (l === "architecture" && (slide.architecture?.components?.length ?? 0) > 0)
                || (l === "capability" && (slide.capability?.categories?.length ?? 0) > 0)
                || (l === "risk_matrix" && (slide.risk?.items?.length ?? 0) > 0);
              return (
                <button
                  key={l}
                  onClick={() => onChange({ layout: l })}
                  disabled={!supported}
                  title={supported ? "" : `Generate via AI to populate ${l} content`}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                    active ? "border-sky-300 bg-sky-50 text-sky-700"
                           : supported ? "border-slate-200 text-slate-600 hover:border-slate-300"
                                       : "border-slate-100 text-slate-300 cursor-not-allowed"
                  }`}
                >
                  {l}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Subtitle (cover/closing) */}
      {(slide.kind === "cover" || slide.kind === "closing") && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5">Subtitle</label>
          <input
            type="text"
            value={slide.subtitle ?? ""}
            onChange={(e) => onChange({ subtitle: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl"
          />
        </div>
      )}

      {/* Bullets (content) */}
      {slide.kind === "content" && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5">Bullets</label>
          <div className="space-y-1.5">
            {slide.bullets.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-slate-300 text-xs">•</span>
                <input
                  type="text"
                  value={b}
                  onChange={(e) => updateBullet(i, e.target.value)}
                  className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg"
                />
                <button onClick={() => removeBullet(i)} className="w-7 h-7 rounded-lg hover:bg-red-50 text-red-400 text-xs">×</button>
              </div>
            ))}
            <button onClick={addBullet} className="w-full px-3 py-1.5 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 hover:border-sky-300 hover:text-sky-600">+ Add bullet</button>
          </div>
        </div>
      )}

      {/* Takeaway (content) */}
      {slide.kind === "content" && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5">
            Takeaway <span className="font-normal text-slate-400">(one-line &quot;so what&quot;)</span>
          </label>
          <input
            type="text"
            value={slide.takeaway ?? ""}
            onChange={(e) => onChange({ takeaway: e.target.value })}
            placeholder="The single sentence the audience should remember from this slide"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl"
          />
        </div>
      )}

      {/* Structured-content read-only preview (pillars/stats/quote/comparison) */}
      {slide.kind === "content" && slide.layout && slide.layout !== "bullets" && (
        <StructuredPreview slide={slide} />
      )}

      {/* Speaker notes */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1.5">Speaker notes <span className="font-normal text-slate-400">(optional)</span></label>
        <textarea
          rows={2}
          value={slide.notes ?? ""}
          onChange={(e) => onChange({ notes: e.target.value })}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl"
        />
      </div>
    </div>
  );
}

function StructuredPreview({ slide }: { slide: SlideDraft }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{slide.layout} content (read-only)</p>
      {slide.layout === "pillars" && (
        <ul className="text-xs text-slate-600 space-y-1">
          {slide.pillars?.map((p, i) => (
            <li key={i}><span className="font-semibold text-slate-800">{p.title}</span> — {p.body}</li>
          ))}
        </ul>
      )}
      {slide.layout === "stats" && (
        <ul className="text-xs text-slate-600 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {slide.stats?.map((s, i) => (
            <li key={i} className="bg-white rounded-lg border border-slate-200 px-2 py-1.5">
              <p className="text-base font-bold text-sky-700">{s.value}</p>
              <p className="text-[11px] text-slate-500 leading-snug">{s.label}</p>
            </li>
          ))}
        </ul>
      )}
      {slide.layout === "quote" && slide.quote && (
        <blockquote className="text-xs italic text-slate-700">
          “{slide.quote.text}”
          {slide.quote.attribution && <span className="block not-italic text-slate-400 mt-0.5">— {slide.quote.attribution}</span>}
        </blockquote>
      )}
      {slide.layout === "comparison" && slide.comparison && (
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
          {(["left", "right"] as const).map((side) => {
            const s = slide.comparison![side] ?? { heading: "", items: [] };
            return (
              <div key={side} className="bg-white rounded-lg border border-slate-200 px-2 py-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{s.heading}</p>
                <ul className="mt-1 space-y-0.5">{(s.items ?? []).map((it, i) => <li key={i}>· {it}</li>)}</ul>
              </div>
            );
          })}
        </div>
      )}
      {slide.layout === "timeline" && slide.timeline && (
        <div className="flex gap-2 overflow-x-auto py-1">
          {slide.timeline.map((t, i) => (
            <div key={i} className="shrink-0 bg-white rounded-lg border border-slate-200 px-3 py-2 min-w-[120px]">
              <div className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center mb-1">{i+1}</div>
              <p className="text-xs font-semibold text-slate-700">{t.phase}</p>
              <p className="text-[10px] text-slate-500">{t.description}</p>
            </div>
          ))}
        </div>
      )}
      {slide.layout === "matrix" && slide.matrix && (
        <div className="grid grid-cols-2 gap-1 text-xs">
          <div className="bg-sky-50 rounded p-2"><span className="font-semibold">{slide.matrix.topLeft}</span></div>
          <div className="bg-white rounded p-2"><span className="font-semibold">{slide.matrix.topRight}</span></div>
          <div className="bg-white rounded p-2"><span className="font-semibold">{slide.matrix.bottomLeft}</span></div>
          <div className="bg-slate-100 rounded p-2"><span className="font-semibold">{slide.matrix.bottomRight}</span></div>
          {slide.matrix.axisX && <p className="col-span-2 text-[10px] text-center text-slate-400">X: {slide.matrix.axisX}</p>}
          {slide.matrix.axisY && <p className="col-span-2 text-[10px] text-center text-slate-400">Y: {slide.matrix.axisY}</p>}
        </div>
      )}
      {slide.layout === "org" && slide.org && (
        <div className="text-xs">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-sky-600 text-white flex items-center justify-center font-bold">{slide.org.leader.charAt(0)}</div>
            <span className="font-semibold">{slide.org.leader}</span>
          </div>
          <div className="flex flex-wrap gap-1 justify-center">
            {slide.org.roles?.map((r, i) => (
              <span key={i} className="px-2 py-1 bg-slate-100 rounded text-[10px]">{r}</span>
            ))}
          </div>
        </div>
      )}
      {slide.layout === "infographic" && slide.infographic?.items && (
        <div className="grid grid-cols-3 gap-2">
          {slide.infographic.items.map((it, i) => (
            <div key={i} className="text-center">
              <p className="text-xl font-bold text-sky-700">{it.value}</p>
              <p className="text-[10px] text-slate-500">{it.label}</p>
            </div>
          ))}
        </div>
      )}
      {slide.layout === "fullbleed" && slide.fullbleed && (
        <div className="bg-slate-800 text-white rounded p-3 text-center">
          <p className="text-sm font-semibold">{slide.fullbleed.overlayText || slide.title}</p>
          <p className="text-[10px] text-slate-400 mt-1">Dark background with accent overlay</p>
        </div>
      )}
      {slide.layout === "four_column_case" && slide.case_study && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs text-slate-600">
          {[
            ["Challenge", slide.case_study.challenge],
            ["Solution", slide.case_study.solution],
            ["Apexon Role", slide.case_study.role],
            ["Benefits", slide.case_study.benefits],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
              <p className="mt-1">{value}</p>
            </div>
          ))}
        </div>
      )}
      {slide.layout === "architecture" && slide.architecture?.components && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-slate-600">
          {slide.architecture.components.map((component, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
              <p className="font-semibold text-slate-800">{component.name}</p>
              <p className="text-[10px] text-slate-500">{component.description}</p>
            </div>
          ))}
        </div>
      )}
      {slide.layout === "capability" && slide.capability?.categories && (
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
          {slide.capability.categories.map((category, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
              <p className="font-semibold text-slate-800">{category.name}</p>
              <p className="text-[10px] text-slate-500">{category.items.join(", ")}</p>
            </div>
          ))}
        </div>
      )}
      {slide.layout === "risk_matrix" && slide.risk?.items && (
        <div className="space-y-1 text-xs text-slate-600">
          {slide.risk.items.map((risk, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
              <p className="font-semibold text-slate-800">{risk.risk}</p>
              <p className="text-[10px] text-slate-500">{risk.impact} · {risk.mitigation}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-slate-400 mt-2">Edit these fields by regenerating with AI — the structured content is preserved on export.</p>
    </div>
  );
}

function VisualJsonPreview({ slide }: { slide: SlideDraft }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    fetch("/api/local/render-visual-slide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: slide.kind,
        layout: slide.layout,
        kicker: slide.kicker,
        title: slide.title,
        subtitle: slide.subtitle,
        bullets: slide.bullets,
        pillars: slide.pillars,
        stats: slide.stats,
        quote: slide.quote,
        comparison: slide.comparison,
        timeline: slide.timeline,
        matrix: slide.matrix,
        org: slide.org,
        infographic: slide.infographic,
        fullbleed: slide.fullbleed,
        case_study: slide.case_study,
        architecture: slide.architecture,
        capability: slide.capability,
        risk: slide.risk,
        takeaway: slide.takeaway,
        design: slide.design,
        notes: slide.notes,
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.text();
      })
      .then((nextSvg) => { if (!cancelled) setSvg(nextSvg); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [slide]);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-100 overflow-hidden shadow-sm">
      <div className="px-3 py-2 border-b border-slate-200 bg-white flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Final visual preview</p>
        <p className="text-[10px] text-slate-400">{slide.design?.template || slide.design?.style || slide.layout || "auto"}</p>
      </div>
      <div className="aspect-video bg-white">
        {svg ? (
          <img
            alt="Generated slide preview"
            src={`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`}
            className="w-full h-full object-contain"
          />
        ) : error ? (
          <div className="h-full flex items-center justify-center px-4 text-xs text-red-500 text-center">{error}</div>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-slate-400">Rendering preview...</div>
        )}
      </div>
    </div>
  );
}

function SlideMiniPreview({ slide, theme }: { slide: SlideDraft; theme: PptxTheme }) {
  const ratio = theme.slideSize.heightIn / theme.slideSize.widthIn;
  const accent = `#${theme.colors.accent1}`;
  const text   = `#${theme.colors.text}`;

  if (slide.kind === "cover") {
    return (
      <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm relative" style={{ paddingBottom: `${ratio * 100}%`, background: "#FFF", fontFamily: theme.fonts.major }}>
        <div className="absolute inset-y-0 left-0 w-2" style={{ background: accent }} />
        <div className="absolute inset-y-0 right-0 w-[45%]" style={{ background: `${accent}10` }} />
        <div className="absolute right-0 left-[50%] top-0 h-1.5" style={{ background: accent, opacity: 0.85 }} />
        <div className="absolute inset-0 px-6 py-7 flex flex-col justify-center">
          {slide.kicker && <p className="text-[10px] font-bold tracking-[0.18em]" style={{ color: accent }}>{slide.kicker.toUpperCase()}</p>}
          <div className="w-8 h-1 rounded mt-1.5" style={{ background: accent }} />
          <p className="text-2xl font-extrabold leading-tight line-clamp-3 mt-3" style={{ color: text }}>{slide.title || "Title"}</p>
          {slide.subtitle && <p className="text-sm mt-2 line-clamp-2 text-slate-500">{slide.subtitle}</p>}
        </div>
      </div>
    );
  }

  if (slide.kind === "section") {
    return (
      <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm relative" style={{ paddingBottom: `${ratio * 100}%`, background: text, fontFamily: theme.fonts.major }}>
        <div className="absolute inset-0 px-6 py-7 flex flex-col justify-center text-white">
          <p className="text-4xl font-extrabold" style={{ color: accent }}>01</p>
          {slide.kicker && <p className="text-[10px] font-bold tracking-[0.18em] mt-2" style={{ color: `${accent}` }}>{slide.kicker.toUpperCase()}</p>}
          <p className="text-xl font-bold leading-tight line-clamp-3 mt-1">{slide.title || "Section"}</p>
          <div className="w-10 h-0.5 mt-2.5" style={{ background: accent }} />
        </div>
      </div>
    );
  }

  if (slide.kind === "closing") {
    return (
      <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm relative" style={{ paddingBottom: `${ratio * 100}%`, background: "#FFF", fontFamily: theme.fonts.major }}>
        <div className="absolute inset-0 px-6 py-6 flex flex-col">
          <p className="text-[10px] font-bold tracking-[0.18em]" style={{ color: accent }}>{(slide.kicker || "NEXT STEPS").toUpperCase()}</p>
          <div className="w-8 h-1 rounded mt-1.5" style={{ background: accent }} />
          <p className="text-xl font-extrabold leading-tight line-clamp-2 mt-2.5" style={{ color: text }}>{slide.title || "Recommended next steps"}</p>
          {slide.subtitle && <p className="text-xs mt-1.5 text-slate-500 line-clamp-2">{slide.subtitle}</p>}
          <div className="grid grid-cols-3 gap-2 mt-3">
            {(slide.bullets.length ? slide.bullets : ["Step", "Step", "Step"]).slice(0, 3).map((b, i) => (
              <div key={i} className="rounded-md border border-slate-200 px-2 py-1.5 bg-white">
                <p className="text-sm font-bold" style={{ color: accent }}>0{i+1}</p>
                <p className="text-[10px] text-slate-600 line-clamp-2">{b || "…"}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // CONTENT slides — render based on layout
  const layout = slide.layout || "bullets";
  const isDarkTechnical = slide.design?.style === "dark_technical";
  if (isDarkTechnical) {
    const orange = "#F04A24";
    return (
      <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm relative" style={{ paddingBottom: `${ratio * 100}%`, background: "#070B14", fontFamily: theme.fonts.major }}>
        <div className="absolute inset-0 px-5 pt-5 pb-3 flex flex-col text-white">
          <p className="text-[15px] font-extrabold leading-tight line-clamp-2">{slide.title || "Action title goes here"}</p>
          <div className="mt-3 flex items-center gap-2 border-b border-white/30 pb-2">
            {(slide.design?.iconHints?.length ? slide.design.iconHints : ["stability", "scale", "reliability"]).slice(0, 4).map((hint, i) => (
              <div key={i} className="flex-1 min-w-0 flex items-center gap-1.5">
                <div className="w-5 h-5 rounded border border-white/60 flex items-center justify-center text-[9px] font-bold">{hint.slice(0, 1).toUpperCase()}</div>
                <p className="text-[8px] font-bold line-clamp-1">{hint}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] font-bold text-center mt-2">Left Shifted Performance Testing Constructs</p>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {(slide.pillars?.length ? slide.pillars.map((p) => `${p.title}: ${p.body}`) : slide.bullets).slice(0, 3).map((item, i) => (
              <div key={i} className="rounded-md border border-slate-600 bg-slate-800/80 p-1.5">
                <p className="text-[8px] font-bold text-white px-1 rounded-sm" style={{ background: orange }}>{item.split(":")[0] || `Module ${i + 1}`}</p>
                <p className="text-[8px] text-white/85 mt-1 line-clamp-3">{item.split(":").slice(1).join(":") || item}</p>
              </div>
            ))}
          </div>
          {slide.takeaway && (
            <div className="mt-auto rounded-md border border-slate-600 bg-slate-800/70 px-2 py-1.5">
              <p className="text-[8px] font-bold" style={{ color: orange }}>SO WHAT</p>
              <p className="text-[9px] text-white/90 line-clamp-2">{slide.takeaway}</p>
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm relative" style={{ paddingBottom: `${ratio * 100}%`, background: "#FFF", fontFamily: theme.fonts.major }}>
      <div className="absolute inset-0 px-5 pt-5 pb-3 flex flex-col">
        {/* Kicker */}
        {slide.kicker && <p className="text-[9px] font-bold tracking-[0.18em]" style={{ color: accent }}>{slide.kicker.toUpperCase()}</p>}
        {/* Action title */}
        <p className="text-[13px] font-bold leading-tight line-clamp-2 mt-1" style={{ color: text }}>{slide.title || "Action title goes here"}</p>
        {/* Title rule */}
        <div className="relative mt-1.5 h-px bg-slate-200">
          <div className="absolute left-0 -top-[1px] h-1 w-6 rounded" style={{ background: accent }} />
        </div>

        {/* Body */}
        <div className="flex-1 mt-2.5 overflow-hidden">
          {layout === "bullets" && (
            <ul className="space-y-1 text-[10px]" style={{ fontFamily: theme.fonts.minor, color: text }}>
              {slide.bullets.slice(0, 5).map((b, i) => (
                <li key={i} className="flex gap-1.5 line-clamp-1">
                  <span className="shrink-0 mt-1 w-1.5 h-1.5" style={{ background: accent }} />
                  <span>{b || "…"}</span>
                </li>
              ))}
            </ul>
          )}
          {layout === "pillars" && (
            <div className={`grid gap-1.5 ${(slide.pillars?.length ?? 0) > 2 ? "grid-cols-3" : "grid-cols-2"}`}>
              {(slide.pillars ?? []).slice(0, 3).map((p, i) => (
                <div key={i} className="bg-slate-50 rounded-md px-2 py-1.5 relative">
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t" style={{ background: accent }} />
                  <div className="w-4 h-4 rounded-full text-[8px] font-bold text-white flex items-center justify-center" style={{ background: accent }}>{i+1}</div>
                  <p className="text-[9px] font-bold mt-1 line-clamp-1">{p.title}</p>
                  <p className="text-[8px] text-slate-500 line-clamp-2">{p.body}</p>
                </div>
              ))}
            </div>
          )}
          {layout === "stats" && (
            <div className={`grid gap-3 ${(slide.stats?.length ?? 0) > 2 ? "grid-cols-3" : "grid-cols-2"}`}>
              {(slide.stats ?? []).slice(0, 3).map((s, i) => (
                <div key={i}>
                  <p className="text-2xl font-extrabold leading-none" style={{ color: accent }}>{s.value}</p>
                  <div className="w-3 h-0.5 my-1" style={{ background: accent }} />
                  <p className="text-[9px] text-slate-500 line-clamp-2">{s.label}</p>
                </div>
              ))}
            </div>
          )}
          {layout === "quote" && slide.quote && (
            <div className="flex gap-2">
              <p className="text-3xl leading-none font-bold" style={{ color: accent }}>“</p>
              <div className="flex-1">
                <p className="text-[11px] italic line-clamp-4" style={{ color: text }}>{slide.quote.text}</p>
                {slide.quote.attribution && <p className="text-[9px] text-slate-400 mt-1">— {slide.quote.attribution}</p>}
              </div>
            </div>
          )}
          {layout === "comparison" && slide.comparison && (
            <div className="grid grid-cols-2 gap-1.5">
              {(["left", "right"] as const).map((side) => {
                const c = slide.comparison![side] ?? { heading: side === "right" ? "To be" : "Current", items: [] };
                const isRight = side === "right";
                return (
                  <div key={side} className="rounded-md px-2 py-1.5 relative" style={{ background: isRight ? `${accent}14` : "#F4F5F7" }}>
                    <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: isRight ? accent : "#9AA1AB" }} />
                    <p className="text-[8px] font-bold tracking-wider uppercase" style={{ color: isRight ? accent : "#5C6473" }}>{c.heading}</p>
                    <ul className="mt-1 space-y-0.5">
                      {(c.items ?? []).slice(0, 3).map((it, i) => <li key={i} className="text-[9px] line-clamp-1" style={{ color: text }}>· {it}</li>)}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Takeaway band */}
        {slide.takeaway && (
          <div className="rounded-md px-2 py-1.5 mt-2 flex items-start gap-2" style={{ background: `${accent}12` }}>
            <span className="w-0.5 self-stretch rounded" style={{ background: accent }} />
            <div className="min-w-0">
              <p className="text-[8px] font-bold tracking-[0.2em]" style={{ color: accent }}>SO WHAT</p>
              <p className="text-[10px] italic text-slate-700 line-clamp-2">{slide.takeaway}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Step4Preview({
  result, deckTitle, slideCount, onBack, onRestart,
}: {
  result: GenerationResult;
  deckTitle: string;
  slideCount: number;
  onBack: () => void;
  onRestart: () => void;
}) {
  const [pdfStatus, setPdfStatus] = useState<"loading" | "ok" | "error">("loading");
  const pdfUrl = `/api/local/pptx-to-pdf?path=${encodeURIComponent(result.path)}`;
  const pptxUrl = `/api/local/serve?path=${encodeURIComponent(result.path)}`;

  useEffect(() => {
    setPdfStatus("loading");
    fetch(pdfUrl, { method: "HEAD" })
      .then((r) => setPdfStatus(r.ok ? "ok" : "error"))
      .catch(() => setPdfStatus("error"));
  }, [pdfUrl]);

  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Step 4 · Preview & download</h2>
          <p className="text-sm text-slate-500">Your deck is ready — {slideCount} slides.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadFromUrl(pptxUrl, result.filename)}
            className="px-4 py-2 rounded-xl bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 shadow-sm flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download .pptx
          </button>
          <button
            onClick={() => downloadFromUrl(pdfUrl, result.filename.replace(/\.pptx$/i, ".pdf"))}
            disabled={pdfStatus !== "ok"}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border flex items-center gap-1.5 transition-colors ${
              pdfStatus === "ok" ? "border-slate-200 text-slate-700 hover:bg-slate-50" :
              "border-slate-200 text-slate-300 cursor-not-allowed"
            }`}
          >
            Download PDF
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-medium text-slate-500">
          {deckTitle}
        </div>
        <div className="aspect-video bg-slate-100">
          {pdfStatus === "ok" ? (
            <iframe src={pdfUrl} className="w-full h-full" title="Deck preview" />
          ) : pdfStatus === "loading" ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-xs text-slate-400 gap-2">
              <div className="w-6 h-6 rounded-full border-2 border-sky-200 border-t-sky-500 animate-spin" />
              Rendering preview (PDF)…
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-xs text-slate-500 gap-2 px-6 text-center">
              PDF preview unavailable. The .pptx download still works.
              <span className="text-slate-400">Install LibreOffice to enable in-browser PDF preview.</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between gap-3 pt-2">
        <button onClick={onBack} className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">Back to edit</button>
        <button onClick={onRestart} className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50">Start a new deck</button>
      </div>
    </section>
  );
}

// ── Slides Canvas View ─────────────────────────────────────────────────────────

interface CanvasOption {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface CanvasSlide {
  id: number;
  title: string;
  subtitle?: string;
  type: "title" | "content";
}

function SlidesCanvasView({ onModeChange }: { onModeChange: (mode: "wizard" | "canvas") => void }) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [slides, setSlides] = useState<CanvasSlide[]>([]);
  const [empty, setEmpty] = useState(true);
  const [showSharePopover, setShowSharePopover] = useState(false);
  const [showPresetDropdown, setShowPresetDropdown] = useState(false);
  const [preset, setPreset] = useState("Standard");

  const options: CanvasOption[] = [
    { id: "ai", label: "Deep Learning/AI Architecture", icon: <Cpu className="w-5 h-5 text-gray-600" /> },
    { id: "business", label: "Business Presentation", icon: <Briefcase className="w-5 h-5 text-gray-600" /> },
    { id: "product", label: "Product Launch", icon: <Package className="w-5 h-5 text-gray-600" /> },
    { id: "technical", label: "Technical Documentation", icon: <FileText className="w-5 h-5 text-gray-600" /> },
    { id: "education", label: "Educational/Training Material", icon: <BookOpen className="w-5 h-5 text-gray-600" /> },
    { id: "research", label: "Research/Analysis Report", icon: <BarChart3 className="w-5 h-5 text-gray-600" /> },
    { id: "other", label: "Other", icon: <FileQuestion className="w-5 h-5 text-gray-600" /> },
  ];

  const handleGenerate = async () => {
    if (!prompt.trim() && !selectedOption) return;
    setLoading(true);
    setEmpty(false);

    // Determine topic from prompt or selected option
    const topic = prompt.trim() || options.find(o => o.id === selectedOption)?.label || "Presentation";

    try {
      // Call the AI generation endpoint
      const res = await fetch("/api/ai/generate-deck-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          audience: undefined,
          slideCount: 8,
          tone: "professional",
        }),
      });
      const data = await res.json();

      if (res.ok && data.slides) {
        setSlides(data.slides.map((s: any, i: number) => ({
          id: i + 1,
          title: s.title,
          subtitle: s.subtitle,
          type: s.kind === "cover" ? "title" as const : "content" as const,
        })));
      } else {
        // Fallback mock
        setSlides([
          { id: 1, title: topic, subtitle: "Generated Presentation", type: "title" as const },
          { id: 2, title: "Executive Summary", type: "content" as const },
          { id: 3, title: "Key Insights", type: "content" as const },
          { id: 4, title: "Next Steps", type: "content" as const },
        ]);
      }
    } catch (e) {
      console.error(e);
      setSlides([
        { id: 1, title: topic, subtitle: "Generated Presentation", type: "title" as const },
        { id: 2, title: "Executive Summary", type: "content" as const },
        { id: 3, title: "Key Insights", type: "content" as const },
        { id: 4, title: "Next Steps", type: "content" as const },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#F7F7F8]">
      {/* Header */}
      <header className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => onModeChange("wizard")} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <Menu className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex items-center gap-2 absolute left-1/2 -translate-x-1/2">
          <span className="text-[15px] font-medium text-gray-700">Eightfold AI Deep Learning Architecture slide deck</span>
          <button className="p-1 hover:bg-gray-100 rounded transition-colors">
            <Pencil className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSharePopover(!showSharePopover)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
          >
            <Share2 className="w-4 h-4" />
            Share
          </button>
          <AnimatePresence>
            {showSharePopover && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute right-6 top-full mt-2 w-48 bg-white rounded-xl border border-gray-100 shadow-lg py-1 z-50"
              >
                <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  Copy link
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                  Invite collaborators
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Export deck
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <SquarePen className="w-5 h-5 text-gray-400" />
          </button>
          <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <MoreHorizontal className="w-5 h-5 text-gray-400" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden p-6 gap-6">
        {/* Left Panel */}
        <div className="flex flex-col gap-4">
          {/* Question Panel Card */}
          <div className="w-[440px] bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Question Header */}
            <div className="bg-gray-50/50 border-b border-gray-100 px-5 py-4">
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-medium text-gray-700">
                  What topic or subject should this slide deck cover
                </span>
                <div className="flex items-center gap-1">
                  <button className="p-1.5 hover:bg-gray-200 rounded transition-colors">
                    <ChevronLeft className="w-4 h-4 text-gray-400" />
                  </button>
                  <span className="text-sm font-medium text-gray-400">0%</span>
                  <button className="p-1.5 hover:bg-gray-200 rounded transition-colors">
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
              </div>
            </div>

            {/* Options */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[420px]">
              {options.map((option) => (
                <motion.button
                  key={option.id}
                  whileHover={{ scale: 1.005 }}
                  whileTap={{ scale: 0.995 }}
                  onClick={() => setSelectedOption(option.id)}
                  className={`w-full flex items-center gap-3.5 p-3.5 rounded-xl border transition-all duration-200 ${
                    selectedOption === option.id
                      ? "border-gray-300 bg-gray-50"
                      : "border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    selectedOption === option.id ? "bg-gray-200" : "bg-gray-100"
                  }`}>
                    {option.icon}
                  </div>
                  <span className={`flex-1 text-left text-[14px] ${
                    selectedOption === option.id ? "text-gray-900 font-medium" : "text-gray-600"
                  }`}>
                    {option.label}
                  </span>
                  <div className={`w-4.5 h-4.5 rounded-full border-1.5 flex items-center justify-center ${
                    selectedOption === option.id ? "border-gray-500 bg-gray-500" : "border-gray-300"
                  }`}>
                    {selectedOption === option.id && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                </motion.button>
              ))}

              {/* Additional Details Input */}
              <div className="mt-3 relative">
                <input
                  type="text"
                  placeholder="Additional details (optional)"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  className="w-full h-11 px-4 pr-10 rounded-xl border border-gray-100 bg-white text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-gray-300 focus:ring-0"
                />
                <Paperclip className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-gray-100 bg-white px-5 py-3.5 flex justify-end gap-2.5">
              <button className="px-4 py-2 text-sm font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                Skip
              </button>
              <button
                onClick={handleGenerate}
                className="px-4 py-2 text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors"
              >
                Next
              </button>
            </div>
          </div>

          {/* Prompt Composer - Separate below */}
          <div className="w-[440px] bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <textarea
              placeholder="Enter your slides request here"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-24 resize-none text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />

            <div className="flex items-center justify-between pt-3 border-t border-gray-50 mt-2">
              <div className="flex items-center gap-2">
                <button className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors">
                  <Plus className="w-4 h-4 text-gray-400" />
                </button>
                <div className="relative">
                  <button
                    onClick={() => setShowPresetDropdown(!showPresetDropdown)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-full text-sm text-gray-600 hover:bg-gray-200 transition-colors"
                  >
                    <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                    {preset}
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                  </button>
                  <AnimatePresence>
                    {showPresetDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute bottom-full left-0 mb-2 w-36 bg-white rounded-xl border border-gray-100 shadow-lg py-1"
                      >
                        {["Standard", "Detailed", "Executive", "Technical"].map((p) => (
                          <button
                            key={p}
                            onClick={() => { setPreset(p); setShowPresetDropdown(false); }}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                              preset === p ? "text-gray-900 font-medium" : "text-gray-600"
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                  <Mic className="w-4 h-4 text-gray-400" />
                </button>
                <button
                  onClick={handleGenerate}
                  className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-full text-sm font-medium hover:bg-gray-800 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Speak
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Canvas */}
        <div className="flex-1 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="h-11 border-b border-gray-50 px-5 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            <span className="text-xs text-gray-400">Slides Canvas</span>
          </div>
          <div className="p-10 overflow-y-auto h-[calc(100%-44px)]">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full">
                <motion.div
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="flex gap-6 mb-8"
                >
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="w-56 h-32 bg-gray-100 rounded-xl animate-pulse" />
                  ))}
                </motion.div>
                <p className="text-gray-400 text-sm">Generating slide outline...</p>
              </div>
            ) : empty ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-300">
                <svg className="w-14 h-14 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-[14px] font-medium text-gray-400">Preview of Your Slides</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-8">
                {slides.map((slide, index) => (
                  <motion.div
                    key={slide.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className={`aspect-video rounded-xl border ${
                      slide.type === "title"
                        ? "bg-gradient-to-br from-gray-800 to-gray-600"
                        : "bg-white border-gray-100"
                    } p-6 flex flex-col ${
                      slide.type === "title" ? "justify-center text-white" : ""
                    }`}
                  >
                    {slide.type === "title" ? (
                      <>
                        <h3 className="text-lg font-semibold mb-2">{slide.title}</h3>
                        <p className="text-gray-300 text-sm">{slide.subtitle}</p>
                      </>
                    ) : (
                      <>
                        <div className="h-6 w-3/4 bg-gray-100 rounded mb-4" />
                        <div className="h-4 w-full bg-gray-50 rounded mb-2.5" />
                        <div className="h-4 w-5/6 bg-gray-50 rounded mb-2.5" />
                        <div className="h-4 w-4/6 bg-gray-50 rounded" />
                      </>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
