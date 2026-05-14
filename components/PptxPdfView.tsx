"use client";

import { useEffect, useRef, useState } from "react";
import PdfPageCanvas, { clearPdfCache } from "./PdfPageCanvas";

interface Props {
  filePath: string;
  slideNumber: number;
  displayWidth: number;
}

export default function PptxPdfView({ filePath, slideNumber, displayWidth }: Props) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (blobUrlRef.current) {
      clearPdfCache(blobUrlRef.current);
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setPdfUrl(null);
    setStatus("loading");

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

  const displayHeight = Math.round(displayWidth * 9 / 16);

  if (status === "error") {
    return (
      <div
        style={{ width: displayWidth, height: displayHeight }}
        className="flex items-center justify-center bg-slate-100 text-xs text-slate-400 italic"
      >
        Preview unavailable
      </div>
    );
  }

  if (!pdfUrl) {
    return (
      <div
        style={{ width: displayWidth, height: displayHeight }}
        className="flex flex-col items-center justify-center bg-slate-900 gap-2"
      >
        <div className="h-4 w-4 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
        <span className="text-[10px] text-slate-400">Converting…</span>
      </div>
    );
  }

  return (
    <PdfPageCanvas
      key={`${pdfUrl}-${slideNumber}`}
      fileUrl={pdfUrl}
      pageNumber={slideNumber}
      displayWidth={displayWidth}
    />
  );
}
