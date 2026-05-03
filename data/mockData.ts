import type { AIAnswer, Document, SidebarItem, Slide, DeckTheme, SlideData } from "@/types";

// ── Deck themes ───────────────────────────────────────────────────────────────

const THEMES: Record<string, DeckTheme> = {
  bfsiRfp: {
    primary: "#0F2B5B",
    accent: "#C9A84C",
    surface: "#F8F9FF",
    primaryText: "#ffffff",
  },
  digitalPov: {
    primary: "#0E7490",
    accent: "#F97316",
    surface: "#F0FDFA",
    primaryText: "#ffffff",
  },
  paymentsCaseStudy: {
    primary: "#1E1B4B",
    accent: "#06B6D4",
    surface: "#F5F3FF",
    primaryText: "#ffffff",
  },
  genaiTrends: {
    primary: "#0F172A",
    accent: "#8B5CF6",
    surface: "#F8F7FF",
    primaryText: "#ffffff",
  },
};

// ── Helper ────────────────────────────────────────────────────────────────────

function s(
  number: number,
  caption: string,
  layout: SlideData["layout"],
  theme: DeckTheme,
  rest: Omit<SlideData, "layout" | "theme">
): Slide {
  return { number, caption, data: { layout, theme, ...rest } };
}

// ── Deck 1 – BFSI Lending Platform RFP (doc-1, 12 slides) ────────────────────

const T1 = THEMES.bfsiRfp;
const deck1: Slide[] = [
  s(1,  "Title",                       "title",   T1, { eyebrow: "RFP Response", title: "BFSI Lending Platform Modernization", subtitle: "Transforming Lending Operations with Cloud-Native Architecture · Apexon Inc." }),
  s(2,  "Executive Summary",           "section", T1, { eyebrow: "01", title: "Executive Summary", body: "Our 14-slide response addresses every section of your lending platform RFP with a proven, delivery-led approach." }),
  s(3,  "Key Commitments",             "bullets", T1, { title: "Key Commitments", bullets: ["End-to-end microservices migration with zero downtime", "Cloud-native deployment on AWS / Azure (client choice)", "99.9% SLA with financial penalty clauses", "18-month delivery commitment, weekly milestone demos", "Dedicated 35-member pod team, fully embedded"] }),
  s(4,  "Current State vs Future State","two-col", T1, { title: "Current State vs Future State", leftCol: { heading: "Pain Points Today", items: ["Monolithic core, 6-month release cycles", "Manual underwriting: avg 4.8 days", "Data siloed across 12 BUs", "Unable to support API-first channels", "SOX audit lag: 6 weeks"] }, rightCol: { heading: "Apexon Solution", items: ["Domain-driven microservices mesh", "AI-powered underwriting: <4 hours", "Unified real-time data platform", "Public API marketplace for partners", "Automated SOX reporting pipeline"] } }),
  s(5,  "Solution Architecture",       "bullets", T1, { title: "Solution Architecture Overview", bullets: ["API Gateway: Kong + AWS API GW (rate limit, auth, logging)", "15+ domain microservices (Spring Boot / Node.js)", "Event streaming: Apache Kafka on MSK (1.2M msg/sec)", "Persistence: Aurora PostgreSQL + DynamoDB (CQRS pattern)", "Micro-frontend: React + Module Federation"] }),
  s(6,  "By the Numbers",              "stats",   T1, { title: "Why It Works – By the Numbers", stats: [{ value: "99.9%", label: "Uptime SLA" }, { value: "<200ms", label: "API P95 Latency" }, { value: "60%", label: "Infra Cost Reduction" }, { value: "18mo", label: "Delivery Commitment" }] }),
  s(7,  "Microservices Decomposition", "bullets", T1, { title: "Microservices Decomposition", bullets: ["Loan Origination Service – application intake & decisioning", "Credit Assessment Engine – bureau integration + ML scoring", "Document Management Service – S3 + e-sign orchestration", "Notification & Workflow Service – event-driven, Temporal", "Regulatory Reporting Service – Basel IV, CCAR, DFAST"] }),
  s(8,  "Cloud-Native Infrastructure", "two-col", T1, { title: "Cloud-Native Infrastructure", leftCol: { heading: "AWS Services", items: ["EKS (Kubernetes 1.29)", "Aurora PostgreSQL Serverless v2", "Amazon MSK (Kafka)", "CloudFront CDN + WAF", "Secrets Manager + KMS"] }, rightCol: { heading: "DevOps Toolchain", items: ["Terraform IaC (GitOps)", "GitHub Actions CI/CD", "Datadog APM + Logs", "SonarQube SAST / DAST", "Vault for secret rotation"] } }),
  s(9,  "Security & Compliance",       "bullets", T1, { title: "Security & Compliance", bullets: ["Zero-trust network (Istio service mesh + mTLS)", "SOC 2 Type II certified delivery centre", "OWASP Top 10 – automated scanning in every PR", "PCI-DSS Level 1 compliant data handling", "AES-256 at rest, TLS 1.3 in transit, HSM key mgmt"] }),
  s(10, "Our Team",                    "stats",   T1, { title: "Team Credentials", stats: [{ value: "35", label: "Dedicated Team Members" }, { value: "12+", label: "Avg Years Experience" }, { value: "200+", label: "BFSI Clients Served" }, { value: "4", label: "Global Delivery Centres" }] }),
  s(11, "Why Apexon",                  "bullets", T1, { title: "Why Apexon", bullets: ["Top 100 BFSI technology partner – Gartner Peer Insights 2024", "ISO 27001, ISO 9001, CMMi Level 5 certified", "15+ years of BFSI-specific domain experience", "Agile delivery with weekly demos and open backlog", "Full IP & knowledge transfer on project completion"] }),
  s(12, "Commercial Proposal",         "closing", T1, { eyebrow: "Commercial Proposal", title: "Let's Build Together", subtitle: "bfsi@apexon.com  ·  apexon.com  ·  +1 (408) 123-4567" }),
];

