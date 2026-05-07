import { NextResponse } from "next/server";

const env = (name: string) => process.env[name]?.trim() || "";

export async function GET() {
  return NextResponse.json({
    sourceType:        "local",
    folderPath:        env("DEFAULT_FOLDER_PATH"),
    aiProvider:        env("DEFAULT_AI_PROVIDER") || "openrouter",
    ollamaBaseUrl:     env("OLLAMA_BASE_URL") || "http://localhost:11434",
    ollamaModel:       env("OLLAMA_MODEL") || "",
    ollamaEmbedModel:  env("OLLAMA_EMBED_MODEL") || "bge-large",
    openrouterModel:   env("DEFAULT_OPENROUTER_MODEL") || "",
    geminiModel:       env("DEFAULT_GEMINI_MODEL") || "",
    embeddingProvider: env("DEFAULT_EMBEDDING_PROVIDER") || "ollama",
    // Keys are intentionally NOT returned — they stay server-side only.
    // The query/slide-search routes read them directly from process.env.
  });
}
