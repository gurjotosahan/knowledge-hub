import type { WebResult } from "@/lib/rag/agent";

interface JsonRpcResponse<T = unknown> {
  result?: T;
  error?: { message?: string };
}

interface ToolInfo {
  name: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
  };
}

interface ToolCallResult {
  content?: Array<{ type?: string; text?: string }>;
}

const DEFAULT_PARALLEL_MCP_URL = "https://search.parallel.ai/mcp";

export function isParallelMcpEnabled(): boolean {
  return process.env.PARALLEL_MCP_DISABLED?.trim().toLowerCase() !== "true";
}

function parseSseOrJson<T>(raw: string): T {
  const trimmed = raw.trim();
  if (!trimmed) return {} as T;
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as T;

  const data = trimmed
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n")
    .trim();

  return data ? JSON.parse(data) as T : {} as T;
}

function textFromToolResult(result: ToolCallResult): string {
  return (result.content ?? [])
    .map((item) => item.text ?? "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function getToolArgName(tool: ToolInfo | undefined, candidates: string[], fallback: string): string {
  const props = tool?.inputSchema?.properties ?? {};
  return candidates.find((name) => Object.prototype.hasOwnProperty.call(props, name)) ?? fallback;
}

function extractUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s)\]>"']+/g)) {
    urls.add(match[0].replace(/[.,;:]+$/g, ""));
  }
  return [...urls].slice(0, 5);
}

function titleFromFetched(url: string, markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 160);
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

class ParallelMcpClient {
  private nextId = 1;
  private sessionId: string | null = null;

  constructor(
    private readonly url: string,
    private readonly apiKey?: string
  ) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  private async request<T>(method: string, params?: unknown): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId++,
        method,
        ...(params === undefined ? {} : { params }),
      }),
      signal: AbortSignal.timeout(25_000),
    });

    const sessionId = res.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;
    if (!res.ok) throw new Error(`Parallel MCP ${res.status}`);

    const parsed = parseSseOrJson<JsonRpcResponse<T>>(await res.text());
    if (parsed.error) throw new Error(parsed.error.message ?? "Parallel MCP error");
    return parsed.result as T;
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "knowledge-hub", version: "0.1.0" },
    });
    await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  async listTools(): Promise<ToolInfo[]> {
    const result = await this.request<{ tools?: ToolInfo[] }>("tools/list");
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.request<ToolCallResult>("tools/call", { name, arguments: args });
    return textFromToolResult(result);
  }
}

export async function searchWithParallelMcp(query: string): Promise<WebResult[]> {
  if (!isParallelMcpEnabled()) return [];

  const url = process.env.PARALLEL_MCP_URL?.trim() || DEFAULT_PARALLEL_MCP_URL;
  const apiKey = process.env.PARALLEL_API_KEY?.trim() || undefined;
  const client = new ParallelMcpClient(url, apiKey);

  await client.initialize();
  const tools = await client.listTools();
  const searchTool = tools.find((tool) => tool.name === "web_search" || tool.name === "web_search_preview");
  const fetchTool = tools.find((tool) => tool.name === "web_fetch");
  if (!searchTool) return [];

  const searchArg = getToolArgName(searchTool, ["objective", "query"], "query");
  const searchProps = searchTool.inputSchema?.properties ?? {};
  const searchArgs: Record<string, unknown> = { [searchArg]: query };
  if (Object.prototype.hasOwnProperty.call(searchProps, "search_queries")) {
    searchArgs.search_queries = [query];
  }

  const searchText = await client.callTool(searchTool.name, searchArgs);
  const urls = extractUrls(searchText);

  if (!fetchTool || urls.length === 0) {
    return [{
      title: "Parallel web search",
      url,
      content: searchText.slice(0, 8_000),
      extracted: false,
    }];
  }

  const urlsArg = getToolArgName(fetchTool, ["urls", "url"], "urls");
  const objectiveArg = getToolArgName(fetchTool, ["objective", "query"], "objective");
  const fetchProps = fetchTool.inputSchema?.properties ?? {};
  const fetchArgs: Record<string, unknown> = {
    [urlsArg]: urls,
    [objectiveArg]: query,
  };
  if (Object.prototype.hasOwnProperty.call(fetchProps, "search_queries")) {
    fetchArgs.search_queries = [query];
  }
  if (Object.prototype.hasOwnProperty.call(fetchProps, "full_content")) {
    fetchArgs.full_content = true;
  }

  const fetchText = await client.callTool(fetchTool.name, fetchArgs);

  return urls.map((resultUrl) => ({
    title: titleFromFetched(resultUrl, fetchText),
    url: resultUrl,
    content: fetchText.slice(0, 8_000),
    extracted: true,
  }));
}
