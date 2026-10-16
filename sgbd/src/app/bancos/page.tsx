"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import { EnginePicker } from "@/components/EnginePicker";
import { EngineBadge } from "@/components/EngineBadge";
import { GlassModal } from "@/components/ui/GlassModal";
import { TiltCard } from "@/components/ui/TiltCard";
import { ToastContainer } from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import { useDb } from "@/hooks/useDb";
import {
  describeDatabase,
  dropDatabase,
  duplicateDatabase,
  inspectDatabase,
  renameDatabase,
} from "@/lib/sqlite/db";
import { getHistory, type HistoryEntry } from "@/lib/sqlite/history";
import { ENGINES, type EngineId } from "@/lib/profile/engines";

interface DbInfo {
  tableCount: number;
  rowCount: number;
  createdAt: number | null;
  updatedAt: number | null;
  engine: EngineId;
}

type SortMode = "updated" | "created" | "name";
type ModalAction = "rename" | "duplicate" | null;

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
  const {
    databases,
    activeDatabase,
    createNewDatabase,
    refresh,
    ready,
    error,
    switchDatabase,
  } = useDb();
  const { toasts, showToast, dismissToast } = useToast();
  const [infos, setInfos] = useState<Record<string, DbInfo>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [action, setAction] = useState<ModalAction>(null);
  const [actionDatabase, setActionDatabase] = useState<string | null>(null);
  const [actionName, setActionName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("updated");
  const [selectionMode, setSelectionMode] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const loadInfos = useCallback(async () => {
    const next: Record<string, DbInfo> = {};
    await Promise.all(
      databases.map(async (name) => {
        try {
          const [info, description] = await Promise.all([
            inspectDatabase(name),
            describeDatabase(name),
          ]);
          next[name] = {
            tableCount: info.tableCount,
            rowCount: description.rowCount,
            createdAt: info.createdAt,
            updatedAt: info.updatedAt,
            engine: info.engine,
          };
        } catch {
          next[name] = {
            tableCount: 0,
            rowCount: 0,
            createdAt: null,
            updatedAt: null,
            engine: "postgres",
          };
        }
      })
    );
    setInfos(next);
  }, [databases]);

  useEffect(() => {
    if (ready) void loadInfos();
  }, [ready, loadInfos]);

  useEffect(() => {
    setSelected((current) => new Set([...current].filter((name) => databases.includes(name))));
  }, [databases]);

  const visibleDatabases = useMemo(() => {
    const filtered = databases.filter((name) =>
      name.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR"))
    );
    return filtered.sort((a, b) => {
      if (sort === "name") return a.localeCompare(b, "pt-BR");
      const dateKey = sort === "created" ? "createdAt" : "updatedAt";
      return (infos[b]?.[dateKey] ?? 0) - (infos[a]?.[dateKey] ?? 0);
    });
  }, [databases, infos, search, sort]);

  const allVisibleSelected =
    visibleDatabases.length > 0 &&
    visibleDatabases.every((name) => selected.has(name));

  const toggleSelection = (name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleDatabases.forEach((name) => next.delete(name));
      else visibleDatabases.forEach((name) => next.add(name));
      return next;
    });
  };

  const createDb = async (name: string, engine: EngineId) => {
    setCreating(true);
    setCreateError(null);
    try {
      await createNewDatabase(name, engine);
      setShowPicker(false);
      await refresh();
      showToast(`Banco "${name}" criado com motor ${ENGINES[engine].label}.`, "success");
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };

  const toggleCard = async (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      return;
    }
    setExpanded(name);
    setLoadingHistory(true);
    try {
      setHistory(await getHistory(name));
    } catch {
      setHistory([]);
      setPageError("Não foi possível carregar o histórico deste banco.");
    } finally {
      setLoadingHistory(false);
    }
  };

  const beginAction = (kind: Exclude<ModalAction, null>, name: string) => {
    setAction(kind);
    setActionDatabase(name);
    setActionName(kind === "duplicate" ? `${name}_copia` : name);
    setActionError(null);
  };

  const submitAction = async () => {
    if (!actionDatabase || !action) return;
    const name = actionName.trim();
    if (!name) {
      setActionError("Informe um nome para o banco.");
      return;
    }
    setBusyAction(true);
    setActionError(null);
    try {
      if (action === "rename") {
        const clean = await renameDatabase(actionDatabase, name);
        await refresh();
        showToast(`Banco renomeado para "${clean}".`, "success");
      } else {
        const copy = await duplicateDatabase(actionDatabase, name);
        await refresh();
        showToast(`Banco duplicado como "${copy}".`, "success");
      }
      setAction(null);
      setActionDatabase(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyAction(false);
    }
  };

  const deleteDatabases = async () => {
    const names = confirmDelete;
    if (!names?.length) return;
    setDeleting(true);
    setPageError(null);
    try {
      for (const name of names) await dropDatabase(name);
      setSelected(new Set());
      setSelectionMode(false);
      setExpanded(null);
      setHistory([]);
      setConfirmDelete(null);
      await refresh();
      showToast(
        names.length === 1
          ? `Banco "${names[0]}" excluído permanentemente.`
          : `${names.length} bancos excluídos permanentemente.`,
        "success"
      );
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <RequireAuth>
      <PageShell>
        <div className="space-y-6 pb-10">
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="flex flex-wrap items-end justify-between gap-4"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/80">
                Espaço de trabalho
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">
                Bancos de Dados
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">
                Organize seus bancos, acompanhe o tamanho e consulte o histórico de cada um.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setCreateError(null);
                setShowPicker(true);
              }}
              disabled={creating}
              className="glass-button focus-ring rounded-xl bg-sky-400 px-5 py-2.5 text-sm font-bold text-slate-950 shadow-[0_8px_28px_rgba(56,189,248,0.2)] hover:-translate-y-0.5 hover:bg-sky-300 disabled:opacity-50"
            >
              + Novo banco
            </button>
          </motion.section>

          {(pageError || error) && (
            <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {pageError ?? error}
            </div>
          )}

          {databases.length > 0 && (
            <div className="glass-panel flex flex-wrap items-center gap-3 rounded-2xl p-3 sm:p-4">
              <label className="min-w-[12rem] flex-1">
                <span className="sr-only">Buscar bancos</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar banco…"
                  className="focus-ring w-full rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                Ordenar
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortMode)}
                  className="focus-ring rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200"
                >
                  <option value="updated">Modificados recentemente</option>
                  <option value="created">Mais antigos primeiro</option>
                  <option value="name">Nome</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  setSelectionMode((value) => {
                    if (value) setSelected(new Set());
                    return !value;
                  });
                }}
                aria-pressed={selectionMode}
                className={`focus-ring rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                  selectionMode
                    ? "border-sky-300/40 bg-sky-300/10 text-sky-200"
                    : "border-white/10 text-slate-300 hover:bg-white/5"
                }`}
              >
                {selectionMode ? "Sair da seleção" : "Selecionar"}
              </button>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() => {
                    setSelectionMode(true);
                    toggleAll();
                  }}
                  aria-label="Selecionar todos os bancos visíveis"
                  className="h-4 w-4 accent-sky-400"
                />
                Selecionar tudo
              </label>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete([...selected])}
                  className="focus-ring rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-400/20"
                >
                  Excluir selecionados ({selected.size})
                </button>
              )}
            </div>
          )}

          {ready && databases.length === 0 ? (
            <div className="glass-panel mx-auto mt-8 max-w-2xl rounded-[28px] px-6 py-12 text-center sm:px-12">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.07] text-4xl text-cyan-200 shadow-[0_0_45px_rgba(34,211,238,0.12)]" aria-hidden>
                ▤
              </div>
              <h2 className="mt-6 text-2xl font-bold text-white">Nenhum banco criado ainda</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
                Crie seu primeiro banco de dados para começar a trabalhar com tabelas e consultas SQL.
              </p>
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="glass-button focus-ring mt-6 rounded-xl bg-sky-400 px-6 py-3 text-sm font-bold text-slate-950 hover:bg-sky-300"
              >
                + Criar novo banco
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <AnimatePresence initial={false}>
                {visibleDatabases.map((name, index) => {
                  const info = infos[name];
                  const isActive = name === activeDatabase;
                  const isOpen = expanded === name;
                  return (
                    <motion.div
                      key={name}
                      layout
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.94, filter: "blur(5px)" }}
                      transition={{ duration: 0.24, delay: index * 0.035 }}
                    >
                      <TiltCard className="h-full">
                        <article className="flex h-full flex-col">
                          <div className="flex items-start gap-3 p-4 sm:p-5">
                            <input
                              type="checkbox"
                              checked={selected.has(name)}
                              onChange={() => {
                                setSelectionMode(true);
                                toggleSelection(name);
                              }}
                              aria-label={`Selecionar banco ${name}`}
                              className="mt-1 h-4 w-4 shrink-0 accent-sky-400"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h2 className="max-w-full truncate font-mono text-base font-bold text-white">
                                  {name}
                                </h2>
                                <EngineBadge engine={info?.engine ?? "postgres"} />
                                {isActive && (
                                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-200">
                                    <span className="status-pulse h-1.5 w-1.5 rounded-full bg-emerald-300" />
                                    ATIVO
                                  </span>
                                )}
                              </div>
                              <div className="mt-4 grid grid-cols-2 gap-2">
                                <Metric label="Tabelas" value={info?.tableCount} />
                                <Metric label="Linhas" value={info?.rowCount} />
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-white/[0.07] px-4 py-3 text-[11px] text-slate-400 sm:px-5">
                            <span>Criado</span><span className="text-right">{fmtDate(info?.createdAt)}</span>
                            <span>Modificado</span><span className="text-right">{fmtDate(info?.updatedAt)}</span>
                          </div>

                          <div className="mt-auto flex flex-wrap gap-2 border-t border-white/[0.07] bg-slate-950/25 p-3 sm:p-4">
                            <Link
                              href={`/console?db=${encodeURIComponent(name)}`}
                              className="glass-button focus-ring rounded-lg bg-sky-400/15 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-400/25"
                            >
                              Abrir no Console
                            </Link>
                            {!isActive && (
                              <button
                                type="button"
                                onClick={() => void switchDatabase(name)}
                                className="focus-ring rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
                              >
                                Ativar
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => beginAction("rename", name)}
                              className="focus-ring rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
                            >
                              Renomear
                            </button>
                            <button
                              type="button"
                              onClick={() => beginAction("duplicate", name)}
                              className="focus-ring rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
                            >
                              Duplicar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete([name])}
                              className="focus-ring rounded-lg border border-rose-300/20 px-3 py-2 text-xs text-rose-200 hover:border-rose-300/40 hover:bg-rose-400/10"
                            >
                              Excluir
                            </button>
                            <button
                              type="button"
                              onClick={() => void toggleCard(name)}
                              aria-expanded={isOpen}
                              className="focus-ring ml-auto rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
                            >
                              {isOpen ? "Ocultar histórico" : "Histórico"}
                            </button>
                          </div>

                          <AnimatePresence initial={false}>
                            {isOpen && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden border-t border-white/[0.07] bg-slate-950/25"
                              >
                                <div className="space-y-2 p-4">
                                  <p className="text-xs font-semibold text-slate-300">
                                    Histórico recente · {history.length} registro(s)
                                  </p>
                                  {loadingHistory ? (
                                    <div className="skeleton-shimmer h-12 rounded-xl" />
                                  ) : history.length === 0 ? (
                                    <p className="text-xs text-slate-500">
                                      Nenhuma consulta registrada neste banco.
                                    </p>
                                  ) : (
                                    history.slice(0, 8).map((entry, entryIndex) => (
                                      <div key={`${entry.timestamp}-${entryIndex}`} className="rounded-xl border border-white/[0.07] bg-black/20 p-2.5">
                                        <div className="flex items-center justify-between gap-3">
                                          <span className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-200">
                                            {entry.command}
                                          </span>
                                          <time className="text-[10px] text-slate-500">{fmtDate(entry.timestamp)}</time>
                                        </div>
                                        <pre className="mt-2 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-slate-300">{entry.query}</pre>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </article>
                      </TiltCard>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}

          {databases.length > 0 && visibleDatabases.length === 0 && (
            <p className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">
              Nenhum banco corresponde à busca.
            </p>
          )}
        </div>

        {showPicker && (
          <EnginePicker
            existingNames={databases}
            busy={creating}
            serverError={createError}
            onNameChange={() => setCreateError(null)}
            onCancel={() => {
              if (!creating) setShowPicker(false);
            }}
            onConfirm={(name, engine) => void createDb(name, engine)}
          />
        )}

        <AnimatePresence>
          {confirmDelete && (
            <GlassModal
              title={confirmDelete.length === 1 ? "Excluir banco de dados?" : `Excluir ${confirmDelete.length} bancos?`}
              description={
                confirmDelete.length === 1
                  ? `O banco “${confirmDelete[0]}” e todos os seus dados serão removidos.`
                  : `${confirmDelete.length} bancos e todos os dados associados serão removidos.`
              }
              onClose={() => !deleting && setConfirmDelete(null)}
            >
              <div className="rounded-xl border border-rose-300/20 bg-rose-400/[0.07] p-4 text-sm leading-6 text-rose-100/90">
                Esta ação é permanente. Tabelas, consultas, favoritos e histórico de importação/exportação associados também serão apagados.
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(null)}
                  disabled={deleting}
                  className="focus-ring rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void deleteDatabases()}
                  disabled={deleting}
                  className="glass-button focus-ring rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-400 disabled:opacity-50"
                >
                  {deleting ? "Excluindo…" : "Excluir"}
                </button>
              </div>
            </GlassModal>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {action && actionDatabase && (
            <GlassModal
              title={action === "rename" ? "Renomear banco" : "Duplicar banco"}
              description={
                action === "rename"
                  ? `Escolha um novo nome para “${actionDatabase}”.`
                  : `Crie uma cópia de “${actionDatabase}” com outro nome.`
              }
              onClose={() => !busyAction && setAction(null)}
            >
              <label className="block text-sm font-medium text-slate-200" htmlFor="database-action-name">
                Nome do banco
              </label>
              <input
                id="database-action-name"
                autoFocus
                value={actionName}
                onChange={(event) => setActionName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitAction();
                }}
                className="focus-ring mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 font-mono text-sm text-white"
              />
              {actionError && <p role="alert" className="mt-2 text-sm text-rose-300">{actionError}</p>}
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAction(null)}
                  disabled={busyAction}
                  className="focus-ring rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/5"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void submitAction()}
                  disabled={busyAction}
                  className="glass-button focus-ring rounded-xl bg-sky-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-50"
                >
                  {busyAction ? "Salvando…" : action === "rename" ? "Salvar" : "Duplicar"}
                </button>
              </div>
            </GlassModal>
          )}
        </AnimatePresence>
        <div className="fixed bottom-4 right-4 z-[80] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
      </PageShell>
    </RequireAuth>
  );
}

function Metric({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-slate-950/35 px-3 py-2">
      <p className="font-mono text-lg font-semibold tabular-nums text-white">
        {value == null ? "—" : value.toLocaleString("pt-BR")}
      </p>
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
    </div>
  );
}
