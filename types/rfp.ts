export interface RfpAnalysisSectionDef {
  id: string;
  name: string;
  description: string;
  query: string;
  categories: string[];
  prompt: string;
}

export interface RfpRecommendationAreaDef {
  id: string;
  name: string;
  description: string;
  queryTemplate: string;
  desiredAssetTypes: string[];
  prompt: string;
  enabled: boolean;
}

export interface RfpRecommendationCard {
  id: string;
  title: string;
  assetType: string;
  fileName: string;
  filePath?: string;
  fileType?: string;
  page?: number;
  matchReason: string;
  excerpt: string;
  confidence: "High" | "Medium" | "Low";
  suggestedReuse: string;
  documentAssetType?: string;
  sectionAssetType?: string;
  industries?: string[];
  serviceLines?: string[];
  technologies?: string[];
  reusableFor?: string[];
  proofStrength?: string;
  hasMetrics?: boolean;
  assetSummary?: string;
  thumbnailUrl?: string;
  previewPdfUrl?: string;
  previewStatus?: "thumbnail" | "pdf" | "failed";
  assetYear?: number;
  yearConfidence?: "high" | "medium" | "low";
  recencyNote?: string;
  score: number;
}

export interface RfpRecommendationGroup {
  id: string;
  name: string;
  description: string;
  query: string;
  cards: RfpRecommendationCard[];
}

export const RFP_SECTIONS_STORAGE_KEY = "apexon-hub-rfp-sections";
export const RFP_RECOMMENDATION_AREAS_STORAGE_KEY = "apexon-hub-rfp-recommendation-areas";

export const RFP_ANALYSIS_SECTIONS: RfpAnalysisSectionDef[] = [
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

export const RFP_RECOMMENDATION_AREAS: RfpRecommendationAreaDef[] = [
  {
    id: "similar_proposals",
    name: "Similar Proposals / RFPs",
    description: "Closest past proposal and RFP material for structure, scope, and response patterns",
    queryTemplate: "similar proposal RFP {{profile}} requirements scope evaluation response",
    desiredAssetTypes: ["pdf", "docx"],
    prompt: "Find prior proposal or RFP material that can guide response structure, compliance handling, and pursuit strategy.",
    enabled: true,
  },
  {
    id: "capability_slides",
    name: "Capability Slides",
    description: "Reusable capability slides for technologies, practices, service lines, and differentiators",
    queryTemplate: "capability slides {{profile}} data testing UI UX cloud Salesforce AWS automation",
    desiredAssetTypes: ["pptx"],
    prompt: "Find reusable capability slides that directly support the required service areas and technical themes.",
    enabled: true,
  },
  {
    id: "case_studies",
    name: "Case Studies / Proof Points",
    description: "Client examples, measurable outcomes, proof points, and references",
    queryTemplate: "case study proof point client example outcomes metrics {{profile}} regulated industry",
    desiredAssetTypes: ["pdf", "pptx", "docx"],
    prompt: "Find source-backed proof points and case studies that strengthen credibility for this RFP.",
    enabled: true,
  },
  {
    id: "operating_model",
    name: "Operating Model / Delivery Model",
    description: "Governance, team structure, delivery cadence, acceptance, reporting, and operating model assets",
    queryTemplate: "operating model delivery model governance cadence agile team structure reporting {{profile}}",
    desiredAssetTypes: ["pptx", "pdf", "docx"],
    prompt: "Find delivery and operating model content that can shape the proposal delivery approach.",
    enabled: true,
  },
  {
    id: "solution_assets",
    name: "Solution / Architecture Assets",
    description: "Solution approach, architecture, integration, accelerators, and platform references",
    queryTemplate: "solution architecture accelerator integration platform cloud workflow {{profile}}",
    desiredAssetTypes: ["pptx", "pdf", "docx"],
    prompt: "Find solution and architecture assets that map to the technical requirements in the RFP.",
    enabled: true,
  },
  {
    id: "commercial_pricing",
    name: "Commercial / Pricing References",
    description: "Pricing model references, commercial assumptions, estimation patterns, and contracting considerations",
    queryTemplate: "pricing commercial model assumptions rate card payment terms fixed price managed services {{profile}}",
    desiredAssetTypes: ["pdf", "docx", "pptx"],
    prompt: "Find commercial or pricing references only when there is source-backed internal content.",
    enabled: true,
  },
];