// ── Deck 2 – Digital Transformation POV (doc-2, 8 slides) ────────────────────

const T2 = THEMES.digitalPov;
const deck2: Slide[] = [
  s(1, "Title",                        "title",   T2, { eyebrow: "Point of View", title: "Digital Transformation in Banking", subtitle: "Navigating Open Banking, Embedded Finance & API-Led Growth" }),
  s(2, "The Digital Imperative",       "section", T2, { eyebrow: "01", title: "The Digital Imperative", body: "Why transformation is no longer optional for tier-1 and mid-market banks alike." }),
  s(3, "Forces Reshaping Banking",     "bullets", T2, { title: "Forces Reshaping Banking", bullets: ["PSD2 / Open Banking mandates – API exposure is now law", "BNPL & embedded finance disrupting traditional credit", "Neo-bank competition: Revolut, Monzo, Chime, N26", "GenAI-driven customer expectations for instant, personal service", "Rising regulatory complexity (Basel IV, DORA, MiCA)"] }),
  s(4, "The Open Banking Opportunity", "two-col", T2, { title: "The Open Banking Opportunity", leftCol: { heading: "Challenges", items: ["Legacy core banking systems (10–20yr old)", "Data siloed across business units", "Slow partner onboarding (12–18 weeks)", "Risk-averse, waterfall delivery culture"] }, rightCol: { heading: "Opportunities", items: ["API marketplace revenue streams", "Third-party fintech partnerships at speed", "Real-time data monetisation models", "Ecosystem platform: bank as infrastructure"] } }),
  s(5, "API-Led Connectivity Model",   "bullets", T2, { title: "API-Led Connectivity Model", bullets: ["System APIs – expose core assets (accounts, payments, balances)", "Process APIs – orchestrate business workflows end-to-end", "Experience APIs – power mobile, web and voice channels", "Event APIs – enable real-time triggers (webhooks, SSE)", "Developer portal – self-serve partner onboarding in <5 days"] }),
  s(6, "Market Opportunity",           "stats",   T2, { title: "The Market Opportunity", stats: [{ value: "$7.2T", label: "Embedded Finance Value by 2030" }, { value: "78%", label: "Banks Prioritising API Strategy" }, { value: "3.4×", label: "ROI on Digital Platform Investment" }, { value: "67%", label: "Customers Prefer Digital-First" }] }),
  s(7, "Industry Quote",               "quote",   T2, { quote: "Banks that master the platform model will capture disproportionate value in the next decade. The window to act is closing fast.", attribution: "McKinsey Global Banking Annual Review, 2024" }),
  s(8, "Closing",                      "closing", T2, { eyebrow: "Ready to Transform?", title: "Partner with Apexon", subtitle: "digital@apexon.com  ·  apexon.com/banking" }),
];

