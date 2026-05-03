"use client";

import { useState, useRef, useEffect } from "react";

interface ChatInputProps {
  onSend: (query: string) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export default function ChatInput({ onSend, isLoading, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  }, [value]);

  const send = () => {
    const q = value.trim();
    if (!q || isLoading || disabled) return;
    onSend(q);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  };

  return (
    <div className="flex items-center gap-3 bg-white border border-slate-300 rounded-2xl px-4 py-3 shadow-sm focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100 transition-all">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
        }}
        placeholder="Ask anything about your documents…"
        rows={1}
        disabled={disabled}
        className="flex-1 resize-none bg-transparent text-sm text-slate-700 placeholder-slate-400 focus:outline-none leading-[1.5] max-h-44 disabled:opacity-50 self-center"
        style={{ paddingTop: "1px", paddingBottom: "1px" }}
      />
      <button
        onClick={send}
        disabled={!value.trim() || isLoading || disabled}
        className="shrink-0 w-9 h-9 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
        aria-label="Send"
      >
        {isLoading ? (
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
        ) : (
          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        )}
      </button>
    </div>
  );
}
