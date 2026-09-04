"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getTableSchema, getForeignKeys } from "@/lib/sqlite/db";
import type { ForeignKeyInfo } from "@/lib/sqlite/db";
import type { ColumnInfo } from "@/lib/sqlite/types";

interface DiagramEdge {
  fromTable: string;
  fromCol: string;
  toTable: string;
  toCol: string;
}

interface DiagramNodeData {
  name: string;
  columns: ColumnInfo[];
  fkCols: Set<string>;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SchemaDiagramProps {
  /** nomes das tabelas do banco ativo */
  tables: string[];
}

const CELL_W = 310;
const BOX_W = 268;
const COL_H = 21;
const HEADER_H = 36;
const PAD = 10;

/** Diagrama ER (estilo brModelo) renderizado a partir do schema real do banco. */
export function SchemaDiagram({ tables }: SchemaDiagramProps) {
  const [nodes, setNodes] = useState<DiagramNodeData[]>([]);
  const [edges, setEdges] = useState<DiagramEdge[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (tables.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }
    setLoading(true);
    try {
      const schemas = await Promise.all(
        tables.map(async (t) => ({
          name: t,
          columns: (await getTableSchema(t)).columns,
          fks: await getForeignKeys(t),
        }))
      );
      const fkByTable = new Map<string, ForeignKeyInfo[]>();
      const fkColOwners = new Map<string, Set<string>>();
      for (const s of schemas) {
        const fks = s.fks ?? [];
        fkByTable.set(s.name, fks);
        const owned = new Set<string>();
        for (const fk of fks) {
          owned.add(fk.from);
        }
        fkColOwners.set(s.name, owned);
      }

      // Layout em grade por linhas, com altura por linha baseada no maior nó.
      const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
      const heights = schemas.map(
        (s) => HEADER_H + s.columns.length * COL_H + PAD
      );
      const rowHeights: number[] = [];
      schemas.forEach((_, i) => {
        const r = Math.floor(i / cols);
        rowHeights[r] = Math.max(rowHeights[r] ?? 0, heights[i] + 22);
      });
      const rowStart: number[] = [];
      let acc = 0;
      rowHeights.forEach((h, i) => {
        rowStart[i] = acc;
        acc += h;
      });

      const nodesArr: DiagramNodeData[] = schemas.map((s, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        return {
          name: s.name,
          columns: s.columns,
          fkCols: fkColOwners.get(s.name) ?? new Set(),
          x: col * CELL_W + 20,
          y: rowStart[row] + 10,
          width: BOX_W,
          height: HEADER_H + s.columns.length * COL_H,
        };
      });

      const nodeHeight = new Map(nodesArr.map((n) => [n.name, n.height]));
      const edgesArr: DiagramEdge[] = [];
      for (const s of schemas) {
        for (const fk of fkByTable.get(s.name) ?? []) {
          if (!nodeHeight.has(fk.table)) continue;
          edgesArr.push({
            fromTable: s.name,
            fromCol: fk.from,
            toTable: fk.table,
            toCol: fk.to,
          });
        }
      }

      setNodes(nodesArr);
      setEdges(edgesArr);
    } finally {
      setLoading(false);
    }
  }, [tables]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalHeight = useMemo(() => {
    if (nodes.length === 0) return 120;
    return Math.max(...nodes.map((n) => n.y + n.height)) + PAD;
  }, [nodes]);

  if (loading && nodes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 py-10 text-sm text-slate-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
        Carregando diagrama…
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 py-10 text-center text-sm text-slate-400">
        Nenhuma tabela no banco ativo para desenhar.
      </div>
    );
  }

  return (
    <div
      className="relative overflow-auto rounded-xl border border-white/10 bg-slate-950/40"
      style={{ height: totalHeight }}
    >
      <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: "none" }}>
        {edges.map((e, i) => {
          const from = nodes.find((n) => n.name === e.fromTable);
          const to = nodes.find((n) => n.name === e.toTable);
          if (!from || !to) return null;
          const sx = from.x + from.width;
          const sy = from.y + HEADER_H / 2;
          const tx = to.x;
          const ty = to.y + HEADER_H / 2;
          const cp = Math.max(40, Math.abs(tx - sx) / 2);
          return (
            <g key={i}>
              <path
                d={`M ${sx} ${sy} C ${sx + cp} ${sy}, ${tx - cp} ${ty}, ${tx} ${ty}`}
                fill="none"
                stroke="rgba(56,189,248,0.5)"
                strokeWidth={1.5}
              />
              <circle cx={tx} cy={ty} r={4} fill="rgba(56,189,248,0.7)" />
              <circle cx={sx} cy={sy} r={3} fill="rgba(250,204,21,0.7)" />
            </g>
          );
        })}
      </svg>

      {nodes.map((n) => (
        <div
          key={n.name}
          className="absolute overflow-hidden rounded-lg border border-sky-400/25 bg-slate-900/95 shadow-[0_0_20px_rgba(56,189,248,0.08)]"
          style={{ left: n.x, top: n.y, width: n.width, height: n.height }}
        >
          <div className="flex items-center justify-between border-b border-white/10 bg-sky-400/10 px-3 font-mono text-xs font-semibold text-sky-300">
            <span className="truncate">{n.name}</span>
          </div>
          <div>
            {n.columns.map((c) => (
              <div
                key={c.cid}
                className="flex items-center justify-between gap-2 px-3 font-mono text-[11px]"
                style={{ height: COL_H }}
              >
                <span className="truncate text-slate-200">{c.name}</span>
                <span className="flex shrink-0 items-center gap-1 text-[9px]">
                  <span className="text-slate-500">{c.type || "?"}</span>
                  {c.pk > 0 && (
                    <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1 text-amber-300">
                      PK
                    </span>
                  )}
                  {n.fkCols.has(c.name) && (
                    <span className="rounded border border-sky-400/40 bg-sky-400/10 px-1 text-sky-300">
                      FK
                    </span>
                  )}
                </span>
              </div>
            ))}
            {n.columns.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-slate-500">
                Sem colunas
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}