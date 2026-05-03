"use client";

import { useEffect, useState, KeyboardEvent } from "react";

interface SearchBoxProps {
  onSearch: (query: string) => void;
  initialValue?: string;
  compact?: boolean;
}

const CHIPS = ["Analyze RFP", "Create POV", "Client Research"];

export default function SearchBox({ onSearch, initialValue, compact = false }: SearchBoxProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue(initialValue ?? "");
  }, [initialValue]);

  const submit = () => {
    if (value.trim()) onSearch(value.trim());
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") submit();
  };

  return (
    <div className={`flex flex-col items-center ${compact ? "gap-0" : "gap-4"}`}>
      {/* Search input */}
      <div className="relative w-full" style={{ maxWidth: 640 }}>
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
          <svg
            className="w-5 h-5 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
            />
          </svg>
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Search Apexon knowledge, RFPs, POVs…"
          aria-label="Search knowledge hub"
          className={`w-full pl-12 pr-14 rounded-2xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition ${
            compact ? "h-11 text-sm shadow-sm" : "h-14 text-base shadow-md"
          }`}
        />
        <button
          onClick={submit}
          aria-label="Run search"
          className={`absolute inset-y-0 right-3 my-auto flex items-center justify-center rounded-xl bg-sky-600 hover:bg-sky-700 transition-colors ${
            compact ? "w-8 h-8" : "w-9 h-9"
          }`}
        >
          <svg
            className="w-4 h-4 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14 5l7 7m0 0l-7 7m7-7H3"
            />
          </svg>
        </button>
      </div>

      {/* Quick action chips */}
      {!compact && (
        <div className="flex items-center gap-3">
          {CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => {
                setValue(chip);
                onSearch(chip);
              }}
              className="px-4 py-1.5 rounded-full border border-slate-200 bg-white text-sm text-slate-600 hover:bg-sky-50 hover:border-sky-300 hover:text-sky-700 transition-colors shadow-sm"
            >
              {chip}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
