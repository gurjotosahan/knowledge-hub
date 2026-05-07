// Shared types for PPTX slide parsing — used by both the API route and PptxSlideView

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;  // pt
  color?: string;     // #RRGGBB
}

export interface Para {
  runs: TextRun[];
  align?: "l" | "ctr" | "r" | "just";
}

export interface TextShape {
  kind: "text";
  x: number; y: number; w: number; h: number;  // % of slide dimensions
  fill?: string;
  valign?: "t" | "ctr" | "b";
  paragraphs: Para[];
  defaultColor?: string;
}

export interface ImageShape {
  kind: "image";
  x: number; y: number; w: number; h: number;
  mediaPath: string;  // zip-internal path, served via /api/local/pptx-media
}

export interface PptxSlideData {
  slideEmuWidth: number;
  slideEmuHeight: number;
  totalSlides: number;
  background?: string;          // solid hex colour
  backgroundMediaPath?: string; // zip-internal path for background image
  shapes: (TextShape | ImageShape)[];
}
