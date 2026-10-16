"use client";
import { ENGINES, type EngineId } from "@/lib/profile/engines";

export function EngineBadge({ engine }: { engine: EngineId }) {
  const e = ENGINES[engine];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-200" title={`Motor real: SQLite. Dialeto selecionado: ${e.label} (simulado).`}>
      <span aria-hidden>▦</span>
      SQLite
      <span className="text-cyan-100/55">· {e.short}</span>
      <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
    </span>
  );
}

export function consoleUrl(db: string, query?: string): string {
  const q = query ? `&q=${encodeURIComponent(query)}` : "";
  return `/console?db=${encodeURIComponent(db)}${q}`;
}

export function tablesUrl(db: string, table?: string): string {
  const t = table ? `&table=${encodeURIComponent(table)}` : "";
  return `/tabelas?db=${encodeURIComponent(db)}${t}`;
}
