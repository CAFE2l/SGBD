"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import dagre from "dagre";
import { useDb } from "@/hooks/useDb";
import { addForeignKey, dropForeignKey, getForeignKeys, getTableSchema } from "@/lib/sqlite/db";
import type { ForeignKeyInfo } from "@/lib/sqlite/db";
import type { ColumnInfo } from "@/lib/sqlite/types";

const NODE_W = 300;
const HEADER_H = 38;
const ROW_H = 28;
const CURVATURE = 0.5;

type Cardinality = "1:1" | "1:N" | "N:N";

const CARDINALITIES: { value: Cardinality; label: string; hint: string }[] = [
  { value: "1:1", label: "1:1", hint: "um para um" },
  { value: "1:N", label: "1:N", hint: "um para muitos (padrão de FK)" },
  { value: "N:N", label: "N:N", hint: "muitos para muitos (label visual)" },
];

interface TableDef {
  name: string;
  columns: ColumnInfo[];
  fks: ForeignKeyInfo[];
}

interface RelDef {
  key: string;
  fromTable: string;
  fromCol: string;
  toTable: string;
  toCol: string;
}

interface ErNodeData {
  table: string;
  columns: ColumnInfo[];
  fkTargets: Record<string, string>;
  highlightedCol: string | null;
  onColumnClick: (table: string, col: string) => void;
  [key: string]: unknown;
}

type ErNode = FlowNode<ErNodeData, "er">;

interface ErEdgeData {
  key: string;
  fromTable: string;
  fromCol: string;
  toTable: string;
  toCol: string;
  cardinality: Cardinality;
  highlighted: boolean;
  onDelete: () => void;
  [key: string]: unknown;
}

type ErEdge = Edge<ErEdgeData, "er">;

interface PersistedView {
  pos: Record<string, { x: number; y: number }>;
  card: Record<string, Cardinality>;
}

