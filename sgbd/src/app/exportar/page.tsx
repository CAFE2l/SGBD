"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useDb } from "@/hooks/useDb";
import {
  countTable,
  getEditableTableData,
  updateTableCell,
} from "@/lib/sqlite/db";
import {
  exportDatabase,
  exportTable,
  type ExportFormat,
  type ExportProgress,
} from "@/lib/sqlite/export-service";
import type { QueryResult, Row } from "@/lib/sqlite/types";

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PAGE_SIZE = 20;

export default function ExportarPage() {
  const { tables, databases, activeDatabase, switchDatabase } = useDb();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    content: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTable, setEditingTable] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [delimiter, setDelimiter] = useState<"," | ";">(",");
  const [dialect, setDialect] = useState<"sqlite" | "mysql">("sqlite");
  const controller = useRef<AbortController | null>(null);
  const countSequence = useRef(0);

  const refreshCounts = useCallback(async () => {
    const sequence = ++countSequence.current;
    const next: Record<string, number> = {};
    for (const t of tables) {
      try {
        next[t.name] = await countTable(t.name);
      } catch {
        next[t.name] = -1;
      }
    }
    if (sequence === countSequence.current) setCounts(next);
  }, [tables]);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  const startExport = useCallback((label: string) => {
    const abortController = new AbortController();
    controller.current = abortController;
    setBusy(label);
    setError(null);
    setToast(null);
    setProgress(null);
    return abortController;
  }, []);

  const finishExport = useCallback(() => {
    controller.current = null;
    setBusy(null);
    setProgress(null);
  }, []);

  const reportSuccess = useCallback((filename: string, rowCount: number) => {
    setToast(`Exportação concluída: ${filename} · ${rowCount} linha(s).`);
    setError(null);
  }, []);

  const filenamePart = (value: string) =>
    value.replace(/[\\/:*?"<>|]/g, "_").trim() || "banco";

  const exportOne = useCallback(async (table: string, format: ExportFormat) => {
    if (!activeDatabase) return;
    const abortController = startExport(table);
    const extension = format === "csv" ? "csv" : format === "sql" ? "sql" : "json";
    try {
      const result = await exportTable(activeDatabase, table, format, {
        delimiter,
        dialect,
        signal: abortController.signal,
        onProgress: setProgress,
      });
      const filename = `${filenamePart(activeDatabase)}_${filenamePart(table)}.${extension}`;
      download(filename, result.blob);
      reportSuccess(filename, result.rowCount);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      finishExport();
    }
  }, [activeDatabase, delimiter, dialect, finishExport, reportSuccess, startExport]);

  const exportAll = useCallback(async (format: ExportFormat, previewOnly = false) => {
    if (!activeDatabase) return;
    const abortController = startExport("all");
    try {
      const result = await exportDatabase(activeDatabase, format, {
        delimiter,
        dialect,
        signal: abortController.signal,
        preview: previewOnly,
        onProgress: setProgress,
      });
      if (previewOnly) {
        setPreview({
          title: `${activeDatabase}.sql`,
          content: await result.blob.text(),
        });
      } else {
        const extension = format === "csv" ? "zip" : format === "sql" ? "sql" : "json";
        const filename = `${filenamePart(activeDatabase)}.${extension}`;
        download(filename, result.blob);
        reportSuccess(filename, result.rowCount);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      finishExport();
    }
  }, [activeDatabase, delimiter, dialect, finishExport, reportSuccess, startExport]);

  const startEditing = useCallback((table: string) => {
    setEditingTable(table);
    setPreview(null);
  }, []);

  const cancelExport = useCallback(() => controller.current?.abort(), []);

  if (databases.length === 0 || tables.length === 0) {
    const noDatabases = databases.length === 0;
    return (
      <RequireAuth>
        <PageShell>
          <h1 className="text-2xl font-bold text-white">Exportar</h1>
          <div className="glass-panel mx-auto mt-10 max-w-xl rounded-[28px] p-9 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-300/10 text-3xl text-cyan-200" aria-hidden>⇩</div>
            <h2 className="mt-5 text-xl font-bold text-white">
              {noDatabases ? "Crie um banco para começar" : "Nenhuma tabela para exportar"}
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              {noDatabases
                ? "Crie um banco de dados antes de importar ou exportar informações."
                : "Importe dados ou crie tabelas no Console SQL para poder exportá-los."}
            </p>
            <Link
              href={noDatabases ? "/bancos" : "/importar"}
              className="glass-button focus-ring mt-6 inline-flex rounded-xl bg-sky-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-300"
            >
              {noDatabases ? "+ Criar novo banco" : "Importar dados"}
            </Link>
          </div>
        </PageShell>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <PageShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Exportar</h1>
          <p className="mt-1 text-sm text-slate-400">
            Corrija valores mal importados e depois exporte como CSV, JSON ou SQL.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="text-slate-500">• CSV: sem chaves primárias/estrangeiras</span>
            <span className="text-slate-500">• JSON dados: apenas dados</span>
            <span className="text-slate-500">• JSON esquema: dados + esquema completo</span>
            <span className="text-slate-500">• SQL: SQLite (ou MySQL)</span>
          </div>
        </div>
        <div className="flex max-w-3xl flex-wrap items-center gap-3">
          <label htmlFor="export-database" className="text-xs font-semibold text-slate-400">Banco:</label>
          <select
            id="export-database"
            value={activeDatabase ?? ""}
            onChange={(e) => switchDatabase(e.target.value)}
            className="rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 font-mono text-sm text-sky-300 outline-none focus:border-sky-400/60 focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            {databases.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            onClick={() => exportAll("sql", true)}
            disabled={busy !== null}
            className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-400 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40"
          >
            Prévia SQL
          </button>
          <button
            onClick={() => exportAll("sql")}
            disabled={busy !== null}
            className="rounded-xl bg-sky-400 px-5 py-2 text-sm font-semibold text-slate-950 outline-none hover:bg-sky-300 focus-visible:ring-2 focus-visible:ring-sky-200 disabled:opacity-40"
          >
            {busy === "all" ? "Gerando…" : "Exportar banco como .sql"}
          </button>
          <div className="relative inline-block">
            <select
              aria-label="Exportar o banco inteiro"
              onChange={(e) => {
                const action = e.target.value;
                if (action) void exportAll(action as ExportFormat);
                e.target.value = "";
              }}
              disabled={busy !== null}
              className="appearance-none rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 pr-8 text-xs text-slate-400 outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40"
            >
              <option value="">Exportar banco…</option>
              <option value="csv">CSV (.zip)</option>
              <option value="json-data">Dados (.json)</option>
              <option value="json-schema">Dados com esquema (.json)</option>
            </select>
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            Separador CSV
            <select
              aria-label="Separador CSV"
              value={delimiter}
              onChange={(e) => setDelimiter(e.target.value as "," | ";")}
              className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              <option value=",">Vírgula</option>
              <option value=";">Ponto e vírgula (Excel pt-BR)</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            SQL
            <select
              aria-label="Dialeto SQL"
              value={dialect}
              onChange={(e) => setDialect(e.target.value as "sqlite" | "mysql")}
              className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              <option value="sqlite">SQLite</option>
              <option value="mysql">MySQL</option>
            </select>
          </label>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Fechar mensagem de erro"
            className="rounded px-2 text-rose-200 outline-none hover:bg-rose-400/10 focus-visible:ring-2 focus-visible:ring-rose-300"
          >
            ×
          </button>
        </div>
      )}
      {toast && (
        <div role="status" className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {toast}
          <button
            onClick={() => setToast(null)}
            aria-label="Fechar confirmação"
            className="ml-3 rounded px-2 outline-none hover:bg-emerald-400/10 focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            ×
          </button>
        </div>
      )}
      {busy && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-3 text-xs text-sky-200" role="status">
          <span aria-live="polite">
            {progress
              ? `Exportando ${progress.table}: ${progress.processed.toLocaleString("pt-BR")} / ${progress.total.toLocaleString("pt-BR")} linhas`
              : "Preparando exportação…"}
          </span>
          {progress && progress.total > 0 && (
            <progress
              aria-label={`Progresso da exportação de ${progress.table}`}
              value={progress.processed}
              max={progress.total}
              className="h-2 flex-1 accent-sky-400"
            />
          )}
          <button
            onClick={cancelExport}
            className="rounded-lg border border-white/10 px-2.5 py-1 text-slate-300 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            Cancelar
          </button>
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
                  {counts[t.name] === -1 ? "—" : (counts[t.name] ?? "…")}
                  {counts[t.name] === 0 && (
                    <span className="ml-2 text-xs text-slate-500">
                      Tabela vazia: nada para exportar
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startEditing(t.name)}
                      disabled={busy !== null}
                      className="rounded-lg bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-300 outline-none hover:bg-amber-400/25 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-40"
                    >
                      {editingTable === t.name ? "Editando…" : "Revisar"}
                    </button>
                    <div className="relative inline-block">
                      <select
                        aria-label={`Exportar tabela ${t.name}`}
                        onChange={(e) => {
                          const action = e.target.value;
                          if (action) void exportOne(t.name, action as ExportFormat);
                          e.target.value = "";
                        }}
                        disabled={busy !== null}
                        className="appearance-none rounded-lg border border-white/10 bg-slate-900 px-2 py-1 pr-6 text-[11px] text-slate-400 outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40"
                      >
                        <option value="">Exportar…</option>
                        <option value="csv">CSV</option>
                        <option value="json-data">JSON (dados)</option>
                        <option value="json-schema">JSON (esquema)</option>
                        <option value="sql">SQL</option>
                      </select>
                      <svg className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
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
    </RequireAuth>
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