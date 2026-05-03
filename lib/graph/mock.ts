import type { GraphDrive, GraphDriveItem } from "./types";

export const MOCK_DRIVE_ID = "mock-drive-documents";

export const MOCK_DRIVES: GraphDrive[] = [
  { id: MOCK_DRIVE_ID, name: "Documents", driveType: "documentLibrary", webUrl: "https://mock.sharepoint.com/sites/apexon/Documents" },
];

// ── Folder items (returned when listing the root) ─────────────────────────────

export const MOCK_ROOT_CHILDREN: GraphDriveItem[] = [
  { id: "mock-folder-bfsi",          name: "BFSI",          lastModifiedDateTime: "2024-03-10T09:00:00Z", folder: { childCount: 3 } },
  { id: "mock-folder-healthcare",    name: "Healthcare",    lastModifiedDateTime: "2024-03-12T11:00:00Z", folder: { childCount: 2 } },
  { id: "mock-folder-life-sciences", name: "Life-Sciences", lastModifiedDateTime: "2024-03-14T14:00:00Z", folder: { childCount: 2 } },
];

// ── BFSI folder ───────────────────────────────────────────────────────────────

const BFSI_BANKING_RFP: GraphDriveItem = {
  id: "mock-file-bfsi-rfp",
  name: "Digital-Banking-RFP-2024.pdf",
  size: 2_450_000,
  lastModifiedDateTime: "2024-01-20T10:30:00Z",
  file: { mimeType: "application/pdf" },
  webUrl: "https://mock.sharepoint.com/sites/apexon/Documents/BFSI/Digital-Banking-RFP-2024.pdf",
  mockSlides: [
    { number: 1, text: "Request for Proposal: Digital Banking Transformation. Issued by First National Bank (FNB), a $120B asset institution serving 4.2M retail and 180K corporate clients. RFP Reference: FNB-DBT-2024-001. FNB seeks a technology partner to modernize its legacy IBM mainframe core banking infrastructure and deliver best-in-class digital experiences across mobile, web, and open banking API channels." },
    { number: 2, text: "Current State: FNB operates a 38-year-old Hogan core banking system with batch-oriented processing. Mobile app load time averages 4.8 seconds against industry benchmark of 1.5s. API availability is 99.2% versus a 99.99% target. Legacy system supports only 12,000 concurrent users while peak demand reaches 45,000. The bank processes 11.2 million transactions daily across ACH, wire, SWIFT, and card rails. Technical debt is estimated at $340M." },
    { number: 3, text: "Project Scope — Phase 1 (Months 1-6): Open Banking API layer using PSD2, FDX, and Open Banking UK standards. Expose 50+ APIs covering accounts, transactions, payments, and identity with FAPI 2.0 security. Phase 2 (Months 7-18): React Native mobile app and micro-frontend web architecture. Phase 3 (Months 19-30): Cloud-native core banking on AWS using microservices, zero-downtime migration by customer cohorts of 500K." },
    { number: 4, text: "Technical Requirements: AWS GovCloud multi-AZ active-active deployment. Real-time fraud detection with <30ms latency processing 1,000 TPS. ISO 20022 native messaging for all payment rails by January 2025 regulatory deadline. Integration with FIS Systematics, Jack Henry Silverlake, and Fiserv card processing. SOC 2 Type II and PCI DSS Level 1 mandatory. Apache Kafka event streaming for real-time analytics. 99.999% uptime SLA for core banking microservices." },
    { number: 5, text: "Vendor Requirements: Minimum 15 years in tier-1 banking technology. At least 5 successful core banking migrations in North America with assets >$50B. AWS Financial Services Competency certification required. CISSP-certified security team. References from 3 current clients willing to join discovery calls. Experience with Temenos, Thought Machine, or Mambu cloud-native platforms. Dedicated center of excellence with minimum 50 FTE commitment." },
    { number: 6, text: "Evaluation Criteria: Technical approach and architecture (30 points), implementation experience (25 points), total 5-year cost of ownership (20 points), innovation and AI/ML roadmap (15 points), risk management and rollback strategy (10 points). Shortlisted vendors will present for 4 hours on-site." },
    { number: 7, text: "Budget: Total program budget $52M over 30 months. Phase 1 API layer $7.5M, Phase 2 digital re-platform $22M, Phase 3 core migration $22.5M. Annual ongoing support $4.2M. Pricing must include fixed-price milestones with 15% holdback pending UAT sign-off. Performance bond of 10% of contract value required." },
    { number: 8, text: "Timeline: RFP Q&A closes February 20, 2024. Proposal deadline March 15, 2024. Shortlist April 1, 2024. Vendor presentations April 8–12, 2024. Contract award May 31, 2024. Program kickoff July 1, 2024. Contact: procurement@fnb.com. Technical queries: sarah.chen@fnb.com (CTO). Commercial: mike.patel@fnb.com (CPO)." },
  ],
};

