import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { indexExtractedDocs } from "@/lib/rag/indexer";
import { extractDoc } from "@/lib/extractors";
import { join } from "path";
import { tmpdir } from "os";
import { writeFile, unlink } from "fs/promises";
import { resolveAiConfig } from "@/lib/serverConfig";
import type { ExtractedDoc } from "@/lib/extractors";

export const maxDuration = 300;

const GRAPH = "https://graph.microsoft.com/v1.0";

interface SyncBody {
  itemIds:           string[];
  folderItemId?:     string;
  syncFolderMode?:   boolean;
  ollamaBaseUrl?:    string;
  embedModel?:       string;
  embeddingProvider?: "ollama" | "google";
  enableAssetLlmEnrichment?: boolean;
  aiProvider?: "ollama" | "openrouter" | "gemini";
  ollamaModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
}

async function listFilesRecursive(token: string, itemId: string): Promise<{ id: string; name: string }[]> {
  const url = `${GRAPH}/me/drive/items/${itemId}/children?$select=id,name,folder,file`;
  const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph ${res.status}`);
  const data = await res.json();
  const files: { id: string; name: string }[] = [];
  for (const item of data.value ?? []) {
    if (item.folder) {
      files.push(...await listFilesRecursive(token, item.id));
    } else if (/\.(pdf|pptx)$/i.test(item.name)) {
      files.push({ id: item.id, name: item.name });
    }
  }
  return files;
}

async function downloadItem(token: string, itemId: string): Promise<Buffer> {
  const res = await fetch(`${GRAPH}/me/drive/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getServerSession(authOptions);
  const token   = (session as Record<string, unknown> | null)?.accessToken as string | undefined;
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: SyncBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const {
    itemIds,
    folderItemId,
    syncFolderMode = false,
  } = body;
  const aiConfig = resolveAiConfig({
    ollamaBaseUrl: body.ollamaBaseUrl,
    ollamaModel: body.ollamaModel,
    ollamaEmbedModel: body.embedModel,
    aiProvider: body.aiProvider,
    openrouterApiKey: body.openrouterApiKey,
    openrouterModel: body.openrouterModel,
    geminiApiKey: body.geminiApiKey,
    geminiModel: body.geminiModel,
    embeddingProvider: body.embeddingProvider,
  });

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (payload: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        let filesToProcess: { id: string; name: string }[] = [];

        if (syncFolderMode && folderItemId) {
          send({ msg: "Scanning folder for PDF/PPTX files…" });
          filesToProcess = await listFilesRecursive(token, folderItemId);
        } else {
          filesToProcess = itemIds.map((id) => ({ id, name: id }));
        }

        send({ msg: `Found ${filesToProcess.length} file(s). Downloading…` });

        const docs: ExtractedDoc[] = [];
        for (let i = 0; i < filesToProcess.length; i++) {
          const file = filesToProcess[i];
          send({ msg: `[${i + 1}/${filesToProcess.length}] ${file.name}` });

          try {
            // Fetch name if we only have an ID (non-folder mode)
            let fileName = file.name;
            if (!fileName.includes(".")) {
              const meta = await fetch(`${GRAPH}/me/drive/items/${file.id}?$select=name`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (meta.ok) fileName = (await meta.json()).name ?? fileName;
            }

            const buffer  = await downloadItem(token, file.id);
            const tmpPath = join(tmpdir(), `kh-od-${file.id}-${fileName}`);
            await writeFile(tmpPath, buffer);

            try {
              const doc = await extractDoc(tmpPath);
              docs.push({ ...doc, fileName, filePath: `onedrive:${file.id}` });
            } finally {
              await unlink(tmpPath).catch(() => {});
            }
          } catch (e) {
            send({ msg: `  ⚠ Skipping: ${String(e)}` });
          }
        }

        const sourceKey = "onedrive:me";
        const result = await indexExtractedDocs(
          sourceKey,
          docs,
          aiConfig.ollamaBaseUrl ?? "http://localhost:11434",
          aiConfig.ollamaEmbedModel ?? "bge-large",
          (msg) => send({ msg }),
          aiConfig.embeddingProvider,
          aiConfig.geminiApiKey,
          {
            enableAssetLlmEnrichment: Boolean(body.enableAssetLlmEnrichment),
            assetLlmConfig: aiConfig,
          }
        );
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
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      Connection:      "keep-alive",
    },
  });
}
