import type { SearchableFileType } from "@/types";
import type { AgentConfig } from "@/lib/rag/agent";

export type AssetType =
  | "rfp_response"
  | "proposal"
  | "capability_deck"
  | "case_study"
  | "operating_model"
  | "solution_architecture"
  | "commercial_pricing"
  | "research_report"
  | "reference_document"
  | "unknown";

export type SectionAssetType =
  | "executive_summary"
  | "capability"
  | "case_study"
  | "operating_model"
  | "solution_architecture"
  | "commercial_pricing"
  | "delivery_plan"
  | "governance"
  | "security_compliance"
  | "requirement_response"
  | "proof_point"
  | "appendix"
  | "generic";

export interface AssetIntelligence {
  documentAssetType: AssetType;
  sectionAssetType: SectionAssetType;
  industries: string[];
  serviceLines: string[];
  technologies: string[];
  reusableFor: string[];
  proofStrength: "high" | "medium" | "low" | "none";
  hasMetrics: boolean;
  summary: string;
}

export interface AssetLlmConfig extends Pick<
  AgentConfig,
  "aiProvider" | "ollamaBaseUrl" | "ollamaModel" | "openrouterApiKey" | "openrouterModel" | "geminiApiKey" | "geminiModel"
> {}

interface Rule {
  label: string;
  patterns: RegExp[];
}

const INDUSTRIES: Rule[] = [
  { label: "Healthcare", patterns: [/healthcare/i, /payer/i, /provider/i, /patient/i, /hospital/i, /ehr/i, /hipaa/i] },
  { label: "Life Sciences", patterns: [/life sciences?/i, /pharma/i, /clinical/i, /cro\b/i, /trial/i, /iqvia/i, /fhir/i, /hl7/i] },
  { label: "BFSI", patterns: [/bfsi/i, /bank/i, /banking/i, /financial/i, /insurance/i, /payments?/i, /lending/i] },
  { label: "Retail", patterns: [/retail/i, /restaurant/i, /commerce/i, /customer loyalty/i] },
  { label: "Automotive", patterns: [/automotive/i, /vehicle/i, /fleet/i, /volkswagen/i, /\bvw\b/i] },
];

const SERVICE_LINES: Rule[] = [
  { label: "Quality Engineering", patterns: [/quality engineering/i, /\bqe\b/i, /testing/i, /test automation/i, /selenium/i, /jmeter/i] },
  { label: "Data", patterns: [/\bdata\b/i, /analytics/i, /snowflake/i, /databricks/i, /migration/i, /warehouse/i] },
  { label: "Cloud", patterns: [/cloud/i, /\baws\b/i, /azure/i, /\bgcp\b/i, /kubernetes/i, /serverless/i] },
  { label: "Salesforce", patterns: [/salesforce/i, /lightning/i, /\bapex\b/i, /sfdx/i] },
  { label: "UI/UX", patterns: [/\bui\b/i, /\bux\b/i, /user experience/i, /design system/i, /figma/i] },
  { label: "Application Engineering", patterns: [/application/i, /modernization/i, /microservices/i, /api/i, /integration/i] },
  { label: "Managed Services", patterns: [/managed service/i, /l1/i, /l2/i, /support model/i, /service desk/i, /operations/i] },
  { label: "AI / Agentic AI", patterns: [/\bai\b/i, /genai/i, /agentic/i, /copilot/i, /automation/i] },
];

const TECHNOLOGIES: Rule[] = [
  { label: "AWS", patterns: [/\baws\b/i, /lambda/i, /dynamodb/i, /eventbridge/i, /cloudformation/i] },
  { label: "Azure", patterns: [/azure/i, /power platform/i] },
  { label: "GCP", patterns: [/\bgcp\b/i, /google cloud/i] },
  { label: "Salesforce", patterns: [/salesforce/i, /lightning web components?/i, /\blwc\b/i, /\bapex\b/i, /sfdx/i] },
  { label: "Snowflake", patterns: [/snowflake/i] },
  { label: "Databricks", patterns: [/databricks/i] },
  { label: "React", patterns: [/react/i, /next\.?js/i] },
  { label: "Java", patterns: [/\bjava\b/i, /spring boot/i] },
  { label: "FHIR / HL7", patterns: [/\bfhir\b/i, /\bhl7\b/i] },
  { label: "ServiceNow", patterns: [/servicenow/i] },
  { label: "JMeter", patterns: [/jmeter/i] },
  { label: "Selenium", patterns: [/selenium/i] },
];

