export type HarnessStatus = "pass" | "review" | "fail";

export interface AgentHarnessTraceEntry {
  step: string;
  tool: string;
  query?: string;
  found?: number;
  status?: "ok" | "fallback" | "warning" | "error";
  note?: string;
}

export interface AgentHarnessReport {
  status: HarnessStatus;
  intent: string;
  toolsUsed: string[];
  retrievedItems: number;
  evidenceRefs: number;
  fallbacks: number;
  warnings: string[];
  agentTrace: AgentHarnessTraceEntry[];
}

export function classifyAgentIntent(query: string): string {
  const lower = query.toLowerCase();
  if (/\b(compare|versus|vs\.?|difference|differentiate)\b/.test(lower)) return "compare";
  if (/\b(slide|deck|ppt|pptx|presentation|visual|diagram|asset|boilerplate)\b/.test(lower)) return "find_assets";
  if (/\b(case stud|proof|reference|client example|outcome|roi|metric)\b/.test(lower)) return "find_proof_points";
  if (/\b(summarize|summary|brief|overview)\b/.test(lower)) return "summarize";
  return "answer";
}

export function countCitationMarkers(text: string): number {
  return new Set(text.match(/\[\d+\]/g) || []).size;
}

export function buildAgentHarnessReport(args: {
  intent: string;
  toolsUsed: string[];
  retrievedItems: number;
  evidenceRefs: number;
  fallbacks?: number;
  warnings?: string[];
  agentTrace?: AgentHarnessTraceEntry[];
}): AgentHarnessReport {
  const warnings = args.warnings ?? [];
  const fallbacks = args.fallbacks ?? 0;
  const status: HarnessStatus =
    fallbacks > 0 || warnings.length > 0 || args.evidenceRefs === 0
      ? "review"
      : "pass";

  return {
    status,
    intent: args.intent,
    toolsUsed: [...new Set(args.toolsUsed)].filter(Boolean),
    retrievedItems: args.retrievedItems,
    evidenceRefs: args.evidenceRefs,
    fallbacks,
    warnings: [
      ...warnings,
      ...(args.evidenceRefs === 0 && args.retrievedItems > 0 ? ["No explicit citation markers found in the final answer."] : []),
    ],
    agentTrace: args.agentTrace ?? [],
  };
}
