export interface ResearchSectionDef {
  id: string;
  title: string;
  emoji: string;
  searchQuery: (name: string) => string;
  description: string;
}

export interface ResearchSectionResult {
  id: string;
  title: string;
  emoji: string;
  content: string;
}

export interface SavedResearch {
  id: string;
  clientName: string;
  createdAt: string;
  selectedSections: string[];
  sections: ResearchSectionResult[];
}

export const RESEARCH_SECTIONS: ResearchSectionDef[] = [
  {
    id: "snapshot",
    title: "Company Snapshot",
    emoji: "🏢",
    description: "Revenue, headcount, geography, leadership",
    searchQuery: (n) => `${n} company overview revenue employees headquarters leadership CEO CIO 2024 2025`,
  },
  {
    id: "business",
    title: "Business Model & Revenue Drivers",
    emoji: "💰",
    description: "How they make money, core products, pricing",
    searchQuery: (n) => `${n} business model revenue streams products services pricing customer segments 2024`,
  },
  {
    id: "strategy",
    title: "Strategic Priorities",
    emoji: "🎯",
    description: "Digital transformation, CEO priorities, M&A, partnerships",
    searchQuery: (n) => `${n} strategic priorities digital transformation annual report CEO priorities initiatives 2024 2025`,
  },
  {
    id: "tech",
    title: "Technology Landscape",
    emoji: "⚙️",
    description: "Cloud, legacy systems, CRM/ERP, AI maturity",
    searchQuery: (n) => `${n} technology stack cloud AWS Azure GCP Salesforce SAP ERP CRM infrastructure 2024`,
  },
  {
    id: "challenges",
    title: "Challenges & Pain Points",
    emoji: "⚡",
    description: "Operational inefficiencies, regulatory pressure, legacy debt",
    searchQuery: (n) => `${n} challenges problems operational issues regulatory legacy technology debt 2024 2025`,
  },
  {
    id: "buying",
    title: "Buying Group Mapping",
    emoji: "👥",
    description: "Decision makers, CIO/CTO/CDO, influencers, org changes",
    searchQuery: (n) => `${n} CIO CTO CDO technology leadership executives digital officer 2024 2025`,
  },
  {
    id: "market",
    title: "Competitor & Market Position",
    emoji: "📊",
    description: "Key competitors, market share, differentiators",
    searchQuery: (n) => `${n} competitors market share industry position differentiators competitive landscape`,
  },
  {
    id: "vendors",
    title: "Existing Vendors & Partners",
    emoji: "🤝",
    description: "Current IT vendors, consulting partners, outsourcing",
    searchQuery: (n) => `${n} IT vendors consulting partners outsourcing technology partnerships Infosys Accenture TCS IBM`,
  },
  {
    id: "intent",
    title: "Intent Signals",
    emoji: "📡",
    description: "Hiring trends, content engagement, solution searches",
    searchQuery: (n) => `${n} hiring AI cloud digital transformation job postings technology investment 2024 2025`,
  },
  {
    id: "hypothesis",
    title: "Opportunity Hypothesis",
    emoji: "💡",
    description: "Inferred entry points and deal opportunities",
    searchQuery: (n) => `${n} technology investment gaps modernization opportunities cloud AI digital 2024 2025`,
  },
  {
    id: "engagement",
    title: "Engagement Strategy",
    emoji: "🚀",
    description: "Which BU to target, persona to approach, message to lead with",
    searchQuery: (n) => `${n} IT procurement decision making digital initiative stakeholder 2024 2025`,
  },
  {
    id: "apexon_fit",
    title: "Apexon Fit & Opportunity Map",
    emoji: "🎯",
    description: "Explicit mapping of client needs to Apexon service lines and entry points",
    searchQuery: (n) => `${n} IT outsourcing digital services vendor evaluation 2024 2025`,
  },
];
