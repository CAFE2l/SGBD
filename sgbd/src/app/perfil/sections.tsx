"use client";

import Link from "next/link";
import { EngineBadge, consoleUrl, tablesUrl } from "@/components/EngineBadge";
import type { EngineId } from "@/lib/profile/engines";
import {
  fmtDate,
  fmtTime,
  type DbCard,
  type FileRef,
  type FavoriteEntry,
  type GlobalQueryEntry,
  type IoHistoryEntry,
} from "./types";

export function Stat(p: { label: string; value: number; title?: string }) {
  return (
    <div
      className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-center"
      title={p.title}
    >
      <p className="text-xl font-bold text-white">{p.value}</p>
      <p className="text-[10px] uppercase tracking-widest text-slate-500">
        {p.label}
      </p>
    </div>
  );
}

export interface DbCardsProps {
  cards: DbCard[];
  loading: boolean;
  activeDatabase: string | null;
  renaming: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  setRenaming: (v: string | null) => void;
  confirmDelete: string | null;
  setConfirmDelete: (v: string | null) => void;
  expandedDb: string | null;
  setExpandedDb: (v: string | null) => void;
  onOpenPicker: () => void;
  onRename: (n: string) => void;
  onDuplicate: (n: string) => void;
  onExport: (n: string) => void;
  onDelete: (n: string) => void;
}

export function DbCards(p: DbCardsProps) {
  if (p.loading) {
    return (
      <section>
        <HeadRow count={p.cards.length} onNew={p.onOpenPicker} />
        <p className="text-sm text-slate-500">Carregando bancos…</p>
      </section>
    );
  }
  if (p.cards.length === 0) {
    return (
      <section>
        <HeadRow count={0} onNew={p.onOpenPicker} />
        <EmptyBox />
      </section>
    );
  }
  return (
    <section>
      <HeadRow count={p.cards.length} onNew={p.onOpenPicker} />
      <div className="grid gap-3 md:grid-cols-2">
        {p.cards.map((c) => (
          <DbCardView key={c.name} c={c} p={p} />
        ))}
      </div>
    </section>
  );
}

function HeadRow({ count, onNew }: { count: number; onNew: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-lg font-bold text-white">
        Meus Bancos de Dados ({count})
      </h2>
      <button
        onClick={onNew}
        className="rounded-xl bg-sky-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-300"
      >
        + Criar novo banco
      </button>
    </div>
  );
}

function EmptyBox() {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-8 text-center text-sm text-slate-500">
      Nenhum banco ainda. Crie o primeiro escolhendo um motor.
    </div>
  );
}

