"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { ResultTable } from "@/components/ResultTable";
import { SchemaDiagram } from "@/components/SchemaDiagram";
import { RequireAuth } from "@/components/RequireAuth";
import { useDb } from "@/hooks/useDb";
import {
  getTableSchema,
  getForeignKeys,
  getTableData,
  countTable,
} from "@/lib/sqlite/db";
import type { TableInfo, TableSchema, QueryResult } from "@/lib/sqlite/types";
import type { ForeignKeyInfo } from "@/lib/sqlite/db";

type Tab = "estrutura" | "dados" | "diagrama";

const DATA_LIMIT = 100;

export default function TabelasPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<PageShell>Carregando navegador de tabelas…</PageShell>}>
        <TabelasInner />
      </Suspense>
    </RequireAuth>
  );
}

function TabelasInner() {
  const searchParams = useSearchParams();
  const requestedDb = searchParams.get("db");
  const requestedTable = searchParams.get("table");
  const appliedDbParam = useRef(false);

  const { tables, activeDatabase, switchDatabase } = useDb();

  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("estrutura");

  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [fks, setFks] = useState<ForeignKeyInfo[]>([]);
  const [rowData, setRowData] = useState<QueryResult | null>(null);

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingCounts, setLoadingCounts] = useState(false);

  // Permite abrir /tabelas?db=nome para já deixar o banco ativo selecionado.
  // Aplica apenas uma vez para não "brigar" com a lista de tabelas.
  useEffect(() => {
    if (!requestedDb || appliedDbParam.current) return;
    appliedDbParam.current = true;
    if (requestedDb !== activeDatabase) {
      switchDatabase(requestedDb).catch(() => {
        /* mantém o banco atual se o nome for inválido */
      });
    }
  }, [requestedDb, activeDatabase, switchDatabase]);

  // Carrega contagens de linhas para a lista de tabelas.
  const loadCounts = useCallback(async () => {
    if (!tables.length) {
      setCounts({});
      return;
    }
    setLoadingCounts(true);
    try {
      const next: Record<string, number> = {};
      for (const t of tables) {
        try {
          next[t.name] = await countTable(t.name);
        } catch {
          next[t.name] = 0;
        }
      }
      setCounts(next);
    } finally {
      setLoadingCounts(false);
    }
  }, [tables]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  // Auto-seleciona a primeira tabela — ou ?table= (link do /perfil).
  useEffect(() => {
    if (tables.length > 0 && !selectedTable) {
      const wanted = requestedTable && tables.some((t) => t.name === requestedTable)
        ? requestedTable
        : tables[0]?.name;
      if (wanted) {
        setSelectedTable(wanted);
        setActiveTab("dados");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, selectedTable]);

  const loadSchema = useCallback(
    async (name: string) => {
      setSelectedTable(name);
      setSchema(null);
      setFks([]);
      setRowData(null);
      setActiveTab("estrutura");
      setLoadingSchema(true);
      try {
        const [s, fk] = await Promise.all([
          getTableSchema(name),
          getForeignKeys(name),
        ]);
        setSchema(s);
        setFks(fk ?? []);
      } catch {
        setSchema(null);
        setFks([]);
      } finally {
        setLoadingSchema(false);
      }
    },
    []
  );

  const loadRows = useCallback(
    async (name: string) => {
      if (rowData && schema?.name === name) return;
      setLoadingRows(true);
      try {
        const d = await getTableData(name, DATA_LIMIT);
        setRowData(d);
      } catch {
        setRowData(null);
      } finally {
        setLoadingRows(false);
      }
    },
    [rowData, schema?.name]
  );

  // Recarrega linhas ao trocar para a aba "Dados".
  const selectTab = useCallback(
    (tab: Tab) => {
      setActiveTab(tab);
      if (tab === "dados" && selectedTable) {
        void loadRows(selectedTable);
      }
    },
    [selectedTable, loadRows]
  );

  const fkByColumn = useMemo(() => {
    const m = new Map<string, ForeignKeyInfo>();
    for (const fk of fks) m.set(fk.from, fk);
    return m;
  }, [fks]);

  const hasStructure =
    !!schema &&
    schema.columns.some((c) => c.pk > 0) &&
    fks.length > 0;
  const hasNoKeys =
    !!schema &&
    schema.columns.length > 0 &&
    schema.columns.every((c) => c.pk === 0) &&
    fks.length === 0;

  function renderEstrutura() {
    if (loadingSchema && !schema) {
      return (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-slate-500">
          Carregando estrutura…
        </div>
      );
    }
    if (!schema) {
      return (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-slate-500">
          Não foi possível carregar a estrutura desta tabela.
        </div>
      );
    }
    const cols = schema.columns;
    return (
      <div className="space-y-3">
        {hasNoKeys && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3.5 py-2 text-xs text-amber-300">
            Estrutura não detectada: nenhuma chave primária ou estrangeira
            definida nesta tabela (tabelas importadas via CSV costumam ser
            assim).
          </div>
        )}
        <div className="max-h-80 overflow-auto rounded-lg border border-white/10">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-900/80">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 font-mono text-sky-300">
                  Coluna
                </th>
                <th className="px-3 py-2 font-mono text-sky-300">Tipo</th>
                <th className="px-3 py-2 font-mono text-sky-300">Chave Primária</th>
                <th className="px-3 py-2 font-mono text-sky-300">Chave Estrangeira</th>
                <th className="px-3 py-2 font-mono text-sky-300">Nulável</th>
                <th className="px-3 py-2 font-mono text-sky-300">Padrão</th>
              </tr>
            </thead>
            <tbody>
              {cols.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-3 text-slate-500">
                    Sem colunas.
                  </td>
                </tr>
              ) : (
                cols.map((c) => {
                  const fk = fkByColumn.get(c.name);
                  return (
                    <tr
                      key={c.cid}
                      className="border-t border-white/5"
                    >
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-slate-200">
                        {c.name}
                        {c.pk > 0 && (
                          <span className="ml-1 rounded border border-amber-400/40 bg-amber-400/10 px-1 text-[9px] font-semibold text-amber-300">
                            PK
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-slate-400">
                        {c.type || "TEXT"}
                      </td>
                      <td className="px-3 py-1.5">
                        {c.pk > 0 ? (
                          <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.25 text-[10px] text-amber-300">
                            {c.pk}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {fk ? (
                          <span className="inline-flex items-center gap-1 rounded border border-sky-400/40 bg-sky-400/10 px-1.5 py-0.25 text-[10px] text-sky-300">
                            <span>FK</span>
                            <span className="text-slate-400">→</span>
                            <span>{fk.table}.{fk.to}</span>
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-slate-400">
                        {c.notnull === 1 ? "Não" : "Sim"}
                      </td>
                      <td className="px-3 py-1.5 text-slate-400">
                        {c.dflt_value ?? "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!hasStructure && !hasNoKeys && (
          <p className="text-[11px] text-slate-500">
            Sem chaves primárias ou estrangeiras detectadas.
          </p>
        )}
      </div>
    );
  }

  function renderDados() {
    if (loadingRows) {
      return (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-slate-400">
          Carregando dados…
        </div>
      );
    }
    if (!rowData) {
      return (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-slate-400">
          Não foi possível carregar os dados desta tabela.
        </div>
      );
    }
    return (
      <ResultTable
        columns={rowData.columns}
        rows={rowData.rows}
        pageSize={25}
        emptyMessage={rowData.message || "Tabela vazia."}
      />
    );
  }

  function renderDiagrama() {
    return (
      <div className="rounded-xl border border-white/10 p-2 bg-black/20">
        <p className="mb-2 text-[11px] font-semibold text-slate-400">
          Relacionamentos (chaves estrangeiras) — fonte: schema real do banco
        </p>
        <SchemaDiagram tables={tables.map((t) => t.name)} />
      </div>
    );
  }

  return (
    <PageShell>
      <div className="mb-6 flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-white">Ver Tabelas</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            banco: {activeDatabase ?? "—"}
          </span>
          <Link
            href="/bancos"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:border-sky-400/40 hover:text-sky-300"
          >
            ← Voltar para Bancos
          </Link>
        </div>
        <p className="text-sm text-slate-400">
          Navegue pela estrutura e dados das tabelas do banco, estilo phpMyAdmin.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Lista de tabelas */}
        <div className="lg:col-span-1">
          <h2 className="mb-2 text-xs font-semibold text-slate-400">
            Tabelas ({tables.length})
          </h2>
          {tables.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center text-sm text-slate-500">
              Nenhuma tabela neste banco.
            </div>
          ) : (
            <div className="space-y-1">
              {tables.map((t: TableInfo) => {
                const isActive = t.name === selectedTable;
                return (
                  <button
                    key={t.name}
                    onClick={() => void loadSchema(t.name)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left font-mono text-xs transition-colors ${
                      isActive
                        ? "border-sky-400/40 bg-sky-400/10 text-sky-200"
                        : "border-white/10 bg-white/5 text-slate-300 hover:border-sky-400/30 hover:bg-white/10"
                    }`}
                    title={`Ver estrutura e dados de ${t.name}`}
                  >
                    <span className="truncate">{t.name}</span>
                    <span className="ml-2 rounded-full border border-white/10 bg-black/20 px-1.5 py-0.25 text-[10px] text-slate-400">
                      {loadingCounts ? "…" : counts[t.name] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Detalhe da tabela selecionada */}
        <div className="lg:col-span-2">
          {!selectedTable ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-500">
              Selecione uma tabela para ver sua estrutura e dados.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Cabeçalho da aba */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-sky-300">
                    {selectedTable}
                  </span>
                  {loadingSchema && (
                    <span className="text-[11px] text-slate-500">
                      Carregando…
                    </span>
                  )}
                </div>
                <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1 text-xs">
                  <TabBtn
                    label="Estrutura"
                    active={activeTab === "estrutura"}
                    onClick={() => selectTab("estrutura")}
                  />
                  <TabBtn
                    label="Dados"
                    active={activeTab === "dados"}
                    onClick={() => selectTab("dados")}
                  />
                  <TabBtn
                    label="Diagrama"
                    active={activeTab === "diagrama"}
                    onClick={() => selectTab("diagrama")}
                  />
                </div>
              </div>

              {/* Estrutura */}
              {activeTab === "estrutura" && renderEstrutura()}
              {/* Dados */}
              {activeTab === "dados" && renderDados()}
              {/* Diagrama */}
              {activeTab === "diagrama" && renderDiagrama()}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function TabBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "border border-white/10 bg-sky-400/15 text-sky-300"
          : "text-slate-400 hover:text-white hover:bg-white/5"
      }`}
      title={`Aba ${label}`}
    >
      {label}
    </button>
  );
}