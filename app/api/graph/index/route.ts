import { NextRequest, NextResponse } from "next/server";
import { getAllFiles } from "@/lib/graph/client";
import { indexExtractedDocs } from "@/lib/rag/indexer";
import { extractDoc } from "@/lib/extractors";
import type { GraphConfig } from "@/lib/graph/types";
import type { ExtractedDoc } from "@/lib/extractors";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: {
    driveId: string;
    mockMode?: boolean;
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    siteUrl?: string;
    ollamaBaseUrl?: string;
    embedModel?: string;
    embeddingProvider?: "ollama" | "google";
    googleApiKey?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    driveId,
    mockMode = true,
    tenantId = "",
    clientId = "",
    clientSecret = "",
    siteUrl = "",
    ollamaBaseUrl = "http://localhost:11434",
    embedModel = "bge-large",
    embeddingProvider = "ollama" as "ollama" | "google",
    googleApiKey = "",
  } = body;

  if (!driveId) return NextResponse.json({ error: "Missing driveId" }, { status: 400 });

  const config: GraphConfig = { tenantId, clientId, clientSecret, siteUrl, driveId, mockMode };
  const sourceKey = `graph:${driveId}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        send({ msg: "Fetching file list from SharePoint…" });
        const files = await getAllFiles(config, driveId);
        send({ msg: `Found ${files.length} file(s). Processing…` });

        const docs: ExtractedDoc[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          send({ msg: `[${i + 1}/${files.length}] ${file.name}` });

          if (file.mockSlides) {
            // Mock path — slides are pre-extracted
            const ext = file.name.split(".").pop()?.toLowerCase() as "pdf" | "pptx";
            docs.push({
              fileName: file.name,
              filePath: `graph:${driveId}:${file.id}`,
              fileType: ext === "pptx" ? "pptx" : "pdf",
              totalSlides: file.mockSlides.length,
              slides: file.mockSlides,
            });
          } else {
            // Real Graph path — download binary and extract
            try {
              const { downloadItem } = await import("@/lib/graph/client");
              const buffer = await downloadItem(config, driveId, file.id);
              // Write to a temp file so extractDoc can read it
              const os = await import("os");
              const path = await import("path");
              const fs = await import("fs/promises");
              const tmpPath = path.join(os.tmpdir(), `kh-graph-${file.id}-${file.name}`);
              await fs.writeFile(tmpPath, buffer);
              try {
                const doc = await extractDoc(tmpPath);
                docs.push({ ...doc, fileName: file.name, filePath: `graph:${driveId}:${file.id}` });
              } finally {
                await fs.unlink(tmpPath).catch(() => {});
              }
            } catch {
              send({ msg: `  ⚠ Skipping ${file.name}: download/extraction failed` });
            }
          }
        }

        const result = await indexExtractedDocs(sourceKey, docs, ollamaBaseUrl, embedModel, (msg) => send({ msg }), embeddingProvider, googleApiKey);
        send({ done: true, ...result });
      } catch (err) {
        send({ error: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
