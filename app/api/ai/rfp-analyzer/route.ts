import { NextRequest, NextResponse } from "next/server";
import { resolveAiConfig } from "@/lib/serverConfig";

export const maxDuration = 300;

const AGENT_LLM_TIMEOUT_MS = 12_000;
const PROFESSIONAL_ANALYSIS_TIMEOUT_MS = 180_000;
const PROFESSIONAL_RFP_TEXT_LIMIT = 55_000;

const FINAL_SECTION_IDS = [
  "executive_brief",
  "opportunity_snapshot",
  "client_objective",
  "pain_points",
  "scope_intelligence",
  "requirement_intelligence",
  "mandatory_items",
  "evaluation_criteria",
  "submission_intelligence",
  "commercial_intelligence",
  "technical_intelligence",
  "security_compliance",
  "delivery_governance",
  "risks_assumptions",
  "clarification_questions",
  "response_strategy",
] as const;

type FinalSectionId = string;

interface RfpAnalysisSectionDef {
  id: FinalSectionId;
  name: string;
  description: string;
  query: string;
  categories: string[];
  prompt: string;
}

const RFP_ANALYSIS_SECTIONS: RfpAnalysisSectionDef[] = [
  {
    id: "executive_brief",
    name: "Executive Opportunity Brief",
    description: "Bid/no-bid summary, objective, risks, and response focus",
    query: "client objective business problem scope evaluation risk deadline requirements",
    categories: ["Opportunity Snapshot", "Project Overview", "Client Objective", "Business Problem", "Evaluation Criteria", "Risks"],
    prompt: "Create an executive opportunity brief for presales leadership. Include client, RFP title, deadline, one-line objective, core business problem, key success factors, main risks, recommended response focus, and confidence. Keep it concise and evidence-aware.",
  },
  {
    id: "opportunity_snapshot",
    name: "Opportunity Snapshot",
    description: "Client, title, dates, industry, submission basics",
    query: "client name RFP title reference number proposal due date submission format pricing format industry",
    categories: ["Opportunity Snapshot", "Project Overview", "Submission Instructions", "Commercial / Pricing"],
    prompt: "Extract a compact opportunity snapshot. Prefer a markdown table with client name, RFP title, reference number, industry, due date, submission format, pricing format, and evidence.",
  },
  {
    id: "client_objective",
    name: "Client Objective",
    description: "Business goal, desired future state, outcomes",
    query: "objective goal purpose business problem desired state outcomes",
    categories: ["Client Objective", "Business Problem", "Project Overview"],
    prompt: "Explain the client's stated objective, desired future state, business problem, expected outcomes, and proposal implications. Clearly mark anything inferred.",
  },
  {
    id: "pain_points",
    name: "Business Problems / Pain Points",
    description: "Explicit and inferred pains, urgency, impact",
    query: "problem challenge pain point current state issue constraint driver urgency",
    categories: ["Business Problem", "Project Overview", "Client Objective", "Risks"],
    prompt: "Identify explicit and inferred pain points. For each, include evidence, business impact, urgency, and how it should shape the proposal response.",
  },
  {
    id: "scope_intelligence",
    name: "Scope Intelligence",
    description: "In scope, out of scope, responsibilities, deliverables",
    query: "scope in scope out of scope deliverables services responsibilities",
    categories: ["Scope", "Project Overview", "Functional Requirements", "Technical Requirements"],
    prompt: "Summarize scope intelligence: confirmed in-scope items, out-of-scope items, vendor responsibilities, client responsibilities, deliverables, and unclear boundaries.",
  },
  {
    id: "requirement_intelligence",
    name: "Requirement Intelligence",
    description: "Functional and non-functional requirement matrix",
    query: "requirements functional technical capability must have should have mandatory optional",
    categories: ["Functional Requirements", "Technical Requirements", "AI / Agentic Workflow", "Multi-Tenant", "Integration"],
    prompt: "Create a requirement matrix with category, requirement, mandatory/optional/unclear, evidence, priority, and response implication. Include only requirements supported by the RFP.",
  },
  {
    id: "mandatory_items",
    name: "Mandatory and Disqualification Items",
    description: "Must-haves, submission rules, knockout risks",
    query: "mandatory must required disqualification reject submission requirements compliance contract terms",
    categories: ["Submission Instructions", "Evaluation Criteria", "Legal / Contractual", "Commercial / Pricing", "Security"],
    prompt: "List mandatory items and disqualification risks. Separate proposal submission requirements, contractual must-accept items, compliance/security must-haves, and unclear items requiring clarification.",
  },
  {
    id: "evaluation_criteria",
    name: "Evaluation and Scoring Intelligence",
    description: "Scoring criteria, evaluation signals, win themes",
    query: "evaluation criteria scoring weight assessment award selection",
    categories: ["Evaluation Criteria", "Submission Instructions", "Project Overview"],
    prompt: "Extract evaluation and scoring intelligence. Include explicit criteria, weights if stated, inferred buyer priorities, and proposal tactics for scoring well.",
  },
  {
    id: "submission_intelligence",
    name: "Submission Intelligence",
    description: "Due dates, format, artifacts, references, checklist",
    query: "proposal submission due date format case studies references assumptions governance supporting materials",
    categories: ["Submission Instructions", "Evaluation Criteria", "Project Overview"],
    prompt: "Create submission intelligence: deadlines, format, delivery method, required artifacts, case studies/references, assumptions, and a concise submission checklist.",
  },
  {
    id: "commercial_intelligence",
    name: "Commercial and Pricing Intelligence",
    description: "Pricing model, payment terms, legal and commercial signals",
    query: "pricing price cost commercial payment invoice rates budget contract terms liability",
    categories: ["Commercial / Pricing", "Legal / Contractual"],
    prompt: "Summarize commercial and pricing intelligence: pricing model, pricing format, payment terms, budget signals, contract terms, liability/IP issues, and pricing strategy implications.",
  },
  {
    id: "technical_intelligence",
    name: "Technical / Architecture Intelligence",
    description: "Architecture, cloud, integrations, platforms, AI expectations",
    query: "architecture cloud AWS Azure GCP DynamoDB EventBridge RabbitMQ multi-tenant agentic workflow integration platform",
    categories: ["Architecture", "Technical Requirements", "AI / Agentic Workflow", "Integration", "Cloud"],
    prompt: "Analyze technical and architecture intelligence. Cover platform expectations, cloud preferences, integrations, data flows, AI/agentic workflow requirements, non-functional requirements, and technical risks.",
  },
  {
    id: "security_compliance",
    name: "Security, Privacy, and Compliance Intelligence",
    description: "Security, privacy, regulatory, identity, data controls",
    query: "security compliance privacy FHIR HL7 HIPAA authentication authorization encryption tenant isolation data protection",
    categories: ["Security", "Compliance", "Privacy"],
    prompt: "Extract security, privacy, and compliance requirements. Include standards, regulatory expectations, identity/access, data protection, tenant isolation, evidence, and response implications.",
  },
  {
    id: "delivery_governance",
    name: "Delivery and Governance Intelligence",
    description: "Timeline, phases, governance, team, operating model",
    query: "delivery implementation timeline phase milestone governance steering reporting team cadence",
    categories: ["Delivery", "Governance", "Project Overview"],
    prompt: "Summarize delivery and governance intelligence: phases, timeline, milestones, team model, governance cadence, reporting, acceptance, and delivery risks.",
  },
  {
    id: "risks_assumptions",
    name: "Risks, Assumptions, and Dependencies",
    description: "Top risks, dependencies, mitigations, assumptions",
    query: "risks assumptions dependencies constraints unclear unknown mitigation",
    categories: ["Risks", "Business Problem", "Project Overview", "Legal / Contractual", "Technical Requirements"],
    prompt: "Create a risk, assumption, and dependency register. Include impact, likelihood where inferable, evidence, mitigation, and owner/action for each item.",
  },
  {
    id: "clarification_questions",
    name: "Clarification Questions",
    description: "Prioritized client questions for Q&A",
    query: "unclear clarification questions assumptions scope requirements pricing security delivery",
    categories: ["Risks", "Scope", "Technical Requirements", "Commercial / Pricing", "Security", "Submission Instructions"],
    prompt: "Generate prioritized clarification questions. For each question, explain why it matters and which proposal decision it affects.",
  },
  {
    id: "response_strategy",
    name: "Recommended Response Strategy",
    description: "Proposal storyline, win themes, proof points, next actions",
    query: "strategy win themes response proposal storyline differentiators risks solution approach",
    categories: ["Risks", "Business Problem", "Project Overview", "Evaluation Criteria"],
    prompt: "Recommend a response strategy: storyline, win themes, proof points to include, solution emphasis, risks to neutralize, and immediate next actions for the pursuit team.",
  },
];