const BFSI_OPEN_BANKING_POV: GraphDriveItem = {
  id: "mock-file-bfsi-pov",
  name: "Open-Banking-API-POV.pptx",
  size: 1_800_000,
  lastModifiedDateTime: "2024-02-05T14:00:00Z",
  file: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  webUrl: "https://mock.sharepoint.com/sites/apexon/Documents/BFSI/Open-Banking-API-POV.pptx",
  mockSlides: [
    { number: 1, text: "Open Banking: The API Economy Opportunity for Financial Institutions. Apexon Point of View, Q1 2024. The open banking revolution is reshaping BFSI globally. Regulatory mandates (PSD2, Consumer Data Right, FDX) combined with fintech disruption are forcing incumbents to become platform businesses. Banks that embrace open APIs will capture the next wave of embedded finance revenue." },
    { number: 2, text: "Market Reality: PSD2 enabled 400M+ European consumers to share financial data with third parties. UK Open Banking has 7M+ active users and 1B+ API calls per month. In the US, the FDX standard now covers 55M+ consumers. Revenue at stake: McKinsey estimates $200B+ in new banking revenue from open banking by 2025. Early movers show 40% lower customer acquisition costs and 25% higher cross-sell rates." },
    { number: 3, text: "Apexon Open Banking Framework — Three pillars: (1) Consent Management: granular data-sharing controls with full audit trail and revocation. (2) API Gateway: FAPI 2.0 compliant with rate limiting, monetization, and developer portal. (3) Analytics Layer: real-time insights from consented data streams using Kafka + Snowflake. Reference implementations for top-5 US bank, UK challenger bank, and APAC neobank." },
    { number: 4, text: "Implementation Roadmap: 90-day quick win — API inventory and PSD2/FDX gap analysis. 6-month milestone — publish 20 core APIs (accounts, transactions, payments initiation). 12-month target — premium API marketplace with 3rd-party developer ecosystem. 18-month vision — embedded finance products (BNPL, treasury-as-a-service). Technology stack: MuleSoft or Kong for gateway, ForgeRock or Okta for identity, AWS or Azure cloud." },
    { number: 5, text: "Security Architecture: Financial-grade API (FAPI) 2.0 profile with mTLS and DPoP. JWE encryption for all sensitive payloads. PKCE for public clients. Pushed Authorization Requests (PAR). Regular penetration testing against OWASP API Top 10. Incident response SLA: P1 within 15 minutes. Annual CREST-certified security assessment included." },
    { number: 6, text: "Why Apexon: 200+ API transformation engagements. 15 of the top 20 global banks are clients. Average 6 months from kickoff to first production API. FAPI 2.0 certified implementation team. 98% CSAT across financial services engagements. Dedicated BFSI practice with 800+ engineers. Partnerships with MuleSoft (Platinum), Microsoft Azure, AWS Financial Services." },
  ],
};

