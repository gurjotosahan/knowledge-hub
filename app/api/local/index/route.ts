import { NextRequest, NextResponse } from "next/server";
import { buildIndex, getIndexStatus } from "@/lib/rag/indexer";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const folderPath = req.nextUrl.searchParams.get("folderPath");
  if (!folderPath) {
    return NextResponse.json({ error: "Missing folderPath" }, { status: 400 });
  }
  const status = await getIndexStatus(folderPath);
  return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
  let body: {
    folderPath: string;
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
    folderPath,
    ollamaBaseUrl = "http://localhost:11434",
    embedModel = "bge-large",
    embeddingProvider = "ollama",
    googleApiKey = "",
  } = body;

  if (!folderPath) {
    return NextResponse.json({ error: "Missing folderPath" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        const result = await buildIndex(
          folderPath,
          ollamaBaseUrl,
          embedModel,
          (msg) => send({ msg }),
          embeddingProvider,
          googleApiKey
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
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
