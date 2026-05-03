"use client";

import { useEffect, useRef, useState } from "react";
import type { Source } from "@/types";
import { docSlides } from "@/data/mockData";
import SlideRenderer from "./SlideRenderer";
import SlideModal, { type ModalContent } from "./SlideModal";

// Design canvas dimensions (SlideRenderer renders at these dimensions)
const DESIGN_W = 640;
const DESIGN_H = 360;
// Panel content width = 400px panel − 32px padding
const DISPLAY_W = 368;
const SCALE = DISPLAY_W / DESIGN_W;
const DISPLAY_H = Math.round(DESIGN_H * SCALE);

interface PreviewPanelProps {
  source: Source | null;
}

export default function PreviewPanel({ source }: PreviewPanelProps) {
  const activeRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<{
    slideNumber: number;
  } | null>(null);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [source]);

  const slides = source ? (docSlides[source.docId] ?? []) : [];
  const modalSlide = modal
    ? slides.find((sl) => sl.number === modal.slideNumber)
    : null;
  const modalContent: ModalContent | null = modalSlide
    ? modalSlide.data
      ? { kind: "rendered", data: modalSlide.data, number: modalSlide.number }
      : { kind: "image", url: modalSlide.imageUrl ?? "" }
    : null;

  return (
    <aside
      className="flex flex-col h-screen shrink-0 bg-white border-l border-slate-200"
      style={{ width: 400 }}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 shrink-0">
        {source ? (
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold text-slate-800 truncate">
              {source.title}
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-400">{source.serviceLine}</span>
              <span className="text-slate-200">·</span>
              <span className="text-xs text-slate-400">{slides.length} slides</span>
              <span className="text-slate-200">·</span>
              <span className="text-xs text-sky-600 font-medium">
                Slide {source.slide} referenced
              </span>
            </div>
          </div>
        ) : (
          <h2 className="text-sm font-semibold text-slate-700">Slide Preview</h2>
        )}
      </div>

      {/* Body */}
      {!source ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-slate-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 17V7m0 10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 10a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 10V7m0 10a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2"
              />
            </svg>
          </div>
          <p className="text-sm text-slate-400 font-medium">
            Select a reference to preview
          </p>
          <p className="text-xs text-slate-300">
            Click any citation in the AI answer to view the source slide here.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 p-4">
            {slides.map((sl) => {
              const isActive = sl.number === source.slide;
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
                      isActive
                        ? "bg-sky-500 text-white"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <span>Slide {sl.number}</span>
                    {isActive && (
                      <span className="flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm3.707-9.293a1 1 0 0 0-1.414-1.414L9 10.586 7.707 9.293a1 1 0 0 0-1.414 1.414l2 2a1 1 0 0 0 1.414 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Referenced
                      </span>
                    )}
                  </div>

                  {/* Slide content */}
                  {sl.data ? (
                    // Rich rendered slide — design at 640×360, scaled to display width
                    <div
                      style={{
                        width: DISPLAY_W,
                        height: DISPLAY_H,
                        overflow: "hidden",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          width: DESIGN_W,
                          height: DESIGN_H,
                          transform: `scale(${SCALE})`,
                          transformOrigin: "top left",
                          position: "absolute",
                          top: 0,
                          left: 0,
                        }}
                      >
                        <SlideRenderer data={sl.data} slideNumber={sl.number} />
                      </div>
                    </div>
                  ) : (
                    // Fallback: placeholder image
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={sl.imageUrl}
                      alt={`Slide ${sl.number} – ${sl.caption}`}
                      className="w-full object-cover"
                      style={{ aspectRatio: "16/9" }}
                    />
                  )}

                  {/* Caption */}
                  <div className="px-3 py-2 bg-white border-t border-slate-100">
                    <p className="text-xs text-slate-600 font-medium">{sl.caption}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {modal && source && modalSlide && modalContent && (
        <SlideModal
          content={modalContent}
          docTitle={source.title}
          slideNumber={modal.slideNumber}
          caption={modalSlide.caption}
          onClose={() => setModal(null)}
          onPrevious={() => setModal((prev) => prev ? { slideNumber: prev.slideNumber - 1 } : prev)}
          onNext={() => setModal((prev) => prev ? { slideNumber: prev.slideNumber + 1 } : prev)}
          hasPrevious={modal.slideNumber > 1}
          hasNext={modal.slideNumber < slides.length}
          totalSlides={slides.length}
          slideLabel="Slide"
        />
      )}
    </aside>
  );
}
