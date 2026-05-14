import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { extractDoc } from "@/lib/extractors";

export const dynamic = "force-dynamic";

interface ExtractedRFP {
  clientName?: string;
  industry?: string;
  rfpTitle?: string;
  deadline?: string;
  objective?: string;
  businessProblem?: string;
  evaluationCriteria?: string;
  mandatoryRequirements?: string;
  competitors?: string;
}

function parseRFPExtractedText(text: string): ExtractedRFP {
  const result: ExtractedRFP = {};
  const lowerText = text.toLowerCase();

  // Client name - try to find after "client:", "prepared for:", "to:" or first prominent company name
  const clientMatch = text.match(/(?:client|prepared for|to|company)[\s:]+([A-Z][a-zA-Z\s&]+?)(?:\n|,|deadline|industry)/i);
  if (clientMatch) result.clientName = clientMatch[1].trim();

  // Industry - more flexible matching
  const industryKeywords = ["banking", "healthcare", "pharma", "pharmaceutical", "insurance", "retail", "manufacturing", "technology", "finance", "automotive", "energy", "telecom"];
  for (const ind of industryKeywords) {
    if (lowerText.includes(ind)) {
      result.industry = ind.charAt(0).toUpperCase() + ind.slice(1);
      break;
    }
  }

  // Deadline - more flexible
  const deadlineMatch = text.match(/(?:deadline|submission due|due date|submission deadline)[\s:]+([A-Za-z0-9,\s]+?)(?:\n|$)/i);
  if (deadlineMatch) result.deadline = deadlineMatch[1].trim();

  // Business Problem - look for various patterns
  const problemPatterns = [
    /(?:problem statement|business problem|business need|background|challenge)[\s\n:]+([\s\S]{30,600}?)(?=\n[A-Z][a-zA-Z]{3,}|$)/i,
    /(?:current state|existing system)[\s\S]{10,200}?(?=\n[A-Z]|$)/i,
  ];
  for (const pattern of problemPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.businessProblem = match[1].trim().substring(0, 500);
      break;
    }
  }

  // Objective - more flexible
  const objectivePatterns = [
    /(?:objective|goal|purpose|vision)[\s\n:]+([\s\S]{20,400}?)(?=\n[A-Z][a-zA-Z]{3,}|scope|requirements|$)/i,
  ];
  for (const pattern of objectivePatterns) {
    const match = text.match(pattern);
    if (match) {
      result.objective = match[1].trim().substring(0, 400);
      break;
    }
  }

  // Evaluation Criteria
  const criteriaPatterns = [
    /(?:evaluation criteria|selection criteria|scoring|weighted criteria|evaluation methodology)[\s\n:]+([\s\S]{30,1000}?)(?=\n[A-Z][a-zA-Z]{3,}|scope|$)/i,
  ];
  for (const pattern of criteriaPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.evaluationCriteria = match[1].trim().substring(0, 800);
      break;
    }
  }

  // Mandatory Requirements
  const mandatoryPatterns = [
    /(?:mandatory requirements|must have|required minimum|mandatory|requirements)[\s\n:]+([\s\S]{30,800}?)(?=\n[A-Z][a-zA-Z]{3,}|$)/i,
  ];
  for (const pattern of mandatoryPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.mandatoryRequirements = match[1].trim().substring(0, 600);
      break;
    }
  }

  // Competitors
  const competitorPatterns = [
    /(?:competitors|vendors|bidders|proposers|existing vendors|current vendors)[\s:]+([\s\S]{10,300}?)(?:\n|$)/i,
  ];
  for (const pattern of competitorPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.competitors = match[1].trim().substring(0, 200);
      break;
    }
  }

  // RFP Title - use first non-empty line if it looks like a title
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length > 0 && lines[0].length < 100 && !lines[0].toLowerCase().includes("page")) {
    result.rfpTitle = lines[0].trim();
  }

  return result;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const extension = path.extname(file.name).toLowerCase();
    const allowedExtensions = [".pdf", ".docx", ".pptx", ".txt"];

    if (!allowedExtensions.includes(extension)) {
      return NextResponse.json({ error: "Only PDF, DOCX, PPTX, and TXT files are supported" }, { status: 400 });
    }

    // Save uploaded file temporarily
    const tempDir = path.join(os.tmpdir(), "rfp-extract-" + Date.now());
    await fs.mkdir(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, file.name);
    const buffer = await file.arrayBuffer();
    await fs.writeFile(tempPath, Buffer.from(buffer));

    try {
      let text = "";

      if (extension === ".txt") {
        text = await fs.readFile(tempPath, "utf8");
      } else if (extension === ".docx" || extension === ".pdf" || extension === ".pptx") {
        const doc = await extractDoc(tempPath);
        text = doc.slides.map((slide) => slide.text).join("\n\n");
      }

      const extracted = parseRFPExtractedText(text);

      return NextResponse.json({
        success: true,
        extracted,
        text,
        message: "Document processed successfully",
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error("Extract RFP error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    message: "RFP Document Extractor",
    usage: "POST with multipart form containing .pdf, .docx, .pptx, or .txt file",
  });
}
