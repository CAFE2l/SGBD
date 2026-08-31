"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";

interface FileDropzoneProps {
  accept: string;
  onFile: (file: File) => void;
  label?: string;
}

export function FileDropzone({ accept, onFile, label }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      aria-label={label ?? "Área de upload de arquivo"}
      className={`flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-all ${
        dragOver
          ? "border-sky-400 bg-sky-400/10 glow"
          : "border-white/15 bg-white/5 hover:border-sky-400/60 hover:bg-white/10"
      }`}
    >
      <svg
        className="mb-3 h-10 w-10 text-sky-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
        />
      </svg>
      <p className="text-sm text-slate-300">
        Arraste o arquivo aqui ou{" "}
        <span className="font-semibold text-sky-300">selecione</span>
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Formatos aceitos: {accept.replace(/,/g, " ou ")}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