function hits(text: string, rules: Rule[]): string[] {
  return rules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => rule.label);
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function compactSummary(text: string, fallback: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, 220);
}

const ASSET_TYPES: AssetType[] = [
  "rfp_response",
  "proposal",
  "capability_deck",
  "case_study",
  "operating_model",
  "solution_architecture",
  "commercial_pricing",
  "research_report",
  "reference_document",
  "unknown",
];

const SECTION_ASSET_TYPES: SectionAssetType[] = [
  "executive_summary",
  "capability",
  "case_study",
  "operating_model",
  "solution_architecture",
  "commercial_pricing",
  "delivery_plan",
  "governance",
  "security_compliance",
  "requirement_response",
  "proof_point",
  "appendix",
  "generic",
];

const PROOF_STRENGTHS: AssetIntelligence["proofStrength"][] = ["high", "medium", "low", "none"];

export function classifyDocumentAsset(fileName: string, fileType: SearchableFileType, fullText: string): Omit<AssetIntelligence, "sectionAssetType" | "summary"> {
  const text = `${fileName} ${fullText.slice(0, 12_000)}`;
  const lower = text.toLowerCase();
  let documentAssetType: AssetType = "unknown";

  if (hasAny(lower, [/rfp response/i, /response to rfp/i, /proposal response/i, /rfq/i])) documentAssetType = "rfp_response";
  else if (hasAny(lower, [/proposal/i, /\bsow\b/i, /statement of work/i])) documentAssetType = "proposal";
  else if (hasAny(lower, [/case stud/i, /success stor/i, /customer stor/i])) documentAssetType = "case_study";
  else if (hasAny(lower, [/capabilit/i, /offering/i, /service line/i]) || fileType === "pptx") documentAssetType = "capability_deck";
  else if (hasAny(lower, [/operating model/i, /delivery model/i, /governance model/i])) documentAssetType = "operating_model";
  else if (hasAny(lower, [/architecture/i, /solution overview/i, /reference architecture/i, /accelerator/i])) documentAssetType = "solution_architecture";
  else if (hasAny(lower, [/pricing/i, /commercial/i, /rate card/i, /payment terms/i])) documentAssetType = "commercial_pricing";
  else if (hasAny(lower, [/research/i, /market/i, /trend/i, /analysis/i])) documentAssetType = "research_report";
  else documentAssetType = "reference_document";

  return {
    documentAssetType,
    industries: [...new Set(hits(text, INDUSTRIES))],
    serviceLines: [...new Set(hits(text, SERVICE_LINES))],
    technologies: [...new Set(hits(text, TECHNOLOGIES))],
    reusableFor: reusableForDocument(documentAssetType),
    proofStrength: proofStrength(text),
    hasMetrics: metricPattern().test(text),
  };
}

export async function enrichDocumentAssetWithLlm(
  base: Omit<AssetIntelligence, "sectionAssetType" | "summary">,
  fileName: string,
  fileType: SearchableFileType,
  fullText: string,
  config?: AssetLlmConfig
): Promise<Omit<AssetIntelligence, "sectionAssetType" | "summary">> {
  if (!hasLlmConfig(config)) return base;
  const prompt = `Classify this internal knowledge asset for enterprise proposal reuse.

Return ONLY valid JSON with this schema:
{
  "documentAssetType": one of ${ASSET_TYPES.join(", ")},
  "industries": string[],
  "serviceLines": string[],
  "technologies": string[],
  "reusableFor": string[],
  "proofStrength": one of high, medium, low, none,
  "hasMetrics": boolean
}

Use concise labels. Do not invent client names or proof points not present in the text.

File: ${fileName}
File type: ${fileType}
Text:
${fullText.slice(0, 10_000)}`;

  try {
    const parsed = await callAssetLlm(prompt, config);
    return {
      documentAssetType: pickEnum(parsed.documentAssetType, ASSET_TYPES, base.documentAssetType),
      industries: mergeLabels(base.industries, parsed.industries),
      serviceLines: mergeLabels(base.serviceLines, parsed.serviceLines),
      technologies: mergeLabels(base.technologies, parsed.technologies),
      reusableFor: mergeLabels(base.reusableFor, parsed.reusableFor),
      proofStrength: pickEnum(parsed.proofStrength, PROOF_STRENGTHS, base.proofStrength),
      hasMetrics: typeof parsed.hasMetrics === "boolean" ? parsed.hasMetrics : base.hasMetrics,
    };
  } catch {
    return base;
  }
}

