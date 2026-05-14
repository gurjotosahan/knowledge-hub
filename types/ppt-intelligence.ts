// PptIntelligence types — restored for ppt-generator and visualSlideRenderer
// These were removed from the deleted types/ directory

export type PptSlideKind =
  | "cover"
  | "section"
  | "section-header"
  | "title"
  | "content"
  | "closing"
  | "two-column"
  | "quote"
  | "callout"
  | "image-text"
  | "chart"
  | "table"
  | "comparison"
  | "process"
  | "footer"
  | "agenda"
  | "thank-you";

export type PptSlideLayout = "title" | "content" | "two-col" | "quote" | "callout" | "footer" | "blank" | "bullets" | "pillars" | "stats" | "quote-layout" | "comparison" | "timeline" | "matrix" | "org" | "infographic" | "fullbleed" | "four_column_case" | "architecture" | "capability" | "risk_matrix";

export interface PptSlideStyle {
  backgroundColor?: string;
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  fontSize?: number;
  textColor?: string;
}

export interface PptSlidePillar {
  title: string;
  body: string;
}

export interface PptSlideStat {
  value: string;
  label: string;
}

export interface PptSlideQuote {
  text?: string;
  author?: string;
  attribution?: string;
}

export interface PptSlideComparisonSide {
  heading?: string;
  items?: string[];
}

export interface PptSlideDesign {
  visualPattern?: string;
  iconHints?: string[];
  style?: string;
  template?: string;
}

export interface PptSlideDraft {
  slideNumber: number;
  title: string;
  content: string;
  layout?: PptSlideLayout;
  kind?: PptSlideKind;
  style?: PptSlideStyle;
  imageUrl?: string;
  bullets?: string[];
  subtitle?: string;
  notes?: string;
  kicker?: string;
  takeaway?: string;
  speakerNotes?: string;
  pillars?: PptSlidePillar[];
  stats?: PptSlideStat[];
  quote?: PptSlideQuote;
  comparison?: {
    left?: PptSlideComparisonSide;
    right?: PptSlideComparisonSide;
  };
  design?: PptSlideDesign;
}

export interface PptDeckDraft {
  title: string;
  subtitle?: string;
  slides: PptSlideDraft[];
  theme?: Record<string, string>;
}

export interface PptQualityResult {
  score: number;
  critical: PptIssue[];
  warning: PptIssue[];
  info: PptIssue[];
  overall: string;
}

export interface PptIssue {
  slide: number;
  type: "critical" | "warning" | "info";
  message: string;
  suggestion?: string;
}

export interface PptIntelligenceContext {
  opportunity: string;
  client: string;
  industry: string;
  audience: string;
  keyMessages: string[];
  differentiators: string[];
  proofPoints: string[];
  tone: string;
  constraints: string[];
}