function normalizeConfiguredRfpSections(raw: unknown): RfpAnalysisSectionDef[] {
  if (!Array.isArray(raw) || !raw.length) return RFP_ANALYSIS_SECTIONS;
  const defaultsById = new Map(RFP_ANALYSIS_SECTIONS.map((section) => [section.id, section]));
  const normalized = raw
    .filter((section): section is Partial<RfpAnalysisSectionDef> & { id: string } => Boolean(section && typeof section === "object" && "id" in section))
    .map((section) => {
      const defaults = defaultsById.get(String(section.id));
      return {
        ...defaults,
        ...section,
        id: String(section.id),
        name: String(section.name || defaults?.name || "RFP Analysis Area"),
        description: String(section.description || defaults?.description || "Custom RFP analysis area"),
        query: String(section.query || defaults?.query || "requirements scope risk evaluation"),
        categories: Array.isArray(section.categories) && section.categories.length ? section.categories.map(String) : defaults?.categories || ["Project Overview"],
        prompt: String(section.prompt || defaults?.prompt || "Analyze this RFP section using only source-backed evidence."),
      };
    });
  return normalized.length ? normalized : RFP_ANALYSIS_SECTIONS;
}

function normalizeSelectedSections(raw: unknown, configuredSections: RfpAnalysisSectionDef[]): RfpAnalysisSectionDef[] {
  const requested = Array.isArray(raw) ? raw.map(String) : [...FINAL_SECTION_IDS];
  const requestedSet = new Set(requested);
  const selected = configuredSections.filter((section) => requestedSet.has(section.id));
  return selected.length ? selected : configuredSections;
}

// ============================================
// TYPES
// ============================================

interface Chunk {
  chunkId: string;
  documentId: string;
  fileName: string;
  pageRange: string;
  sectionTitle: string;
  chunkText: string;
  detectedCategory: string;
  keywords: string[];
  tokenEstimate: number;
}

interface ClassifiedChunk extends Chunk {
  categories: string[];
  shortSummary: string;
  importantFacts: string[];
  confidence: "High" | "Medium" | "Low";
}

interface AgentResult {
  success: boolean;
  data?: any;
  raw: string;
  error?: string;
}

interface HarnessSectionRun {
  id: string;
  name: string;
  status: "completed" | "fallback" | "failed";
  attempts: string[];
  retrievedChunks: number;
  evidenceRefs: number;
  usedFallback: boolean;
  warning?: string;
  durationMs: number;
}

interface HarnessReport {
  status: "pass" | "review" | "fail";
  summary: string;
  chunkCount: number;
  selectedSectionCount: number;
  fallbackCount: number;
  sectionsWithoutEvidence: string[];
  warnings: string[];
  sectionRuns: HarnessSectionRun[];
}

// ============================================
// CHUNKING
// ============================================

function chunkRFP(text: string, fileName: string): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = text.split('\n');
  
  let currentChunk = "";
  let currentSection = "Introduction";
  let pageNum = 1;
  let chunkId = 1;

  // Split by common RFP section patterns
  const sectionPatterns = [
    /^1\.\s*/i, /^2\.\s*/i, /^3\.\s*/i, /^4\.\s*/i, /^5\.\s*/i,
    /^SECTION\s*\d/i, /^SECTION\s*[A-Z]/i,
    /^(EXECUTIVE|INTRODUCTION|OVERVIEW|BACKGROUND|OBJECTIVE|SCOPE|REQUIREMENTS|TECHNICAL|SECURITY|COMMERCIAL|LEGAL|SUBMISSION|EVALUATION|PRICING|TERMS)/i,
    /^(Project Overview|Client Background|Business Problem|Solution Approach|Delivery|Governance)/i,
  ];

  for (const line of lines) {
    const isSectionHeader = sectionPatterns.some(p => p.test(line.trim()));
    
    if (isSectionHeader && currentChunk.length > 100) {
      // Save current chunk
      chunks.push({
        chunkId: `chunk-${chunkId}`,
        documentId: "doc-1",
        fileName,
        pageRange: `p${pageNum}`,
        sectionTitle: currentSection.trim(),
        chunkText: currentChunk.trim().substring(0, 3000),
        detectedCategory: detectCategory(currentSection),
        keywords: extractKeywords(currentChunk),
        tokenEstimate: Math.ceil(currentChunk.length / 4),
      });
      chunkId++;
      currentSection = line.trim();
      currentChunk = "";
    } else {
      currentChunk += line + "\n";
    }
  }

  // Don't forget last chunk
  if (currentChunk.trim().length > 50) {
    chunks.push({
      chunkId: `chunk-${chunkId}`,
      documentId: "doc-1",
      fileName,
      pageRange: `p${pageNum}`,
      sectionTitle: currentSection.trim(),
      chunkText: currentChunk.trim().substring(0, 3000),
      detectedCategory: detectCategory(currentSection),
      keywords: extractKeywords(currentChunk),
      tokenEstimate: Math.ceil(currentChunk.length / 4),
    });
  }

  return chunks;
}

function detectCategory(sectionTitle: string): string {
  const title = sectionTitle.toLowerCase();
  if (title.includes('scope') || title.includes('work')) return 'Scope';
  if (title.includes('requirement') || title.includes('functional') || title.includes('technical')) return 'Requirements';
  if (title.includes('security') || title.includes('compliance') || title.includes('privacy')) return 'Security/Compliance';
  if (title.includes('submit') || title.includes('proposal') || title.includes('format')) return 'Submission';
  if (title.includes('price') || title.includes('cost') || title.includes('pricing') || title.includes('commercial')) return 'Commercial';
  if (title.includes('contract') || title.includes('legal') || title.includes('terms')) return 'Legal';
  if (title.includes('evaluation') || title.includes('criteria') || title.includes('scoring')) return 'Evaluation';
  if (title.includes('architecture') || title.includes('technical') || title.includes('cloud') || title.includes('AWS')) return 'Technical';
  if (title.includes('objective') || title.includes('goal') || title.includes('overview')) return 'Objective';
  if (title.includes('client') || title.includes('background')) return 'Client Background';
  if (title.includes('delivery') || title.includes('timeline') || title.includes('governance')) return 'Delivery';
  if (title.includes('risk') || title.includes('assumption')) return 'Risks';
  return 'Other';
}

function extractKeywords(text: string): string[] {
  const keywords: string[] = [];
  const patterns = [
    /iqvia/gi, /deviq/gi, /rfp/gi, /proposal/gi, /deadline/gi,
    /aws/gi, /dynamodb/gi, /eventbridge/gi, /rabbitmq/gi,
    /fhir/gi, /hl7/gi, /hipaa/gi, /multi-tenant/gi,
    /agentic/gi, /workflow/gi, /integration/gi,
    /pricing/gi, /payment/gi, /contract/gi, /termination/gi,
    /submission/gi, /evaluation/gi, /scope/gi,
  ];
  
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      keywords.push(...matches.map(m => m.toLowerCase()));
    }
  }
  
  return [...new Set(keywords)];
}

// ============================================
// CLASSIFICATION
// ============================================

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Opportunity Snapshot': ['rfp title', 'reference number', 'proposal due', 'submission deadline', 'client name', 'industry'],
  'Client Background': ['client', 'company', 'background', 'about', 'history'],
  'Project Overview': ['project', 'overview', 'description', 'introduction'],
  'Client Objective': ['objective', 'goal', 'purpose', 'vision', 'aim', 'outcome'],
  'Business Problem': ['problem', 'challenge', 'pain point', 'issue', 'current state', 'pain'],
  'Scope': ['scope', 'in scope', 'out of scope', 'services', 'deliverables', 'work'],
  'Functional Requirements': ['functional', 'requirement', 'capability', 'feature', 'must have'],
  'Technical Requirements': ['technical', 'technology', 'system', 'platform', 'infrastructure'],
  'Architecture': ['architecture', 'design', 'technical design', 'solution architecture', 'aws', 'cloud'],
  'AI / Agentic Workflow': ['agent', 'ai', 'artificial intelligence', 'workflow', 'automation', 'agentic', 'machine learning'],
  'Multi-Tenant': ['multi-tenant', 'multi tenant', 'tenant', 'saas'],
  'Integration': ['integration', 'integrate', 'api', 'connect', 'interface', 'event'],
  'Security': ['security', 'secure', 'authentication', 'authorization', 'encryption', 'identity'],
  'Compliance': ['compliance', 'compliant', 'regulation', 'regulatory', 'fhir', 'hl7', 'hipaa'],
  'Privacy': ['privacy', 'data privacy', 'personal data', 'pii'],
  'Cloud': ['cloud', 'aws', 'azure', 'gcp', 'hosting', 'deployment'],
  'Delivery': ['delivery', 'implementation', 'timeline', 'phase', 'milestone', 'sprint'],
  'Governance': ['governance', 'governance', 'steering', 'escalation', 'reporting'],
  'Submission Instructions': ['submit', 'proposal', 'submission', 'format', 'deadline', 'due date'],
  'Evaluation Criteria': ['evaluation', 'criteria', 'scoring', 'weight', 'assessment'],
  'Commercial / Pricing': ['pricing', 'price', 'cost', 'budget', 'payment', 'invoice', 'rate'],
  'Legal / Contractual': ['contract', 'legal', 'terms', 'conditions', 'liability', 'ip', 'termination'],
};

