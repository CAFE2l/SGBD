"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { useDb } from "@/hooks/useDb";
import { dropDatabase, inspectDatabase } from "@/lib/sqlite/db";
import { getHistory, type HistoryEntry } from "@/lib/sqlite/history";

interface DbInfo {
  tableCount: number;
  createdAt: number | null;
  updatedAt: number | null;
}

const COMMAND_COLORS: Record<string, string> = {
  CREATE: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  INSERT: "text-sky-300 border-sky-400/30 bg-sky-400/10",
  UPDATE: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  DELETE: "text-rose-300 border-rose-400/30 bg-rose-400/10",
  ALTER: "text-violet-300 border-violet-400/30 bg-violet-400/10",
  DROP: "text-rose-300 border-rose-400/30 bg-rose-400/10",
  IMPORT: "text-cyan-300 border-cyan-400/30 bg-cyan-400/10",
};

function fmtDate(ts: number | null | undefined): string {
  if (ts == null) return "—";
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BancosPage() {
  const { databases, activeDatabase, createNewDatabase, refresh, ready, error } =
    useDb();
  const [infos, setInfos] = useState<Record<string, DbInfo>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [newDbName, setNewDbName] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const loadInfos = useCallback(async () => {
    const next: Record<string, DbInfo> = {};
    await Promise.all(
      databases.map(async (name) => {
        try {
          const info = await inspectDatabase(name);
          next[name] = {
            tableCount: info.tableCount,
            createdAt: info.createdAt,
            updatedAt: info.updatedAt,
          };
        } catch {
          next[name] = { tableCount: 0, createdAt: null, updatedAt: null };
        }
      })
    );
    setInfos(next);
  }, [databases]);

  useEffect(() => {
    if (ready) loadInfos();
  }, [ready, loadInfos]);

  const toggleCard = useCallback(
    async (name: string) => {
      if (expanded === name) {
        setExpanded(null);
        return;
      }
      setExpanded(name);
      setLoadingHistory(true);
      try {
        const entries = await getHistory(name);
        setHistory(entries);
      } finally {
        setLoadingHistory(false);
      }
    },
    [expanded]
  );

  const createDb = useCallback(async () => {
    const name = newDbName.trim();
    if (!name) return;
    setCreating(true);
    setPageError(null);
    try {
      await createNewDatabase(name);
      setNewDbName("");
      await loadInfos();
    } catch (e) {
      setPageError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [newDbName, createNewDatabase, loadInfos]);

  const handleDelete = useCallback(
    async (name: string) => {
      setDeleting(name);
      setPageError(null);
      try {
        await dropDatabase(name);
        if (expanded === name) {
          setExpanded(null);
          setHistory([]);
        }
        await refresh();
        await loadInfos();
        setConfirmDelete(null);
      } catch (e) {
        setPageError(e instanceof Error ? e.message : String(e));
      } finally {
        setDeleting(null);
      }
    },
    [expanded, refresh, loadInfos]
  );

  return (
    <PageShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Bancos de Dados</h1>
          <p className="mt-1 text-sm text-slate-400">
            Workspace com todos os bancos criados. Clique em um card para ver o
            histórico de queries.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={newDbName}
            onChange={(e) => setNewDbName(e.target.value)}
            placeholder="nome_do_banco"
            onKeyDown={(e) => e.key === "Enter" && createDb()}
            className="rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 font-mono text-sm text-white outline-none focus:border-sky-400/60"
          />
          <button
            onClick={createDb}
            disabled={creating || !newDbName.trim()}
            className="rounded-lg bg-sky-400 px-4 py-1.5 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-40"
          >
            {creating ? "Criando…" : "+ Novo banco"}
          </button>
        </div>
      </div>

      {(pageError || error) && (
        <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300 font-mono">
          {pageError ?? error}
        </div>
      )}

      {databases.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-10 text-center text-sm text-slate-400">
          Nenhum banco criado ainda. Use o campo acima ou o Console SQL.
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {databases.map((name) => {
            const info = infos[name];
            const isOpen = expanded === name;
            const isActive = name === activeDatabase;
            return (
              <div
                key={name}
                className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 transition-colors hover:border-sky-400/30"
              >
                <div className="flex items-start justify-between gap-2 px-4 py-3">
                  <button
                    onClick={() => toggleCard(name)}
                    className="flex min-w-0 items-center gap-2 text-left"
                    title={isOpen ? "Recolher" : "Ver histórico"}
                  >
                    <span className="text-slate-500">{isOpen ? "▾" : "▸"}</span>
                    <div className="min-w-0">
                      <span className="font-mono text-sm font-semibold text-sky-300">
                        {name}
                      </span>
                      <span className="ml-2 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-slate-400">
                        {info?.tableCount ?? "…"}{" "}
                        tabela{info?.tableCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </button>
                  {isActive && (
                    <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">
                      ativo
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-[11px] text-slate-500">
                  <span>Modificado: {fmtDate(info?.updatedAt)}</span>
                  <span>Criado: {fmtDate(info?.createdAt)}</span>
                </div>

                <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2.5">
                  <Link
                    href={`/console?db=${encodeURIComponent(name)}`}
                    className="rounded-lg bg-sky-400/15 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-400/25"
                  >
                    Abrir no Console
                  </Link>
                  {confirmDelete === name ? (
                    <span className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(name)}
                        disabled={deleting === name}
                        className="rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/30 disabled:opacity-40"
                      >
                        {deleting === name ? "Excluindo…" : "Confirmar?"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-slate-400 hover:bg-white/5"
                      >
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(name)}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:border-rose-400/40 hover:text-rose-300"
                    >
                      Excluir
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div className="border-t border-white/10 bg-black/20 px-4 py-3">
                    <p className="mb-2 text-[11px] font-semibold text-slate-400">
                      Histórico de queries ·{" "}
                      {history.length} registro{history.length === 1 ? "" : "s"}
                    </p>
                    {loadingHistory ? (
                      <p className="text-[11px] text-slate-500">Carregando…</p>
                    ) : history.length === 0 ? (
                      <p className="text-[11px] text-slate-500">
                        Nenhuma query de escrita executada ainda nesta nova
                        versão.
                      </p>
                    ) : (
                      <div className="max-h-56 space-y-1.5 overflow-auto pr-1">
                        {history.map((h, i) => (
                          <div
                            key={h.timestamp + "-" + i}
                            className="rounded-lg border border-white/10 bg-white/5 p-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                                  COMMAND_COLORS[h.command] ??
                                  "text-slate-300 border-white/15 bg-white/10"
                                }`}
                              >
                                {h.command}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                {fmtDate(h.timestamp)}
                              </span>
                            </div>
                            <pre className="mt-1 truncate font-mono text-[11px] text-slate-300">
                              {h.query}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}