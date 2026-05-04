"use client";

import { useState, useRef, useEffect } from "react";

interface ChatInputProps {
  onSend: (query: string) => void;
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export default function ChatInput({ onSend, onStop, isLoading, disabled }: ChatInputProps) {
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
    <div className={`flex items-center gap-3 bg-white border rounded-2xl px-4 py-3 shadow-sm transition-all ${
      isLoading
        ? "border-sky-400 ring-2 ring-sky-100"
        : "border-slate-300 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100"
    }`}>
      {/* Animated pulse dot while loading */}
      {isLoading && (
        <span className="shrink-0 w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
      )}
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
        }}
        placeholder={isLoading ? "Searching…" : "Ask anything about your documents…"}
        rows={1}
        disabled={disabled || isLoading}
        className="flex-1 resize-none bg-transparent text-sm text-slate-700 placeholder-slate-400 focus:outline-none leading-[1.5] max-h-44 disabled:opacity-60 self-center"
        style={{ paddingTop: "1px", paddingBottom: "1px" }}
      />

      {/* Stop button while loading, send button otherwise */}
      {isLoading && onStop ? (
        <button
          onClick={onStop}
          className="shrink-0 w-9 h-9 rounded-xl border-2 border-slate-300 hover:border-red-400 hover:bg-red-50 flex items-center justify-center transition-colors group"
          aria-label="Stop"
          title="Stop generation"
        >
          <span className="w-3.5 h-3.5 rounded-sm bg-slate-400 group-hover:bg-red-500 transition-colors block" />
        </button>
      ) : (
        <button
          onClick={send}
          disabled={!value.trim() || isLoading || disabled}
          className="shrink-0 w-9 h-9 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          aria-label="Send"
        >
          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      )}
    </div>
  );
}
