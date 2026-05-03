export type ServiceLine = "BFSI" | "Healthcare" | "Life Sciences";
export type DocType = "RFP" | "POV" | "Case Study" | "Trend Report";

// ── App config (persisted in localStorage) ───────────────────────────────────

export type AIProvider  = "ollama" | "openrouter" | "gemini";
export type SourceType  = "local" | "sharepoint";

export interface AppConfig {
  // Data source
  sourceType: SourceType;
  // Local source
  folderPath: string;
  // SharePoint / Microsoft Graph source
  graphTenantId: string;
  graphClientId: string;
  graphClientSecret: string;
  graphSiteUrl: string;
  graphDriveId: string;
  graphMockMode: boolean;
  // AI
  aiProvider: AIProvider;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaEmbedModel: string;
  openrouterApiKey: string;
  openrouterModel: string;
  geminiApiKey: string;
  geminiModel: string;
  embeddingProvider: "ollama" | "google";
  // Web search
  tavilyApiKey: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  sourceType: "local",
  folderPath: "",
  graphTenantId: "",
  graphClientId: "",
  graphClientSecret: "",
  graphSiteUrl: "",
  graphDriveId: "mock-drive-documents",
  graphMockMode: true,
  aiProvider: "ollama",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "",
  ollamaEmbedModel: "bge-large",
  openrouterApiKey: "",
  openrouterModel: "",
  geminiApiKey: "",
  geminiModel: "",
  embeddingProvider: "ollama",
  tavilyApiKey: "",
};

// ── Local file types (returned by API routes) ─────────────────────────────────

export interface LocalSlide {
  number: number;
  text: string;
}

export interface LocalFile {
  name: string;
  path: string;
  type: "pdf" | "pptx";
  totalSlides: number;
  slides: LocalSlide[];
}

export interface LocalSourceEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
  type?: "pdf" | "pptx";
  sizeBytes?: number;
  modifiedAt?: string;
  webUrl?: string;
}

// ── Rich slide content types (mock decks) ─────────────────────────────────────

export type SlideLayout =
  | "title"
  | "section"
  | "bullets"
  | "two-col"
  | "stats"
  | "quote"
  | "closing";

export interface DeckTheme {
  primary: string;
  accent: string;
  surface: string;
  primaryText: string;
}

export interface StatItem {
  value: string;
  label: string;
}

export interface ColumnContent {
  heading: string;
  items: string[];
}

export interface SlideData {
  layout: SlideLayout;
  theme: DeckTheme;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  bullets?: string[];
  leftCol?: ColumnContent;
  rightCol?: ColumnContent;
  stats?: StatItem[];
  quote?: string;
  attribution?: string;
}

export interface Slide {
  number: number;
  caption: string;
  data?: SlideData;
  imageUrl?: string;
}

// ── Core domain types ─────────────────────────────────────────────────────────

export interface Source {
  id: string;
  docId: string;
  title: string;
  slide: number;
  serviceLine: ServiceLine;
  filePath?: string;
  fileType?: "pdf" | "pptx";
  excerpt?: string;
  // Web search fields
  sourceType?: "rag" | "web";
  url?: string;
}

export interface AIAnswer {
  answer: string;
  sources: Source[];
}

export interface Document {
  id: string;
  title: string;
  summary: string;
  serviceLine: ServiceLine;
  type: DocType;
  tags: string[];
}

export interface SidebarItem {
  label: string;
  serviceLine: ServiceLine;
  children: string[];
}
