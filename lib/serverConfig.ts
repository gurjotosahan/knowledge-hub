import type { AgentConfig } from "@/lib/rag/agent";

interface AiConfigInput {
  aiProvider?: "ollama" | "openrouter" | "gemini";
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaEmbedModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  embeddingProvider?: "ollama" | "google";
  tavilyApiKey?: string;
  searchMode?: "rag" | "mixed";
}

const env = (name: string) => process.env[name]?.trim() || undefined;

export function resolveAiConfig(input: AiConfigInput): AgentConfig {
  // Prefer passed API keys, fall back to env variables
  const openrouterApiKey = input.openrouterApiKey || env("OPENROUTER_API_KEY");
  const geminiApiKey = input.geminiApiKey || env("GEMINI_API_KEY") || env("GOOGLE_API_KEY");
  
  return {
    aiProvider: input.aiProvider ?? "ollama",
    ollamaBaseUrl: input.ollamaBaseUrl ?? env("OLLAMA_BASE_URL") ?? "http://localhost:11434",
    ollamaModel: input.ollamaModel ?? env("OLLAMA_MODEL"),
    ollamaEmbedModel: input.ollamaEmbedModel ?? env("OLLAMA_EMBED_MODEL") ?? "bge-large",
    openrouterApiKey: openrouterApiKey,
    openrouterModel: input.openrouterModel ?? env("OPENROUTER_MODEL"),
    geminiApiKey: geminiApiKey,
    geminiModel: input.geminiModel ?? env("GEMINI_MODEL"),
    embeddingProvider: input.embeddingProvider ?? (env("EMBEDDING_PROVIDER") as "ollama" | "google" | undefined) ?? "ollama",
    tavilyApiKey: env("TAVILY_API_KEY"),
    searchMode: input.searchMode,
  };
}

export function resolveGraphSecret(): string {
  return env("AZURE_CLIENT_SECRET") ?? env("GRAPH_CLIENT_SECRET") ?? "";
}