export function classifySectionAsset(
  docIntel: Omit<AssetIntelligence, "sectionAssetType" | "summary">,
  text: string,
  page: number
): AssetIntelligence {
  const lower = text.toLowerCase();
  let sectionAssetType: SectionAssetType = "generic";

  if (hasAny(lower, [/executive summary/i, /value proposition/i])) sectionAssetType = "executive_summary";
  else if (hasAny(lower, [/case stud/i, /challenge/i, /solution/i, /outcome/i, /customer story/i])) sectionAssetType = "case_study";
  else if (hasAny(lower, [/operating model/i, /delivery model/i, /l1/i, /l2/i, /support model/i, /service desk/i])) sectionAssetType = "operating_model";
  else if (hasAny(lower, [/architecture/i, /solution overview/i, /reference architecture/i, /integration/i, /data flow/i])) sectionAssetType = "solution_architecture";
  else if (hasAny(lower, [/pricing/i, /commercial/i, /rate card/i, /payment terms/i, /assumptions/i])) sectionAssetType = "commercial_pricing";
  else if (hasAny(lower, [/delivery plan/i, /timeline/i, /phase/i, /milestone/i, /implementation/i])) sectionAssetType = "delivery_plan";
  else if (hasAny(lower, [/governance/i, /steering/i, /reporting/i, /cadence/i, /raci/i])) sectionAssetType = "governance";
  else if (hasAny(lower, [/security/i, /privacy/i, /compliance/i, /hipaa/i, /soc2/i, /encryption/i])) sectionAssetType = "security_compliance";
  else if (hasAny(lower, [/requirement/i, /shall/i, /must/i, /compliance response/i])) sectionAssetType = "requirement_response";
  else if (hasAny(lower, [/proof point/i, /outcome/i, /roi/i, /reduced/i, /improved/i]) || metricPattern().test(text)) sectionAssetType = "proof_point";
  else if (hasAny(lower, [/capabilit/i, /offering/i, /accelerator/i, /framework/i, /approach/i])) sectionAssetType = "capability";
  else if (hasAny(lower, [/appendix/i, /annex/i])) sectionAssetType = "appendix";

  const localIndustries = hits(text, INDUSTRIES);
  const localServiceLines = hits(text, SERVICE_LINES);
  const localTechnologies = hits(text, TECHNOLOGIES);
  const hasMetrics = metricPattern().test(text);

  return {
    ...docIntel,
    sectionAssetType,
    industries: [...new Set([...localIndustries, ...docIntel.industries])],
    serviceLines: [...new Set([...localServiceLines, ...docIntel.serviceLines])],
    technologies: [...new Set([...localTechnologies, ...docIntel.technologies])],
    reusableFor: [...new Set([...reusableForSection(sectionAssetType), ...docIntel.reusableFor])],
    proofStrength: hasMetrics || sectionAssetType === "case_study" || sectionAssetType === "proof_point"
      ? proofStrength(text)
      : docIntel.proofStrength,
    hasMetrics: hasMetrics || docIntel.hasMetrics,
    summary: compactSummary(text, `Reusable asset on page or slide ${page}`),
  };
}

export async function enrichSectionAssetWithLlm(
  base: AssetIntelligence,
  page: number,
  text: string,
  config?: AssetLlmConfig
): Promise<AssetIntelligence> {
  if (!hasLlmConfig(config) || text.trim().length < 80) return base;
  const prompt = `Classify this page or slide as a reusable proposal asset.

Return ONLY valid JSON with this schema:
{
  "sectionAssetType": one of ${SECTION_ASSET_TYPES.join(", ")},
  "industries": string[],
  "serviceLines": string[],
  "technologies": string[],
  "reusableFor": string[],
  "proofStrength": one of high, medium, low, none,
  "hasMetrics": boolean,
  "summary": "one sentence, source-grounded, max 180 characters"
}

Do not invent metrics or claims. Prefer "generic" when the section has no reusable proposal value.

Current document classification:
${JSON.stringify({
  documentAssetType: base.documentAssetType,
  industries: base.industries,
  serviceLines: base.serviceLines,
  technologies: base.technologies,
  reusableFor: base.reusableFor,
}, null, 2)}

Page or slide: ${page}
Text:
${text.slice(0, 4_000)}`;

  try {
    const parsed = await callAssetLlm(prompt, config);
    return {
      ...base,
      sectionAssetType: pickEnum(parsed.sectionAssetType, SECTION_ASSET_TYPES, base.sectionAssetType),
      industries: mergeLabels(base.industries, parsed.industries),
      serviceLines: mergeLabels(base.serviceLines, parsed.serviceLines),
      technologies: mergeLabels(base.technologies, parsed.technologies),
      reusableFor: mergeLabels(base.reusableFor, parsed.reusableFor),
      proofStrength: pickEnum(parsed.proofStrength, PROOF_STRENGTHS, base.proofStrength),
      hasMetrics: typeof parsed.hasMetrics === "boolean" ? parsed.hasMetrics : base.hasMetrics,
      summary: typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.replace(/\s+/g, " ").trim().slice(0, 220)
        : base.summary,
    };
  } catch {
    return base;
  }
}