// ── Deck 3 – Payments Modernization Case Study (doc-3, 10 slides) ─────────────

const T3 = THEMES.paymentsCaseStudy;
const deck3: Slide[] = [
  s(1,  "Title",                       "title",   T3, { eyebrow: "Case Study", title: "60% Latency Reduction in 8 Months", subtitle: "Payments Modernization for a Regional Commercial Bank" }),
  s(2,  "The Client",                  "section", T3, { eyebrow: "CLIENT", title: "Regional Commercial Bank", body: "US mid-market bank · $28B AUM · 1.2M customers · 280 branches" }),
  s(3,  "Business Challenge",          "bullets", T3, { title: "Business Challenge", bullets: ["Legacy FIS Horizon batch-based payment integration", "Avg payment settlement latency: 4.2 seconds end-to-end", "3× YoY growth in digital payment volume (2021–2024)", "ISO 20022 regulatory deadline: Q4 2024", "Manual overnight reconciliation causing 48-hour dispute lag"] }),
  s(4,  "Architecture: Before & After","two-col", T3, { title: "Architecture: Before & After", leftCol: { heading: "Legacy Architecture (2022)", items: ["Synchronous REST batch jobs", "Oracle DB monolith (single AZ)", "Nightly batch reconciliation", "Point-to-point FTP integrations", "No real-time observability"] }, rightCol: { heading: "Modern Architecture (2024)", items: ["Event-driven Apache Kafka streams", "CQRS + event sourcing pattern", "Real-time settlement (<400ms)", "ISO 20022 native message format", "Datadog full-stack observability"] } }),
  s(5,  "Apexon's Approach",           "bullets", T3, { title: "Apexon's Delivery Approach", bullets: ["12-week event storming & architecture design phase", "Strangler Fig pattern – zero-downtime phased migration", "Dual-write strategy during cut-over period", "Kafka cluster capacity: 1.2M messages/sec (MSK)", "Canary deployment with automated rollback on error rate >0.1%"] }),
  s(6,  "Event-Driven Architecture",   "bullets", T3, { title: "Event-Driven Architecture Stack", bullets: ["Apache Kafka on AWS MSK – 12 partitions, 3 broker nodes", "Schema Registry (Confluent) for message governance", "Kafka Streams for real-time payment enrichment", "ksqlDB for stream analytics & fraud signal generation", "Dead-letter queue with exponential backoff retry (max 5×)"] }),
  s(7,  "Results",                     "stats",   T3, { title: "Measured Results – 6 Months Post Go-Live", stats: [{ value: "60%", label: "P95 Latency Reduction" }, { value: "3×", label: "Throughput Increase" }, { value: "99.99%", label: "System Uptime Achieved" }, { value: "8mo", label: "Delivery Timeline" }] }),
  s(8,  "Client Quote",                "quote",   T3, { quote: "Apexon delivered a payments transformation we thought would take three years – in just eight months. The results have exceeded every target.", attribution: "VP Engineering, Regional Commercial Bank" }),
  s(9,  "Key Learnings",               "bullets", T3, { title: "Key Learnings", bullets: ["Event storming workshops (2 weeks) prevent architecture rework later", "Invest in Kafka operations training before cluster go-live", "Schema Registry is non-negotiable at production message volumes", "Canary deployments reduced rollout production risk by ~90%", "Observability must be designed-in from sprint 1, not retrofitted"] }),
  s(10, "Closing",                     "closing", T3, { eyebrow: "Replicate this success", title: "Modernize Your Payments Stack", subtitle: "payments@apexon.com  ·  apexon.com/payments" }),
];

