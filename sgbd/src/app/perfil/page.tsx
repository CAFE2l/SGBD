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
import { download, type DbCard } from "./types";
import Papa from "papaparse";

export default function PerfilPage() {
  return (<RequireAuth><PageShell><PerfilInner /></PageShell></RequireAuth>);
}

function PerfilInner() {
  const { user } = useAuth();
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
    setCreating(true); setPageError(null);
    try {
      await createNewDatabase(name, engine);
      setShowPicker(false); setPageOk(`Banco "${name}" criado com motor ${ENGINES[engine].label}.`);
      await loadAll();
    } catch (e) { setPageError(e instanceof Error ? e.message : String(e)); }
    finally { setCreating(false); }
  };
  const doRename = async (oldName: string) => {
    if (!renameValue.trim()) return;
    setBusyDb(oldName); setPageError(null);
    try {
      const clean = await renameDatabase(oldName, renameValue.trim());
      setRenaming(null); setPageOk(`Banco renomeado para "${clean}".`);
      await refresh(); await loadAll();
    } catch (e) { setPageError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyDb(null); }
  };
  const doDuplicate = async (name: string) => {
    setBusyDb(name); setPageError(null);
    try {
      const copy = await duplicateDatabase(name);
      setPageOk(`Banco duplicado como "${copy}".`);
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
      await refresh(); await loadAll();
    } catch (e) { setPageError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyDb(null); }
  };
  const doToggleFav = async (database: string, query: string, command: string) => {
    const { list } = await toggleFavorite({ database, query, command });
    setFavs(list);
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
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        <div className="h-1.5 bg-gradient-to-r from-amber-400 via-sky-400 to-emerald-400" />
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-400/15 text-3xl font-bold text-sky-300">{(displayName[0] ?? "?").toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold text-white">{displayName}</h1>
            <p className="truncate text-sm text-slate-400">{user?.email ?? "—"}</p>
            <p className="mt-1 text-xs text-slate-500">Conta criada em {createdAt}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
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
        onOpenPicker={() => setShowPicker(true)}
        onRename={(n: string) => void doRename(n)} onDuplicate={(n: string) => void doDuplicate(n)}
        onExport={(n: string) => void doExport(n)} onDelete={(n: string) => void doDelete(n)} />
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
      {showPicker && <EnginePicker busy={creating} onCancel={() => setShowPicker(false)} onConfirm={(n, e) => void doCreate(n, e)} />}
    </div>
  );
}