function loadPersist(db: string): PersistedView | null {
  try {
    const raw = window.localStorage.getItem(`sgbd:er:${db}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedView>;
    return {
      pos: parsed.pos ?? {},
      card: parsed.card ?? {},
    };
  } catch {
    return null;
  }
}

function savePersist(db: string, view: PersistedView): void {
  try {
    window.localStorage.setItem(`sgbd:er:${db}`, JSON.stringify(view));
  } catch {
    // sem persistência disponível (ex: modo privado)
  }
}

function cardHeight(columns: ColumnInfo[]): number {
  return HEADER_H + Math.max(columns.length, 1) * ROW_H;
}

function labelFor(p: string): string {
  const parts = p.split(":");
  return parts[1] ?? "";
}

function relKey(fromTable: string, fromCol: string, toTable: string, toCol: string): string {
  return `${fromTable}.${fromCol}->${toTable}.${toCol}`;
}

function cardinalityLabels(c: Cardinality): { from: string; to: string } {
  if (c === "1:1") return { from: "1", to: "1" };
  if (c === "N:N") return { from: "N", to: "N" };
  return { from: "N", to: "1" };
}

function pointOnBezier(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  t: number
): { x: number; y: number } {
  const dist = Math.abs(tx - sx) * CURVATURE;
  const p1x = sx + dist;
  const p1y = sy;
  const p2x = tx - dist;
  const p2y = ty;
  const mt = 1 - t;
  const x = mt * mt * mt * sx + 3 * mt * mt * t * p1x + 3 * mt * t * t * p2x + t * t * t * tx;
  const y = mt * mt * mt * sy + 3 * mt * mt * t * p1y + 3 * mt * t * t * p2y + t * t * t * ty;
  return { x, y };
}

function dagreLayout(defs: TableDef[], rels: RelDef[]): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 56, ranksep: 140, marginx: 24, marginy: 24 });
  for (const d of defs) {
    g.setNode(d.name, { width: NODE_W, height: cardHeight(d.columns) });
  }
  for (const r of rels) {
    if (g.hasNode(r.fromTable) && g.hasNode(r.toTable)) g.setEdge(r.fromTable, r.toTable);
  }
  dagre.layout(g);
  const positions: Record<string, { x: number; y: number }> = {};
  for (const d of defs) {
    const n = g.node(d.name);
    positions[d.name] = {
      x: Math.round(n.x - NODE_W / 2),
      y: Math.round(n.y - cardHeight(d.columns) / 2),
    };
  }
  return positions;
}

// ---------- Node: card de tabela ----------

function makeHandleClass(): string {
  return [
    "!h-2 !w-2 !rounded-full !border !border-cyan-300/80 !bg-cyan-400",
    "opacity-0 transition-opacity group-hover:opacity-100",
    "!shadow-[0_0_6px_rgba(103,232,249,0.8)]",
  ].join(" ");
}

const ErTableNode = memo(function ErTableNode({ data, selected }: NodeProps<ErNode>) {
  const { table, columns, fkTargets, highlightedCol } = data;
  const handleCls = makeHandleClass();
  return (
    <div
      className={`w-full overflow-hidden rounded-lg border bg-slate-900/95 shadow-[0_0_20px_rgba(56,189,248,0.08)] transition-[border-color,box-shadow] ${
        selected
          ? "border-cyan-300 shadow-glow"
          : "border-sky-400/25 hover:border-sky-400/40"
      }`}
      style={{ width: NODE_W }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-sky-400/10 px-3 font-mono text-xs font-semibold text-sky-300"
        style={{ height: HEADER_H }}
      >
        <span className="truncate">{table}</span>
      </div>
      <div>
        {columns.map((c) => {
          const isFk = fkTargets[c.name] != null;
          const active = highlightedCol === c.name;
          return (
            <div
              key={c.cid}
              onClick={(e) => {
                e.stopPropagation();
                data.onColumnClick(table, c.name);
              }}
              title={
                isFk
                  ? `${table}.${c.name} → ${fkTargets[c.name]}`
                  : `Coluna ${c.name}`
              }
              className={`group relative flex cursor-pointer items-center justify-between gap-2 border-t border-white/[0.04] px-3 font-mono text-[11px] transition-colors ${
                active ? "bg-cyan-400/10" : "hover:bg-white/5"
              }`}
              style={{ height: ROW_H }}
            >
              <Handle
                id={`h:${c.name}:l`}
                type="source"
                position={Position.Left}
                isConnectable
                className={handleCls}
              />
              <span className={`truncate ${active ? "text-cyan-200" : "text-slate-200"}`}>
                {c.name}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[9px]">
                <span className="text-slate-500">{c.type || "?"}</span>
                {c.pk > 0 && (
                  <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1 font-bold text-amber-300">
                    PK
                  </span>
                )}
                {isFk && (
                  <span className="rounded border border-sky-400/40 bg-sky-400/10 px-1 font-bold text-sky-300">
                    FK
                  </span>
                )}
              </span>
              <Handle
                id={`h:${c.name}:r`}
                type="source"
                position={Position.Right}
                isConnectable
                className={handleCls}
              />
            </div>
          );
        })}
        {columns.length === 0 && (
          <div className="border-t border-white/[0.04] px-3 py-2 font-mono text-[11px] text-slate-500">
            Sem colunas
          </div>
        )}
      </div>
    </div>
  );
});

// ---------- Edge: relacionamento com cardinalidade ----------

const ErRelationEdge = memo(function ErRelationEdge(props: EdgeProps<ErEdge>) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    selected,
    data,
    style,
  } = props;
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: CURVATURE,
  });

  if (!data) return <BaseEdge path={path} style={style} />;

  const from = pointOnBezier(sourceX, sourceY, targetX, targetY, 0.16);
  const to = pointOnBezier(sourceX, sourceY, targetX, targetY, 0.84);
  const mid = pointOnBezier(sourceX, sourceY, targetX, targetY, 0.5);
  const labels = cardinalityLabels(data.cardinality);
  const hot = selected || data.highlighted;
  const stroke = hot ? "#22d3ee" : "rgba(56,189,248,0.4)";
  const width = hot ? 2.5 : 1.5;

  return (
    <>
      <BaseEdge
        path={path}
        style={{
          ...style,
          stroke,
          strokeWidth: width,
          filter: hot ? "drop-shadow(0 0 6px rgba(34,211,238,0.7))" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="pointer-events-none absolute z-[5]"
          style={{
            transform: `translate(-50%, -50%) translate(${from.x}px, ${from.y}px)`,
          }}
        >
          <span
            className={`inline-flex min-w-[1.25rem] items-center justify-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${
              hot
                ? "border-cyan-300/70 bg-cyan-400/20 text-cyan-200"
                : "border-sky-400/40 bg-sky-400/10 text-sky-300"
            }`}
          >
            {labels.from}
          </span>
        </div>
        <div
          className="pointer-events-none absolute z-[5]"
          style={{
            transform: `translate(-50%, -50%) translate(${to.x}px, ${to.y}px)`,
          }}
        >
          <span
            className={`inline-flex min-w-[1.25rem] items-center justify-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${
              hot
                ? "border-cyan-300/70 bg-cyan-400/20 text-cyan-200"
                : "border-sky-400/40 bg-sky-400/10 text-sky-300"
            }`}
          >
            {labels.to}
          </span>
        </div>
        {selected && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onDelete();
            }}
            className="absolute z-10 flex h-6 w-6 items-center justify-center rounded-md border border-red-400/40 bg-slate-900 text-xs text-red-300 shadow-lg transition-colors hover:bg-red-400/20"
            style={{
              transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)`,
            }}
            title="Excluir relacionamento"
          >
            ✕
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
});