function DbCardView({ c, p }: { c: DbCard; p: DbCardsProps }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-sm font-bold text-white">
            {c.name}
          </span>
          <EngineBadge engine={c.engine} />
          {p.activeDatabase === c.name && (
            <span className="rounded-full border border-sky-400/40 bg-sky-400/10 px-2 py-0.5 text-[10px] font-bold text-sky-300">
              ATIVO
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          {c.tableCount} tabela(s) · {c.rowCount} linha(s) · criado em{" "}
          {fmtDate(c.createdAt)} · atualizado em {fmtDate(c.updatedAt)}
        </p>
      </div>
      {p.renaming === c.name ? (
        <RenameRow c={c} p={p} />
      ) : (
        <ActionsRow c={c} p={p} />
      )}
      {p.expandedDb === c.name && <TablesRow c={c} />}
    </article>
  );
}

function RenameRow({ c, p }: { c: DbCard; p: DbCardsProps }) {
  return (
    <div className="flex gap-2 border-t border-white/10 bg-black/20 px-4 py-3">
      <input
        value={p.renameValue}
        onChange={(e) => p.setRenameValue(e.target.value)}
        placeholder="Novo nome"
        className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 font-mono text-xs text-white outline-none focus:border-sky-400/60"
      />
      <button
        onClick={() => p.onRename(c.name)}
        className="rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950"
      >
        Salvar
      </button>
      <button
        onClick={() => p.setRenaming(null)}
        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400"
      >
        Cancelar
      </button>
    </div>
  );
}

function ActionsRow({ c, p }: { c: DbCard; p: DbCardsProps }) {
  return (
    <div className="flex flex-wrap gap-1.5 border-t border-white/10 bg-black/20 px-4 py-3">
      <Link
        href={consoleUrl(c.name)}
        className="rounded-lg bg-sky-400/15 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-400/25"
      >
        Abrir no Console
      </Link>
      <button
        onClick={() => {
          p.setRenaming(c.name);
          p.setRenameValue(c.name);
        }}
        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
      >
        Renomear
      </button>
      <button
        onClick={() => p.onDuplicate(c.name)}
        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
      >
        Duplicar
      </button>
      <button
        onClick={() => p.onExport(c.name)}
        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
      >
        Exportar
      </button>
      {p.confirmDelete === c.name ? (
        <span className="flex items-center gap-1">
          <button
            onClick={() => p.onDelete(c.name)}
            className="rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300"
          >
            Confirmar?
          </button>
          <button
            onClick={() => p.setConfirmDelete(null)}
            className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-slate-400"
          >
            Não
          </button>
        </span>
      ) : (
        <button
          onClick={() => p.setConfirmDelete(c.name)}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:border-rose-400/40 hover:text-rose-300"
        >
          Excluir
        </button>
      )}
      <button
        onClick={() => p.setExpandedDb(p.expandedDb === c.name ? null : c.name)}
        className="ml-auto rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-500 hover:text-white"
      >
        {p.expandedDb === c.name ? "Ocultar" : `Tabelas (${c.tables.length})`}
      </button>
    </div>
  );
}

function TablesRow({ c }: { c: DbCard }) {
  return (
    <div className="space-y-1 border-t border-white/10 bg-black/20 px-4 py-3">
      {c.tables.length === 0 ? (
        <p className="text-[11px] text-slate-500">Sem tabelas ainda.</p>
      ) : (
        c.tables.map((t) => (
          <Link
            key={t.name}
            href={tablesUrl(c.name, t.name)}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-slate-300 hover:border-sky-400/40 hover:text-sky-300"
          >
            <span className="truncate">{t.name}</span>
            <span className="ml-2 text-slate-500">
              {t.rows} linha(s) → ver dados
            </span>
          </Link>
        ))
      )}
    </div>
  );
}

export interface QueryHistoryProps {
  databases: string[];
  favs: FavoriteEntry[];
  qText: string;
  setQText: (v: string) => void;
  qDb: string;
  setQDb: (v: string) => void;
  qStatus: "all" | "ok" | "err";
  setQStatus: (v: "all" | "ok" | "err") => void;
  showFavOnly: boolean;
  setShowFavOnly: (v: boolean | ((p: boolean) => boolean)) => void;
  visibleLog: GlobalQueryEntry[];
  favKeys: Set<string>;
  norm: (s: string) => string;
  onToggleFav: (db: string, q: string, c: string) => void;
}

export function QueryHistory(p: QueryHistoryProps) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">
          Histórico de Queries ({p.favs.length} ★)
        </h2>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-bold text-slate-500">
          {p.visibleLog.length} resultado(s)
        </span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={p.qText}
          onChange={(e) => p.setQText(e.target.value)}
          placeholder="Buscar query…"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 font-mono text-xs text-white outline-none focus:border-sky-400/60"
        />
        <select
          value={p.qDb}
          onChange={(e) => p.setQDb(e.target.value)}
          className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-sky-400/60"
        >
          <option value="all">Todos os bancos</option>
          {p.databases.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button
          onClick={() => p.setQStatus(p.qStatus === "ok" ? "all" : "ok")}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
            p.qStatus === "ok"
              ? "bg-emerald-400/15 text-emerald-300"
              : "border border-white/10 text-slate-400 hover:bg-white/5"
          }`}
        >
          OK
        </button>
        <button
          onClick={() => p.setQStatus(p.qStatus === "err" ? "all" : "err")}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
            p.qStatus === "err"
              ? "bg-rose-400/15 text-rose-300"
              : "border border-white/10 text-slate-400 hover:bg-white/5"
          }`}
        >
          Erro
        </button>
        <button
          onClick={() => p.setShowFavOnly((v) => !v)}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
            p.showFavOnly
              ? "bg-amber-400/15 text-amber-300"
              : "border border-white/10 text-slate-400 hover:bg-white/5"
          }`}
        >
          ★ Favoritas
        </button>
      </div>
      <div className="space-y-1.5">
        {p.visibleLog.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-6 text-center text-sm text-slate-500">
            Nenhuma query encontrada.
          </div>
        ) : (
          p.visibleLog.map((e) => {
            const fav = p.favKeys.has(`${e.database}::${p.norm(e.query)}`);
            return (
              <div
                key={e.id}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => p.onToggleFav(e.database, e.query, e.command)}
                    className={`text-sm ${
                      fav ? "text-amber-300" : "text-slate-600 hover:text-amber-300"
                    }`}
                    title={fav ? "Remover favorita" : "Marcar como favorita"}
                  >
                    ★
                  </button>
                  <span className="truncate font-mono text-sm font-bold text-sky-300">
                    {e.database}
                  </span>
                  <EngineBadge engine={e.engine as EngineId} />
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      e.success
                        ? "bg-emerald-400/10 text-emerald-300"
                        : "bg-rose-400/10 text-rose-300"
                    }`}
                  >
                    {e.command || (e.success ? "ok" : "erro")}
                  </span>
                  {e.message && (
                    <span className="hidden truncate text-[11px] text-slate-500 sm:block">
                      {e.message}
                    </span>
                  )}
                  <span className="ml-auto whitespace-nowrap text-[11px] text-slate-500">
                    {fmtTime(e.timestamp)}
                    {e.durationMs != null && ` · ${e.durationMs}ms`}
                  </span>
                </div>
                <p className="mt-1 truncate pl-5 font-mono text-xs text-slate-300">
                  {e.query}
                </p>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export function TablesByDb({ cards }: { cards: DbCard[] }) {
  const all = cards.flatMap((c) =>
    c.tables.map((t) => ({ db: c.name, name: t.name, rows: t.rows }))
  );
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">
          Tabelas por Banco ({all.length})
        </h2>
      </div>
      {all.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-8 text-center text-sm text-slate-500">
          Crie tabelas nos bancos para vê-las listadas aqui.
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {all.map((t) => (
            <Link
              key={`${t.db}::${t.name}`}
              href={tablesUrl(t.db, t.name)}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 hover:border-sky-400/40"
            >
              <span className="truncate font-mono text-xs font-bold text-sky-300">
                {t.db}
              </span>
              <span className="text-slate-600">/</span>
              <span className="truncate font-mono text-xs text-slate-200">
                {t.name}
              </span>
              <span className="ml-auto whitespace-nowrap text-[11px] text-slate-500">
                {t.rows} linha(s)
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export interface IoSectionProps {
  cards: DbCard[];
  busyDb: string | null;
  jsonMsg: string | null;
  ioHist: IoHistoryEntry[];
  fileRef: FileRef;
  onJsonFile: (f: File) => void;
  onExportJson: (name: string) => void;
}

export function IoSection(p: IoSectionProps) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Importar / Exportar</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-sm font-semibold text-white">Importação JSON</h3>
          <p className="mt-1 text-xs text-slate-500">
            Selecione um arquivo .json com um array de documentos ou um objeto
            relacional.
          </p>
          <input
            ref={p.fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onJsonFile(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => p.fileRef.current?.click()}
            disabled={p.busyDb === "__import__"}
            className="mt-3 rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-50"
          >
            {p.busyDb === "__import__" ? "Importando…" : "Escolher arquivo JSON"}
          </button>
          {p.jsonMsg && (
            <p className="mt-2 text-xs text-emerald-300">{p.jsonMsg}</p>
          )}
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-sm font-semibold text-white">Exportação JSON</h3>
          <p className="mt-1 text-xs text-slate-500">
            Baixa todas as tabelas do banco no formato JSON.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {p.cards.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhum banco ainda.</p>
            ) : (
              p.cards.map((c) => (
                <button
                  key={c.name}
                  onClick={() => p.onExportJson(c.name)}
                  disabled={p.busyDb === c.name}
                  className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-300 hover:border-sky-400/40 hover:text-sky-300 disabled:opacity-50"
                >
                  {p.busyDb === c.name ? "…" : c.name}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
      <h3 className="mb-2 mt-6 text-sm font-semibold text-white">
        Atividade recente
      </h3>
      <div className="space-y-1.5">
        {p.ioHist.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-6 text-center text-sm text-slate-500">
            Nenhuma importação/exportação ainda.
          </div>
        ) : (
          p.ioHist.slice(0, 20).map((h) => (
            <div
              key={h.id}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
            >
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  h.success
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-rose-400/10 text-rose-300"
                }`}
              >
                {h.direction} · {h.format}
              </span>
              <span className="truncate font-mono text-xs text-slate-200">
                {h.fileName}
              </span>
              <span className="hidden truncate text-[11px] text-slate-500 sm:block">
                → {h.database}
                {h.tableName ? `/${h.tableName}` : ""}
              </span>
              {h.rows != null && (
                <span className="text-[11px] text-slate-500">
                  {h.rows} linha(s)
                </span>
              )}
              <span className="ml-auto whitespace-nowrap text-[11px] text-slate-500">
                {fmtTime(h.timestamp)}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}