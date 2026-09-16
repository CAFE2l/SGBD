"use client";

import { useMemo, useState } from "react";
import type { TableInfo } from "@/lib/sqlite/types";

interface TableListProps {
  tables: TableInfo[];
  counts: Record<string, number>;
  loadingCounts?: boolean;
  activeTable: string | null;
  onSelectTable: (table: string) => void;
}

/** Exibe o filtro rápido só quando a lista começa a ficar longa. */
const FILTER_THRESHOLD = 6;

/**
 * Sidebar de tabelas estilo phpMyAdmin: todas as tabelas do banco navegáveis,
 * com contagem de linhas e destaque na tabela ativa. A linha inteira é o
 * gatilho de seleção.
 */
export function TableList({
  tables,
  counts,
  loadingCounts,
  activeTable,
  onSelectTable,
}: TableListProps) {
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tables, filter]);

  if (tables.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center text-xs text-slate-500">
        Nenhuma tabela importada ainda.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {tables.length >= FILTER_THRESHOLD && (
                <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar tabelas..."
          data-filter-input="true"
          className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 font-mono text-xs text-white outline-none focus:border-sky-400/60"
        />
      )}
      {visible.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-xs text-slate-500">
          Nenhuma tabela corresponde a &quot;{filter}&quot;.
        </p>
      ) : (
        visible.map((t) => {
          const isActive = t.name === activeTable;
          return (
            <button
              key={t.name}
              type="button"
              onClick={() => onSelectTable(t.name)}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left font-mono text-xs transition-colors ${
                isActive
                  ? "border-sky-400/60 bg-sky-400/15 text-sky-200 shadow-glow-sm"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-sky-400/40 hover:bg-white/10 hover:text-sky-200"
              }`}
              title={`Ver estrutura e dados de ${t.name}`}
            >
              <span className="truncate">{t.name}</span>
              <span
                className={`ml-2 shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${
                  isActive
                    ? "border-sky-400/40 bg-sky-400/15 text-sky-300"
                    : "border-white/10 bg-black/20 text-slate-400"
                }`}
              >
                {loadingCounts ? "…" : counts[t.name] ?? 0}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}