const nodeTypes: NodeTypes = { er: ErTableNode };
const edgeTypes: EdgeTypes = { er: ErRelationEdge };

// ---------- Editor ----------

function ErDiagramRoot() {
  const { fitView, zoomIn, zoomOut } = useReactFlow<ErNode, ErEdge>();
  const { tables, activeDatabase } = useDb();

  const [nodes, setNodes, onNodesChange] = useNodesState<ErNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ErEdge>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [pendingCardinality, setPendingCardinality] = useState<Cardinality>("1:N");
  const [deleteTarget, setDeleteTarget] = useState<{ key: string; fromTable: string; fromCol: string; toTable: string; toCol: string } | null>(null);
  const [acting, setActing] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const defsRef = useRef<TableDef[]>([]);
  const relsRef = useRef<RelDef[]>([]);
  const persistRef = useRef<PersistedView>({ pos: {}, card: {} });
  const dbKeyRef = useRef("");
  const fittedRef = useRef("");
  const highlightRef = useRef<{ table: string; col: string } | null>(null);
  const guardRef = useRef(false);

  const armGuard = useCallback(() => {
    guardRef.current = true;
    window.setTimeout(() => {
      guardRef.current = false;
    }, 250);
  }, []);

  const applyHighlight = useCallback(() => {
    const hl = highlightRef.current;
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          highlightedCol: hl && hl.table === n.data.table ? hl.col : null,
        },
      }))
    );
    setEdges((eds) =>
      eds.map((e) => {
        const d = e.data;
        if (!d) return e;
        const h =
          !!hl &&
          ((d.fromTable === hl.table && d.fromCol === hl.col) ||
            (d.toTable === hl.table && d.toCol === hl.col));
        return { ...e, data: { ...d, highlighted: h }, zIndex: h ? 10 : 0 };
      })
    );
  }, [setNodes, setEdges]);

  const toggleColumn = useCallback(
    (table: string, col: string) => {
      if (guardRef.current) return;
      const cur = highlightRef.current;
      highlightRef.current =
        cur && cur.table === table && cur.col === col ? null : { table, col };
      applyHighlight();
    },
    [applyHighlight]
  );

  const buildView = useCallback(
    (
      defs: TableDef[],
      rels: RelDef[],
      card: Record<string, Cardinality>,
      positions: Record<string, { x: number; y: number }>,
      highlight: { table: string; col: string } | null
    ): { nodes: ErNode[]; edges: ErEdge[] } => {
      const nodes: ErNode[] = defs.map((d) => {
        const fkTargets: Record<string, string> = {};
        for (const fk of d.fks) fkTargets[fk.from] = `${fk.table}.${fk.to}`;
        return {
          id: d.name,
          type: "er",
          position: positions[d.name] ?? { x: 0, y: 0 },
          data: {
            table: d.name,
            columns: d.columns,
            fkTargets,
            highlightedCol: highlight && highlight.table === d.name ? highlight.col : null,
            onColumnClick: toggleColumn,
          },
        };
      });

      const edges: ErEdge[] = rels.map((r) => {
        const hl =
          !!highlight &&
          ((r.fromTable === highlight.table && r.fromCol === highlight.col) ||
            (r.toTable === highlight.table && r.toCol === highlight.col));
        return {
          id: r.key,
          type: "er",
          source: r.fromTable,
          target: r.toTable,
          sourceHandle: `h:${r.fromCol}:r`,
          targetHandle: `h:${r.toCol}:l`,
          data: {
            key: r.key,
            fromTable: r.fromTable,
            fromCol: r.fromCol,
            toTable: r.toTable,
            toCol: r.toCol,
            cardinality: card[r.key] ?? "1:N",
            highlighted: hl,
            onDelete: () =>
              setDeleteTarget({
                key: r.key,
                fromTable: r.fromTable,
                fromCol: r.fromCol,
                toTable: r.toTable,
                toCol: r.toCol,
              }),
          },
          zIndex: hl ? 10 : 1,
        };
      });

      return { nodes, edges };
    },
    [toggleColumn]
  );

  const refresh = useCallback(async () => {
    const tabNames = tables.map((t) => t.name);
    if (tabNames.length === 0) {
      setNodes([]);
      setEdges([]);
      setError(null);
      setLoading(false);
      defsRef.current = [];
      relsRef.current = [];
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        tabNames.map(async (name) => {
          const [schema, fks] = await Promise.all([
            getTableSchema(name),
            getForeignKeys(name),
          ]);
          return { name, columns: schema.columns, fks: fks ?? [] };
        })
      );
      const defs: TableDef[] = results;
      const rels: RelDef[] = [];
      const seen = new Set<string>();
      for (const d of defs) {
        for (const fk of d.fks) {
          if (!d.columns.some((c) => c.name === fk.from)) continue;
          const parent = defs.find((t) => t.name === fk.table);
          if (!parent || !parent.columns.some((c) => c.name === fk.to)) continue;
          const key = relKey(d.name, fk.from, fk.table, fk.to);
          if (seen.has(key)) continue;
          seen.add(key);
          rels.push({ key, fromTable: d.name, fromCol: fk.from, toTable: fk.table, toCol: fk.to });
        }
      }
      defsRef.current = defs;
      relsRef.current = rels;

      const dbKey = activeDatabase ?? "";
      dbKeyRef.current = dbKey;
      const saved = loadPersist(dbKey);
      const validNames = new Set(defs.map((d) => d.name));
      const positions: Record<string, { x: number; y: number }> = {};
      for (const [k, v] of Object.entries(saved?.pos ?? {})) {
        if (validNames.has(k)) positions[k] = v;
      }
      if (Object.keys(positions).length === 0) {
        Object.assign(positions, dagreLayout(defs, rels));
      }
      const card: Record<string, Cardinality> = {};
      for (const r of rels) card[r.key] = saved?.card?.[r.key] ?? "1:N";
      persistRef.current = { pos: positions, card };

      const view = buildView(defs, rels, card, positions, highlightRef.current);
      setNodes(view.nodes);
      setEdges(view.edges);

      if (fittedRef.current !== dbKey) {
        fittedRef.current = dbKey;
        requestAnimationFrame(() => {
          fitView({ padding: 0.18, duration: 300 });
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tables, activeDatabase, buildView, setNodes, setEdges, fitView]);

  // recarrega quando o banco ativo (ou a lista de tabelas) muda
  useEffect(() => {
    const key = activeDatabase ?? "";
    if (!key || tables.length === 0) {
      setNodes([]);
      setEdges([]);
      setLoading(false);
      defsRef.current = [];
      relsRef.current = [];
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDatabase, tables.length, refresh]);

  const isValidConnection = useCallback(
    (conn: Connection | Edge) => {
      const c = conn as Connection;
      if (!c.source || !c.target || c.source === c.target) return false;
      if (!c.sourceHandle || !c.targetHandle) return false;
      return !edges.some(
        (e) =>
          e.source === c.source &&
          e.sourceHandle === c.sourceHandle &&
          e.target === c.target &&
          e.targetHandle === c.targetHandle
      );
    },
    [edges]
  );

  const onConnect = useCallback((conn: Connection) => {
    if (!isValidConnection(conn)) return;
    setModalError(null);
    setPendingCardinality("1:N");
    setPendingConnection(conn);
  }, [isValidConnection]);

  const closeModals = useCallback(() => {
    setPendingConnection(null);
    setDeleteTarget(null);
    setModalError(null);
  }, []);

  const confirmCreate = useCallback(async () => {
    if (!pendingConnection) return;
    const conn = pendingConnection;
    const fromTable = conn.source as string;
    const fromCol = labelFor(conn.sourceHandle ?? "");
    const toTable = conn.target as string;
    const toCol = labelFor(conn.targetHandle ?? "");
    setActing(true);
    setModalError(null);
    try {
      await addForeignKey(fromTable, fromCol, toTable, toCol);
      const key = relKey(fromTable, fromCol, toTable, toCol);
      persistRef.current.card[key] = pendingCardinality;
      savePersist(dbKeyRef.current, persistRef.current);
      closeModals();
      await refresh();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  }, [pendingConnection, pendingCardinality, refresh, closeModals]);

  const doDelete = useCallback(async () => {
    const del = deleteTarget;
    if (!del) return;
    setActing(true);
    setModalError(null);
    try {
      await dropForeignKey(del.fromTable, del.fromCol, del.toTable, del.toCol);
      delete persistRef.current.card[del.key];
      savePersist(dbKeyRef.current, persistRef.current);
      closeModals();
      await refresh();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  }, [deleteTarget, refresh, closeModals]);

  const autoLayout = useCallback(() => {
    const defs = defsRef.current;
    if (defs.length === 0) return;
    const positions = dagreLayout(defs, relsRef.current);
    persistRef.current.pos = positions;
    savePersist(dbKeyRef.current, persistRef.current);
    setNodes((nds) =>
      nds.map((n) =>
        positions[n.id] ? { ...n, position: positions[n.id] } : n
      )
    );
    fitView({ padding: 0.18, duration: 300 });
  }, [setNodes, fitView]);

  const onNodeDragStop = useCallback(
    (_: unknown, node: ErNode) => {
      persistRef.current.pos[node.id] = node.position;
      savePersist(dbKeyRef.current, persistRef.current);
    },
    []
  );

  if (loading && nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 text-sm text-slate-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
        Carregando diagrama…
      </div>
    );
  }

  if (error && nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 px-6 text-center text-sm text-slate-400">
        <span>Não foi possível carregar o diagrama.</span>
        <span className="text-xs text-red-300">{error}</span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-lg border border-sky-400/30 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-400/10"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950/60">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onConnectStart={armGuard}
        onNodeDragStart={armGuard}
        onNodeDragStop={onNodeDragStop}
        connectionMode={ConnectionMode.Loose}
        colorMode="dark"
        zoomOnScroll
        panOnScroll={false}
        panOnDrag
        minZoom={0.15}
        maxZoom={2.5}
        defaultEdgeOptions={{ type: "er" }}
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="rgba(56,189,248,0.16)" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>

      {/* Ferramentas */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <div className="pointer-events-auto flex flex-col gap-1.5">
          <button
            type="button"
            onClick={autoLayout}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-slate-200 shadow-lg backdrop-blur transition-colors hover:border-sky-400/40 hover:text-sky-300"
          >
            <span>⤢</span> Reorganizar automaticamente
          </button>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => void zoomIn({ duration: 200 })}
              className="rounded-lg border border-white/10 bg-slate-900/90 px-2.5 py-1.5 text-xs text-slate-300 hover:border-sky-400/40 hover:text-sky-300"
              title="Aumentar zoom"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => void zoomOut({ duration: 200 })}
              className="rounded-lg border border-white/10 bg-slate-900/90 px-2.5 py-1.5 text-xs text-slate-300 hover:border-sky-400/40 hover:text-sky-300"
              title="Diminuir zoom"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => void fitView({ padding: 0.18, duration: 300 })}
              className="rounded-lg border border-white/10 bg-slate-900/90 px-2.5 py-1.5 text-xs text-slate-300 hover:border-sky-400/40 hover:text-sky-300"
              title="Ajustar à tela"
            >
              ⌖
            </button>
          </div>
        </div>
        <span className="pointer-events-auto rounded-full border border-white/10 bg-slate-900/80 px-2.5 py-1 text-[10px] text-slate-400 backdrop-blur">
          {nodes.length} tabela{nodes.length === 1 ? "" : "s"} · {edges.length} relacionamento{edges.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center">
        <p className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1 text-[10px] text-slate-500 backdrop-blur">
          fonte: schema real do banco · arraste uma coluna até outra para criar
          um relacionamento (FK)
        </p>
      </div>

      {/* Modal: criar relacionamento */}
      {pendingConnection && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={closeModals}
        >
          <div
            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-sm font-semibold text-white">
              Criar relacionamento (FOREIGN KEY)
            </h3>
            <p className="mb-4 rounded-lg border border-sky-400/20 bg-sky-400/5 px-3 py-2 font-mono text-xs text-sky-200">
              {pendingConnection.source}.
              <span className="text-cyan-300">{labelFor(pendingConnection.sourceHandle ?? "")}</span>
              {" "}→{" "}
              {pendingConnection.target}.
              <span className="text-cyan-300">{labelFor(pendingConnection.targetHandle ?? "")}</span>
            </p>
            <p className="mb-2 text-xs text-slate-400">Cardinalidade:</p>
            <div className="mb-4 space-y-1.5">
              {CARDINALITIES.map((c) => (
                <label
                  key={c.value}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition-colors ${
                    pendingCardinality === c.value
                      ? "border-cyan-400/50 bg-cyan-400/10"
                      : "border-white/10 hover:border-white/20"
                  }`}
                >
                  <input
                    type="radio"
                    name="cardinality"
                    className="mt-0.5 accent-cyan-400"
                    checked={pendingCardinality === c.value}
                    onChange={() => setPendingCardinality(c.value)}
                  />
                  <span>
                    <span className="block font-mono text-xs font-semibold text-sky-200">{c.label}</span>
                    <span className="block text-[11px] text-slate-400">{c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mb-3 text-[11px] text-slate-500">
              A constraint será gravada no schema real do banco (
              <code className="font-mono text-slate-400">ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY</code>
              ).
            </p>
            {modalError && (
              <p className="mb-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">
                {modalError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModals}
                disabled={acting}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmCreate()}
                disabled={acting}
                className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-400 disabled:opacity-60"
              >
                {acting ? "Criando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: excluir relacionamento */}
      {deleteTarget && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={closeModals}
        >
          <div
            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-sm font-semibold text-white">Excluir relacionamento</h3>
            <p className="mb-3 rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 font-mono text-xs text-red-200">
              {deleteTarget.fromTable}.<span className="text-red-300">{deleteTarget.fromCol}</span>
              {" "}→{" "}
              {deleteTarget.toTable}.<span className="text-red-300">{deleteTarget.toCol}</span>
            </p>
            <p className="mb-3 text-[11px] text-slate-500">
              Isso executa o{" "}
              <code className="font-mono text-slate-400">DROP CONSTRAINT</code>{" "}
              correspondente no schema real do banco.
            </p>
            {modalError && (
              <p className="mb-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">
                {modalError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModals}
                disabled={acting}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void doDelete()}
                disabled={acting}
                className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-400 disabled:opacity-60"
              >
                {acting ? "Excluindo…" : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ErDiagram({ height = 620 }: { height?: number }) {
  return (
    <div className="w-full" style={{ height }}>
      <ReactFlowProvider>
        <ErDiagramRoot />
      </ReactFlowProvider>
    </div>
  );
}