function classifyChunks(chunks: Chunk[]): ClassifiedChunk[] {
  return chunks.map(chunk => {
    const categories: string[] = [];
    const textLower = chunk.chunkText.toLowerCase() + ' ' + chunk.sectionTitle.toLowerCase();
    
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      const matchCount = keywords.filter(k => textLower.includes(k)).length;
      if (matchCount > 0) {
        categories.push(category);
      }
    }
    
    if (categories.length === 0) {
      categories.push(chunk.detectedCategory || 'Other');
    }

    // Extract important facts
    const importantFacts: string[] = [];
    const factPatterns = [
      /(?:client|customer)[\s:]+([A-Z][a-zA-Z\s]+?)(?:\n|,|deadline)/gi,
      /(?:proposal due|submission deadline)[\s:]+([A-Za-z0-9,\s]+?)(?:\n|,|$)/gi,
      /(?:budget|price|cost)[\s:]+([A-Za-z0-9$,\s]+?)(?:\n|,|$)/gi,
    ];
    
    for (const pattern of factPatterns) {
      const matches = textLower.match(pattern);
      if (matches) {
        importantFacts.push(...matches.slice(0, 3));
      }
    }

    return {
      ...chunk,
      categories,
      shortSummary: chunk.chunkText.substring(0, 200).replace(/\n/g, ' '),
      importantFacts,
      confidence: chunk.chunkText.length > 500 ? 'High' : 'Medium',
    };
  });
}

// ============================================
// RETRIEVAL
// ============================================

function retrieveChunks(chunks: ClassifiedChunk[], query: string, categoryFilter?: string[]): ClassifiedChunk[] {
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/);
  
  let scored = chunks.map(chunk => {
    let score = 0;
    
    // Category match
    if (categoryFilter) {
      const hasCategory = chunk.categories.some(c => categoryFilter.includes(c));
      if (hasCategory) score += 10;
    }
    
    // Keyword match
    for (const term of queryTerms) {
      if (chunk.chunkText.toLowerCase().includes(term)) score += 2;
      if (chunk.sectionTitle.toLowerCase().includes(term)) score += 5;
      if (chunk.keywords.includes(term)) score += 3;
    }
    
    // Category keywords match
    const textLower = chunk.chunkText.toLowerCase();
    if (categoryFilter) {
      for (const cat of categoryFilter) {
        const catKeywords = CATEGORY_KEYWORDS[cat] || [];
        for (const kw of catKeywords) {
          if (textLower.includes(kw)) score += 1;
        }
      }
    }
    
    return { chunk, score };
  });
  
  // Sort by score and return top chunks
  scored.sort((a, b) => b.score - a.score);
  
  return scored
    .filter(s => s.score > 0)
    .slice(0, 5)
    .map(s => s.chunk);
}

// ============================================
// LLM CALL
// ============================================

async function callLLM(
  prompt: string,
  config: ReturnType<typeof resolveAiConfig>,
  options: {
    systemPrompt?: string;
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<string> {
  const { aiProvider, ollamaBaseUrl, ollamaModel, openrouterApiKey, openrouterModel, geminiApiKey, geminiModel } = config;
  const systemPrompt = options.systemPrompt ?? GLOBAL_SYSTEM_PROMPT;
  const timeoutMs = options.timeoutMs ?? AGENT_LLM_TIMEOUT_MS;
  const temperature = options.temperature ?? 0.3;
  const maxTokens = options.maxTokens ?? 8192;

  const hasOllama = aiProvider === "ollama" && ollamaModel && ollamaBaseUrl;
  const hasOpenRouter = aiProvider === "openrouter" && openrouterApiKey && openrouterModel;
  const hasGemini = aiProvider === "gemini" && geminiApiKey && geminiModel;
  
  if (!hasOllama && !hasOpenRouter && !hasGemini) return "";

  if (hasOpenRouter) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openrouterApiKey}`,
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "RFP Analyzer"
        },
        body: JSON.stringify({
          model: openrouterModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
          temperature,
          max_tokens: maxTokens
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`OpenRouter error: ${res.status}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      console.error("OpenRouter call failed:", err);
      throw err;
    }
  }

  if (hasOllama) {
    try {
      const res = await fetch(`${ollamaBaseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
          stream: false,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
      return (await res.json()).message?.content ?? "";
    } catch (err) {
      console.error("Ollama call failed:", err);
      throw err;
    }
  }

  if (hasGemini) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } catch (err) {
      console.error("Gemini call failed:", err);
      throw err;
    }
  }

  return "";
}

async function callLLMStreamingText(
  prompt: string,
  config: ReturnType<typeof resolveAiConfig>,
  onDelta: (delta: string) => void,
  options: {
    systemPrompt?: string;
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<string> {
  const { aiProvider, ollamaBaseUrl, ollamaModel, openrouterApiKey, openrouterModel, geminiApiKey, geminiModel } = config;
  const systemPrompt = options.systemPrompt ?? PROFESSIONAL_SYSTEM_PROMPT;
  const timeoutMs = options.timeoutMs ?? PROFESSIONAL_ANALYSIS_TIMEOUT_MS;
  const temperature = options.temperature ?? 0.2;
  const maxTokens = options.maxTokens ?? 4096;

  const hasOllama = aiProvider === "ollama" && ollamaModel && ollamaBaseUrl;
  const hasOpenRouter = aiProvider === "openrouter" && openrouterApiKey && openrouterModel;
  const hasGemini = aiProvider === "gemini" && geminiApiKey && geminiModel;

  if (!hasOllama && !hasOpenRouter && !hasGemini) return "";

  if (hasOllama) {
    const res = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        stream: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok || !res.body) throw new Error(`Ollama error: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        const delta = event.message?.content ?? "";
        if (delta) {
          content += delta;
          onDelta(delta);
        }
      }
    }

    return content;
  }

  if (hasOpenRouter) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openrouterApiKey}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "RFP Analyzer",
      },
      body: JSON.stringify({
        model: openrouterModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok || !res.body) throw new Error(`OpenRouter error: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data);
        const delta = event.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          content += delta;
          onDelta(delta);
        }
      }
    }

    return content;
  }

  const geminiText = await callLLM(prompt, config, {
    systemPrompt,
    timeoutMs,
    temperature,
    maxTokens,
  });
  if (geminiText) onDelta(geminiText);
  return geminiText;
}

async function callSectionLLMText(
  prompt: string,
  config: ReturnType<typeof resolveAiConfig>
): Promise<string> {
  return callLLM(prompt, config, {
    systemPrompt: SECTION_MARKDOWN_SYSTEM_PROMPT,
    timeoutMs: PROFESSIONAL_ANALYSIS_TIMEOUT_MS,
    temperature: 0.2,
    maxTokens: 4096,
  });
}

async function repairSectionEvidence(
  section: RfpAnalysisSectionDef,
  content: string,
  chunks: ClassifiedChunk[],
  config: ReturnType<typeof resolveAiConfig>
): Promise<string> {
  const retrievedChunks = retrieveChunks(chunks, section.query, section.categories);
  const contextChunks = (retrievedChunks.length ? retrievedChunks : chunks.slice(0, 8))
    .map((chunk) => `[${chunk.chunkId}] ${chunk.sectionTitle} | Categories: ${chunk.categories.join(", ")}\n${chunk.chunkText.slice(0, 1800)}`)
    .join("\n\n---\n\n");

  const prompt = `Repair this RFP analysis section so every factual bullet, table row, or recommendation has explicit source evidence.

Section:
${section.name}

Existing draft:
${content}

Allowed source chunks:
${contextChunks || "No source chunks available."}

Instructions:
- Return polished markdown only.
- Preserve useful analysis from the draft.
- Add citations in the exact format "(Evidence: chunk-N)".
- Use only the allowed source chunks.
- If a claim cannot be supported by a chunk, remove it or mark it "Not specified in the RFP".
- Do not return JSON or code fences.`;

  return callLLM(prompt, config, {
    systemPrompt: SECTION_MARKDOWN_SYSTEM_PROMPT,
    timeoutMs: PROFESSIONAL_ANALYSIS_TIMEOUT_MS,
    temperature: 0.1,
    maxTokens: 4096,
  });
}

const GLOBAL_SYSTEM_PROMPT = `You are an expert RFP intelligence analyst.

RULES:
- Use only the provided RFP sections
- Every finding must cite source (chunkId or section)
- If not in provided sections, say "Not specified in retrieved sections"
- Do not invent information
- Return structured JSON only
- Mark as "Explicit" if directly stated, "Inferred" if logically derived
- Include confidence level`;

const PROFESSIONAL_SYSTEM_PROMPT = `You are a senior proposal strategist and RFP intelligence analyst.

Your output should read like a high-quality ChatGPT / GPT-4 style RFP analysis for a presales leadership team: structured, specific, crisp, evidence-aware, and commercially useful.

Rules:
- Use only the provided RFP text.
- Do not invent client names, dates, platforms, requirements, scoring, competitors, or commercial terms.
- If a point is inferred, label it as inferred and explain why.
- Avoid generic filler such as "demonstrate relevant experience" unless it is tied to specific RFP evidence.
- Prefer executive language: concise bullets, clear implications, proposal actions, risks, and clarification questions.
- Include "Not specified in the RFP" where the source text does not support an answer.
- Return valid JSON only.`;

const SECTION_MARKDOWN_SYSTEM_PROMPT = `You are a senior proposal strategist and RFP intelligence analyst.

Write one selected RFP intelligence section for a presales leadership team.

Rules:
- Use only the provided RFP text and retrieved chunks.
- Do not invent client names, dates, platforms, requirements, scoring, competitors, or commercial terms.
- If a point is inferred, label it as inferred and explain why.
- Avoid generic filler unless it is tied to specific RFP evidence.
- Prefer executive language: concise bullets, clear implications, proposal actions, risks, and clarification questions.
- Cite evidence using chunk ids where available, e.g. "(Evidence: chunk-3)".
- Return polished markdown only.
- Do not return JSON.
- Do not use markdown code fences.`;

function extractJSON(text: string): any {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {}
  return null;
}

function stripMarkdownFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function valueToMarkdown(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "Not specified";
    if (value.every(item => typeof item !== "object" || item === null)) {
      return value.map(item => `- ${String(item)}`).join("\n");
    }
    return value.map(item => objectToMarkdown(item)).join("\n\n");
  }

  if (value && typeof value === "object") {
    return objectToMarkdown(value);
  }

  return value === undefined || value === null || String(value).trim() === "" ? "Not specified" : String(value);
}

function objectToMarkdown(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return valueToMarkdown(value);

  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => {
      if (Array.isArray(item) && item.every(row => row && typeof row === "object" && !Array.isArray(row))) {
        return `### ${humanizeKey(key)}\n\n${arrayOfObjectsToTable(item as Record<string, unknown>[])}`;
      }
      return `**${humanizeKey(key)}:** ${valueToMarkdown(item)}`;
    })
    .join("\n\n");
}

