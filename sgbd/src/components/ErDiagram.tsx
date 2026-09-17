"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
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
import { AnimatePresence, motion } from "framer-motion";
import { useDb } from "@/hooks/useDb";
import { useToast } from "@/hooks/useToast";
import { ToastContainer } from "@/components/Toast";
import {
  addForeignKey,
  addPrimaryKey,
  dropForeignKey,
  dropPrimaryKey,
  getForeignKeys,
  getTableSchema,
} from "@/lib/sqlite/db";
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
  /** Destaque de alvo durante uma conexão em arrasto: válido (verde) ou inválido (vermelho). */
  connTarget: "valid" | "invalid" | null;
  onColumnClick: (table: string, col: string) => void;
  onSetPk: (table: string, col: string) => void;
  onRemovePk: (table: string, col: string) => void;
  onStartFk: (table: string, col: string) => void;
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
  const { table, columns, fkTargets, highlightedCol, connTarget } = data;
  const handleCls = makeHandleClass();
  const [menu, setMenu] = useState<{ col: string; x: number; y: number } | null>(null);

  // Fecha o menu de contexto ao clicar fora / redimensionar
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const openMenu = (col: string, e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(r.right + 6, window.innerWidth - 240);
    const y = Math.min(r.top, window.innerHeight - 130);
    setMenu({ col, x, y });
  };

  // Glow durante o arrasto de conexão: verde = destino válido, vermelho = inválido
  const glow =
    connTarget === "valid"
      ? "border-emerald-400 shadow-[0_0_28px_rgba(52,211,153,0.5)]"
      : connTarget === "invalid"
        ? "border-red-400/80 shadow-[0_0_28px_rgba(248,113,113,0.4)]"
        : "";

  return (
    <div
      className={`w-full overflow-hidden rounded-lg border bg-slate-900/95 transition-[border-color,box-shadow] duration-150 ${
        glow ||
        (selected
          ? "border-cyan-300 shadow-glow"
          : "border-sky-400/25 shadow-[0_0_20px_rgba(56,189,248,0.08)] hover:border-sky-400/40")
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
                <button
                  type="button"
                  aria-label={`Opções da coluna ${c.name}`}
                  title="Opções: PK / FK"
                  onClick={(e) => openMenu(c.name, e)}
                  className="ml-0.5 rounded px-1 text-[10px] text-slate-500 opacity-0 transition-opacity hover:bg-white/10 hover:text-sky-300 focus:opacity-100 group-hover:opacity-100"
                >
                  ⋯
                </button>
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

      {/* Menu de contexto da coluna: PK on/off + atalho para criar FK */}
      {menu && (
        <div
          className="fixed z-[100] w-56 overflow-hidden rounded-lg border border-white/10 bg-slate-900 shadow-2xl ring-1 ring-black/40"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[10px] text-slate-400">
            {table}.{menu.col}
          </div>
          {(() => {
            const isPk = (columns.find((c) => c.name === menu.col)?.pk ?? 0) > 0;
            return (
              <>
                {isPk ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      data.onRemovePk(table, menu.col);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-amber-300 hover:bg-amber-400/10"
                  >
                    <span>🔓</span> Remover chave primária
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      data.onSetPk(table, menu.col);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-slate-200 hover:bg-white/10"
                  >
                    <span>🔑</span> Definir como chave primária
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMenu(null);
                    data.onStartFk(table, menu.col);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-sky-300 hover:bg-sky-400/10"
                >
                  <span>🔗</span> Criar FK a partir daqui
                  <span className="ml-auto text-[9px] text-slate-500">clique no destino</span>
                </button>
              </>
            );
          })()}
        </div>
      )}
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
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <BaseEdge
          path={path}
          style={{
            ...style,
            stroke,
            strokeWidth: width,
            filter: hot ? "drop-shadow(0 0 6px rgba(34,211,238,0.7))" : undefined,
          }}
        />
      </motion.g>
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
  const { toasts, showToast, dismissToast } = useToast();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsFallback, setFsFallback] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  /** Tabela alvo durante uma conexão em arrasto, com validade p/ glow verde/vermelho. */
  const [connTarget, setConnTarget] = useState<{ table: string; valid: boolean } | null>(null);
  /** Modo "criar FK a partir daqui": origem pré-selecionada aguardando clique no destino. */
  const [fkPick, setFkPick] = useState<{ table: string; col: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  /** Histórico de layout (undo/redo) — apenas posições visuais dos cards. */
  const layoutHistory = useRef<{ stack: Record<string, { x: number; y: number }>[]; index: number }>({
    stack: [],
    index: -1,
  });

  const defsRef = useRef<TableDef[]>([]);
  const relsRef = useRef<RelDef[]>([]);
  const persistRef = useRef<PersistedView>({ pos: {}, card: {} });
  const dbKeyRef = useRef("");
  const fittedRef = useRef("");
  const highlightRef = useRef<{ table: string; col: string } | null>(null);
  const guardRef = useRef(false);
  /** Ref para chamar `refresh` (declarado adiante) sem ciclos de dependência. */
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  /** Origem armada pelo menu "Criar FK a partir daqui" (ref p/ não recriar callbacks). */
  const fkPickRef = useRef<{ table: string; col: string } | null>(null);

  /** Abre o modal de criação de FK a partir de uma conexão (drag ou clique). */
  const openFkModal = useCallback((conn: Connection) => {
    setModalError(null);
    setPendingCardinality("1:N");
    setPendingConnection(conn);
  }, []);

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
      // Modo "criar FK a partir daqui": o próximo clique vira o destino da FK
      const pick = fkPickRef.current;
      if (pick && (pick.table !== table || pick.col !== col)) {
        fkPickRef.current = null;
        highlightRef.current = null;
        applyHighlight();
        openFkModal({
          source: pick.table,
          sourceHandle: `h:${pick.col}:r`,
          target: table,
          targetHandle: `h:${col}:l`,
        });
        return;
      }
      if (pick) {
        // clique na própria origem cancela o modo
        fkPickRef.current = null;
        showToast("Criação de FK cancelada.", "info", 1800);
      }
      const cur = highlightRef.current;
      highlightRef.current =
        cur && cur.table === table && cur.col === col ? null : { table, col };
      applyHighlight();
    },
    [applyHighlight, showToast, openFkModal]
  );

  // ---------- Fullscreen nativo com fallback CSS ----------
  const enterFullscreen = useCallback(async () => {
    const el = canvasRef.current;
    if (!el) return;
    type FsDoc = Document & {
      webkitFullscreenElement?: Element;
      mozFullScreenElement?: Element;
      msFullscreenElement?: Element;
    };
    const doc = document as FsDoc;
    const active =
      doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.mozFullScreenElement ?? doc.msFullscreenElement;
    if (active) return;
    const elFs = el as HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      mozRequestFullScreen?: () => Promise<void>;
      msRequestFullscreen?: () => Promise<void>;
    };
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (elFs.webkitRequestFullscreen) await elFs.webkitRequestFullscreen();
      else if (elFs.mozRequestFullScreen) await elFs.mozRequestFullScreen();
      else if (elFs.msRequestFullscreen) await elFs.msRequestFullscreen();
      else {
        setFsFallback(true); // API indisponível: modo simulado via CSS
        return;
      }
      setFsFallback(false);
    } catch {
      setFsFallback(true); // navegador negou (ex: sem gesto do usuário)
    }
    // Recalcula o canvas depois da transição do navegador
    window.setTimeout(() => void fitView({ padding: 0.18, duration: 300 }), 350);
  }, [fitView]);

  const exitFullscreen = useCallback(async () => {
    type FsDoc = Document & {
      webkitExitFullscreen?: () => Promise<void>;
      mozCancelFullScreen?: () => Promise<void>;
      msExitFullscreen?: () => Promise<void>;
    };
    if (fsFallback) {
      setFsFallback(false);
      window.setTimeout(() => void fitView({ padding: 0.18, duration: 300 }), 100);
      return;
    }
    const doc = document as FsDoc;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
      else if (doc.mozCancelFullScreen) await doc.mozCancelFullScreen();
      else if (doc.msExitFullscreen) await doc.msExitFullscreen();
    } catch {
      // ignore
    }
    window.setTimeout(() => void fitView({ padding: 0.18, duration: 300 }), 150);
  }, [fsFallback, fitView]);

  const toggleFullscreen = useCallback(() => {
    type FsDoc = Document & { webkitFullscreenElement?: Element; mozFullScreenElement?: Element };
    const doc = document as FsDoc;
    const active =
      doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.mozFullScreenElement ?? fsFallback;
    if (active) void exitFullscreen();
    else void enterFullscreen();
  }, [enterFullscreen, exitFullscreen, fsFallback]);

  // Sincroniza estado com eventos nativos (Esc sai do fullscreen nativo)
  useEffect(() => {
    const onChange = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);
      window.setTimeout(() => void fitView({ padding: 0.18, duration: 300 }), 120);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, [fitView]);

  // ---------- PK: definir / remover com rollback otimista + toast ----------
  const applyPkChange = useCallback(
    async (table: string, col: string, mode: "set" | "remove") => {
      const tableDef = defsRef.current.find((d) => d.name === table);
      const otherPks = tableDef?.columns.filter((c) => c.pk > 0 && c.name !== col) ?? [];
      if (mode === "set" && otherPks.length > 0) {
        const ok = window.confirm(
          `A tabela "${table}" já tem PK (${otherPks.map((c) => c.name).join(", ")}). Continuar vai criar uma PK composta com "${col}".`
        );
        if (!ok) return;
      }
      const restore = () => {
        if (!tableDef) return;
        setNodes((nds) =>
          nds.map((n) =>
            n.data.table === table
              ? { ...n, data: { ...n.data, columns: tableDef.columns.map((c) => ({ ...c })) } }
              : n
          )
        );
      };
      setActing(true);
      try {
        if (mode === "set") {
          // Otimista: marca PK na UI antes de gravar no banco
          setNodes((nds) =>
            nds.map((n) =>
              n.data.table === table
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      columns: n.data.columns.map((c) =>
                        c.name === col ? { ...c, pk: 1 } : { ...c, pk: 0 }
                      ),
                    },
                  }
                : n
            )
          );
          await addPrimaryKey(table, col);
          showToast(`PK definida em ${table}.${col} (ADD CONSTRAINT … PRIMARY KEY)`, "success");
        } else {
          setNodes((nds) =>
            nds.map((n) =>
              n.data.table === table
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      columns: n.data.columns.map((c) =>
                        c.name === col ? { ...c, pk: 0 } : c
                      ),
                    },
                  }
                : n
            )
          );
          await dropPrimaryKey(table, col);
          showToast(`PK removida de ${table}.${col} (DROP CONSTRAINT)`, "success");
        }
      } catch (e) {
        restore(); // rollback visual: diagrama volta a espelhar o schema real
        showToast(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setActing(false);
        void refreshRef.current();
      }
    },
    [showToast, setNodes]
  );

  const onSetPk = useCallback(
    (table: string, col: string) => void applyPkChange(table, col, "set"),
    [applyPkChange]
  );

  const onRemovePk = useCallback(
    (table: string, col: string) => void applyPkChange(table, col, "remove"),
    [applyPkChange]
  );

  // "Criar FK a partir daqui": arma a origem; o próximo clique numa coluna de
  // outra tabela abre o mesmo modal do drag-and-connect.
  const onStartFk = useCallback(
    (table: string, col: string) => {
      fkPickRef.current = { table, col };
      setFkPick({ table, col });
      highlightRef.current = { table, col };
      applyHighlight();
      showToast(`Origem armada: ${table}.${col} — agora clique na coluna de destino (Esc cancela).`, "info");
    },
    [applyHighlight, showToast]
  );

  const cancelFkPick = useCallback(() => {
    if (!fkPickRef.current) return;
    fkPickRef.current = null;
    setFkPick(null);
    highlightRef.current = null;
    applyHighlight();
    showToast("Criação de FK cancelada.", "info", 1800);
  }, [applyHighlight, showToast]);

  // ---------- Undo / redo do layout (só posições visuais) ----------
  const pushLayout = useCallback((pos: Record<string, { x: number; y: number }>) => {
    const h = layoutHistory.current;
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push({ ...pos });
    if (h.stack.length > 50) h.stack.shift();
    h.index = h.stack.length - 1;
  }, []);

  const applyLayout = useCallback(
    (pos: Record<string, { x: number; y: number }>) => {
      persistRef.current.pos = { ...pos };
      savePersist(dbKeyRef.current, persistRef.current);
      setNodes((nds) =>
        nds.map((n) => (pos[n.id] ? { ...n, position: { ...pos[n.id] } } : n))
      );
    },
    [setNodes]
  );

  const undoLayout = useCallback(() => {
    const h = layoutHistory.current;
    if (h.index > 0) {
      h.index -= 1;
      applyLayout(h.stack[h.index]);
      showToast("Layout desfeito (Ctrl+Z)", "info", 1500);
    }
  }, [applyLayout, showToast]);

  const redoLayout = useCallback(() => {
    const h = layoutHistory.current;
    if (h.index < h.stack.length - 1) {
      h.index += 1;
      applyLayout(h.stack[h.index]);
      showToast("Layout refeito (Ctrl+Shift+Z)", "info", 1500);
    }
  }, [applyLayout, showToast]);

  // ---------- Atalhos de teclado ----------
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      const mod = ev.ctrlKey || ev.metaKey;

      if (ev.key === "Escape") {
        if (fkPickRef.current) cancelFkPick();
        return;
      }
      if (mod && ev.key.toLowerCase() === "f") {
        // Ctrl+F: foca no filtro de tabelas da sidebar
        ev.preventDefault();
        const input = document.querySelector<HTMLInputElement>('[data-filter-input="true"]');
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }
      if (mod && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        if (ev.shiftKey) redoLayout();
        else undoLayout();
        return;
      }
      if (inField) return;
      if (ev.key === "Delete" || ev.key === "Backspace") {
        const selEdge = edges.find((e) => e.selected);
        if (selEdge?.data) {
          ev.preventDefault();
          setDeleteTarget({
            key: selEdge.data.key,
            fromTable: selEdge.data.fromTable,
            fromCol: selEdge.data.fromCol,
            toTable: selEdge.data.toTable,
            toCol: selEdge.data.toCol,
          });
          return;
        }
        const selNode = nodes.find((n) => n.selected);
        if (selNode) {
          ev.preventDefault();
          // Remove o card do canvas (apenas visual — o banco não é alterado)
          setNodes((nds) => nds.filter((n) => n.id !== selNode.id));
          setEdges((eds) =>
            eds.filter((e) => e.source !== selNode.id && e.target !== selNode.id)
          );
          showToast(
            `"${selNode.id}" removido apenas do canvas — use "Reorganizar" ou recarregue para trazê-lo de volta.`,
            "info"
          );
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edges, nodes, undoLayout, redoLayout, cancelFkPick, setNodes, setEdges, showToast]);

  // ---------- Aplica glow de alvo (conexão em arrasto) nos nós ----------
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        const next =
          connTarget && connTarget.table === n.data.table
            ? connTarget.valid
              ? ("valid" as const)
              : ("invalid" as const)
            : null;
        if (n.data.connTarget === next) return n;
        return { ...n, data: { ...n.data, connTarget: next } };
      })
    );
  }, [connTarget, setNodes]);

  // ---------- Tooltip de onboarding (mostrado uma única vez) ----------
  useEffect(() => {
    try {
      if (!window.localStorage.getItem("sgbd:er:onboarding:v1")) setShowHelp(true);
    } catch {
      setShowHelp(true);
    }
  }, []);

  const dismissHelp = useCallback(() => {
    setShowHelp(false);
    try {
      window.localStorage.setItem("sgbd:er:onboarding:v1", "1");
    } catch {
      // sem storage disponível
    }
  }, []);

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
            connTarget: null,
            onColumnClick: toggleColumn,
            onSetPk,
            onRemovePk,
            onStartFk,
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
    [toggleColumn, onSetPk, onRemovePk, onStartFk]
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
      pushLayout(positions); // semeia o histórico de undo/redo

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
  }, [tables, activeDatabase, buildView, setNodes, setEdges, fitView, pushLayout]);
  refreshRef.current = refresh;

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

  // Glow verde/vermelho na tabela alvo enquanto a conexão é arrastada
  const onConnectStart = useCallback(() => {
    armGuard();
    setConnTarget(null);
  }, [armGuard]);

  const onConnectEnd = useCallback(() => {
    setConnTarget(null);
  }, []);

  const isValidConnection = useCallback(
    (conn: Connection | Edge) => {
      const c = conn as Connection;
      if (!c.source || !c.target || c.source === c.target) return false;
      if (!c.sourceHandle || !c.targetHandle) return false;
      const valid = !edges.some(
        (e) =>
          e.source === c.source &&
          e.sourceHandle === c.sourceHandle &&
          e.target === c.target &&
          e.targetHandle === c.targetHandle
      );
      // Durante o arrasto, realça a tabela alvo: verde (válido) / vermelho (inválido)
      setConnTarget((cur) =>
        cur && cur.table === c.target && cur.valid === valid
          ? cur
          : { table: c.target, valid }
      );
      return valid;
    },
    [edges]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      setConnTarget(null);
      if (!isValidConnection(conn)) {
        showToast(
          "Relacionamento inválido: mesma tabela ou já existente no schema real.",
          "warning"
        );
        return;
      }
      openFkModal(conn);
    },
    [isValidConnection, openFkModal, showToast]
  );

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
      showToast(
        `FK criada: ${fromTable}.${fromCol} → ${toTable}.${toCol} (${pendingCardinality})`,
        "success"
      );
      await refresh();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  }, [pendingConnection, pendingCardinality, refresh, closeModals, showToast]);

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
      showToast(
        `Relacionamento removido: ${del.fromTable}.${del.fromCol} → ${del.toTable}.${del.toCol}`,
        "success"
      );
      await refresh();
    } catch (e) {
      // Falha no banco: a edge permanece (rollback automático da UI)
      setModalError(e instanceof Error ? e.message : String(e));
      showToast("Não foi possível remover a constraint no banco.", "error");
    } finally {
      setActing(false);
    }
  }, [deleteTarget, refresh, closeModals, showToast]);

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
    pushLayout(positions);
    fitView({ padding: 0.18, duration: 300 });
  }, [setNodes, fitView, pushLayout]);

  const onNodeDragStop = useCallback(
    (_: unknown, node: ErNode) => {
      persistRef.current.pos[node.id] = node.position;
      savePersist(dbKeyRef.current, persistRef.current);
      // Registra o layout no histórico de undo/redo
      pushLayout(persistRef.current.pos);
    },
    [pushLayout]
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
    <div
      ref={canvasRef}
      className={`relative h-full w-full overflow-hidden bg-slate-950/60 ${
        fsFallback
          ? "fixed inset-0 z-[9999] rounded-none border-0"
          : "rounded-xl border border-white/10"
      } ${isFullscreen ? "bg-slate-950" : ""}`}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
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
            <button
              type="button"
              onClick={toggleFullscreen}
              className="rounded-lg border border-white/10 bg-slate-900/90 px-2.5 py-1.5 text-xs text-slate-300 hover:border-sky-400/40 hover:text-sky-300"
              title={isFullscreen || fsFallback ? "Sair da tela cheia (Esc)" : "Tela cheia"}
            >
              {isFullscreen || fsFallback ? "⤡" : "⛶"}
            </button>
          </div>
        </div>
        <span className="pointer-events-auto rounded-full border border-white/10 bg-slate-900/80 px-2.5 py-1 text-[10px] text-slate-400 backdrop-blur">
          {nodes.length} tabela{nodes.length === 1 ? "" : "s"} · {edges.length} relacionamento{edges.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-10 flex flex-col items-center gap-2">
        {fkPick ? (
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-1.5 text-[11px] text-cyan-200 shadow-[0_0_16px_rgba(34,211,238,0.25)] backdrop-blur">
            <motion.span
              className="h-2 w-2 rounded-full bg-cyan-300"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
            />
            Origem: <span className="font-mono font-semibold">{fkPick.table}.{fkPick.col}</span>
            — clique na coluna de destino
            <button
              type="button"
              onClick={cancelFkPick}
              className="rounded px-1.5 text-[10px] text-cyan-300/80 hover:bg-white/10 hover:text-cyan-100"
              title="Cancelar (Esc)"
            >
              ✕ cancelar
            </button>
          </div>
        ) : (
          <p className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1 text-[10px] text-slate-500 backdrop-blur">
            fonte: schema real do banco · arraste uma coluna até outra para criar
            um relacionamento (FK)
          </p>
        )}
        <AnimatePresence>
          {showHelp && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-auto max-w-md rounded-xl border border-sky-400/30 bg-slate-900/95 p-3 shadow-2xl backdrop-blur"
            >
              <p className="text-xs font-semibold text-sky-200">Bem-vindo ao Editor de Diagrama ER ✨</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                <strong className="text-slate-200">Arraste uma coluna até outra</strong> para criar um
                relacionamento (FK). Use o menu <span className="font-mono text-slate-300">⋯</span> na
                coluna para alternar PK ou iniciar uma FK com cliques. Clique numa linha para removê-la,
                <span className="font-mono text-slate-300"> Ctrl+Z</span> desfaz o layout e
                <span className="font-mono text-slate-300"> Ctrl+F</span> foca no filtro de tabelas.
              </p>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={dismissHelp}
                  className="rounded-lg border border-sky-400/40 bg-sky-400/10 px-2.5 py-1 text-[11px] text-sky-200 transition-colors hover:bg-sky-400/20"
                >
                  Entendi
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Botão de saída do fullscreen simulado (fallback CSS) */}
      {fsFallback && (
        <button
          type="button"
          onClick={() => void exitFullscreen()}
          className="absolute right-3 top-3 z-[10000] flex items-center gap-2 rounded-lg border border-white/20 bg-slate-900/95 px-3 py-1.5 text-xs text-slate-200 shadow-xl transition-colors hover:border-red-400/50 hover:text-red-300"
          title="Sair da tela cheia (Esc)"
        >
          ✕ Sair da tela cheia
        </button>
      )}

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

      {/* Toasts de feedback (sucesso / erro / aviso) */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
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