const BFSI_PAYMENTS_CASE_STUDY: GraphDriveItem = {
  id: "mock-file-bfsi-cs",
  name: "Payments-Modernization-Case-Study.pdf",
  size: 1_200_000,
  lastModifiedDateTime: "2024-01-30T16:45:00Z",
  file: { mimeType: "application/pdf" },
  webUrl: "https://mock.sharepoint.com/sites/apexon/Documents/BFSI/Payments-Modernization-Case-Study.pdf",
  mockSlides: [
    { number: 1, text: "Case Study: Real-Time Payments Modernization for a Top-10 US Regional Bank. Client: Midlands Financial Group (MFG), $85B assets, 3.4M customers, 18 states. Challenge: Legacy ACH-only payments infrastructure unable to support RTP (Real-Time Payments) network, Zelle, or ISO 20022. Apexon delivered a full payments modernization program in 14 months." },
    { number: 2, text: "Problem: MFG was losing high-value commercial clients to competitors offering real-time treasury services. 62% of corporate clients had requested RTP capability. The existing COBOL-based payment engine processed transactions in batch cycles (4x daily), couldn't meet the Fed's FedNow 20-second settlement requirement, and required manual reconciliation for exceptions — costing $3.2M annually in ops overhead." },
    { number: 3, text: "Solution Architecture: Apexon implemented a payment hub using Finastra Payments To Go (cloud-native) on AWS. Key components: ISO 20022 message translation layer (supporting PAIN, PACS, CAMT formats). Real-time liquidity management with intraday credit limits. Fraud scoring via AWS Fraud Detector with 28ms average latency. FedNow and RTP network connectivity via TCH and Federal Reserve APIs. 99.999% uptime achieved via active-active multi-region setup." },
    { number: 4, text: "Outcomes after 12 months in production: RTP transaction volume grew from 0 to 2.1M monthly. Corporate client NPS improved from 34 to 61. Manual reconciliation reduced by 87% saving $2.8M annually. FedNow settlement success rate 99.97%. Time to onboard new payment corridor reduced from 6 weeks to 3 days. Fraud detection accuracy improved to 97.3% with false-positive rate below 0.4%." },
    { number: 5, text: "Implementation Approach: Agile delivery in 6 two-week sprints per quarter. Parallel run strategy: all payments processed on both old and new systems for 60 days before cutover. Zero downtime migration over a single weekend. Test coverage: 2,400 automated test cases covering 98% of payment scenarios. Change management: 3-day training program for 420 operations staff." },
    { number: 6, text: "Testimonial from MFG CTO: 'Apexon delivered the payments modernization on time and under budget. The real-time capability has become a key competitive differentiator — we've already won back 3 major corporate clients who had moved to JPMorgan. The team's depth in ISO 20022 and FedNow was exceptional.' Future: MFG is now planning cross-border ISO 20022 expansion with Apexon in 2024." },
  ],
};

// ── Healthcare folder ─────────────────────────────────────────────────────────

