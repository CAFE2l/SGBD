"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { SqlEditor } from "@/components/SqlEditor";
import { ResultTable } from "@/components/ResultTable";
import { TableList } from "@/components/TableList";
import { useDb } from "@/hooks/useDb";
import { getSchemaCompletions, getTableSchema } from "@/lib/sqlite/db";
import type { SQLNamespace } from "@codemirror/lang-sql";
import type { QueryResult, QueryScriptResult, ColumnInfo } from "@/lib/sqlite/types";

/** Tempo máximo de execução antes de forçar o retorno ao estado ocioso. */
const EXEC_TIMEOUT_MS = 15000;

export default function ConsolePage() {
  return (
    <Suspense fallback={<PageShell>Carregando Console…</PageShell>}>
      <ConsoleInner />
    </Suspense>
  );
}

function ConsoleInner() {
  const { tables, executeScript, databases, activeDatabase, switchDatabase, createNewDatabase } =
    useDb();
  const searchParams = useSearchParams();
  const [sql, setSql] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [log, setLog] = useState<QueryScriptResult["log"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<Record<string, ColumnInfo[]>>({});
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [newDbName, setNewDbName] = useState("");
  const [showNewDb, setShowNewDb] = useState(false);
  const [completionSchema, setCompletionSchema] = useState<SQLNamespace>({});

  // Permite abrir /console?db=nome para já deixar o banco ativo selecionado.
  // Aplica apenas uma vez para não "brigar" com trocas manuais posteriores.
  const requestedDb = searchParams.get("db");
  const appliedDbParam = useRef(false);
  useEffect(() => {
    if (!requestedDb || appliedDbParam.current) return;
    appliedDbParam.current = true;
    if (requestedDb !== activeDatabase) {
      switchDatabase(requestedDb).catch(() => {
        // banco inválido: mantém o banco atual
      });
    }
  }, [requestedDb, activeDatabase, switchDatabase]);

  useEffect(() => {
    let cancelled = false;
    if (!activeDatabase) {
      setCompletionSchema({});
      return;
    }
    getSchemaCompletions(activeDatabase).then((schema) => {
      if (!cancelled) setCompletionSchema(schema);
    });
    return () => {
      cancelled = true;
    };
  }, [activeDatabase, tables]);

  const run = useCallback(
    async (source?: string) => {
      const query = source ?? sql;
      if (!query.trim()) return;
      setRunning(true);
      setError(null);
      setResult(null);
      setLog([]);
      let stale = false;
      // Rede de segurança: nunca deixar o botão preso em "Executando…".
      const guard = window.setTimeout(() => {
        stale = true;
        setRunning(false);
        setError(
          "A execução levou mais que 15s e foi interrompida por segurança. " +
            "Tente dividir o script em comandos menores."
        );
      }, EXEC_TIMEOUT_MS);
      try {
        const res = await executeScript(query);
        if (stale) return;
        setResult(res.final);
        setLog(res.log);
        setError(res.error);
        setHistory((h) => [query, ...h.filter((x) => x !== query)].slice(0, 20));
      } catch (e) {
        if (!stale) setError(e instanceof Error ? e.message : String(e));
      } finally {
        window.clearTimeout(guard);
        setRunning(false);
      }
    },
    [sql, executeScript]
  );

  const createDb = useCallback(async () => {
    const name = newDbName.trim();
    if (!name) return;
    setError(null);
    try {
      await createNewDatabase(name);
      setShowNewDb(false);
      setNewDbName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [newDbName, createNewDatabase]);

  const insertSelect = useCallback((table: string) => {
    setSql(`SELECT * FROM "${table}" LIMIT 100;`);
  }, []);

  const toggleSchema = useCallback(
    async (table: string) => {
      if (schemas[table]) {
        const next = { ...schemas };
        delete next[table];
        setSchemas(next);
        return;
      }
      setLoadingSchema(true);
      try {
        const schema = await getTableSchema(table);
        setSchemas((s) => ({ ...s, [table]: schema.columns }));
      } catch {
        // schema vazio em caso de erro
      } finally {
        setLoadingSchema(false);
      }
    },
    [schemas]
  );

  return (
    <PageShell>
      {/* Seletor de banco ativo */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
        <label className="text-xs font-semibold text-slate-400">Banco ativo:</label>
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
          onClick={() => setShowNewDb((v) => !v)}
          className="rounded-lg bg-sky-400/15 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-400/25"
        >
          + Novo banco
        </button>
        {showNewDb && (
          <div className="flex items-center gap-2">
            <input
              value={newDbName}
              onChange={(e) => setNewDbName(e.target.value)}
              placeholder="nome_do_banco"
              className="rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 font-mono text-sm text-white outline-none focus:border-sky-400/60"
              onKeyDown={(e) => e.key === "Enter" && createDb()}
            />
            <button
              onClick={createDb}
              disabled={!newDbName.trim()}
              className="rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-40"
            >
              Criar
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sidebar de tabelas */}
        <aside className="w-full shrink-0 lg:w-64">
          <h2 className="mb-2 text-sm font-semibold text-slate-300">
            Tabelas {activeDatabase ? `· ${activeDatabase}` : ""}
          </h2>
          <TableList
            tables={tables}
            schemas={schemas}
            onSelectTable={insertSelect}
            onToggleSchema={toggleSchema}
            loadingSchema={loadingSchema}
          />
          <div className="mt-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-300">Histórico</h2>
            {history.length === 0 ? (
              <p className="text-xs text-slate-500">
                Nenhuma query executada nesta sessão.
              </p>
            ) : (
              <div className="space-y-1">
                {history.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => run(q)}
                    className="block w-full truncate rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-left font-mono text-[11px] text-slate-400 hover:bg-white/10 hover:text-sky-300"
                    title={q}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Editor + resultados */}
        <div className="min-w-0 flex-1">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
              <span className="text-xs font-semibold text-slate-400">Console SQL</span>
              <button
                onClick={() => run()}
                disabled={running || !sql.trim()}
                className="rounded-lg bg-sky-400 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-40"
              >
                {running ? "Executando…" : "Executar (Ctrl+Enter)"}
              </button>
            </div>
            <div className="p-3">
              <SqlEditor
                value={sql}
                onChange={setSql}
                onRun={() => run()}
                schema={completionSchema}
                placeholderText={"CREATE DATABASE Ecommerce;\nUSE Ecommerce;\nCREATE TABLE ...;\nINSERT INTO ...;"}
              />
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300 font-mono">
              {error}
            </div>
          )}

          {log.length > 0 && (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="mb-2 text-xs font-semibold text-slate-400">Log de comandos</p>
              <div className="space-y-1 font-mono text-xs">
                {log.map((l, i) => (
                  <div
                    key={i}
                    className={l.startsWith("✅") ? "text-emerald-300" : "text-rose-300"}
                  >
                    {l}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result && !result.isSelect && (
            <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300">
              {result.message}
            </div>
          )}

          {result && result.isSelect && (
            <div className="mt-4">
              <ResultTable
                columns={result.columns}
                rows={result.rows}
                emptyMessage={result.message}
              />
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