// ── Deck 4 – GenAI in Financial Services (doc-4, 9 slides) ───────────────────

const T4 = THEMES.genaiTrends;
const deck4: Slide[] = [
  s(1, "Title",                        "title",   T4, { eyebrow: "Trend Report 2025", title: "GenAI in Financial Services", subtitle: "From Experimentation to Enterprise-Scale Deployment" }),
  s(2, "The GenAI Revolution",         "section", T4, { eyebrow: "CONTEXT", title: "The GenAI Revolution", body: "Financial services is the fastest-adopting vertical for generative AI — and the stakes have never been higher." }),
  s(3, "GenAI by the Numbers",         "stats",   T4, { title: "GenAI in FS – Market Data", stats: [{ value: "$15.7T", label: "Potential Value by 2030 (McKinsey)" }, { value: "78%", label: "Banks Piloting GenAI in 2024" }, { value: "4.7×", label: "Productivity Gain – Knowledge Work" }, { value: "42%", label: "Cost Reduction in Early Adopters" }] }),
  s(4, "Use Case: Wealth Management",  "bullets", T4, { title: "Use Case: Wealth Management", bullets: ["Hyper-personalised investment narratives at scale (10K clients/day)", "Automated portfolio commentary via Bloomberg GPT / FinGPT", "Client suitability screening using NLP on CRM notes", "Regulatory doc generation: KIID, SRDII, MiFID II disclosures", "Voice-to-trade interface for HNW & UHNW client segments"] }),
  s(5, "Use Case: Fraud & Risk",       "bullets", T4, { title: "Use Case: Fraud Detection & Risk", bullets: ["Real-time transaction narrative analysis (Llama 3 fine-tuned)", "Synthetic identity fraud detection: 78% improvement in recall", "AML alert triage – 60% reduction in false positive rate", "Automated regulatory filings: SAR, CTR, CMIR generation", "Adversarial prompt-injection defences for customer-facing LLMs"] }),
  s(6, "Use Case: Customer Engagement","bullets", T4, { title: "Use Case: Customer Engagement", bullets: ["LLM-powered omnichannel support agents (deflect 65% of volume)", "Personalised financial wellness coaching via mobile", "Proactive spend insight notifications with nudge theory", "Zero-wait mortgage pre-approval chatbot (<90 seconds)", "Retention: churn propensity model + personalised re-engagement"] }),
  s(7, "Build vs Buy Framework",       "two-col", T4, { title: "Build vs Buy Decision Framework", leftCol: { heading: "Build (Fine-tune / RAG)", items: ["Proprietary data moat advantage", "Full IP ownership & auditability", "Regulatory control & explainability", "Higher upfront investment (6–12mo)"] }, rightCol: { heading: "Buy (API / SaaS Platform)", items: ["Faster time-to-market (6–12 weeks)", "Lower initial investment", "Vendor lock-in & data residency risk", "Limited domain customisation ceiling"] } }),
  s(8, "Apexon Quote",                 "quote",   T4, { quote: "GenAI is not a feature you add to financial services. It is the new operating layer on which differentiated institutions will be built.", attribution: "Apexon AI Practice — Q1 2025 Outlook" }),
  s(9, "Closing",                      "closing", T4, { eyebrow: "Start Your GenAI Journey", title: "Apexon GenAI Practice", subtitle: "ai@apexon.com  ·  apexon.com/genai  ·  Request a Workshop" }),
];

// ── Remaining docs – placeholder image slides ─────────────────────────────────

function imgSlide(n: number, caption: string, color: string): Slide {
  return {
    number: n,
    caption,
    imageUrl: `https://placehold.co/800x450/${color}/ffffff?text=${encodeURIComponent(
      `Slide ${n} – ${caption}`
    )}`,
  };
}