const HC_EHR_RFP: GraphDriveItem = {
  id: "mock-file-hc-rfp",
  name: "EHR-Cloud-Migration-RFP.pdf",
  size: 2_100_000,
  lastModifiedDateTime: "2024-02-10T09:15:00Z",
  file: { mimeType: "application/pdf" },
  webUrl: "https://mock.sharepoint.com/sites/apexon/Documents/Healthcare/EHR-Cloud-Migration-RFP.pdf",
  mockSlides: [
    { number: 1, text: "Request for Proposal: Epic EHR Cloud Migration and HL7 FHIR Enablement. Issuing Organization: MidWest Health System (MWHS). MWHS operates 12 hospitals and 85 outpatient clinics across 5 states with 18,000 employees and 2.1M active patient records. We seek a technology partner to migrate our on-premise Epic EHR to a HIPAA-compliant cloud environment and implement HL7 FHIR R4 APIs for interoperability." },
    { number: 2, text: "Current Environment: Epic EHR (Chronicles) on HPE ProLiant servers, on-premise. 18TB of patient data: structured Epic Chronicles plus unstructured DICOM imaging (8TB, 15M studies) and clinical notes. Current availability 99.7% vs target 99.99%. 12 existing HL7 2.x interfaces via Mirth Connect. PHI subject to HIPAA, HITECH, and 5-state privacy regulations. Annual infrastructure cost: $4.5M." },
    { number: 3, text: "Migration Objectives: Reduce infrastructure TCO by 35% over 5 years. Achieve 99.99% uptime for clinical applications. Enable real-time data exchange via HL7 FHIR R4 with 40+ payer and provider organizations. Support AI/ML workloads for clinical decision support (sepsis prediction, readmission risk scoring). Disaster recovery with RTO <15 minutes and RPO <5 minutes." },
    { number: 4, text: "Technical Scope: Cloud platform selection (AWS GovCloud, Azure Government, or Google Cloud Healthcare API). Epic on-cloud deployment following Epic's cloud readiness framework. Zero clinical-downtime migration strategy. DICOM archive migration using cloud PACS (Ambra or NilRead). HL7 FHIR R4 server implementation. CMS Interoperability Rule compliance for patient access APIs. SMART on FHIR authorization. Integration with existing Meditech billing and PointClickCare post-acute systems." },
    { number: 5, text: "FHIR Requirements: FHIR R4 server supporting 25+ resource types (Patient, Encounter, Observation, MedicationRequest, DiagnosticReport, etc.). Must pass Epic App Orchard certification. Patient access API compliant with CMS 9115-F rule. Bulk FHIR export for payer data exchange. Performance: p95 response <200ms. SMART on FHIR 2.0 authorization with granular scopes. Audit logging for all PHI access." },
    { number: 6, text: "Vendor Requirements: Epic Gold Star partner certification required. AWS Healthcare Competency or Azure Healthcare designation. HITRUST CSF Certified. Minimum 5 Epic cloud migrations with references from health systems >500 beds. Dedicated HIPAA Security Officer assigned to engagement. Full SOC 2 Type II report for cloud platform. Dedicated Epic-certified Technical Account Manager." },
    { number: 7, text: "Budget: Total project $12M. Phase 1 assessment and design $1.5M (3 months). Phase 2 migration and testing $7.5M (9 months). Phase 3 optimization and hypercare $3M (6 months). Target annual cloud cost $2.8M vs current $4.5M on-premise. Submission deadline: April 30, 2024. Contact: it.procurement@mwhs.org, Dr. Rachel Torres, CMIO." },
  ],
};

const HC_PATIENT_POV: GraphDriveItem = {
  id: "mock-file-hc-pov",
  name: "Digital-Patient-Engagement-POV.pptx",
  size: 1_600_000,
  lastModifiedDateTime: "2024-02-18T11:30:00Z",
  file: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  webUrl: "https://mock.sharepoint.com/sites/apexon/Documents/Healthcare/Digital-Patient-Engagement-POV.pptx",
  mockSlides: [
    { number: 1, text: "Digital Patient Engagement: From Episodic Care to Continuous Health Relationships. Apexon Healthcare Practice. The patient engagement gap costs US health systems $150B annually in avoidable readmissions and missed preventive care. Apexon's digital engagement platform connects patients, providers, and payers through a unified omnichannel experience across telehealth, remote monitoring, and mobile health applications." },
    { number: 2, text: "The Engagement Imperative: 40% of patients do not follow post-discharge care plans. No-show rates average 23% for specialist appointments (costing $150/visit). Patients with chronic conditions (diabetes, CHF, COPD) require 3–4 touchpoints per week to maintain adherence. CMS STARS ratings and value-based contracts increasingly tie reimbursement to patient experience scores (CAHPS). Health systems that excel in digital engagement show 18% lower readmission rates." },
    { number: 3, text: "Apexon Engagement Stack: (1) Patient Portal (FHIR-native, SMART-enabled): appointment scheduling, lab results, care plans, secure messaging. (2) Telehealth: WebRTC-based video visits integrated with Epic and Cerner via SMART on FHIR. (3) Remote Patient Monitoring: integrations with 40+ connected devices (Withings, iHealth, Apple HealthKit, Google Fit). (4) AI Care Navigator: NLP-powered chatbot for triage, medication reminders, and care gap closure. Built on AWS HealthLake." },
    { number: 4, text: "Implementation Methodology: 16-week delivery in 4 sprints. Week 1–4: patient portal launch with Epic MyChart integration. Week 5–8: telehealth go-live with 50 pilot providers. Week 9–12: RPM device integration and population health dashboards. Week 13–16: AI care navigator launch with NLP training on 50K historical encounters. Success metrics: portal activation >60%, telehealth utilization >15% of outpatient visits, RPM enrollment >30% of eligible chronic patients." },
    { number: 5, text: "Results from recent engagements: Regional health system (350-bed) achieved 67% portal activation vs 31% pre-implementation. No-show rate dropped from 24% to 11% after SMS reminders with 1-click rescheduling. CHF readmission rate fell 22% over 6 months with daily RPM monitoring. Telehealth adoption reached 18% of outpatient encounters. Patient NPS improved from 42 to 71. CAHPS composite score improved 14 points, directly improving CMS STARS from 3.5 to 4.0." },
  ],
};

