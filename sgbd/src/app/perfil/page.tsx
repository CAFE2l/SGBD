"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import { EnginePicker } from "@/components/EnginePicker";
import { useAuth } from "@/hooks/useAuth";
import { useDb } from "@/hooks/useDb";
import { ENGINES, engineOrDefault, type EngineId } from "@/lib/profile/engines";
import { buildJsonSql } from "@/lib/profile/json-import";
import { describeDatabase, duplicateDatabase, exportDatabaseSql, getDatabaseEngine, getProfileStats, importCsv, inspectDatabase, renameDatabase, switchActiveDatabase, dropDatabase, importSql as importSqlInto } from "@/lib/sqlite/db";
import { appendIoHistory, getFavorites, getGlobalQueryLog, getIoHistory, toggleFavorite, type FavoriteEntry, type GlobalQueryEntry, type IoHistoryEntry } from "@/lib/sqlite/history";
import { DbCards, IoSection, QueryHistory, Stat, TablesByDb } from "./sections";
import { ProfileAvatar } from "./ProfileAvatar";
import { download, type DbCard } from "./types";
import Papa from "papaparse";
import { useToast } from "@/hooks/useToast";
import { ToastContainer } from "@/components/Toast";
import { GlassModal } from "@/components/ui/GlassModal";
import { AnimatePresence } from "framer-motion";

export default function PerfilPage() {
  return (<RequireAuth><PageShell><PerfilInner /></PageShell></RequireAuth>);
}

