import type { Source, Document, ServiceLine } from "@/types";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StoredAgentLogEntry {
  iteration: number;
  tool: string;
  query: string;
  found: number;
  tokens?: number;
}

export interface StoredTokenUsage {
  agentTokens: number;
  synthesisTokens: number;
  totalTokens: number;
}

// Docs stored without slides text (too large for localStorage)
export interface StoredDoc {
  id: string;
  title: string;
  summary: string;
  filePath?: string;
  fileType?: "pdf" | "pptx";
  totalSlides?: number;
  serviceLine: ServiceLine;
  type: string;
  tags: string[];
}

export interface StoredTurn {
  id: string;
  query: string;
  answer?: string;
  keyPoints?: string[];
  metrics?: string[];
  sources?: Source[];
  docs?: StoredDoc[];
  agentLog?: StoredAgentLogEntry[];
  tokenUsage?: StoredTokenUsage;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  turns: StoredTurn[];
}

// ── Storage helpers ────────────────────────────────────────────────────────────

const SESSIONS_KEY  = "apexon-hub-sessions";
const MAX_SESSIONS  = 50;

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatSession[];
  } catch {
    return [];
  }
}

export function saveSession(session: ChatSession): void {
  try {
    const all = loadSessions();
    const idx = all.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      all[idx] = session;
    } else {
      all.unshift(session);
    }
    // Keep newest MAX_SESSIONS, drop the rest
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(all.slice(0, MAX_SESSIONS)));
  } catch {
    // localStorage full — try removing oldest sessions until it fits
    try {
      const all = loadSessions().slice(0, 10);
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(all));
    } catch { /* give up */ }
  }
}

export function deleteSession(id: string): void {
  try {
    const all = loadSessions().filter((s) => s.id !== id);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

// Strip large slides text before persisting — keeps localStorage lean
export function stripDocsForStorage(docs?: Document[]): StoredDoc[] | undefined {
  if (!docs) return undefined;
  return docs.map(({ id, title, summary, serviceLine, type, tags, ...rest }) => ({
    id,
    title,
    summary,
    serviceLine,
    type,
    tags,
    filePath:    (rest as { filePath?: string }).filePath,
    fileType:    (rest as { fileType?: "pdf" | "pptx" }).fileType,
    totalSlides: (rest as { totalSlides?: number }).totalSlides,
  }));
}

// Group sessions by relative date for sidebar display
export function groupSessionsByDate(sessions: ChatSession[]): { label: string; items: ChatSession[] }[] {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86_400_000;
  const last7days = today - 6 * 86_400_000;
  const last30days = today - 29 * 86_400_000;

  const groups: { label: string; items: ChatSession[] }[] = [
    { label: "Today",       items: [] },
    { label: "Yesterday",   items: [] },
    { label: "Last 7 days", items: [] },
    { label: "Last 30 days",items: [] },
    { label: "Older",       items: [] },
  ];

  for (const session of sessions) {
    const t = new Date(session.createdAt).getTime();
    if      (t >= today)     groups[0].items.push(session);
    else if (t >= yesterday) groups[1].items.push(session);
    else if (t >= last7days) groups[2].items.push(session);
    else if (t >= last30days)groups[3].items.push(session);
    else                     groups[4].items.push(session);
  }

  return groups.filter((g) => g.items.length > 0);
}