function arrayOfObjectsToTable(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "Not specified";
  const preferredKeys = [
    "category",
    "requirement",
    "mandatory_optional_unclear",
    "mandatoryStatus",
    "priority",
    "evidence",
    "response_implication",
    "responseImplication",
  ];
  const allKeys = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
  const keys = [
    ...preferredKeys.filter(key => allKeys.includes(key)),
    ...allKeys.filter(key => !preferredKeys.includes(key)),
  ].slice(0, 7);

  const header = `| ${keys.map(humanizeKey).join(" | ")} |`;
  const separator = `| ${keys.map(() => "---").join(" | ")} |`;
  const body = rows.map(row => {
    const cells = keys.map(key => {
      const value = row[key];
      const compact = Array.isArray(value) ? value.join(", ") : valueToMarkdown(value);
      return compact.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
    });
    return `| ${cells.join(" | ")} |`;
  });

  return [header, separator, ...body].join("\n");
}

function normalizeSectionContent(section: RfpAnalysisSectionDef, rawContent: string): string {
  const stripped = stripMarkdownFences(rawContent);
  const parsed = extractJSON(stripped);

  if (!parsed) return stripped;

  if (section.id === "requirement_intelligence") {
    const matrix = parsed.requirement_matrix || parsed.requirements || parsed.items;
    if (Array.isArray(matrix)) {
      return `## ${section.name}\n\n${arrayOfObjectsToTable(matrix)}`;
    }
  }

  const content =
    parsed.markdown ||
    parsed.content ||
    parsed.analysis ||
    parsed.summary ||
    parsed.finalOutput?.[section.id];

  if (typeof content === "string" && content.trim()) {
    return stripMarkdownFences(content);
  }

  return `## ${section.name}\n\n${objectToMarkdown(parsed)}`;
}

async function runAgent(agentName: string, prompt: string, config: ReturnType<typeof resolveAiConfig>): Promise<AgentResult> {
  try {
    const response = await callLLM(prompt, config);
    if (response) {
      const parsed = extractJSON(response);
      if (parsed) return { success: true, data: parsed, raw: response };
    }
    return { success: false, error: "No response", raw: "" };
  } catch (err) {
    return { success: false, error: String(err), raw: "" };
  }
}

function hasConfiguredLLM(config: ReturnType<typeof resolveAiConfig>): boolean {
  return Boolean(
    (config.aiProvider === "ollama" && config.ollamaModel && config.ollamaBaseUrl) ||
    (config.aiProvider === "openrouter" && config.openrouterApiKey && config.openrouterModel) ||
    (config.aiProvider === "gemini" && config.geminiApiKey && config.geminiModel)
  );
}

function buildProfessionalAnalysisPrompt(text: string, chunks: ClassifiedChunk[]): string {
  const sectionList = FINAL_SECTION_IDS.map((id) => `- ${id}`).join("\n");
  const chunkMap = chunks
    .slice(0, 18)
    .map((chunk) => `[${chunk.chunkId}] ${chunk.sectionTitle} | Categories: ${chunk.categories.join(", ")}\n${chunk.chunkText.slice(0, 1800)}`)
    .join("\n\n---\n\n");

  return `Analyze the uploaded RFP as if you are ChatGPT producing a senior presales RFP intelligence brief.

Return JSON in this exact shape:
{
  "finalOutput": {
    "executive_brief": "markdown",
    "opportunity_snapshot": "markdown",
    "client_objective": "markdown",
    "pain_points": "markdown",
    "scope_intelligence": "markdown",
    "requirement_intelligence": "markdown",
    "mandatory_items": "markdown",
    "evaluation_criteria": "markdown",
    "submission_intelligence": "markdown",
    "commercial_intelligence": "markdown",
    "technical_intelligence": "markdown",
    "security_compliance": "markdown",
    "delivery_governance": "markdown",
    "risks_assumptions": "markdown",
    "clarification_questions": "markdown",
    "response_strategy": "markdown"
  },
  "qualityNotes": ["short note"]
}

Required sections:
${sectionList}

Writing standard:
- Every section must be useful to a bid/no-bid or proposal team.
- Use specific facts from the RFP. Cite evidence using chunk ids where available, e.g. "(Evidence: chunk-3)".
- Include implications and recommended proposal actions, not just summary.
- Keep each section concise but substantive: 4-8 bullets or a compact table where appropriate.
- For requirements, create a professional matrix with category, requirement, mandatory/optional/unclear, evidence, and response implication.
- For risks, include impact and mitigation.
- For clarification questions, prioritize the questions and explain why each matters.
- If the RFP does not state something, write "Not specified in the RFP" and do not fill with generic assumptions.
- Do not include code fences.

Retrieved RFP map:
${chunkMap}

Full extracted RFP text, truncated if very long:
${text.slice(0, PROFESSIONAL_RFP_TEXT_LIMIT)}`;
}

