"use client";

import { useMemo, useState } from "react";
import type { Row } from "@/lib/sqlite/types";

interface ResultTableProps {
  columns: string[];
  rows: Row[];
  pageSize?: number;
  emptyMessage?: string;
}

export function ResultTable({
  columns,
  rows,
  pageSize = 50,
  emptyMessage = "Sem resultados.",
}: ResultTableProps) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(0);

  const sortedRows = useMemo(() => {
    if (!sortCol) return rows;
    const sorted = [...rows];
    sorted.sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * sortDir;
      }
      return String(va).localeCompare(String(vb)) * sortDir;
    });
    return sorted;
  }, [rows, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sortedRows.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize
  );

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortCol(col);
      setSortDir(1);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  onClick={() => toggleSort(col)}
                  className="cursor-pointer select-none whitespace-nowrap border-b border-white/10 px-3 py-2 font-mono text-xs font-semibold text-sky-300 hover:bg-white/5"
                >
                  {col}
                  {sortCol === col ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i} className="transition-colors hover:bg-white/5">
                {columns.map((col) => (
                  <td
                    key={col}
                    className="max-w-[280px] truncate border-b border-white/5 px-3 py-1.5 whitespace-nowrap text-slate-300"
                    title={String(row[col] ?? "")}
                  >
                    {formatCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-white/10 px-3 py-2 text-xs text-slate-400">
          <span>
            {sortedRows.length} linha(s) · página {safePage + 1}/{totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="rounded-lg border border-white/10 px-2 py-1 hover:bg-white/10 disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="rounded-lg border border-white/10 px-2 py-1 hover:bg-white/10 disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatCell(v: unknown) {
  if (v == null) return <span className="text-slate-600 italic">NULL</span>;
  return String(v);
}
