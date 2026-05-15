export type ServiceLine = "BFSI" | "Healthcare" | "Life Sciences";
export type DocType = "RFP" | "POV" | "Case Study" | "Trend Report";
export type DocumentCategory = "RFPs" | "POVs" | "Case Studies" | "Latest Trends";

// ── App config (persisted in localStorage) ───────────────────────────────────

export type AIProvider  = "ollama" | "openrouter" | "gemini";
export type SourceType  = "local" | "sharepoint" | "onedrive";
export type SearchableFileType = "pdf" | "pptx" | "docx";

export interface AppConfig {
  // Data source
  sourceType: SourceType;
  // Local source
  folderPath: string;
  // SharePoint / Microsoft Graph source (client_credentials)
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
  generateSlidePreviews: boolean;
  enableAssetLlmEnrichment: boolean;
  enableVisionIndexing: boolean;
  visionModel: string;
  visionWordThreshold: number;
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
  generateSlidePreviews: false,
  enableAssetLlmEnrichment: false,
  enableVisionIndexing: false,
  visionModel: "qwen2.5vl:7b",
  visionWordThreshold: 200,
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
  type: SearchableFileType;
  totalSlides: number;
  slides: LocalSlide[];
}

export interface LocalSourceEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
  type?: SearchableFileType;
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
  fileType?: SearchableFileType;
  excerpt?: string;
  previewPdfUrl?: string;
  // Web search fields
  sourceType?: "rag" | "web";
  url?: string;
}

export interface SlideSearchResult {
  slideNumber: number;
  reason: string;
  excerpt: string;
  score?: number;
  confidence?: "High" | "Medium" | "Low";
  thumbnailUrl?: string;
  previewPdfUrl?: string;
  previewStatus?: "thumbnail" | "pdf" | "failed";
  assetYear?: number;
  yearConfidence?: "high" | "medium" | "low";
  recencyNote?: string;
}

export interface SlideSearchGroup {
  filePath: string;
  fileTitle: string;
  fileType: "pptx";
  slides: SlideSearchResult[];
}

export interface SlideSearchTopicGroup {
  id: string;
  topic: string;
  groups: SlideSearchGroup[];
  resultCount: number;
}

export interface AgentHarnessTraceEntry {
  step: string;
  tool: string;
  query?: string;
  found?: number;
  status?: "ok" | "fallback" | "warning" | "error";
  note?: string;
}

export interface AgentHarnessReport {
  status: "pass" | "review" | "fail";
  intent: string;
  toolsUsed: string[];
  retrievedItems: number;
  evidenceRefs: number;
  fallbacks: number;
  warnings: string[];
  agentTrace: AgentHarnessTraceEntry[];
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
