export type Feature =
  | "slides"      // Find Slides tab
  | "answer"      // Answer mode
  | "web"         // Web search toggle
  | "rfp"         // RFP Analyzer
  | "research"    // Client Research
  | "composer";   // Slide Composer

export interface UserPermissions {
  features: Feature[];
  allowedSourceKeys: string[]; // ["*"] = all indexed folders
  canManageIndex: boolean;     // can rebuild / force-rebuild the index
}

export const ADMIN_PERMISSIONS: UserPermissions = {
  features: ["slides", "answer", "web", "rfp", "research", "composer"],
  allowedSourceKeys: ["*"],
  canManageIndex: true,
};

export const DEFAULT_USER_PERMISSIONS: UserPermissions = {
  features: ["slides", "answer"],
  allowedSourceKeys: ["*"],
  canManageIndex: false,
};

export const ALL_FEATURES: Array<{ id: Feature; label: string; description: string }> = [
  { id: "answer",   label: "Answer mode",     description: "Ask questions and get AI-generated answers" },
  { id: "slides",   label: "Find Slides",     description: "Search for relevant presentation slides" },
  { id: "composer", label: "Slide Composer",  description: "Build and export slide decks" },
  { id: "research", label: "Client Research", description: "Generate client research reports" },
  { id: "rfp",      label: "RFP Analyzer",    description: "Analyze and respond to RFPs" },
  { id: "web",      label: "Web Search",      description: "Include live web search in answers" },
];

export function canAccess(permissions: UserPermissions, feature: Feature): boolean {
  return permissions.features.includes(feature);
}

export function canUseSourceKey(permissions: UserPermissions, sourceKey: string): boolean {
  return permissions.allowedSourceKeys.includes("*") || permissions.allowedSourceKeys.includes(sourceKey);
}
