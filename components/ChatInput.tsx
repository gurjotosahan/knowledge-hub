"use client";

import { useState, useRef, useEffect } from "react";

interface ChatInputProps {
  onSend: (query: string, imageDataUrl?: string) => void;
  onStop?: () => void;
  onUploadFiles?: (files: FileList) => void;
  isLoading?: boolean;
  disabled?: boolean;
  uploadDisabled?: boolean;
  uploadFileNames?: string[];
  isUploading?: boolean;
  onRemoveUploadFile?: (index: number) => void;
}

export default function ChatInput({
  onSend,
  onStop,
  onUploadFiles,
  isLoading,
  disabled,
  uploadDisabled,
  uploadFileNames = [],
  isUploading = false,
  onRemoveUploadFile,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [pastedImage, setPastedImage] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const wordInputRef = useRef<HTMLInputElement>(null);
  const pptInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  }, [value]);

  const send = () => {
    const q = value.trim();
    if ((!q && !pastedImage) || isLoading || disabled || isUploading) return;
    onSend(q, pastedImage ?? undefined);
    setValue("");
    setPastedImage(null);
    if (ref.current) ref.current.style.height = "auto";
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItem = Array.from(e.clipboardData.items).find((item) =>
      item.type.startsWith("image/")
    );
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPastedImage(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleUpload = (files: FileList | null) => {
    if (!files?.length || uploadDisabled) return;
    setUploadMenuOpen(false);
    onUploadFiles?.(files);
  };

  const fileMeta = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pptx") return { label: "Presentation", initials: "PPT", color: "bg-orange-500" };
    if (ext === "pdf") return { label: "PDF", initials: "PDF", color: "bg-red-500" };
    return { label: "Document", initials: "DOC", color: "bg-sky-600" };
  };

  return (
    <div className={`flex flex-col gap-3 bg-white border rounded-[1.75rem] px-4 py-3 shadow-sm transition-all ${
      isLoading
        ? "border-sky-400 ring-2 ring-sky-100"
        : "border-slate-300 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100"
    }`}>
      <input
        ref={wordInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        className="hidden"
        onChange={(e) => {
          handleUpload(e.target.files);
          e.currentTarget.value = "";
        }}
      />
      <input
        ref={pptInputRef}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        multiple
        className="hidden"
        onChange={(e) => {
          handleUpload(e.target.files);
          e.currentTarget.value = "";
        }}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          handleUpload(e.target.files);
          e.currentTarget.value = "";
        }}
      />
      {pastedImage && (
        <div className="relative w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pastedImage}
            alt="Pasted image"
            className="h-20 rounded-xl border border-slate-200 object-cover"
          />
          <button
            type="button"
            onClick={() => setPastedImage(null)}
            className="absolute -right-1.5 -top-1.5 w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center hover:bg-slate-700 transition-colors"
            aria-label="Remove image"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      {uploadFileNames.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {uploadFileNames.slice(0, 3).map((name, index) => {
            const meta = fileMeta(name);
            return (
              <div
                key={`${name}-${index}`}
                title={name}
                className="relative flex items-center gap-3 min-w-0 max-w-[280px] rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
              >
                <div className={`relative w-10 h-10 rounded-xl ${meta.color} text-white flex items-center justify-center text-[10px] font-bold shrink-0`}>
                  {isUploading && index === uploadFileNames.length - 1 ? (
                    <span className="w-6 h-6 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
                  ) : (
                    meta.initials
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{name}</p>
                  <p className="text-xs text-slate-500">{isUploading ? "Indexing..." : meta.label}</p>
                </div>
                {onRemoveUploadFile && (
                  <button
                    type="button"
                    onClick={() => onRemoveUploadFile(index)}
                    className="absolute -right-1.5 -top-1.5 w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center hover:bg-slate-700 transition-colors"
                    aria-label={`Remove ${name}`}
                    title="Remove"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
          {uploadFileNames.length > 3 && (
            <div className="h-14 px-4 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center text-sm font-semibold text-slate-500">
              +{uploadFileNames.length - 3}
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        {/* Animated pulse dot while loading */}
        {isLoading && (
          <span className="shrink-0 w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
        )}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setUploadMenuOpen((open) => !open)}
            disabled={uploadDisabled || isLoading}
            className="w-9 h-9 rounded-full text-slate-800 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            aria-label="Add document"
            title="Add document"
          >
            <svg className="w-[30px] h-[30px]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 5v14M5 12h14" />
            </svg>
          </button>
          {uploadMenuOpen && (
            <div className="absolute bottom-11 left-0 z-20 w-40 rounded-xl border border-slate-200 bg-white shadow-xl py-1">
              <button
                type="button"
                onClick={() => wordInputRef.current?.click()}
                className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-sky-50 hover:text-sky-700"
              >
                Word document
              </button>
              <button
                type="button"
                onClick={() => pptInputRef.current?.click()}
                className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-orange-50 hover:text-orange-700"
              >
                PowerPoint
              </button>
              <button
                type="button"
                onClick={() => pdfInputRef.current?.click()}
                className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-red-50 hover:text-red-700"
              >
                PDF
              </button>
            </div>
          )}
        </div>
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          onPaste={handlePaste}
          placeholder={isLoading ? "Searching…" : "Ask anything… or paste a screenshot"}
          rows={1}
          disabled={disabled || isLoading}
          className="flex-1 resize-none bg-transparent text-sm text-slate-700 placeholder-slate-400 focus:outline-none leading-[1.5] max-h-44 disabled:opacity-60 self-center"
          style={{ paddingTop: "1px", paddingBottom: "1px" }}
        />

        {/* Stop button while loading, send button otherwise */}
        {isLoading && onStop ? (
          <button
            onClick={onStop}
            className="shrink-0 w-9 h-9 rounded-full border-2 border-slate-300 hover:border-red-400 hover:bg-red-50 flex items-center justify-center transition-colors group"
            aria-label="Stop"
            title="Stop generation"
          >
            <span className="w-3.5 h-3.5 rounded-sm bg-slate-400 group-hover:bg-red-500 transition-colors block" />
          </button>
        ) : (
          <button
            onClick={send}
            disabled={(!value.trim() && !pastedImage) || isLoading || disabled || isUploading}
            className="shrink-0 w-9 h-9 rounded-full bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            aria-label="Send"
          >
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