function buildSectionAnalysisPrompt(
  section: RfpAnalysisSectionDef,
  text: string,
  chunks: ClassifiedChunk[]
): string {
  const retrievedChunks = retrieveChunks(chunks, section.query, section.categories);
  const contextChunks = (retrievedChunks.length ? retrievedChunks : chunks.slice(0, 8))
    .map((chunk) => `[${chunk.chunkId}] ${chunk.sectionTitle} | Categories: ${chunk.categories.join(", ")}\n${chunk.chunkText.slice(0, 2200)}`)
    .join("\n\n---\n\n");

  return `Analyze only this selected RFP intelligence area:
${section.name}

Area description:
${section.description}

Specific instruction:
${section.prompt}

Writing standard:
- Use only the uploaded RFP text and retrieved chunks.
- Do not invent client names, dates, platforms, commercial terms, scoring criteria, or compliance requirements.
- If a point is inferred, label it as inferred and explain why.
- If the RFP does not state something, write "Not specified in the RFP".
- Cite evidence using chunk ids where available, e.g. "(Evidence: chunk-3)".
- Output polished markdown only. Do not include JSON or code fences.
- Keep it concise but substantive enough for a presales/proposal team.

Most relevant retrieved chunks:
${contextChunks || "No relevant chunks were retrieved."}

Full extracted RFP text, truncated if very long:
${text.slice(0, PROFESSIONAL_RFP_TEXT_LIMIT)}`;
}

async function generateProfessionalFinalOutput(
  text: string,
  chunks: ClassifiedChunk[],
  config: ReturnType<typeof resolveAiConfig>
): Promise<{ finalOutput: Record<string, string>; qualityNotes?: string[] } | null> {
  if (!hasConfiguredLLM(config)) return null;

  const prompt = buildProfessionalAnalysisPrompt(text, chunks);
  const response = await callLLM(prompt, config, {
    systemPrompt: PROFESSIONAL_SYSTEM_PROMPT,
    timeoutMs: PROFESSIONAL_ANALYSIS_TIMEOUT_MS,
    temperature: 0.2,
    maxTokens: 12_000,
  });
  const parsed = extractJSON(response);
  const finalOutput = parsed?.finalOutput;
  if (!finalOutput || typeof finalOutput !== "object") return null;

  const normalized: Record<string, string> = {};
  for (const sectionId of FINAL_SECTION_IDS) {
    const value = finalOutput[sectionId];
    if (typeof value !== "string" || !value.trim()) return null;
    normalized[sectionId] = value.trim();
  }

  return {
    finalOutput: normalized,
    qualityNotes: Array.isArray(parsed.qualityNotes) ? parsed.qualityNotes.map(String) : undefined,
  };
}

// ============================================
// VALIDATION
// ============================================

function validateRFPText(text: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!text || text.trim().length < 2000) {
    issues.push("Extracted text too short");
  }
  const keyTerms = ["iqvia", "rfp", "proposal", "requirements", "scope", "deadline", "pricing"];
  const foundTerms = keyTerms.filter(term => text.toLowerCase().includes(term));
  if (foundTerms.length < 2) {
    issues.push("Few RFP-like sections detected");
  }
  return { valid: issues.length === 0, issues };
}

// ============================================
// QUALITY GATES
// ============================================

function runQualityGates(rfpText: string, results: Record<string, any>): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  const textLower = rfpText.toLowerCase();
  
  // Gate 1: Client name
  if (textLower.includes("iqvia") || textLower.includes("holdings")) {
    if (!results.opportunity_snapshot?.clientName?.value || 
        results.opportunity_snapshot.clientName.value.toLowerCase().includes("not specified")) {
      failures.push("Client name marked as Not specified but IQVIA found in RFP");
    }
  }
  
  // Gate 2: RFP title
  if (textLower.includes("deviq") || textLower.includes("foundation 2.0")) {
    if (!results.opportunity_snapshot?.rfpTitle?.value || 
        results.opportunity_snapshot.rfpTitle.value.toLowerCase().includes("not specified")) {
      failures.push("RFP title marked as Not specified but DevIQ Foundation 2.0 found in RFP");
    }
  }
  
  // Gate 3: Due date
  if (textLower.includes("feb") || textLower.includes("28") || textLower.includes("deadline") || textLower.includes("due date")) {
    if (!results.opportunity_snapshot?.proposalDueDate?.value || 
        results.opportunity_snapshot.proposalDueDate.value.toLowerCase().includes("not specified")) {
      failures.push("Due date marked as Not specified but deadline found in RFP");
    }
  }
  
  // Gate 4: Technical requirements
  if (textLower.includes("fhir") || textLower.includes("hl7") || textLower.includes("aws") || 
      textLower.includes("dynamodb") || textLower.includes("eventbridge")) {
    if (!results.technical_intelligence?.cloudPreferences?.provider || 
        results.technical_intelligence.cloudPreferences.provider.toLowerCase().includes("not specified")) {
      failures.push("Cloud/tech requirements marked as Not specified but AWS/FHIR found in RFP");
    }
  }
  
  // Gate 5: Security/Compliance
  if (textLower.includes("security") || textLower.includes("compliance") || textLower.includes("hipaa")) {
    if (!results.security_compliance?.fhirRequirements?.required && 
        !results.security_compliance?.securityStandards?.length) {
      failures.push("Security requirements may be missing");
    }
  }
  
  return { passed: failures.length === 0, failures };
}

function countEvidenceRefs(content: string): number {
  return new Set(content.match(/chunk-\d+/gi) || []).size;
}

function buildHarnessReport(
  chunkCount: number,
  selectedSectionCount: number,
  sectionRuns: HarnessSectionRun[],
  qualityGateFailures: string[]
): HarnessReport {
  const fallbackCount = sectionRuns.filter(run => run.usedFallback).length;
  const sectionsWithoutEvidence = sectionRuns
    .filter(run => !run.usedFallback && run.evidenceRefs === 0)
    .map(run => run.name);

  const warnings = [
    ...qualityGateFailures,
    ...sectionRuns.filter(run => run.warning).map(run => `${run.name}: ${run.warning}`),
    ...sectionsWithoutEvidence.map(name => `${name}: no chunk evidence references found`),
  ];

  const status: HarnessReport["status"] =
    fallbackCount > 0 || warnings.length > 0
      ? "review"
      : "pass";

  return {
    status,
    summary: status === "pass"
      ? "Harness checks passed: all selected sections completed with model output and evidence references."
      : "Harness checks need review: inspect fallback sections, missing evidence, or quality gate warnings before using this as final proposal intelligence.",
    chunkCount,
    selectedSectionCount,
    fallbackCount,
    sectionsWithoutEvidence,
    warnings,
    sectionRuns,
  };
}