function PerfilInner() {
  const { user, updateProfile } = useAuth();
  const { toasts, showToast, dismissToast } = useToast();
  const { databases, activeDatabase, createNewDatabase, refresh, ready } = useDb();
  const [cards, setCards] = useState<DbCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [stats, setStats] = useState({ totalQueries: 0, totalTablesCreated: 0, totalDatabasesCreated: 0 });
  const [totalTables, setTotalTables] = useState(0);
  const [log, setLog] = useState<GlobalQueryEntry[]>([]);
  const [favs, setFavs] = useState<FavoriteEntry[]>([]);
  const [ioHist, setIoHist] = useState<IoHistoryEntry[]>([]);
  const [qText, setQText] = useState("");
  const [qDb, setQDb] = useState<string>("all");
  const [qStatus, setQStatus] = useState<"all" | "ok" | "err">("all");
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busyDb, setBusyDb] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageOk, setPageOk] = useState<string | null>(null);
  const [expandedDb, setExpandedDb] = useState<string | null>(null);
  const [jsonMsg, setJsonMsg] = useState<string | null>(null);
  const [sqlMsg, setSqlMsg] = useState<string | null>(null);
  const [csvMsg, setCsvMsg] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadAll = useCallback(async () => {
    setLoadingCards(true);
    try {
      const next: DbCard[] = [];
      let tables = 0;
      await Promise.all(databases.map(async (name) => {
        try {
          const [desc, info] = await Promise.all([describeDatabase(name), inspectDatabase(name)]);
          tables += desc.tableCount;
          const eng = engineOrDefault((info as { engine?: unknown }).engine ?? getDatabaseEngine(name));
          next.push({ name, engine: eng, tableCount: desc.tableCount, rowCount: desc.rowCount, tables: desc.tables, createdAt: info.createdAt, updatedAt: info.updatedAt });
        } catch { next.push({ name, engine: "postgres", tableCount: 0, rowCount: 0, tables: [], createdAt: null, updatedAt: null }); }
      }));
      next.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      setCards(next); setTotalTables(tables); setStats(getProfileStats());
      setLog(await getGlobalQueryLog());
      setFavs(await getFavorites());
      setIoHist(await getIoHistory());
    } finally { setLoadingCards(false); }
  }, [databases]);

  useEffect(() => { if (ready) void loadAll(); }, [ready, loadAll]);

  const filteredLog = useMemo(() => {
    const t = qText.trim().toLowerCase();
    return log.filter((e) => {
      if (qDb !== "all" && e.database !== qDb) return false;
      if (qStatus === "ok" && !e.success) return false;
      if (qStatus === "err" && e.success) return false;
      if (t && !e.query.toLowerCase().includes(t) && !e.command.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [log, qText, qDb, qStatus]);

  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  const favKeys = useMemo(() => new Set(favs.map((f) => `${f.database}::${norm(f.query)}`)), [favs]);
  const visibleLog = showFavOnly ? filteredLog.filter((e) => favKeys.has(`${e.database}::${norm(e.query)}`)) : filteredLog;

  const doCreate = async (name: string, engine: EngineId) => {
    setCreating(true); setCreateError(null);
    try {
      await createNewDatabase(name, engine);
      setShowPicker(false); setPageOk(`Banco "${name}" criado com motor ${ENGINES[engine].label}.`);
      showToast(`Banco "${name}" criado.`, "success");
      await loadAll();
    } catch (e) { setCreateError(e instanceof Error ? e.message : String(e)); }
    finally { setCreating(false); }
  };
  const doRename = async (oldName: string) => {
    if (!renameValue.trim()) return;
    setBusyDb(oldName); setPageError(null);
    try {
      const clean = await renameDatabase(oldName, renameValue.trim());
      setRenaming(null); setPageOk(`Banco renomeado para "${clean}".`);
      showToast(`Banco renomeado para "${clean}".`, "success");
      await refresh(); await loadAll();
    } catch (e) { setPageError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyDb(null); }
  };
  const doDuplicate = async (name: string) => {
    setBusyDb(name); setPageError(null);
    try {
      const copy = await duplicateDatabase(name);
      setPageOk(`Banco duplicado como "${copy}".`);
      showToast(`Banco duplicado como "${copy}".`, "success");
      await refresh(); await loadAll();
    } catch (e) { setPageError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyDb(null); }
  };
  const doExport = async (name: string) => {
    setBusyDb(name); setPageError(null);
    try {
      const sql = await exportDatabaseSql(name);
      download(`${name}.sql`, sql, "application/sql");
      await appendIoHistory({ direction: "export", format: "sql", fileName: `${name}.sql`, database: name, success: true, message: `${sql.length} chars` });
      setIoHist(await getIoHistory());
      setPageOk(`Banco "${name}" exportado como .sql.`);
    } catch (e) { setPageError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyDb(null); }
  };
  const doDelete = async (name: string) => {
    setBusyDb(name); setPageError(null);
    try {
      await dropDatabase(name);
      setConfirmDelete(null); setPageOk(`Banco "${name}" excluído.`);
      showToast(`Banco "${name}" excluído permanentemente.`, "success");
      await refresh(); await loadAll();
    } catch (e) { setPageError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyDb(null); }
  };
  const doToggleFav = async (database: string, query: string, command: string) => {
    const { list } = await toggleFavorite({ database, query, command });
    setFavs(list);
  };
  const saveDisplayName = async () => {
    const cleanName = nameValue.trim();
    if (cleanName.length < 2 || cleanName.length > 40) {
      setNameError("O nome deve ter entre 2 e 40 caracteres.");
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      await updateProfile({ displayName: cleanName });
      setEditingName(false);
      showToast("Nome da conta atualizado.", "success");
    } catch (cause) {
      setNameError(cause instanceof Error ? cause.message : "Não foi possível salvar o nome.");
    } finally {
      setSavingName(false);
    }
  };
  const doExportJson = async (dbName: string) => {
    setBusyDb(dbName); setPageError(null);
    try {
      const desc = await describeDatabase(dbName);
      const prev = activeDatabase;
      if (prev !== dbName) await switchActiveDatabase(dbName);
      const { getTableData } = await import("@/lib/sqlite/db");
      const out: Record<string, unknown[]> = {};
      for (const t of desc.tables) {
        try { const d = await getTableData(t.name, 5000); out[t.name] = d.rows as unknown[]; }
        catch { out[t.name] = []; }
      }
      if (prev && prev !== dbName) await switchActiveDatabase(prev).catch(() => undefined);
      download(`${dbName}.json`, JSON.stringify(out, null, 2), "application/json");
      await appendIoHistory({ direction: "export", format: "json", fileName: `${dbName}.json`, database: dbName, success: true, message: `${desc.tableCount} tabela(s)` });
      setIoHist(await getIoHistory());
      setPageOk(`Banco "${dbName}" exportado como .json.`);
    } catch (e) { setPageError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyDb(null); }
  };
  const onJsonFile = async (file: File) => {
    setJsonMsg(null); setPageError(null); setBusyDb("__import__");
    try {
      const text = await file.text();
      const { sql, analysis } = buildJsonSql(text, file.name);
      const target = activeDatabase ?? databases[0];
      if (!target) throw new Error("Crie um banco antes de importar.");
      await switchActiveDatabase(target);
      const rep = await importSqlInto(sql);
      const ok = rep.errors.length === 0;
      await appendIoHistory({ direction: "import", format: "json", fileName: file.name, database: target, tableName: analysis.suggestedTable, rows: analysis.rowCount, success: ok, message: `${analysis.shape === "relational" ? "tabela relacional" : "coleção de documentos"}: ${analysis.reason}` });
      setIoHist(await getIoHistory());
      await refresh(); await loadAll();
            setJsonMsg(`${analysis.shape === "relational" ? "Tabela relacional" : "Coleção de documentos"} criada em "${target}": ${analysis.reason}`);
    } catch (e) { setPageError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyDb(null); }
  };
  const onSqlFile = async (file: File) => {
    setPageError(null); setSqlMsg(null); setBusyDb("__import__");
    try {
      const text = await file.text();
      const rep = await importSqlInto(text);
      const ok = rep.errors.length === 0;
      const target = activeDatabase ?? databases[0];
      await refresh(); await loadAll();
      void appendIoHistory({ direction: "import", format: "sql", fileName: file.name, database: target ?? "(nenhum)", success: ok, message: `${rep.tableCount} tabela(s) · ${rep.rowCount} linha(s) · ${rep.errors.length} erro(s)` });
      setIoHist(await getIoHistory());
      setSqlMsg(`Importado ${rep.tableCount} tabela(s) / ${rep.rowCount} linha(s). ${ok ? "" : `${rep.errors.length} erro(s).`}`);
    } catch (e) { setPageError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyDb(null); }
  };
  const onCsvFile = async (file: File) => {
    setPageError(null); setCsvMsg(null); setBusyDb("__import__");
    try {
      const text = await file.text();
      const parsed = Papa.parse<string[]>(text, { header: true, skipEmptyLines: true });
      if (parsed.errors.length > 0) throw new Error(parsed.errors.map((e) => e.message).join("; "));
      const columns: string[] = parsed.meta.fields ?? [];
      if (!columns.length) throw new Error("CSV sem colunas.");
      const rows: (string | null)[][] = parsed.data.map((row) => columns.map((c) => {
                  const v = (row as unknown as Record<string, string>)[c];
        return v == null || v === "" ? null : v;
      }));
      const tableName = file.name.replace(/\.csv$/i, "").replace(/[^a-zA-Z0-9_]/g, "_") || "csv_data";
      const rep = await importCsv({ columns, rows }, tableName);
      const ok = rep.errors.length === 0;
      const target = activeDatabase ?? databases[0];
      await refresh(); await loadAll();
      void appendIoHistory({ direction: "import", format: "csv", fileName: file.name, database: target ?? "(nenhum)", tableName, rows: rep.rowCount, success: ok, message: `${rep.errors.length} erro(s)` });
      setIoHist(await getIoHistory());
      setCsvMsg(`Importado CSV como tabela "${tableName}" (${rep.rowCount} linha(s)). ${ok ? "" : `${rep.errors.length} erro(s).`}`);
    } catch (e) { setPageError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyDb(null); }
  };
  const doExportSql = async (name: string) => {
    setBusyDb(name); setPageError(null);
    try {
      const prev = activeDatabase;
      if (prev !== name) await switchActiveDatabase(name);
      const sql = await exportDatabaseSql(name);
      download(`${name}.sql`, sql, "application/sql");
      void appendIoHistory({ direction: "export", format: "sql", fileName: `${name}.sql`, database: name, success: true, message: `${sql.length} chars` });
      setIoHist(await getIoHistory());
      setPageOk(`Banco \"${name}\" exportado como .sql.`);
    } catch (e) { setPageError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyDb(null); }
  };
  const doExportCsv = async (name: string) => {
    setBusyDb(name); setPageError(null);
    try {
      const prev = activeDatabase;
      if (prev !== name) await switchActiveDatabase(name);
      const desc = await describeDatabase(name);
      const { getTableData } = await import("@/lib/sqlite/db");
      const parts: string[] = [];
      for (const t of desc.tables) {
        try {
          const d = await getTableData(t.name, Number.MAX_SAFE_INTEGER);
          const header = d.columns.join(",");
          const lines = d.rows.map((r) => d.columns.map((c) => {
            const v = r[c];
            if (v == null) return "";
            const s = String(v);
            return /[\",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          }).join(","));
          parts.push(`# ${t.name}\n${header}\n${lines.join("\n")}`);
        } catch { /* skip */ }
      }
      const blob = new Blob([parts.join("\n\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${name}.csv`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (prev && prev !== name) await switchActiveDatabase(prev).catch(() => undefined);
      void appendIoHistory({ direction: "export", format: "csv", fileName: `${name}.csv`, database: name, success: true, message: `${desc.tableCount} tabela(s)` });
      setIoHist(await getIoHistory());
      setPageOk(`Banco \"${name}\" exportado como .csv.`);
    } catch (e) { setPageError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyDb(null); }
  };
  const doRerun = (db: string, query: string) => {
    const url = `/console?db=${encodeURIComponent(db)}&q=${encodeURIComponent(query)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const displayName = user?.displayName ?? user?.email?.split("@")[0] ?? "Aluno";
  const createdAt = user?.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString("pt-BR") : "—";
  return (
    <div className="space-y-8 pb-10">
      <section className="glass-panel relative overflow-hidden rounded-[24px]">
        <div className="profile-gradient-bar h-1.5" />
        <div className="relative flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:p-7">
          <div className="relative shrink-0 rounded-full p-1 ring-1 ring-cyan-300/30 shadow-[0_0_35px_rgba(34,211,238,0.18)]">
            <div className="rounded-full bg-gradient-to-br from-sky-300 via-cyan-300 to-emerald-300 p-[2px]">
              <ProfileAvatar />
            </div>
          </div>
          <div className="group min-w-0 flex-1">
            {editingName ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveDisplayName();
                }}
                className="max-w-lg"
              >
                <label htmlFor="profile-display-name" className="sr-only">Nome da conta</label>
                <input
                  id="profile-display-name"
                  autoFocus
                  value={nameValue}
                  onChange={(event) => {
                    setNameValue(event.target.value);
                    setNameError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setEditingName(false);
                      setNameError(null);
                    }
                  }}
                  maxLength={80}
                  aria-invalid={!!nameError}
                  aria-describedby={nameError ? "profile-name-error" : undefined}
                  className="focus-ring w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xl font-bold text-white"
                />
                {nameError && <p id="profile-name-error" role="alert" className="mt-2 text-xs text-rose-300">{nameError}</p>}
                <div className="mt-3 flex gap-2">
                  <button type="submit" disabled={savingName} className="rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-50">
                    {savingName ? "Salvando…" : "Salvar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingName(false);
                      setNameError(null);
                    }}
                    disabled={savingName}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="truncate text-2xl font-bold tracking-tight text-white sm:text-3xl">{displayName}</h1>
                <button
                  type="button"
                  onClick={() => {
                    setNameValue(displayName);
                    setNameError(null);
                    setEditingName(true);
                  }}
                  aria-label="Editar nome da conta"
                  title="Editar nome"
                  className="focus-ring rounded-lg p-2 text-slate-400 opacity-100 transition hover:bg-white/5 hover:text-cyan-200 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m16 4 4 4M4 20l4.2-.8L19 8.4a2.1 2.1 0 0 0-3-3L5.2 16.2 4 20Z" />
                  </svg>
                </button>
              </div>
            )}
            <p className="mt-1 truncate text-sm text-slate-300">{user?.email ?? "—"}</p>
            <p className="mt-1.5 text-xs text-slate-500">Conta criada em {createdAt}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:w-[min(100%,22rem)]">
            <Stat label="bancos" value={databases.length} />
            <Stat label="queries" value={stats.totalQueries} title="Queries executadas" />
            <Stat label="tabelas" value={totalTables} title="Tabelas/coleções" />
          </div>
        </div>
      </section>
      {pageError && <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{pageError}</div>}
      {pageOk && <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{pageOk}</div>}
      <DbCards
        cards={cards} loading={loadingCards} activeDatabase={activeDatabase}
        renaming={renaming} renameValue={renameValue}
        setRenameValue={setRenameValue} setRenaming={setRenaming}
        confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete}
        expandedDb={expandedDb} setExpandedDb={setExpandedDb}
        onOpenPicker={() => {
          setCreateError(null);
          setShowPicker(true);
        }}
        onRename={(n: string) => void doRename(n)} onDuplicate={(n: string) => void doDuplicate(n)}
        onExport={(n: string) => void doExport(n)} onDelete={(n: string) => void doDelete(n)} />
      <AnimatePresence>
        {confirmDelete && (
          <GlassModal
            title="Excluir banco de dados?"
            description={`O banco “${confirmDelete}” e os dados associados serão removidos.`}
            onClose={() => {
              if (busyDb !== confirmDelete) setConfirmDelete(null);
            }}
          >
            <div className="rounded-xl border border-rose-300/20 bg-rose-400/[0.07] p-4 text-sm leading-6 text-rose-100/90">
              Esta ação é permanente. As tabelas, consultas, favoritos e registros de importação/exportação deste banco também serão apagados.
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(null)} disabled={busyDb === confirmDelete} className="focus-ring rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={() => void doDelete(confirmDelete)} disabled={busyDb === confirmDelete} className="glass-button focus-ring rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-400 disabled:opacity-50">
                {busyDb === confirmDelete ? "Excluindo…" : "Excluir"}
              </button>
            </div>
          </GlassModal>
        )}
      </AnimatePresence>
      <QueryHistory
        databases={databases} favs={favs}
        qText={qText} setQText={setQText} qDb={qDb} setQDb={setQDb}
        qStatus={qStatus} setQStatus={setQStatus}
        showFavOnly={showFavOnly} setShowFavOnly={setShowFavOnly}
        visibleLog={visibleLog} favKeys={favKeys} norm={norm}
        onToggleFav={(d: string, q: string, c: string) => void doToggleFav(d, q, c)}
        onRerun={(d: string, q: string) => void doRerun(d, q)} />
      <TablesByDb cards={cards} />
      <IoSection
        cards={cards} busyDb={busyDb} jsonMsg={jsonMsg} ioHist={ioHist}
        fileRef={fileRef} onJsonFile={(f: File) => void onJsonFile(f)}
        onSqlFile={(f: File) => void onSqlFile(f)}
        onCsvFile={(f: File) => void onCsvFile(f)}
        onExportJson={(n: string) => void doExportJson(n)}
        onExportSql={(n: string) => void doExportSql(n)}
        onExportCsv={(n: string) => void doExportCsv(n)}
        sqlMsg={sqlMsg} csvMsg={csvMsg} />
      {showPicker && <EnginePicker existingNames={databases} busy={creating} serverError={createError} onNameChange={() => setCreateError(null)} onCancel={() => setShowPicker(false)} onConfirm={(n, e) => void doCreate(n, e)} />}
      <div className="fixed bottom-4 right-4 z-[80] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    </div>
  );
}
