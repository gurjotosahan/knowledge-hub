"use client";

import { useEffect, useState } from "react";
import type { PptxSlideData, TextShape, ImageShape } from "@/types/pptx";

interface Props {
  filePath: string;
  slideNumber: number;
  displayWidth: number;
}

export default function PptxSlideView({ filePath, slideNumber, displayWidth }: Props) {
  const [data,   setData]   = useState<PptxSlideData | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    if (!filePath) { setStatus("error"); return; }
    setData(null);
    setStatus("loading");
    fetch(`/api/local/pptx-slide?path=${encodeURIComponent(filePath)}&slide=${slideNumber}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: PptxSlideData & { error?: string }) => {
        if (d.error) throw new Error(d.error);
        setData(d);
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, [filePath, slideNumber]);

  const displayHeight = data
    ? Math.round(displayWidth * (data.slideEmuHeight / data.slideEmuWidth))
    : Math.round(displayWidth * 9 / 16);

  const mediaUrl = (path: string) =>
    `/api/local/pptx-media?path=${encodeURIComponent(filePath)}&media=${encodeURIComponent(path)}`;

  const containerStyle: React.CSSProperties = {
    width:    displayWidth,
    height:   displayHeight,
    position: "relative",
    overflow: "hidden",
    background: data?.background ?? (status === "ok" ? "#ffffff" : "#1e293b"),
    flexShrink: 0,
  };

  if (status === "loading") {
    return (
      <div style={{ ...containerStyle, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <div className="w-5 h-5 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
        <span style={{ fontSize: 10, color: "rgba(241,245,249,0.5)" }}>Loading…</span>
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div style={{ ...containerStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 10, color: "rgba(100,116,139,0.6)", fontStyle: "italic" }}>
          Preview unavailable
        </span>
      </div>
    );
  }

  // Font scale: 1 pt = (displayWidth / slideWidthInPts) px
  const ptToPx = displayWidth / (data.slideEmuWidth / 12700);

  return (
    <div style={containerStyle}>
      {/* Background image from slide master */}
      {data.backgroundMediaPath && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mediaUrl(data.backgroundMediaPath)}
          alt=""
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", display: "block" }}
        />
      )}

      {/* Shapes */}
      {data.shapes.map((shape, i) => {
        const pos: React.CSSProperties = {
          position: "absolute",
          left:   `${shape.x}%`,
          top:    `${shape.y}%`,
          width:  `${shape.w}%`,
          height: `${shape.h}%`,
          overflow: "hidden",
        };

        if (shape.kind === "image") {
          const img = shape as ImageShape;
          return (
            <div key={i} style={pos}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaUrl(img.mediaPath)}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "fill", display: "block" }}
              />
            </div>
          );
        }

        const ts = shape as TextShape;
        const justifyContent =
          ts.valign === "ctr" ? "center"
          : ts.valign === "b" ? "flex-end"
          : "flex-start";

        return (
          <div
            key={i}
            style={{
              ...pos,
              background:     ts.fill ?? "transparent",
              display:        "flex",
              flexDirection:  "column",
              justifyContent,
              padding:        "1.5% 2%",
              boxSizing:      "border-box",
              color:          ts.defaultColor ?? "#1e293b",
            }}
          >
            {ts.paragraphs.map((para, pi) => (
              <p
                key={pi}
                style={{
                  margin: 0,
                  lineHeight: 1.25,
                  textAlign:
                    para.align === "ctr"  ? "center"
                    : para.align === "r"  ? "right"
                    : para.align === "just" ? "justify"
                    : "left",
                }}
              >
                {para.runs.map((run, ri) => (
                  <span
                    key={ri}
                    style={{
                      fontWeight: run.bold   ? "bold"   : undefined,
                      fontStyle:  run.italic ? "italic" : undefined,
                      fontSize:   run.fontSize ? `${run.fontSize * ptToPx}px` : undefined,
                      color:      run.color ?? "inherit",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {run.text}
                  </span>
                ))}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}
