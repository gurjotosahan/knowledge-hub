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
    let loadingTask: { promise: Promise<unknown>; destroy: () => Promise<void> } | null = null;

    async function render() {
      if (!canvasRef.current) return;
      setError("");
      setLoading(true);
      try {
        const pdfjsLib = await getPdfjsLib();
        loadingTask = pdfjsLib.getDocument(fileUrl);
        const pdf = await loadingTask.promise as {
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
      void loadingTask?.destroy();
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
