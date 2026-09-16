"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getForeignKeys,
  getTableData,
  getTableSchema,
  type ForeignKeyInfo,
} from "@/lib/sqlite/db";
import { ErDiagram } from "./ErDiagram";
import { ResultTable } from "./ResultTable";
import type { QueryResult, TableSchema } from "@/lib/sqlite/types";

export type TableTab = "estrutura" | "dados" | "diagrama";

const DATA_LIMIT = 100;

interface TableDetailsProps {
  /** Tabela ativa do banco. Usar `key={table}` para resetar o estado por tabela. */
  table: string | null;
  /** Aba exibida quando a tabela é aberta pela primeira vez. */
  defaultTab?: TableTab;
}

/**
 * Visão de inspeção de uma tabela (Estrutura / Dados / Diagrama), reaproveitada
 * pelo Console SQL e pela página "Ver Tabelas" — uma única implementação.
 */
export function TableDetails({
  table,
  defaultTab = "estrutura",
}: TableDetailsProps) {
  const [activeTab, setActiveTab] = useState<TableTab>(defaultTab);
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [fks, setFks] = useState<ForeignKeyInfo[]>([]);
  const [rowData, setRowData] = useState<QueryResult | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);

  const loadSchema = useCallback(
    async (name: string) => {
      setSchema(null);
      setFks([]);
      setRowData(null);
      setActiveTab(defaultTab);
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
    [defaultTab]
  );

  useEffect(() => {
    if (table) {
      void loadSchema(table);
    } else {
      setSchema(null);
      setFks([]);
      setRowData(null);
    }
  }, [table, loadSchema]);

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

  const selectTab = useCallback(
    (tab: TableTab) => {
      setActiveTab(tab);
      if (tab === "dados" && table) {
        void loadRows(table);
      }
    },
    [table, loadRows]
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

  if (!table) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-500">
        Selecione uma tabela na sidebar para ver sua estrutura e dados.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-sm font-semibold text-sky-300">
            {table}
          </span>
          {loadingSchema && (
            <span className="shrink-0 text-[11px] text-slate-500">Carregando…</span>
          )}
        </div>
        <div className="flex shrink-0 gap-1 rounded-lg border border-white/10 bg-white/5 p-1 text-xs">
          <TableTabButton
            label="Estrutura"
            active={activeTab === "estrutura"}
            onClick={() => selectTab("estrutura")}
          />
          <TableTabButton
            label="Dados"
            active={activeTab === "dados"}
            onClick={() => selectTab("dados")}
          />
          <TableTabButton
            label="Diagrama"
            active={activeTab === "diagrama"}
            onClick={() => selectTab("diagrama")}
          />
        </div>
      </div>
      <div className="p-3">
        {activeTab === "estrutura" && renderEstrutura()}
        {activeTab === "dados" && renderDados()}
        {activeTab === "diagrama" && renderDiagrama()}
      </div>
    </div>
  );

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
                    <tr key={c.cid} className="border-t border-white/5">
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
                          <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                            {c.pk}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {fk ? (
                          <span className="inline-flex items-center gap-1 rounded border border-sky-400/40 bg-sky-400/10 px-1.5 py-0.5 text-[10px] text-sky-300">
                            <span>FK</span>
                            <span className="text-slate-400">→</span>
                            <span>
                              {fk.table}.{fk.to}
                            </span>
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
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-slate-400">
            Editor de diagrama ER — fonte: schema real do banco
          </p>
          <span className="text-[10px] text-slate-500">
            todas as tabelas do banco · arraste para reposicionar
          </span>
        </div>
        <ErDiagram height={580} />
      </div>
    );
  }
}

function TableTabButton({
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
          : "text-slate-400 hover:bg-white/5 hover:text-white"
      }`}
      title={`Aba ${label}`}
    >
      {label}
    </button>
  );
}