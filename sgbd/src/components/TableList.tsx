"use client";

import type { TableInfo, ColumnInfo } from "@/lib/sqlite/types";

interface TableListProps {
  tables: TableInfo[];
  schemas: Record<string, ColumnInfo[]>;
  onSelectTable: (table: string) => void;
  onToggleSchema: (table: string) => void;
  loadingSchema?: boolean;
}

export function TableList({
  tables,
  schemas,
  onSelectTable,
  onToggleSchema,
  loadingSchema,
}: TableListProps) {
  if (tables.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center text-xs text-slate-500">
        Nenhuma tabela importada ainda.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {tables.map((t) => {
        const cols = schemas[t.name];
        const expanded = !!cols;
        return (
          <div
            key={t.name}
            className="overflow-hidden rounded-xl border border-white/10 bg-white/5"
          >
            <div className="flex items-center justify-between px-3 py-2">
              <button
                onClick={() => onToggleSchema(t.name)}
                className="flex items-center gap-2 text-left font-mono text-xs text-sky-300 hover:text-sky-200"
                title="Ver colunas"
              >
                <span className="text-slate-500">{expanded ? "▾" : "▸"}</span>
                {t.name}
              </button>
              <button
                onClick={() => onSelectTable(t.name)}
                className="rounded-lg bg-sky-400/15 px-2 py-1 text-xs font-semibold text-sky-300 hover:bg-sky-400/25"
                title="Inserir SELECT *"
              >
                SELECT
              </button>
            </div>
            {expanded && (
              <div className="border-t border-white/10 bg-black/20 px-3 py-1.5">
                {cols.length === 0 ? (
                  <p className="py-1 text-[11px] text-slate-500">
                    {loadingSchema ? `Carregando ${t.name}…` : "Sem colunas"}
                  </p>
                ) : (
                  cols.map((c) => (
                    <div
                      key={c.cid}
                      className="flex items-center justify-between py-0.5 font-mono text-[11px]"
                    >
                      <span className="text-slate-300">{c.name}</span>
                      <span className="text-slate-500">
                        {c.type || "?"}
                        {c.pk ? " · PK" : ""}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
