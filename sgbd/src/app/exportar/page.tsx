"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { useDb } from "@/hooks/useDb";
import {
  exportSql,
  exportTableCsv,
  countTable,
} from "@/lib/sqlite/db";

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

export default function ExportarPage() {
  const { tables, databases, activeDatabase, switchDatabase } = useDb();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    content: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const exportOneCsv = useCallback(async (table: string) => {
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
  }, []);

  const previewCsv = useCallback(async (table: string) => {
    setBusy(table);
    setError(null);
    try {
      const content = await exportTableCsv(table);
      const lines = content.split("\n");
      const head = lines.slice(0, 12).join("\n");
      const tail = lines.length > 12 ? `\n… (+${lines.length - 12} linhas)` : "";
      setPreview({ title: `${table}.csv`, content: head + tail });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

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
      const tail = lines.length > 30 ? `\n… (+${lines.length - 30} linhas)` : "";
      setPreview({ title: `${activeDatabase ?? "banco"}.sql`, content: head + tail });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [activeDatabase]);

  if (tables.length === 0) {
    return (
      <PageShell>
        <h1 className="text-2xl font-bold text-white">Exportar</h1>
        <p className="mt-1 text-sm text-slate-400">
          Baixe seus dados de volta como CSV ou SQL.
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
            Baixe seus dados de volta como CSV ou SQL.
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
