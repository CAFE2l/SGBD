"use client";
import Link from "next/link";
import { EngineBadge, consoleUrl, tablesUrl } from "@/components/EngineBadge";
import { fmtDate, type DbCard } from "./types";

export function PerfilDbs(props: {
  cards: DbCard[]; loading: boolean; activeDatabase: string | null;
  busyDb: string | null; renaming: string | null; renameValue: string;
  setRenameValue: (v: string) => void; setRenaming: (v: string | null) => void;
  confirmDelete: string | null; setConfirmDelete: (v: string | null) => void;
  expandedDb: string | null; setExpandedDb: (v: string | null) => void;
  onOpenPicker: () => void;
  onRename: (n: string) => void; onDuplicate: (n: string) => void;
  onExport: (n: string) => void; onDelete: (n: string) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Meus Bancos de Dados ({props.cards.length})</h2>
        <button onClick={props.onOpenPicker} className="rounded-xl bg-sky-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-300">+ Criar novo banco</button>
      </div>
      {props.loading ? <p className="text-sm text-slate-500">Carregando bancos...</p>
      : props.cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-8 text-center text-sm text-slate-500">Nenhum banco ainda. Crie o primeiro escolhendo um motor.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {props.cards.map((c) => (
            <div key={c.name} className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
              <div className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-mono text-sm font-bold text-white">{c.name}</span>
                  <EngineBadge engine={c.engine} />
                  {props.activeDatabase === c.name && <span className="rounded-full border border-sky-400/40 bg-sky-400/10 px-2 py-0.5 text-[10px] font-bold text-sky-300">ATIVO</span>}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{c.tableCount} tabela(s) - {c.rowCount} linha(s) - criado em {fmtDate(c.createdAt)} - atualizado em {fmtDate(c.updatedAt)}</p>
              </div>
              {props.renaming === c.name ? (
                <div className="flex gap-2 border-t border-white/10 bg-black/20 px-4 py-3">
                  <input value={props.renameValue} onChange={(e) => props.setRenameValue(e.target.value)} className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 font-mono text-xs text-white outline-none" />
                  <button onClick={() => props.onRename(c.name)} className="rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950">Salvar</button>
                  <button onClick={() => props.setRenaming(null)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400">Cancelar</button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5 border-t border-white/10 bg-black/20 px-4 py-3">
                  <Link href={consoleUrl(c.name)} className="rounded-lg bg-sky-400/15 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-400/25">Abrir no Console</Link>
                  <button onClick={() => { props.setRenaming(c.name); props.setRenameValue(c.name); }} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">Renomear</button>
                  <button onClick={() => props.onDuplicate(c.name)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">Duplicar</button>
                  <button onClick={() => props.onExport(c.name)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">Exportar</button>
                  {props.confirmDelete === c.name ? (
                    <span className="flex items-center gap-1">
                      <button onClick={() => props.onDelete(c.name)} className="rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300">Confirmar?</button>
                      <button onClick={() => props.setConfirmDelete(null)} className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-slate-400">Nao</button>
                    </span>
                  ) : (
                    <button onClick={() => props.setConfirmDelete(c.name)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:text-rose-300">Excluir</button>
                  )}
                  <button onClick={() => props.setExpandedDb(props.expandedDb === c.name ? null : c.name)} className="ml-auto rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-500 hover:text-white">{props.expandedDb === c.name ? "Ocultar" : `Tabelas (${c.tables.length})`}</button>
                </div>
              )}
              {props.expandedDb === c.name && (
                <div className="space-y-1 border-t border-white/10 bg-black/20 px-4 py-3">
                  {c.tables.length === 0 ? <p className="text-[11px] text-slate-500">Sem tabelas ainda.</p> :
                    c.tables.map((t) => (
                      <Link key={t.name} href={tablesUrl(c.name, t.name)} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-slate-300 hover:text-sky-300">
                        <span className="truncate">{t.name}</span>
                        <span className="ml-2 text-slate-500">{t.rows} linha(s)</span>
                      </Link>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