const deck5 = [
  imgSlide(1,  "Executive Summary",           "164e63"),
  imgSlide(2,  "FHIR R4 Architecture Vision", "164e63"),
  imgSlide(3,  "EHR Integration Strategy",    "164e63"),
  imgSlide(4,  "Payer-Provider Exchange",      "164e63"),
  imgSlide(5,  "Patient-Facing APIs",          "164e63"),
  imgSlide(6,  "Security & HIPAA Compliance", "164e63"),
  imgSlide(7,  "Implementation Approach",      "164e63"),
  imgSlide(8,  "Proposed Team Structure",      "164e63"),
  imgSlide(9,  "Timeline & Milestones",        "164e63"),
  imgSlide(10, "Commercial Terms",             "164e63"),
  imgSlide(11, "References",                   "164e63"),
];
const deck6 = [
  imgSlide(1, "The Patient 360 Vision",         "065f46"),
  imgSlide(2, "Data Fragmentation Problem",      "065f46"),
  imgSlide(3, "SMART on FHIR Foundation",        "065f46"),
  imgSlide(4, "Cloud Data Lake Architecture",    "065f46"),
  imgSlide(5, "Real-Time Analytics & CDS",       "065f46"),
  imgSlide(6, "Privacy & Governance",            "065f46"),
  imgSlide(7, "Path Forward with Apexon",        "065f46"),
];
const deck7 = [
  imgSlide(1, "Client: Global Pharma Leader",    "4c1d95"),
  imgSlide(2, "Challenge: Slow Data Processing", "4c1d95"),
  imgSlide(3, "Automated Pipeline Design",       "4c1d95"),
  imgSlide(4, "Regulatory-Grade Data Lineage",   "4c1d95"),
  imgSlide(5, "45% Faster Processing – Results", "4c1d95"),
  imgSlide(6, "Validation & Audit Trail",        "4c1d95"),
  imgSlide(7, "Scalability Achievements",        "4c1d95"),
  imgSlide(8, "Ongoing Partnership",             "4c1d95"),
];
const deck8 = [
  imgSlide(1, "21 CFR Part 11 Overview",          "7f1d1d"),
  imgSlide(2, "Current Compliance Challenges",    "7f1d1d"),
  imgSlide(3, "AI-Assisted Validation",           "7f1d1d"),
  imgSlide(4, "Digital Signature Framework",      "7f1d1d"),
  imgSlide(5, "Automated Testing & Validation",   "7f1d1d"),
  imgSlide(6, "FDA Submission Acceleration",      "7f1d1d"),
  imgSlide(7, "Risk-Based Approach",              "7f1d1d"),
  imgSlide(8, "Apexon Compliance Practice",       "7f1d1d"),
];
const deck9 = [
  imgSlide(1,  "Executive Summary",              "0c4a6e"),
  imgSlide(2,  "Population Health Management",   "0c4a6e"),
  imgSlide(3,  "HEDIS Quality Measures",         "0c4a6e"),
  imgSlide(4,  "Payer-Provider Data Exchange",   "0c4a6e"),
  imgSlide(5,  "Risk Stratification Models",     "0c4a6e"),
  imgSlide(6,  "Care Gap Identification",        "0c4a6e"),
  imgSlide(7,  "Reporting & Analytics Platform", "0c4a6e"),
  imgSlide(8,  "Implementation Roadmap",         "0c4a6e"),
  imgSlide(9,  "Commercial Proposal",            "0c4a6e"),
  imgSlide(10, "References & Credentials",       "0c4a6e"),
];

// ── Exported slide map ────────────────────────────────────────────────────────

export const docSlides: Record<string, Slide[]> = {
  "doc-1": deck1,
  "doc-2": deck2,
  "doc-3": deck3,
  "doc-4": deck4,
  "doc-5": deck5,
  "doc-6": deck6,
  "doc-7": deck7,
  "doc-8": deck8,
  "doc-9": deck9,
};

// ── AI answer ─────────────────────────────────────────────────────────────────

export const aiAnswer: AIAnswer = {
  answer:
    "Modernization of BFSI platforms typically involves microservices, cloud-native architecture, and API-led integration. Leading institutions are adopting event-driven architectures with Kafka for real-time data streaming, containerized workloads on Kubernetes, and zero-trust security frameworks. Key drivers include regulatory compliance (Basel IV, PSD2), cost optimization via cloud migration, and accelerating time-to-market for digital products like embedded finance and BNPL offerings.",
  sources: [
    { id: "src-1", docId: "doc-1", title: "BFSI Lending RFP",             slide: 12, serviceLine: "BFSI" },
    { id: "src-2", docId: "doc-2", title: "Digital Transformation POV",   slide: 5,  serviceLine: "BFSI" },
    { id: "src-3", docId: "doc-3", title: "Payments Modernization Study",  slide: 8,  serviceLine: "BFSI" },
  ],
};