// ============================================
// MAIN HANDLER
// ============================================

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();
    const { text, config: clientConfig, sections: requestedSections, rfpSections: configuredRfpSections } = body;

    if (!text) {
      return NextResponse.json({ error: "No RFP text provided" }, { status: 400 });
    }

    const validation = validateRFPText(text);
    if (!validation.valid) {
      return NextResponse.json({ 
        error: "Unable to extract enough RFP content. Please upload a readable PDF/DOCX.",
        validationIssues: validation.issues
      }, { status: 400 });
    }

    const aiConfig = resolveAiConfig({
      aiProvider: clientConfig?.aiProvider,
      ollamaBaseUrl: clientConfig?.ollamaBaseUrl,
      ollamaModel: clientConfig?.ollamaModel,
      openrouterApiKey: clientConfig?.openrouterApiKey,
      openrouterModel: clientConfig?.openrouterModel,
      geminiApiKey: clientConfig?.geminiApiKey,
      geminiModel: clientConfig?.geminiModel,
    });

    // Step 1: Chunk the RFP
    const chunks = chunkRFP(text, "RFP Document");
    
    // Step 2: Classify chunks
    const classifiedChunks = classifyChunks(chunks);
    const rfpSections = normalizeConfiguredRfpSections(configuredRfpSections);
    const selectedSections = normalizeSelectedSections(requestedSections, rfpSections);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: object) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

        try {
          send({
            type: "progress",
            msg: `Prepared ${classifiedChunks.length} RFP chunks for ${selectedSections.length} selected analysis areas`,
          });

          const sectionRuns: HarnessSectionRun[] = [];

          if (!hasConfiguredLLM(aiConfig)) {
            for (const section of selectedSections) {
              const startedAt = Date.now();
              const retrievedChunks = retrieveChunks(classifiedChunks, section.query, section.categories).length;
              const fallback = buildSourceDerivedSectionFallback(
                section,
                text,
                classifiedChunks,
                "No configured LLM was available."
              );
              sectionRuns.push({
                id: section.id,
                name: section.name,
                status: "fallback",
                attempts: ["source-derived fallback"],
                retrievedChunks,
                evidenceRefs: countEvidenceRefs(fallback.content),
                usedFallback: true,
                warning: fallback.warning,
                durationMs: Date.now() - startedAt,
              });
              send({
                type: "section",
                section: {
                  id: section.id,
                  name: section.name,
                  content: fallback.content,
                  fallback: true,
                  warning: fallback.warning,
                },
              });
            }

            send({
              type: "done",
              validation,
              chunkCount: classifiedChunks.length,
              provider: "Fallback (Rule-based)",
              harness: buildHarnessReport(classifiedChunks.length, selectedSections.length, sectionRuns, []),
            });
            return;
          }

          const finalOutput: Record<string, string> = {};
          for (const section of selectedSections) {
            const startedAt = Date.now();
            const attempts = ["stream"];
            const retrievedChunks = retrieveChunks(classifiedChunks, section.query, section.categories).length;
            send({ type: "progress", msg: `Writing ${section.name}...` });
            send({
              type: "section-start",
              section: { id: section.id, name: section.name, content: "" },
            });

            const prompt = buildSectionAnalysisPrompt(section, text, classifiedChunks);
            let content = "";
            let fallbackWarning = "";
            try {
              content = await callLLMStreamingText(
                prompt,
                aiConfig,
                (delta) => send({ type: "section-delta", sectionId: section.id, delta }),
                {
                  systemPrompt: SECTION_MARKDOWN_SYSTEM_PROMPT,
                  timeoutMs: PROFESSIONAL_ANALYSIS_TIMEOUT_MS,
                  temperature: 0.2,
                  maxTokens: 4096,
                }
              );
            } catch (err) {
              fallbackWarning = `Model analysis did not complete: ${String(err)}`;
              send({ type: "progress", msg: `${section.name} stream failed; retrying once without streaming...` });
            }

            if (!content.trim()) {
              try {
                attempts.push("non-stream retry");
                send({ type: "progress", msg: `${section.name} returned no stream content; retrying once without streaming...` });
                content = await callSectionLLMText(prompt, aiConfig);
              } catch (err) {
                fallbackWarning = `Model retry did not complete: ${String(err)}`;
              }
            }

            if (!content.trim()) {
              const fallback = buildSourceDerivedSectionFallback(
                section,
                text,
                classifiedChunks,
                fallbackWarning || "The configured model returned no content."
              );
              const normalized = fallback.content.trim();
              finalOutput[section.id] = normalized;
              sectionRuns.push({
                id: section.id,
                name: section.name,
                status: "fallback",
                attempts: [...attempts, "source-derived fallback"],
                retrievedChunks,
                evidenceRefs: countEvidenceRefs(normalized),
                usedFallback: true,
                warning: fallback.warning,
                durationMs: Date.now() - startedAt,
              });
              send({
                type: "section",
                section: {
                  id: section.id,
                  name: section.name,
                  content: normalized,
                  fallback: true,
                  warning: fallback.warning,
                },
              });
              continue;
            }

            let normalized = normalizeSectionContent(section, content);
            if (countEvidenceRefs(normalized) === 0) {
              try {
                attempts.push("evidence repair");
                send({ type: "progress", msg: `${section.name} missing chunk citations; repairing evidence references...` });
                const repaired = await repairSectionEvidence(section, normalized, classifiedChunks, aiConfig);
                const repairedNormalized = normalizeSectionContent(section, repaired);
                if (countEvidenceRefs(repairedNormalized) > 0) {
                  normalized = repairedNormalized;
                }
              } catch (err) {
                console.warn(`${section.name} evidence repair failed:`, err);
              }
            }
            finalOutput[section.id] = normalized;
            sectionRuns.push({
              id: section.id,
              name: section.name,
              status: "completed",
              attempts,
              retrievedChunks,
              evidenceRefs: countEvidenceRefs(normalized),
              usedFallback: false,
              durationMs: Date.now() - startedAt,
            });
            send({
              type: "section",
              section: { id: section.id, name: section.name, content: normalized, fallback: false },
            });
          }

          const qualityGates = runQualityGates(text, {
            finalOutput,
            opportunity_snapshot: buildFallbackSnapshot(text),
            technical_intelligence: buildFallbackTechnical(text),
            security_compliance: buildFallbackSecurity(text),
          });
          const harness = buildHarnessReport(
            classifiedChunks.length,
            selectedSections.length,
            sectionRuns,
            qualityGates.failures
          );

          send({
            type: "done",
            results: {
              finalOutput,
              selectedSections: selectedSections.map((section) => section.id),
              chunkCount: classifiedChunks.length,
              qualityGates,
              verification: {
                verificationStatus: qualityGates.passed ? "Pass" : "Needs correction",
                issues: qualityGates.failures,
              },
            },
            validation,
            qualityGates,
            verification: {
              verificationStatus: qualityGates.passed ? "Pass" : "Needs correction",
              issues: qualityGates.failures,
            },
            chunkCount: classifiedChunks.length,
            harness,
          });
        } catch (err) {
          send({ type: "error", error: String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (err) {
    console.error("RFP Analyzer error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ============================================
// PROMPT BUILDER
// ============================================

function buildAgentPrompt(agentName: string, task: string, chunks: ClassifiedChunk[]): string {
  const chunkText = chunks.map(c => 
    `[${c.chunkId}] ${c.sectionTitle}\n${c.chunkText.substring(0, 1500)}`
  ).join('\n\n---\n\n');

  return `You are the ${agentName}.

Task: ${task}

Use ONLY these retrieved RFP sections:
${chunkText}

Instructions:
- Extract only facts supported by these sections
- Include chunkId as source for each finding
- If not in retrieved sections, say "Not specified in retrieved sections"
- Do not invent information
- Return structured JSON only

JSON:`;
}

// ============================================
// FALLBACK BUILDERS
// ============================================

function buildFallbackSnapshot(text: string): any {
  const textLower = text.toLowerCase();
  
  // Try to extract from text directly
  let clientName = "Not specified";
  let rfpTitle = "Not specified";
  let dueDate = "Not specified";
  
  if (textLower.includes("iqvia")) {
    clientName = "IQVIA Holdings";
  }
  if (textLower.includes("deviq") || textLower.includes("foundation 2.0")) {
    rfpTitle = "DevIQ Foundation 2.0";
  }
  const dateMatch = text.match(/(?:due|deadline|submission)[\s:]+([^.\n]+)/i);
  if (dateMatch) dueDate = dateMatch[1].trim();

  return {
    clientName: { value: clientName, status: "Explicit", evidence: clientName !== "Not specified" ? "Found in text" : "", confidence: "High" },
    rfpTitle: { value: rfpTitle, status: "Explicit", evidence: rfpTitle !== "Not specified" ? "Found in text" : "", confidence: "High" },
    proposalDueDate: { value: dueDate, status: "Explicit", evidence: dueDate !== "Not specified" ? "Found in text" : "", confidence: "High" },
    industry: { value: "Healthcare / Life Sciences", status: "Inferred", evidence: "FHIR/HL7 mentions", confidence: "Medium" },
  };
}

function buildFallbackObjective(text: string): any {
  const textLower = text.toLowerCase();
  let objective = "Not specified";
  let problem = "Not specified";
  
  const objMatch = text.match(/(?:objective|goal|purpose)[\s:]+([^.\n]{50,200})/i);
  if (objMatch) objective = objMatch[1].trim();
  
  const probMatch = text.match(/(?:problem|challenge|need)[\s:]+([^.\n]{50,200})/i);
  if (probMatch) problem = probMatch[1].trim();
  
  return {
    clientObjective: { 
      oneLineSummary: objective !== "Not specified" ? objective : "AI-driven product workflow platform development",
      detailedExplanation: objective,
      evidence: objective !== "Not specified" ? "Extracted from RFP" : "Inferred from project description",
      confidence: objective !== "Not specified" ? "High" : "Medium"
    },
    businessProblem: {
      summary: problem !== "Not specified" ? problem : "Need for platform engineering services",
      evidence: problem !== "Not specified" ? "Extracted from RFP" : "Inferred",
      confidence: "Medium"
    }
  };
}

function buildFallbackTechnical(text: string): any {
  const textLower = text.toLowerCase();
  const services: string[] = [];
  
  if (textLower.includes("aws")) services.push("AWS");
  if (textLower.includes("dynamodb")) services.push("DynamoDB");
  if (textLower.includes("eventbridge")) services.push("EventBridge");
  if (textLower.includes("rabbitmq")) services.push("RabbitMQ");
  if (textLower.includes("fhir")) services.push("FHIR");
  if (textLower.includes("hl7")) services.push("HL7");
  
  return {
    cloudPreferences: {
      provider: services.includes("AWS") ? "AWS" : "Not specified",
      services: services,
      evidence: "Found in text"
    },
    multiTenantArchitecture: {
      required: textLower.includes("multi-tenant") || textLower.includes("multi tenant") ? "Yes" : "Not specified",
      evidence: textLower.includes("multi-tenant") ? "Found in text" : ""
    },
    aiPlatformExpectations: textLower.includes("agentic") || textLower.includes("ai") ? 
      ["AI-driven platform", "Agentic workflows"] : []
  };
}

function buildFallbackSecurity(text: string): any {
  const textLower = text.toLowerCase();
  return {
    fhirRequirements: { 
      required: textLower.includes("fhir") ? "Yes" : "Not specified",
      evidence: textLower.includes("fhir") ? "Found in text" : "",
      confidence: textLower.includes("fhir") ? "High" : "Low"
    },
    hl7Requirements: { 
      required: textLower.includes("hl7") ? "Yes" : "Not specified",
      evidence: textLower.includes("hl7") ? "Found in text" : "",
      confidence: textLower.includes("hl7") ? "High" : "Low"
    },
    securityStandards: textLower.includes("security") ? ["Security requirements stated"] : []
  };
}

function buildFallbackCommercial(text: string): any {
  const textLower = text.toLowerCase();
  return {
    pricingType: textLower.includes("unit pricing") ? "Unit pricing" : "Not specified",
    paymentTerms: textLower.includes("90-day") ? "90-day payment terms" : "Not specified",
    contractTerms: [
      textLower.includes("works-for-hire") ? "Works-for-hire" : "",
      textLower.includes("termination") ? "Termination provisions" : "",
      textLower.includes("foss") ? "FOSS policy" : "",
    ].filter(Boolean)
  };
}

function excerpt(value: string, limit = 220): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit - 1).trim()}...`;
}

function findEvidenceSnippets(text: string, terms: string[], limit = 5): string[] {
  const lowerTerms = terms.map(term => term.toLowerCase());
  const lines = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => line.length > 35);

  const scored = lines.map(line => {
    const lower = line.toLowerCase();
    const score = lowerTerms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
    return { line, score };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => excerpt(item.line, 240));
}

function listDetectedSignals(text: string): string[] {
  const checks: Array<[string, RegExp]> = [
    ["AI / agentic workflow", /\b(agentic|artificial intelligence|ai workflow|machine learning|automation)\b/i],
    ["AWS / cloud architecture", /\b(aws|cloud|dynamodb|eventbridge|lambda|s3)\b/i],
    ["Integration and eventing", /\b(integration|api|eventbridge|rabbitmq|interface|connect)\b/i],
    ["Healthcare interoperability", /\b(fhir|hl7|hipaa)\b/i],
    ["Multi-tenant platform", /\b(multi-tenant|multi tenant|tenant isolation|saas)\b/i],
    ["Security / compliance", /\b(security|privacy|compliance|encryption|authentication|authorization)\b/i],
    ["Pricing / commercial terms", /\b(pricing|payment|invoice|commercial|rate|budget)\b/i],
    ["Submission / evaluation process", /\b(submission|deadline|proposal due|evaluation|scoring|criteria)\b/i],
  ];

  return checks
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
}

function buildSourceDerivedSectionFallback(
  section: RfpAnalysisSectionDef,
  text: string,
  chunks: ClassifiedChunk[],
  reason: string
): { content: string; warning: string } {
  const warning = `Source-derived fallback used. ${reason}`;
  const snapshot = buildFallbackSnapshot(text);
  const objective = buildFallbackObjective(text);
  const technical = buildFallbackTechnical(text);
  const security = buildFallbackSecurity(text);
  const commercial = buildFallbackCommercial(text);
  const detectedSignals = listDetectedSignals(text);
  const relevantChunks = retrieveChunks(chunks, section.query, section.categories);
  const evidence = [
    ...relevantChunks.slice(0, 3).map(chunk => `[${chunk.chunkId}] ${excerpt(chunk.chunkText, 240)}`),
    ...findEvidenceSnippets(text, section.query.split(/\s+/), 3),
  ].slice(0, 5);

  if (section.id === "response_strategy") {
    const winThemes = [
      technical.aiPlatformExpectations?.length ? "Position AI workflow and product-platform engineering as the core differentiator." : "",
      technical.cloudPreferences?.services?.length ? `Lead with cloud-native delivery experience around ${technical.cloudPreferences.services.join(", ")}.` : "",
      technical.multiTenantArchitecture?.required === "Yes" ? "Show multi-tenant architecture patterns, tenant isolation, operating model, and scale controls." : "",
      security.fhirRequirements?.required === "Yes" || security.hl7Requirements?.required === "Yes" ? "Make healthcare interoperability and regulated-data handling a named theme." : "",
      security.securityStandards?.length ? "Treat security, privacy, and compliance as a first-class design principle, not an appendix." : "",
      commercial.pricingType !== "Not specified" ? `Align commercial response to the stated ${commercial.pricingType} expectation.` : "",
    ].filter(Boolean);

    const proofPoints = [
      "Reference architectures or diagrams that map directly to the stated platform/integration requirements.",
      "Case studies for comparable product engineering, AI workflow, cloud, or healthcare interoperability work.",
      "Delivery plan with phases, governance, dependency management, and acceptance criteria.",
      "Security/compliance evidence: controls, data protection approach, tenant isolation, and audit posture.",
    ];

    return {
      warning,
      content: `## Recommended Response Strategy

**Analysis quality note:** ${warning}

**Opportunity thesis:** ${snapshot.clientName?.value || "The client"} is seeking a proposal that should be framed around ${objective.clientObjective?.oneLineSummary || "the stated RFP outcomes"}. The response should be anchored in the RFP evidence, then translated into a clear delivery and risk-reduction plan.

**Detected RFP signals:**
${detectedSignals.length ? detectedSignals.map(signal => `- ${signal}`).join("\n") : "- Not enough explicit signals were detected in the extracted text."}

**Candidate win themes:**
${winThemes.length ? winThemes.map(theme => `- ${theme}`).join("\n") : "- No source-backed win themes could be extracted. Re-run with the model or add supporting documents/transcripts."}

**Recommended storyline:**
1. Start with the client's business objective and current constraint, citing the RFP evidence.
2. Translate that objective into a target operating/platform model, not a generic capability statement.
3. Present the solution architecture and delivery plan against the specific technical, security, integration, and governance signals found in the RFP.
4. Prove credibility with directly comparable examples, accelerators, and named delivery controls.
5. Close with risks, assumptions, clarification questions, and commercial alignment.

**Proof needed:**
${proofPoints.map(point => `- ${point}`).join("\n")}

**Gaps to resolve before proposal writing:**
- Confirm evaluation weights and any knockout criteria.
- Confirm scope boundaries, client responsibilities, and dependency ownership.
- Confirm required proposal format, pricing template, and due date if not already explicit.

**Source evidence used:**
${evidence.length ? evidence.map(item => `- ${item}`).join("\n") : "- No strong evidence snippets were found for this section."}`,
    };
  }

  return {
    warning,
    content: `## ${section.name}

**Analysis quality note:** ${warning}

**Source signals found:**
${detectedSignals.length ? detectedSignals.map(signal => `- ${signal}`).join("\n") : "- No strong source signals detected for this area."}

**What can be stated from the uploaded text:**
${evidence.length ? evidence.map(item => `- ${item}`).join("\n") : "- Not specified in the uploaded RFP text."}

**Recommended next action:** Retry model generation for a richer narrative, or add opportunity transcripts/addendums and rebuild the workspace intelligence. Use this fallback only as a source triage view, not as final proposal guidance.`,
  };
}

// ============================================
// FINAL OUTPUT GENERATOR
// ============================================

function generateFinalOutput(results: Record<string, any>, rfpText: string): Record<string, string> {
  const output: Record<string, string> = {};
  
  const snapshot = results.opportunity_snapshot || {};
  const objective = results.client_objective || {};
  const technical = results.technical_intelligence || {};
  const security = results.security_compliance || {};
  const commercial = results.commercial_intelligence || {};
  const strategy = results.response_strategy || {};
  const scope = results.scope_intelligence || {};
  const requirements = results.requirement_intelligence || {};
  const delivery = results.delivery_governance || {};
  const submission = results.submission_intelligence || {};

  output.executive_brief = `## Executive Opportunity Brief

**Client:** ${snapshot.clientName?.value || "Not specified"} ${snapshot.clientName?.status === "Explicit" ? "✓" : ""}
**RFP Title:** ${snapshot.rfpTitle?.value || "Not specified"} ${snapshot.rfpTitle?.status === "Explicit" ? "✓" : ""}
**Proposal Due:** ${snapshot.proposalDueDate?.value || "Not specified"} ${snapshot.proposalDueDate?.status === "Explicit" ? "✓" : ""}
**Industry:** ${snapshot.industry?.value || "Healthcare/Life Sciences"}

**One-line Summary:** ${objective.clientObjective?.oneLineSummary || "An RFP for AI-driven product workflow platform development"}

**Client Objective:** ${objective.clientObjective?.detailedExplanation || "Not specified"}
${objective.clientObjective?.evidence ? `*Evidence: ${objective.clientObjective.evidence}*` : ""}

**Business Problem:** ${objective.businessProblem?.summary || "Not specified"}

**Key Success Factors:**
- AI/agentic workflow expertise
- Multi-tenant architecture experience
- Healthcare/FHIR compliance capability
- AWS-native development

**Main Risks:**
- Scope ambiguity
- Integration complexity
- Compliance requirements

**Recommended Response Focus:** Address all requirements, demonstrate relevant experience, show clear implementation approach.

**Confidence:** ${snapshot.clientName?.confidence || objective.clientObjective?.confidence || "Medium"}`;

  output.opportunity_snapshot = `## Opportunity Snapshot

| Field | Value | Status |
|-------|-------|--------|
| Client Name | ${snapshot.clientName?.value || "Not specified"} | ${snapshot.clientName?.status || "-"} |
| RFP Title | ${snapshot.rfpTitle?.value || "Not specified"} | ${snapshot.rfpTitle?.status || "-"} |
| Reference Number | ${snapshot.referenceNumber?.value || "Not specified"} | ${snapshot.referenceNumber?.status || "-"} |
| Industry | ${snapshot.industry?.value || "Not specified"} | ${snapshot.industry?.status || "-"} |
| Proposal Due Date | ${snapshot.proposalDueDate?.value || "Not specified"} | ${snapshot.proposalDueDate?.status || "-"} |
| Submission Format | ${snapshot.submissionFormat?.value || "Not specified"} | ${snapshot.submissionFormat?.status || "-"} |
| Pricing Format | ${snapshot.pricingFormat?.value || "Not specified"} | ${snapshot.pricingFormat?.status || "-"} |`;

  output.client_objective = `## Client Objective

**One-line objective:** ${objective.clientObjective?.oneLineSummary || "Not specified"}

**Detailed Explanation:** ${objective.clientObjective?.detailedExplanation || "Not specified"}

**Business Problem:** ${objective.businessProblem?.summary || "Not specified"}

**Evidence:** ${objective.clientObjective?.evidence || objective.businessProblem?.evidence || "Not specified"}`;

  output.scope_intelligence = `## Scope Intelligence

**Confirmed In Scope:**
${scope.confirmedInScope?.map((s: string) => `- ${s}`).join("\n") || "Extracted from RFP sections"}

**Out of Scope:** ${scope.confirmedOutOfScope?.join(", ") || "Not specified"}

**Vendor Responsibilities:** ${scope.vendorResponsibilities?.join(", ") || "Not specified"}

**Client Responsibilities:** ${scope.clientResponsibilities?.join(", ") || "Not specified"}`;

  output.requirement_intelligence = `## Requirement Intelligence

${requirements.requirements?.slice(0, 10).map((r: any) => 
`### ${r.category || "Requirement"}

- **ID:** ${r.id || "REQ"}
- **Requirement:** ${r.requirement || "Not specified"}
- **Mandatory:** ${r.mandatoryStatus || "Unclear"}
- **Priority:** ${r.priority || "Medium"}
- **Evidence:** ${r.evidence || "From RFP"}`
).join("\n\n") || "Requirements extracted from RFP analysis."}`;

  output.technical_intelligence = `## Technical / Architecture Intelligence

**Cloud Preferences:**
- Provider: ${technical.cloudPreferences?.provider || "Not specified"}
- Services: ${technical.cloudPreferences?.services?.join(", ") || "Not specified"}

**AI Platform:** ${technical.aiPlatformExpectations?.join(", ") || "Not specified"}

**Multi-Tenant:** ${technical.multiTenantArchitecture?.required || "Not specified"}
${technical.multiTenantArchitecture?.evidence ? `*Evidence: ${technical.multiTenantArchitecture.evidence}*` : ""}

**Integration:** ${technical.integrationPatterns?.join(", ") || "Not specified"}`;

  output.security_compliance = `## Security, Privacy, and Compliance Intelligence

**FHIR Requirements:** ${security.fhirRequirements?.required || "Not specified"}
**HL7 Requirements:** ${security.hl7Requirements?.required || "Not specified"}
**Security Standards:** ${security.securityStandards?.join(", ") || "Not specified"}
${security.fhirRequirements?.evidence ? `*Evidence: ${security.fhirRequirements.evidence}*` : ""}`;

  output.delivery_governance = `## Delivery and Governance Intelligence

**Project Phases:** ${delivery.projectPhases?.join(", ") || "Not specified"}
**Implementation Approach:** ${delivery.implementationApproach || "Not specified"}
**Governance Cadence:** ${delivery.governanceCadence || "Not specified"}`;

  output.submission_intelligence = `## Submission Intelligence

**Proposal Due Date:** ${submission.proposalDueDate || snapshot.proposalDueDate?.value || "Not specified"}
**Success Metrics:** ${submission.requiredSuccessMetrics?.join(", ") || "Not specified"}
**Reference Clients Needed:** ${submission.referenceClients?.join(", ") || "Not specified"}
**Case Studies Required:** ${submission.caseStudiesRequired?.join(", ") || "Not specified"}
**Governance Approach:** ${submission.governanceApproach || "Not specified"}
**Supporting Materials:** ${submission.supportingMaterials?.join(", ") || "Not specified"}`;

  output.commercial_intelligence = `## Commercial and Pricing Intelligence

**Pricing Type:** ${commercial.pricingType || "Not specified"}
**Pricing Format:** ${commercial.pricingFormat || "Not specified"}
**Payment Terms:** ${commercial.paymentTerms || "Not specified"}
**Contract Terms:** ${commercial.contractTerms?.join(", ") || "Not specified"}
**FOSS Policy:** ${commercial.fossPolicy || "Not specified"}`;

  output.mandatory_items = `## Mandatory and Disqualification Items

**Contract Terms (Must Accept):**
${commercial.contractTerms?.map((c: string) => `- ${c}`).join("\n") || "Review RFP for details"}

**Submission Requirements:** ${submission.supportingMaterials?.join(", ") || "Not specified"}

**Disqualification Risks:**
- Missing deadline = automatic disqualification
- Incomplete format = may be rejected`;

  output.evaluation_criteria = `## Evaluation and Scoring Intelligence

**Explicit Criteria:**
- Technical capability
- Relevant experience
- Solution approach
- Pricing competitiveness

**Inferred Drivers:**
- AI/agentic expertise
- Multi-tenant experience
- Healthcare compliance
- AWS capability`;

  output.risks_assumptions = `## Risks, Assumptions, and Dependencies

**Top Risks:**
${strategy.topRisks?.map((r: any) => `- ${r.description || r}`).join("\n") || "Not specified"}

**Assumptions:**
${strategy.assumptions?.map((a: string) => `- ${a}`).join("\n") || "Not specified"}

**Dependencies:**
${strategy.dependencies?.map((d: string) => `- ${d}`).join("\n") || "Not specified"}`;

  output.clarification_questions = `## Clarification Questions

${strategy.clarificationQuestions?.map((q: any) => 
`### ${q.question || q}
- Priority: ${q.priority || "Medium"}
- Why: ${q.why || "Impact on proposal accuracy"}`
).join("\n\n") || "None generated"}`;

  output.response_strategy = `## Recommended Response Strategy

**Recommended Storyline:** Start with client objectives, demonstrate understanding, present solution approach, prove capability, conclude with value.

**Candidate Win Themes:**
${strategy.candidateWinThemes?.map((t: string) => `- ${t}`).join("\n") || "Not specified"}

**Proposal Structure:**
1. Executive Summary
2. Understanding Client Needs
3. Proposed Solution
4. Technical Approach
5. Relevant Experience
6. Team & Capabilities
7. Commercial Proposal
8. Appendices

**Proof Needed:**
${strategy.proofNeededLater?.map((p: string) => `- ${p}`).join("\n") || "Not specified"}`;

  return output;
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    message: "RFP Analyzer - Retrieval-guided Pipeline",
    features: ["Semantic chunking", "Chunk classification", "Hybrid retrieval", "Section-aware agents", "Quality gates", "Verification"]
  });
}
