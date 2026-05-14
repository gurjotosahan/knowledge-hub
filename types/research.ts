import type { SearchableFileType } from "@/types";
import type { AgentHarnessReport } from "@/types";

export interface ResearchSectionDef {
  id: string;
  title: string;
  emoji: string;
  description: string;
  searchQueryTemplate: string;
  prompt: string;
}

export interface ResearchReference {
  id: string;
  marker: string;
  title: string;
  fileName: string;
  filePath: string;
  fileType: SearchableFileType;
  page: number;
  excerpt: string;
}

export interface ResearchSectionResult {
  id: string;
  title: string;
  emoji: string;
  content: string;
  references?: ResearchReference[];
  harness?: AgentHarnessReport;
}

export interface SavedResearch {
  id: string;
  clientName: string;
  createdAt: string;
  selectedSections: string[];
  sections: ResearchSectionResult[];
}

export const RESEARCH_SECTIONS_STORAGE_KEY = "apexon-hub-research-sections";

export const RESEARCH_SECTIONS: ResearchSectionDef[] = [
  {
    id: "snapshot",
    title: "Company Snapshot",
    emoji: "🏢",
    description: "Revenue, headcount, geography, leadership",
    searchQueryTemplate: "{{client}} company overview revenue employees headquarters leadership CEO CIO 2025 2026",
    prompt: "Summarize the company snapshot: business overview, scale, revenue/headcount when available, headquarters/geography, and leadership. Keep it presales-relevant and cite recent facts from gathered intelligence.",
  },
  {
    id: "business",
    title: "Business Model & Revenue Drivers",
    emoji: "💰",
    description: "How they make money, core products, pricing",
    searchQueryTemplate: "{{client}} business model revenue streams products services pricing customer segments 2025 2026",
    prompt: "Explain how the company makes money, its core offerings, key customer segments, and likely revenue drivers. Highlight what this implies for technology investment and Apexon entry points.",
  },
  {
    id: "strategy",
    title: "Strategic Priorities",
    emoji: "🎯",
    description: "Digital transformation, CEO priorities, M&A, partnerships",
    searchQueryTemplate: "{{client}} strategic priorities digital transformation annual report CEO priorities initiatives 2025 2026",
    prompt: "Identify strategic priorities, transformation themes, acquisitions, partnerships, and executive initiatives. Connect each priority to possible Apexon service opportunities.",
  },
  {
    id: "tech",
    title: "Technology Landscape",
    emoji: "⚙️",
    description: "Cloud, legacy systems, CRM/ERP, AI maturity",
    searchQueryTemplate: "{{client}} technology stack cloud AWS Azure GCP Salesforce SAP ERP CRM infrastructure AI 2025 2026",
    prompt: "Assess the technology landscape: cloud, data, AI, ERP/CRM, legacy modernization, platforms, and visible engineering maturity. Include likely gaps and Apexon-fit service lines.",
  },
  {
    id: "challenges",
    title: "Challenges & Pain Points",
    emoji: "⚡",
    description: "Operational inefficiencies, regulatory pressure, legacy debt",
    searchQueryTemplate: "{{client}} challenges problems operational issues regulatory legacy technology debt 2025 2026",
    prompt: "Surface business and technology pain points such as operational inefficiency, regulatory pressure, cost, legacy debt, security, data fragmentation, and customer experience gaps. Map pains to Apexon plays.",
  },
  {
    id: "buying",
    title: "Buying Group Mapping",
    emoji: "👥",
    description: "Decision makers, CIO/CTO/CDO, influencers, org changes",
    searchQueryTemplate: "{{client}} CIO CTO CDO technology leadership executives digital officer 2025 2026",
    prompt: "Map likely buying group members and influencers: CIO/CTO/CDO, business leaders, digital/product leaders, procurement, and compliance stakeholders. Explain each persona's likely priorities.",
  },
  {
    id: "market",
    title: "Competitor & Market Position",
    emoji: "📊",
    description: "Key competitors, market share, differentiators",
    searchQueryTemplate: "{{client}} competitors market share industry position differentiators competitive landscape",
    prompt: "Describe competitor landscape, market position, differentiation, and external pressure. Turn this into conversation angles Apexon can use with the account.",
  },
  {
    id: "vendors",
    title: "Existing Vendors & Partners",
    emoji: "🤝",
    description: "Current IT vendors, consulting partners, outsourcing",
    searchQueryTemplate: "{{client}} IT vendors consulting partners outsourcing technology partnerships Infosys Accenture TCS IBM",
    prompt: "Identify known or likely technology vendors, consulting partners, outsourcing relationships, and ecosystem dependencies. Highlight displacement, coexistence, or partnership angles.",
  },
  {
    id: "intent",
    title: "Intent Signals",
    emoji: "📡",
    description: "Hiring trends, content engagement, solution searches",
    searchQueryTemplate: "{{client}} hiring AI cloud digital transformation job postings technology investment 2025 2026",
    prompt: "Find intent signals: hiring, recent investments, transformation roles, job postings, solution searches, announcements, events, or technology initiatives. Convert signals into timely outreach triggers.",
  },
  {
    id: "hypothesis",
    title: "Opportunity Hypothesis",
    emoji: "💡",
    description: "Inferred entry points and deal opportunities",
    searchQueryTemplate: "{{client}} technology investment gaps modernization opportunities cloud AI digital 2025 2026",
    prompt: "Build an opportunity hypothesis for Apexon. Name the strongest entry points, likely business pain, recommended Apexon service lines, and why now.",
  },
  {
    id: "engagement",
    title: "Engagement Strategy",
    emoji: "🚀",
    description: "Which BU to target, persona to approach, message to lead with",
    searchQueryTemplate: "{{client}} IT procurement decision making digital initiative stakeholder 2025 2026",
    prompt: "Recommend engagement strategy: target business unit, first persona, likely champion, opening message, discovery questions, and next-best asset or proof point.",
  },
  {
    id: "apexon_fit",
    title: "Apexon Fit & Opportunity Map",
    emoji: "🎯",
    description: "Explicit mapping of client needs to Apexon service lines and entry points",
    searchQueryTemplate: "{{client}} IT outsourcing digital services vendor evaluation 2025 2026",
    prompt: "Create an Apexon fit map. Explicitly connect client needs to Apexon service lines, rank opportunity areas, identify high-value entry points, and suggest a concise talk track.",
  },
];