// ── Life Sciences folder ──────────────────────────────────────────────────────

const LS_CLINICAL_RFP: GraphDriveItem = {
  id: "mock-file-ls-rfp",
  name: "Clinical-Data-Management-RFP.pdf",
  size: 1_950_000,
  lastModifiedDateTime: "2024-03-01T10:00:00Z",
  file: { mimeType: "application/pdf" },
  webUrl: "https://mock.sharepoint.com/sites/apexon/Documents/Life-Sciences/Clinical-Data-Management-RFP.pdf",
  mockSlides: [
    { number: 1, text: "Request for Proposal: Clinical Data Management Platform Modernization. Issuing Organization: NovaTrial Pharma, a mid-size biopharmaceutical company with 12 active Phase II–III clinical trials across oncology, immunology, and rare disease. NovaTrial seeks a technology partner to replace its legacy Medidata Rave environment with a unified, cloud-native clinical data platform supporting eClinical, RBQM, and regulatory submission." },
    { number: 2, text: "Current Pain Points: Medidata Rave deployment is 8 years old and cannot support decentralized clinical trial (DCT) workflows. Manual data reconciliation between EDC, eTMF, and CTMS takes 3 FTEs full-time. Average query resolution time is 14 days vs industry benchmark of 5 days. Database lock for Phase III oncology trial took 11 months. CDISC CDASH and SDTM mapping is done manually in SAS, creating regulatory submission bottlenecks. eCOA (patient-reported outcomes) captured on paper forms." },
    { number: 3, text: "Scope: Unified eClinical platform covering EDC, CTMS, eTMF, and eCOA. CDISC ODM-XML native data model. Medidata Rave historical data migration (8 years, 22 studies). Risk-Based Quality Management (RBQM) with statistical oversight triggers. Decentralized trial support: eConsent, telehealth integration, home nursing visits, direct-to-patient drug shipment. Integration with AZ and Pfizer site management systems via CTMS APIs." },
    { number: 4, text: "Regulatory Requirements: 21 CFR Part 11 electronic records and signatures compliance. ICH E6(R2) GCP for risk-based monitoring. GDPR and HIPAA dual compliance for US/EU trials. CDISC SDTM and ADaM mapping automation for NDA/BLA submission. Veeva Vault or SharePoint integration for eTMF. FDA Data Standardization Plan (DSP) compliant outputs. EMA Clinical Trials Regulation (EU CTR) submission readiness." },
    { number: 5, text: "Technical Requirements: Cloud-native SaaS platform (AWS or Azure). 99.9% uptime SLA with <4-hour planned maintenance windows (not during active enrollment). Validated system with IQ/OQ/PQ documentation. API-first architecture with RESTful and FHIR R4 endpoints. Role-based access control supporting 15 permission levels across sponsor, CRO, site, and patient roles. Audit trail for all data changes (21 CFR Part 11). Multi-language support for 8 languages." },
    { number: 6, text: "Evaluation and Budget: Scoring: functional fit 35%, technical architecture 25%, implementation methodology 20%, vendor stability 10%, pricing 10%. Budget: $4.5M initial implementation, $1.2M annual SaaS license. Preference for platform that includes RBQM and eCOA to avoid point-solution sprawl. Submission deadline: May 15, 2024. Contact: cdm.procurement@novatrial.com. POC: Dr. Elena Kovacs, VP Clinical Operations." },
  ],
};