// ── Documents ─────────────────────────────────────────────────────────────────

export const documents: Document[] = [
  { id: "doc-1", title: "BFSI Lending Platform RFP Response",          summary: "Comprehensive RFP response detailing Apexon's approach to modernizing a tier-1 bank's lending origination system with microservices and cloud-native patterns.",                                                                      serviceLine: "BFSI",           type: "RFP",          tags: ["BFSI", "RFP", "Lending", "Cloud"] },
  { id: "doc-2", title: "Digital Transformation in Banking – POV",     summary: "Point of view on how banks can accelerate digital transformation through API-led connectivity, open banking standards, and embedded finance strategies.",                                                                               serviceLine: "BFSI",           type: "POV",          tags: ["BFSI", "POV", "Open Banking"] },
  { id: "doc-3", title: "Payments Modernization Case Study",           summary: "How Apexon helped a regional bank reduce payment processing latency by 60% through real-time event streaming and ISO 20022 migration.",                                                                                                    serviceLine: "BFSI",           type: "Case Study",   tags: ["BFSI", "Payments", "Kafka"] },
  { id: "doc-4", title: "GenAI in Financial Services – Trend Report",  summary: "Analysis of emerging generative AI use cases in wealth management, fraud detection, and hyper-personalized customer engagement for 2025.",                                                                                                serviceLine: "BFSI",           type: "Trend Report", tags: ["BFSI", "GenAI", "Trends"] },
  { id: "doc-5", title: "Healthcare Interoperability RFP",             summary: "RFP response for a large health system seeking FHIR R4-compliant interoperability platform connecting EHR, payer, and patient-facing applications.",                                                                                      serviceLine: "Healthcare",     type: "RFP",          tags: ["Healthcare", "RFP", "FHIR"] },
  { id: "doc-6", title: "Patient 360 – Healthcare POV",                summary: "Strategic POV on building a unified patient data platform using SMART on FHIR, cloud data lakes, and real-time analytics for clinical decision support.",                                                                                 serviceLine: "Healthcare",     type: "POV",          tags: ["Healthcare", "POV", "Analytics"] },
  { id: "doc-7", title: "Clinical Trial Data Management Case Study",   summary: "Apexon enabled a global pharma leader to cut clinical trial data processing time by 45% through automated pipelines and regulatory-grade data lineage.",                                                                                  serviceLine: "Life Sciences",  type: "Case Study",   tags: ["Life Sciences", "Clinical Trials"] },
  { id: "doc-8", title: "Regulatory Compliance Automation – Life Sciences", summary: "POV on leveraging AI-assisted validation, 21 CFR Part 11 compliance automation, and digital signatures to accelerate FDA submission timelines.",                                                                                    serviceLine: "Life Sciences",  type: "POV",          tags: ["Life Sciences", "Compliance", "FDA"] },
  { id: "doc-9", title: "Value-Based Care Platform RFP",               summary: "End-to-end RFP response covering population health management, quality measure reporting (HEDIS), and payer-provider data exchange for value-based contracts.",                                                                          serviceLine: "Healthcare",     type: "RFP",          tags: ["Healthcare", "Value-Based Care"] },
];

// ── Sidebar ───────────────────────────────────────────────────────────────────

export const sidebarItems: SidebarItem[] = [
  { label: "BFSI",          serviceLine: "BFSI",          children: ["RFPs", "POVs", "Case Studies", "Latest Trends"] },
  { label: "Healthcare",    serviceLine: "Healthcare",    children: ["RFPs", "POVs", "Case Studies", "Latest Trends"] },
  { label: "Life Sciences", serviceLine: "Life Sciences", children: ["RFPs", "POVs", "Case Studies", "Latest Trends"] },
];
