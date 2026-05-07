"use client";

import { useState } from "react";
import Link from "next/link";
import type { ServiceLine, AppConfig, DocumentCategory } from "@/types";
import { sidebarItems } from "@/data/mockData";
import type { ChatSession } from "@/lib/chatStorage";
import { groupSessionsByDate } from "@/lib/chatStorage";

interface SidebarProps {
  selectedLine: ServiceLine | null;
  onSelect: (line: ServiceLine | null) => void;
  selectedCategory: DocumentCategory | null;
  onSelectCategory: (line: ServiceLine, category: DocumentCategory) => void;
  config: AppConfig;
  onOpenSettings: () => void;
  onGoHome: () => void;
  onNewChat: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  appMode: "knowledge" | "research";
  onSetAppMode: (mode: "knowledge" | "research") => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({
  selectedLine, onSelect, config, onOpenSettings, onGoHome, onNewChat,
  selectedCategory, onSelectCategory,
  sessions, activeSessionId, onSelectSession, onDeleteSession,
  appMode, onSetAppMode,
  isOpen, onClose,
}: SidebarProps) {
  const [serviceExpanded, setServiceExpanded] = useState<Record<string, boolean>>({
    BFSI: true,
    Healthcare: false,
    "Life Sciences": false,
  });
  const [researchOpen,    setResearchOpen]    = useState(true);
  const [historyOpen,     setHistoryOpen]     = useState(true);
  const [hoveredSession,  setHoveredSession]  = useState<string | null>(null);

  const toggleService = (label: string) =>
    setServiceExpanded((prev) => ({ ...prev, [label]: !prev[label] }));

  const handleServiceClick = (line: ServiceLine, label: string) => {
    onSelect(line);
    toggleService(label);
    onClose?.();
  };

  const groups = groupSessionsByDate(sessions);

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onClose}
        />
      )}
    <aside
      className={`flex flex-col h-screen shrink-0 overflow-hidden z-50
        fixed md:relative top-0 left-0
        transition-transform duration-300 ease-in-out
        ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}
      style={{ width: 260, backgroundColor: "#0F172A" }}
    >
      {/* ── Logo ── */}
      <button
        onClick={onGoHome}
        className="px-6 py-5 border-b border-slate-700 text-left hover:bg-slate-800 transition-colors shrink-0"
      >
        <span className="text-white font-bold text-lg tracking-tight">Apexon</span>
        <span className="ml-1 text-sky-400 font-bold text-lg">KnowledgeHub</span>
      </button>

      {/* ── New Chat ── */}
      <div className="px-4 py-3 border-b border-slate-700 shrink-0">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-sm font-semibold transition-colors shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* ── Tools ── */}
      <div className="px-3 py-2 border-b border-slate-700 shrink-0">
        <Link
          href="/slide-composer"
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          Slide Composer
        </Link>
      </div>

      {/* ── Services (top, always visible, scrollable) ── */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 min-h-0">
        <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
          Services
        </p>

        {sidebarItems.map((item) => {
          const isOpen   = serviceExpanded[item.label];
          const isActive = selectedLine === item.serviceLine;

          return (
            <div key={item.label} className="mb-1">
              <button
                onClick={() => handleServiceClick(item.serviceLine, item.label)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-sky-600 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <span>{item.label}</span>
                <svg
                  className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {isOpen && (
                <div className="mt-1 ml-3 pl-3 border-l border-slate-700 space-y-0.5">
                  {item.children.map((child) => (
                    <button
                      key={child}
                      onClick={() => onSelectCategory(item.serviceLine, child as DocumentCategory)}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                        isActive && selectedCategory === child
                          ? "text-white bg-slate-800 ring-1 ring-sky-400"
                          : "text-slate-400 hover:text-white hover:bg-slate-800"
                      }`}
                    >
                      {child}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

      </nav>

      {/* ── Recent Chats (collapsible, middle) ── */}
      <div className="border-t border-slate-700 shrink-0 flex flex-col" style={{ maxHeight: historyOpen ? 320 : 44 }}>
        {/* Toggle header */}
        <button
          onClick={() => setHistoryOpen((p) => !p)}
          className="w-full flex items-center justify-between px-5 py-3 text-xs font-semibold uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors"
        >
          <span className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Recent Chats
          </span>
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${historyOpen ? "" : "-rotate-90"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {historyOpen && (
          <div className="overflow-y-auto px-3 pb-2" style={{ maxHeight: 276 }}>

            {/* ── Chat history groups ── */}
            {groups.map((group) => (
              <div key={group.label} className="mb-3">
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  {group.label}
                </p>
                {group.items.map((session) => {
                  const isActive = session.id === activeSessionId;
                  return (
                    <div
                      key={session.id}
                      className="relative group/item"
                      onMouseEnter={() => setHoveredSession(session.id)}
                      onMouseLeave={() => setHoveredSession(null)}
                    >
                      <button
                        onClick={() => onSelectSession(session.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors leading-snug ${
                          isActive
                            ? "bg-slate-700 text-white"
                            : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                        }`}
                      >
                        <span className="line-clamp-2 pr-5">{session.title}</span>
                      </button>
                      {hoveredSession === session.id && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-slate-700 transition-colors"
                          title="Delete"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-4 py-3 border-t border-slate-700 flex items-center justify-between shrink-0">
        <div>
          <p className="text-xs text-slate-500">© 2026 Apexon Inc.</p>
          {config.folderPath && (
            <p className="text-[10px] text-emerald-500 mt-0.5 truncate max-w-[160px]">
              ● {config.aiProvider === "ollama"  ? config.ollamaModel   || "Ollama"
                : config.aiProvider === "gemini" ? config.geminiModel   || "Gemini"
                : config.openrouterModel || "OpenRouter"}
            </p>
          )}
        </div>
        <button
          onClick={onOpenSettings}
          title="Settings"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
          </svg>
        </button>
      </div>
    </aside>
    </>
  );
}