const LS_AI_DRUG_POV: GraphDriveItem = {
  id: "mock-file-ls-pov",
  name: "AI-Drug-Discovery-POV.pptx",
  size: 2_300_000,
  lastModifiedDateTime: "2024-03-08T13:00:00Z",
  file: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  webUrl: "https://mock.sharepoint.com/sites/apexon/Documents/Life-Sciences/AI-Drug-Discovery-POV.pptx",
  mockSlides: [
    { number: 1, text: "AI-Accelerated Drug Discovery: From Target Identification to IND in Half the Time. Apexon Life Sciences Practice. Traditional drug discovery takes 4–6 years from target identification to IND filing at a cost of $500M–$1B. AI and ML are compressing this to 18–30 months. Apexon has deployed AI drug discovery capabilities for 6 pharma and biotech clients, cutting preclinical timelines by an average of 43%." },
    { number: 2, text: "Where AI Adds the Most Value: Target Identification — graph neural networks (GNN) analyzing protein interaction networks identify novel drug targets 10x faster than manual literature review. Hit Discovery — generative AI (diffusion models, transformer-based) designs novel molecular scaffolds with desired ADMET profiles. Lead Optimization — multi-parameter optimization using reinforcement learning on quantum chemistry simulations. Biomarker Discovery — multi-omic data integration (genomics, proteomics, metabolomics) using federated learning across hospital networks." },
    { number: 3, text: "Apexon AI Platform for Drug Discovery: Built on AWS and integrated with LabVantage LIMS. Components: (1) Knowledge Graph — 2.3B biomedical entities from PubMed, ChEMBL, UniProt, ClinicalTrials.gov. (2) Molecular Generation Engine — fine-tuned ChemBERTa and DiffSBDD for structure-based drug design. (3) ADMET Predictor — ensemble model (>95% accuracy on Tox21 benchmark). (4) Digital Lab Integration — automated compound synthesis scheduling via robotic lab API (Hamilton, Tecan). Deployed for 3 top-20 pharma companies." },
    { number: 4, text: "Case Study — Oncology Target Validation: Client: Top-10 global pharma, oncology division. Challenge: 18-month backlog in target validation for 40 KRAS pathway candidates. Apexon deployed GNN-based target prioritization model trained on 450K protein structures from PDB and AlphaFold DB. Result: 40 targets ranked in 3 weeks. Top 5 predictions validated in wet lab within 4 months. 2 candidates advanced to hit discovery. Estimated 14-month reduction in preclinical timeline. ROI: $180M in avoided research costs." },
    { number: 5, text: "Why Apexon for AI Drug Discovery: Team of 85 computational chemists, bioinformaticians, and MLOps engineers. AWS Life Sciences Competency Partner. Published 12 peer-reviewed papers on AI-driven ADMET prediction. Regulatory experience: 3 successful IND filings with AI-assisted preclinical packages accepted by FDA. Data partnerships: access to 5M+ proprietary bioactivity assay records via industry consortia. Engagement model: co-innovation with client wet-lab teams, not black-box AI." },
  ],
};

// ── Lookup maps ───────────────────────────────────────────────────────────────

export const MOCK_FOLDER_CHILDREN: Record<string, GraphDriveItem[]> = {
  "mock-folder-bfsi":          [BFSI_BANKING_RFP, BFSI_OPEN_BANKING_POV, BFSI_PAYMENTS_CASE_STUDY],
  "mock-folder-healthcare":    [HC_EHR_RFP, HC_PATIENT_POV],
  "mock-folder-life-sciences": [LS_CLINICAL_RFP, LS_AI_DRUG_POV],
};

export const ALL_MOCK_FILES: GraphDriveItem[] = [
  BFSI_BANKING_RFP,
  BFSI_OPEN_BANKING_POV,
  BFSI_PAYMENTS_CASE_STUDY,
  HC_EHR_RFP,
  HC_PATIENT_POV,
  LS_CLINICAL_RFP,
  LS_AI_DRUG_POV,
];
