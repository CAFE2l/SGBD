"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { useDb } from "@/hooks/useDb";
import {
  exportSql,
  exportTableCsv,
  countTable,
  getEditableTableData,
  updateTableCell,
} from "@/lib/sqlite/db";
import type { QueryResult, Row } from "@/lib/sqlite/types";

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 20;

export default function ExportarPage() {
  const { tables, databases, activeDatabase, switchDatabase } = useDb();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    content: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTable, setEditingTable] = useState<string | null>(null);

  const refreshCounts = useCallback(async () => {
    const next: Record<string, number> = {};
    for (const t of tables) {
      try {
        next[t.name] = await countTable(t.name);
      } catch {
        next[t.name] = 0;
      }
    }
    setCounts(next);
  }, [tables]);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  const exportOneCsv = useCallback(
    async (table: string) => {
      setBusy(table);
      setError(null);
      try {
        const content = await exportTableCsv(table);
        download(`${table}.csv`, content, "text/csv");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const previewCsv = useCallback(
    async (table: string) => {
      setBusy(table);
      setError(null);
      try {
        const content = await exportTableCsv(table);
        const lines = content.split("\n");
        const head = lines.slice(0, 12).join("\n");
        const tail =
          lines.length > 12 ? `\n… (+${lines.length - 12} linhas)` : "";
        setPreview({ title: `${table}.csv`, content: head + tail });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const exportAllSql = useCallback(async () => {
    setBusy("all");
    setError(null);
    try {
      const content = await exportSql();
      download(`${activeDatabase ?? "banco"}.sql`, content, "application/sql");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [activeDatabase]);

  const previewAllSql = useCallback(async () => {
    setBusy("all");
    setError(null);
    try {
      const content = await exportSql();
      const lines = content.split("\n");
      const head = lines.slice(0, 30).join("\n");
      const tail =
        lines.length > 30 ? `\n… (+${lines.length - 30} linhas)` : "";
      setPreview({
        title: `${activeDatabase ?? "banco"}.sql`,
        content: head + tail,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [activeDatabase]);

  const startEditing = useCallback((table: string) => {
    setEditingTable(table);
    setPreview(null);
  }, []);

  if (tables.length === 0) {
    return (
      <PageShell>
        <h1 className="text-2xl font-bold text-white">Exportar</h1>
        <p className="mt-1 text-sm text-slate-400">
          Revise e corrija os dados antes de baixar como CSV ou SQL.
        </p>
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
          <p className="text-sm text-slate-400">
            Nenhuma tabela carregada ainda.
          </p>
          <Link
            href="/importar"
            className="mt-4 inline-block rounded-xl bg-sky-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-300"
          >
            Importar dados
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Exportar</h1>
          <p className="mt-1 text-sm text-slate-400">
            Corrija valores mal importados e depois exporte CSV ou SQL.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-slate-400">Banco:</label>
          <select
            value={activeDatabase ?? ""}
            onChange={(e) => switchDatabase(e.target.value)}
            className="rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 font-mono text-sm text-sky-300 outline-none focus:border-sky-400/60"
          >
            {databases.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            onClick={previewAllSql}
            disabled={busy !== null}
            className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-400 hover:bg-white/5 disabled:opacity-40"
          >
            Prévia
          </button>
          <button
            onClick={exportAllSql}
            disabled={busy !== null}
            className="rounded-xl bg-sky-400 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-40"
          >
            {busy === "all" ? "Gerando…" : "Exportar banco como .sql"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5">
            <tr className="text-xs text-slate-400 uppercase">
              <th className="px-4 py-2.5">Tabela</th>
              <th className="px-4 py-2.5">Linhas</th>
              <th className="px-4 py-2.5 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {tables.map((t) => (
              <tr
                key={t.name}
                className="border-t border-white/5 hover:bg-white/5"
              >
                <td className="px-4 py-3 font-mono text-sky-300">{t.name}</td>
                <td className="px-4 py-3 text-slate-300">
                  {counts[t.name] ?? "…"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => startEditing(t.name)}
                      disabled={busy !== null}
                      className="rounded-lg bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-400/25 disabled:opacity-40"
                    >
                      {editingTable === t.name ? "Editando…" : "Revisar dados"}
                    </button>
                    <button
                      onClick={() => previewCsv(t.name)}
                      disabled={busy !== null}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5 disabled:opacity-40"
                    >
                      Prévia
                    </button>
                    <button
                      onClick={() => exportOneCsv(t.name)}
                      disabled={busy !== null}
                      className="rounded-lg bg-sky-400/15 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-400/25 disabled:opacity-40"
                    >
                      {busy === t.name ? "Gerando…" : "Exportar CSV"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingTable && (
        <div className="mt-6 rounded-2xl border border-amber-400/20 bg-white/5">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="font-mono text-sm font-semibold text-sky-300">
                {editingTable}
              </p>
              <p className="text-[11px] text-slate-400">
                Clique em uma célula para corrigir. Edições gravam direto no
                banco (UPDATE) — o export sai já corrigido.
              </p>
            </div>
            <button
              onClick={() => setEditingTable(null)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5"
            >
              Fechar
            </button>
          </div>
          <EditableGrid table={editingTable} reloadCount={refreshCounts} />
        </div>
      )}

      {preview && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-xs text-sky-300">{preview.title}</span>
            <button
              onClick={() => setPreview(null)}
              className="text-xs text-slate-500 hover:text-white"
            >
              Fechar
            </button>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 font-mono text-xs text-slate-300">
            {preview.content}
          </pre>
        </div>
      )}
    </PageShell>
  );
}

function EditableGrid({
  table,
  reloadCount,
}: {
  table: string;
  reloadCount: () => void;
}) {
  const [data, setData] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{
    rowid: number;
    col: string;
    value: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadSeq = useRef(0);

  useEffect(() => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    setPage(0);
    getEditableTableData(table)
      .then((res) => {
        if (seq === loadSeq.current) setData(res);
      })
      .catch((e) => {
        if (seq === loadSeq.current)
          setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false);
      });
  }, [table]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 p-8 text-sm text-slate-400">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
        Carregando {table}…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-sm text-rose-300">{error}</div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-sm text-slate-500">
        Tabela vazia ou indisponível.
      </div>
    );
  }

  const columns = data.columns.filter((c) => c !== "__rowid__");
  const totalPages = Math.max(1, Math.ceil(data.rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = data.rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const commit = async (rowid: number, col: string, rawValue: string) => {
    setEditing(null);
    try {
      await updateTableCell(table, rowid, col, rawValue);
      const newValue = rawValue === "" ? null : rawValue;
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((r) =>
            Number(r["__rowid__"]) === rowid ? { ...r, [col]: newValue } : r
          ),
        };
      });
      setEdited((prev) => {
        const next = new Set(prev);
        next.add(`${rowid}\u0000${col}`);
        return next;
      });
      reloadCount();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const renderCell = (row: Row, col: string) => {
    const rowid = Number(row["__rowid__"]);
    const isEditing = editing?.rowid === rowid && editing.col === col;
    const isEdited = edited.has(`${rowid}\u0000${col}`);
    const raw = row[col];
    return isEditing ? (
      <input
        ref={inputRef}
        defaultValue={editing.value}
        className="w-full min-w-[120px] rounded border border-sky-400/60 bg-slate-950 px-1.5 py-0.5 font-mono text-xs text-white outline-none"
        onBlur={(e) => commit(rowid, col, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setEditing(null);
          }
        }}
      />
    ) : (
      <button
        onClick={() =>
          setEditing({ rowid, col, value: raw == null ? "" : String(raw) })
        }
        className={`block w-full truncate text-left px-1.5 py-0.5 font-mono text-xs transition-colors ${
          isEdited
            ? "rounded border border-amber-400/40 bg-amber-400/10 text-amber-200"
            : "text-slate-300 hover:bg-white/5"
        }`}
        title={
          (isEdited ? "✓ corrigido nesta sessão — " : "") +
          `clique para editar`
        }
      >
        {raw == null ? (
          <span className="italic text-slate-600">NULL</span>
        ) : (
          String(raw)
        )}
      </button>
    );
  };

  return (
    <div className="p-4">
      <div className="mb-2 flex items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400/40"></span>
        células corrigidas nesta sessão
        <span className="ml-auto">
          {data.rows.length} linha(s) · página {safePage + 1}/{totalPages}
        </span>
      </div>
      <div className="max-h-[480px] overflow-auto rounded-lg border border-white/10">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className="whitespace-nowrap border-b border-white/10 px-2 py-2 font-mono text-[10px] font-semibold text-sky-300"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i} className="hover:bg-white/5">
                {columns.map((col) => (
                  <td
                    key={col}
                    className="max-w-[220px] truncate border-b border-white/5 px-1 py-0.5"
                  >
                    {renderCell(row, col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs text-slate-400">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="rounded-lg border border-white/10 px-2.5 py-1 hover:bg-white/10 disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            className="rounded-lg border border-white/10 px-2.5 py-1 hover:bg-white/10 disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}