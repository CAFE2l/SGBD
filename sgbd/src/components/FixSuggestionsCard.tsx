"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SqlSuggestion } from "@/lib/sqlite/types";

interface FixSuggestionsCardProps {
  suggestions: SqlSuggestion[];
  busy: boolean;
  onApply: (selectedIndexes: number[]) => Promise<void>;
}

const ACTION_META: Record<
  SqlSuggestion["action"],
  { label: string; className: string }
> = {
  fix: {
    label: "corrigir",
    className: "bg-emerald-400/15 text-emerald-300",
  },
  remove: {
    label: "remover",
    className: "bg-amber-400/15 text-amber-300",
  },
  manual: {
    label: "manual",
    className: "bg-slate-500/20 text-slate-300",
  },
};

export function FixSuggestionsCard({
  suggestions,
  busy,
  onApply,
}: FixSuggestionsCardProps) {
  const selectable = useMemo(
    () =>
      suggestions
        .filter((s) => s.action !== "manual")
        .map((s) => s.index),
    [suggestions]
  );

  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(selectable)
  );

  useEffect(() => {
    setSelected(new Set(selectable));
  }, [selectable]);

  const toggle = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const hasSelected = selected.size > 0;

  return (
    <div className="mt-8 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-200">
            <svg
              className="h-4 w-4 text-amber-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"
              />
            </svg>
            Correções sugeridas
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            {suggestions.length} comando(s) falharam. Marque como corrigir cada
            um e reimporte — os comandos já aplicados não serão executados de
            novo.
          </p>
        </div>
        <button
          onClick={() => setSelected(new Set(selectable))}
          disabled={busy}
          className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-slate-400 hover:bg-white/5 disabled:opacity-40"
        >
          Selecionar todos
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {suggestions.map((s) => {
          const meta = ACTION_META[s.action];
          const checkable = s.action !== "manual";
          const checked = selected.has(s.index);
          return (
            <div
              key={s.index}
              className={`rounded-xl border border-white/10 bg-black/20 p-3 ${
                !checkable ? "opacity-80" : ""
              }`}
            >
              <label
                className={`flex cursor-pointer items-start gap-3 ${
                  checkable ? "" : "cursor-default"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-amber-400 disabled:opacity-40"
                  disabled={!checkable || busy}
                  checked={checked}
                  onChange={() => toggle(s.index)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-amber-200">
                      #{s.index}
                    </span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
                      {s.keyword}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                    <span className="truncate text-[11px] text-slate-400">
                      {s.reason}
                    </span>
                  </div>

                  <div className="mt-2 space-y-1 font-mono text-[11px] leading-relaxed">
                    <div className="text-slate-500 line-through decoration-rose-400/60">
                      {s.original}
                    </div>
                    {s.action === "fix" && s.fixed ? (
                      <div className="text-emerald-300">{s.fixed}</div>
                    ) : s.action === "remove" ? (
                      <div className="text-amber-300/80">
                        — comando descartado na reimportação.
                      </div>
                    ) : (
                      <div className="text-slate-300/80">
                        {s.message} — ajuste manualmente no Console SQL.
                      </div>
                    )}
                  </div>
                </div>
              </label>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() =>
            onApply(suggestions.map((s) => s.index).filter((i) => selected.has(i)))
          }
          disabled={busy || !hasSelected}
          className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300 disabled:opacity-40"
        >
          {busy ? "Aplicando…" : "Aplicar correções e reimportar"}
        </button>
        {!hasSelected && (
          <span className="text-xs text-slate-500">
            Selecione ao menos uma correção.
          </span>
        )}
      </div>
    </div>
  );
}