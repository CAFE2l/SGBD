"use client";

import { useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { TableList } from "@/components/TableList";
import { TableDetails } from "@/components/TableDetails";
import { RequireAuth } from "@/components/RequireAuth";
import { useDb } from "@/hooks/useDb";
import { useActiveTable } from "@/hooks/useActiveTable";
import { useTableCounts } from "@/hooks/useTableCounts";

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
  const appliedTableParam = useRef(false);

  const { tables, activeDatabase, switchDatabase } = useDb();
  const { activeTable, selectTable } = useActiveTable();
  const { counts, loading: loadingCounts } = useTableCounts(tables);

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

  // ?table= (link do /perfil): seleciona a tabela indicada quando disponível.
  useEffect(() => {
    if (!requestedTable || appliedTableParam.current) return;
    if (!tables.some((t) => t.name === requestedTable)) return;
    appliedTableParam.current = true;
    selectTable(requestedTable);
  }, [requestedTable, tables, selectTable]);

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
          <TableList
            tables={tables}
            counts={counts}
            loadingCounts={loadingCounts}
            activeTable={activeTable}
            onSelectTable={selectTable}
          />
        </div>

        {/* Detalhe da tabela selecionada */}
        <div className="lg:col-span-2">
          <TableDetails key={activeTable ?? "none"} table={activeTable} />
        </div>
      </div>
    </PageShell>
  );
}