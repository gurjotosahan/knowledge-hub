"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { SlideSearchGroup, SlideSearchResult, SlideSearchTopicGroup } from "@/types";

interface SlideSearchResultsProps {
  groups: SlideSearchGroup[];
  topicGroups?: SlideSearchTopicGroup[];
  onPreviewSlide: (group: SlideSearchGroup, slide: SlideSearchResult) => void;
}

function downloadBlob(blob: Blob, fallbackName: string, disposition: string | null) {
  const url = URL.createObjectURL(blob);
  const filename = disposition?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function confidenceClass(confidence?: SlideSearchResult["confidence"]): string {
  if (confidence === "High") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (confidence === "Medium") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-500 border-slate-200";
}

export default function SlideSearchResults({ groups, topicGroups = [], onPreviewSlide }: SlideSearchResultsProps) {
  const hasTopicGroups = topicGroups.length > 0;
  const renderGroups = useMemo(
    () => hasTopicGroups ? topicGroups.flatMap((topic) => topic.groups) : groups,
    [groups, hasTopicGroups, topicGroups]
  );
  const initialSelected = useMemo(() => {
    const next: Record<string, number[]> = {};
    const source = hasTopicGroups
      ? topicGroups.flatMap((topic) => topic.groups.map((group) => ({ key: `${topic.id}::${group.filePath}`, group })))
      : groups.map((group) => ({ key: group.filePath, group }));
    for (const { key, group } of source) next[key] = group.slides.map((slide) => slide.slideNumber);
    return next;
  }, [groups, hasTopicGroups, topicGroups]);

  const [selected, setSelected] = useState<Record<string, number[]>>(initialSelected);
  const [exportingPath, setExportingPath] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setSelected(initialSelected);
  }, [initialSelected]);

  const toggleSlide = (selectionKey: string, slideNumber: number) => {
    setSelected((prev) => {
      const current = new Set(prev[selectionKey] ?? []);
      if (current.has(slideNumber)) current.delete(slideNumber);
      else current.add(slideNumber);
      return { ...prev, [selectionKey]: [...current].sort((a, b) => a - b) };
    });
  };

  const exportGroup = async (group: SlideSearchGroup, selectionKey: string) => {
    const slides = selected[selectionKey] ?? [];
    if (slides.length === 0) return;

    setError("");
    setExportingPath(group.filePath);
    try {
      const res = await fetch("/api/local/create-pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: group.fileTitle,
          items: slides.map((slideNumber) => ({
            filePath: group.filePath,
            fileTitle: group.fileTitle,
            slideNumber,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Unable to export selected slides.");
      }
      const blob = await res.blob();
      downloadBlob(blob, `${group.fileTitle}-selected-slides.pptx`, res.headers.get("Content-Disposition"));
    } catch (err) {
      setError(String(err));
    } finally {
      setExportingPath(null);
    }
  };

  if (renderGroups.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
        No PPTX slides matched this request. Try a more specific client, topic, or outcome.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Slide Finder</p>
        <p className="text-xs text-slate-400">
          {hasTopicGroups ? "Grouped by topic · top matches per intent" : "Exports stay separate per source deck"}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}

      {(hasTopicGroups ? topicGroups : [{ id: "all", topic: "", groups, resultCount: groups.reduce((sum, group) => sum + group.slides.length, 0) }]).map((topicGroup) => (
        <div key={topicGroup.id} className="space-y-2">
          {hasTopicGroups && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-800">Topic: {topicGroup.topic}</h3>
                <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500 border border-slate-200">
                  {topicGroup.resultCount} result{topicGroup.resultCount !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          )}

          {topicGroup.groups.map((group) => {
        const selectionKey = hasTopicGroups ? `${topicGroup.id}::${group.filePath}` : group.filePath;
        const selectedSlides = selected[selectionKey] ?? [];
        const allSelected = selectedSlides.length === group.slides.length;
        return (
          <div key={group.filePath} className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-slate-800">{group.fileTitle}</h3>
                <p className="text-xs text-slate-400">
                  {group.slides.length} suggested slide{group.slides.length !== 1 ? "s" : ""} · selected {selectedSlides.join(", ") || "none"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() =>
                    setSelected((prev) => ({
                      ...prev,
                      [selectionKey]: allSelected ? [] : group.slides.map((slide) => slide.slideNumber),
                    }))
                  }
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                >
                  {allSelected ? "Clear" : "Select all"}
                </button>
                <button
                  onClick={() => exportGroup(group, selectionKey)}
                  disabled={selectedSlides.length === 0 || exportingPath === group.filePath}
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {exportingPath === group.filePath ? "Exporting..." : "Export"}
                </button>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {group.slides.map((slide) => (
                <div key={slide.slideNumber} className="flex gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedSlides.includes(slide.slideNumber)}
                    onChange={() => toggleSlide(selectionKey, slide.slideNumber)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <button
                    onClick={() => onPreviewSlide(group, slide)}
                    className="min-w-[72px] rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-sky-700 hover:border-sky-300 hover:bg-sky-50"
                  >
                    Slide {slide.slideNumber}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 text-xs font-medium text-slate-700">{slide.reason}</p>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${confidenceClass(slide.confidence)}`}>
                        {slide.confidence ?? "Low"}
                      </span>
                    </div>
                    {slide.excerpt && (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{slide.excerpt}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
          })}
        </div>
      ))}
    </div>
  );
}
