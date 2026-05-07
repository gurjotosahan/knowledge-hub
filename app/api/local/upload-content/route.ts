import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { appendExtractedDocs } from "@/lib/rag/indexer";
import { extractDoc } from "@/lib/extractors";
import { resolveAiConfig } from "@/lib/serverConfig";
import type { ExtractedDoc } from "@/lib/extractors";

export const maxDuration = 300;

const UPLOAD_DIR = join(homedir(), ".knowledge-hub", "uploads");

function safeFileName(name: string): string {
  const cleaned = name.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
  const fallback = `upload-${Date.now()}`;
  return cleaned || fallback;
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const files = form.getAll("files").filter((item): item is File => item instanceof File);
  if (!files.length) {
    return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
  }

  const unsupported = files.find((file) => !/\.(docx|pptx|pdf)$/i.test(file.name));
  if (unsupported) {
    return NextResponse.json(
      { error: "Only Word (.docx), PowerPoint (.pptx), and PDF (.pdf) files are supported." },
      { status: 400 }
    );
  }

  const aiConfig = resolveAiConfig({
    ollamaBaseUrl: String(form.get("ollamaBaseUrl") ?? ""),
    ollamaEmbedModel: String(form.get("embedModel") ?? ""),
    embeddingProvider: form.get("embeddingProvider") === "google" ? "google" : "ollama",
  });

  const targetFolder = String(form.get("targetFolder") ?? "").trim() || UPLOAD_DIR;
  await mkdir(targetFolder, { recursive: true });
  const saved: string[] = [];

  for (const [index, file] of files.entries()) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = file.name.match(/\.[^.]+$/)?.[0] ?? "";
    const base = safeFileName(file.name.replace(/\.[^.]+$/, ""));
    const path = join(targetFolder, `${base}-${Date.now()}-${index}${ext.toLowerCase()}`);
    await writeFile(path, bytes);
    saved.push(path);
  }

  const docs: ExtractedDoc[] = [];
  for (const path of saved) {
    docs.push(await extractDoc(path));
  }

  const result = await appendExtractedDocs(
    targetFolder,
    docs,
    aiConfig.ollamaBaseUrl ?? "http://localhost:11434",
    aiConfig.ollamaEmbedModel ?? "bge-large",
    () => {},
    aiConfig.embeddingProvider,
    aiConfig.geminiApiKey
  );

  return NextResponse.json({
    folderPath: targetFolder,
    files: saved.length,
    chunks: result.chunks,
    indexedFiles: result.files,
    totalChunks: result.totalChunks,
    totalFiles: result.totalFiles,
  });
}