function reusableForDocument(type: AssetType): string[] {
  switch (type) {
    case "rfp_response": return ["proposal_structure", "requirement_response", "win_theme"];
    case "proposal": return ["proposal_structure", "solution_approach", "delivery_model"];
    case "capability_deck": return ["capability_slide", "solution_approach", "differentiator"];
    case "case_study": return ["proof_point", "case_study", "outcome"];
    case "operating_model": return ["delivery_model", "governance"];
    case "solution_architecture": return ["solution_reference", "technical_approach"];
    case "commercial_pricing": return ["commercial_reference", "pricing_assumption"];
    case "research_report": return ["market_context", "client_context"];
    default: return ["reference"];
  }
}

function reusableForSection(type: SectionAssetType): string[] {
  switch (type) {
    case "executive_summary": return ["executive_summary", "win_theme"];
    case "capability": return ["capability_slide", "solution_approach"];
    case "case_study": return ["proof_point", "case_study"];
    case "operating_model": return ["delivery_model", "operating_model"];
    case "solution_architecture": return ["solution_reference", "technical_approach"];
    case "commercial_pricing": return ["commercial_reference", "pricing_assumption"];
    case "delivery_plan": return ["delivery_model", "implementation_plan"];
    case "governance": return ["governance", "risk_mitigation"];
    case "security_compliance": return ["security_response", "compliance_response"];
    case "requirement_response": return ["requirement_response", "compliance_matrix"];
    case "proof_point": return ["proof_point", "outcome"];
    default: return ["reference"];
  }
}

function proofStrength(text: string): AssetIntelligence["proofStrength"] {
  const lower = text.toLowerCase();
  if (metricPattern().test(text) && hasAny(lower, [/case stud/i, /outcome/i, /results?/i, /client/i, /customer/i])) return "high";
  if (metricPattern().test(text) || hasAny(lower, [/case stud/i, /outcome/i, /results?/i, /reference/i])) return "medium";
  if (hasAny(lower, [/capabilit/i, /approach/i, /framework/i])) return "low";
  return "none";
}

function metricPattern(): RegExp {
  return /(\d+(\.\d+)?\s?%|\$\s?\d+|\d+(\.\d+)?\s?(x|m|k|tb|gb|hrs?|hours?|days?|weeks?|months?))/i;
}

function hasLlmConfig(config?: AssetLlmConfig): config is AssetLlmConfig {
  if (!config) return false;
  if (config.aiProvider === "ollama") return Boolean(config.ollamaBaseUrl && config.ollamaModel);
  if (config.aiProvider === "openrouter") return Boolean(config.openrouterApiKey && config.openrouterModel);
  if (config.aiProvider === "gemini") return Boolean(config.geminiApiKey && config.geminiModel);
  return false;
}

async function callAssetLlm(prompt: string, config: AssetLlmConfig): Promise<Record<string, unknown>> {
  let content = "";
  if (config.aiProvider === "ollama") {
    const res = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        format: "json",
        options: { temperature: 0.1, num_predict: 700 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Asset LLM ${res.status}`);
    const data = await res.json();
    content = data.message?.content ?? data.response ?? "";
  } else {
    const [url, auth, model] = config.aiProvider === "gemini"
      ? ["https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", `Bearer ${config.geminiApiKey}`, config.geminiModel]
      : ["https://openrouter.ai/api/v1/chat/completions", `Bearer ${config.openrouterApiKey}`, config.openrouterModel];
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 700,
        ...(config.aiProvider === "gemini" ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Asset LLM ${res.status}`);
    const data = await res.json();
    content = data.choices?.[0]?.message?.content ?? "";
  }

  const json = extractJsonObject(content);
  return JSON.parse(json) as Record<string, unknown>;
}

function extractJsonObject(content: string): string {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function mergeLabels(base: string[] = [], incoming: unknown): string[] {
  const next = Array.isArray(incoming)
    ? incoming.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
  return [...new Set([...base, ...next])].slice(0, 12);
}
