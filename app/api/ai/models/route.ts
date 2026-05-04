import { NextRequest, NextResponse } from "next/server";

interface ModelEntry {
  id: string;
  name: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const provider = searchParams.get("provider") ?? "ollama";
  const baseUrl  = searchParams.get("baseUrl") ?? "http://localhost:11434";
  const apiKey   = provider === "gemini"
    ? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? ""
    : process.env.OPENROUTER_API_KEY ?? "";

  if (provider === "ollama") {
    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models: ModelEntry[] = (data.models ?? []).map((m: { name: string }) => ({
        id: m.name,
        name: m.name,
      }));
      return NextResponse.json({ models });
    } catch (err) {
      return NextResponse.json(
        { error: `Cannot reach Ollama at ${baseUrl}: ${String(err)}` },
        { status: 502 }
      );
    }
  }

  if (provider === "openrouter") {
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENROUTER_API_KEY in .env.local. Add it and restart the dev server." },
        { status: 400 }
      );
    }
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Filter to popular LLM families; free models sorted first
      const KEEP = /llama|mistral|gemma|qwen|deepseek|claude|gpt|gemini|phi|nvidia|nemotron|meta|microsoft|cohere|command/i;
      const all: { id: string; name?: string }[] = (data.data ?? []).filter(
        (m: { id: string }) => KEEP.test(m.id)
      );
      const free = all.filter((m) => m.id.endsWith(":free"));
      const paid = all.filter((m) => !m.id.endsWith(":free"));
      const models: ModelEntry[] = [...free, ...paid].slice(0, 80).map((m) => ({
        id: m.id,
        name: (m.name ?? m.id) + (m.id.endsWith(":free") ? " (free)" : ""),
      }));
      return NextResponse.json({ models });
    } catch (err) {
      return NextResponse.json(
        { error: `OpenRouter error: ${String(err)}` },
        { status: 502 }
      );
    }
  }

  if (provider === "gemini") {
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY or GOOGLE_API_KEY in .env.local. Add it and restart the dev server." },
        { status: 400 }
      );
    }
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models: ModelEntry[] = (data.models ?? [])
        .filter((m: { name: string }) => m.name.includes("gemini"))
        .map((m: { name: string; displayName?: string }) => ({
          id: m.name.replace("models/", ""),
          name: m.displayName ?? m.name.replace("models/", ""),
        }));
      return NextResponse.json({ models });
    } catch (err) {
      return NextResponse.json(
        { error: `Google AI Studio error: ${String(err)}` },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
}
