"use client";

import { useEffect, useRef, useState } from "react";

// Worker is configured once at module level (browser only)
let workerConfigured = false;

async function getPdfjsLib() {
  const pdfjsLib = await import("pdfjs-dist");
  if (!workerConfigured && typeof window !== "undefined") {
    // Serve the worker from public/ so Next does not try to minify the ESM worker.
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    workerConfigured = true;
  }
  return pdfjsLib;
}

// ── Shared PDF document cache ──────────────────────────────────────────────────
// All PdfPageCanvas instances for the same URL share ONE loaded document.
// Without this, a 48-slide deck loads the full PDF 48 times simultaneously,
// exhausting the pdfjs worker queue and browser memory.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfDocCache = new Map<string, Promise<any>>();

export function clearPdfCache(url: string) {
  pdfDocCache.delete(url);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSharedPdf(url: string): Promise<any> {
  if (!pdfDocCache.has(url)) {
    const lib = await getPdfjsLib();
    const task = lib.getDocument(url);
    const p = (task as unknown as { promise: Promise<unknown> }).promise;
    pdfDocCache.set(url, p);
    p.catch(() => pdfDocCache.delete(url));
  }
  return pdfDocCache.get(url)!;
}

interface Props {
  /** URL served by /api/local/serve */
  fileUrl: string;
  pageNumber: number;
  /** Display width in px; height computed from PDF aspect ratio */
  displayWidth: number;
}

export default function PdfPageCanvas({ fileUrl, pageNumber, displayWidth }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [height, setHeight] = useState(displayWidth * (9 / 16));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { promise: Promise<unknown>; cancel: () => void } | null = null;

    async function render() {
      if (!canvasRef.current) return;
      setError("");
      setLoading(true);
      try {
        const pdf = await getSharedPdf(fileUrl) as {
          getPage: (page: number) => Promise<{
            getViewport: (options: { scale: number }) => { width: number; height: number };
            render: (options: {
              canvasContext: CanvasRenderingContext2D;
              viewport: { width: number; height: number };
            }) => { promise: Promise<unknown>; cancel: () => void };
          }>;
        };
        if (cancelled) return;

        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const viewport   = page.getViewport({ scale: 1 });
        const scale      = displayWidth / viewport.width;
        const scaled     = page.getViewport({ scale });
        const canvas     = canvasRef.current;
        if (!canvas) return;
        const ctx        = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context is unavailable");

        // Set physical pixel size (handles high-DPI)
        const dpr        = window.devicePixelRatio ?? 1;
        canvas.width     = Math.floor(scaled.width  * dpr);
        canvas.height    = Math.floor(scaled.height * dpr);
        canvas.style.width  = `${scaled.width}px`;
        canvas.style.height = `${scaled.height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, scaled.width, scaled.height);

        setHeight(scaled.height);

        renderTask = page.render({ canvasContext: ctx, viewport: scaled });
        await renderTask.promise;
        if (!cancelled) setLoading(false);
      } catch (err) {
        const message = String(err);
        if (!cancelled && !/RenderingCancelledException/i.test(message)) {
          setError(message);
          setLoading(false);
        }
      }
    }

    render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [fileUrl, pageNumber, displayWidth]);

  if (error) {
    return (
      <div
        className="flex items-center justify-center bg-slate-100 text-xs text-slate-400"
        style={{ width: displayWidth, height }}
        title={error}
      >
        Could not render page
      </div>
    );
  }

  return (
    <div className="relative" style={{ width: displayWidth, minHeight: height }}>
      {loading && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100 text-xs text-slate-400"
          style={{ width: displayWidth, height }}
        >
          Rendering page...
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: displayWidth, height }}
      />
    </div>
  );
}
