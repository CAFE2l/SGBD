"use client";
import { useMemo, useState } from "react";
import { ENGINES, ENGINE_IDS, type EngineId } from "@/lib/profile/engines";

export function EnginePicker({ defaultName = "", onCancel, onConfirm, busy = false }: {
  defaultName?: string; onCancel: () => void;
  onConfirm: (name: string, engine: EngineId) => void; busy?: boolean;
}) {
  const [name, setName] = useState(defaultName);
  const [engine, setEngine] = useState<EngineId>("postgres");
  const [error, setError] = useState<string | null>(null);
  const valid = useMemo(() => /^[A-Za-z0-9_]+$/.test(name.trim()), [name]);
  const confirm = () => {
    if (!name.trim()) { setError("Dê um nome ao banco (letras, números e _)."); return; }
    if (!valid) { setError("Use apenas letras, números e sublinhado (_)."); return; }
    setError(null);
    onConfirm(name.trim(), engine);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl">
        <div className="border-b border-white/10 px-6 py-4">
          <p className="text-xs uppercase tracking-widest text-sky-300">Novo banco</p>
          <h2 className="mt-1 text-xl font-bold text-white">Escolha o motor do seu banco</h2>
          <p className="mt-1 text-sm text-slate-400">Cada motor fala um dialeto diferente no Console SQL.</p>
        </div>
        <div className="grid gap-3 p-6 sm:grid-cols-3">
          {ENGINE_IDS.map((id) => {
            const e = ENGINES[id];
            const selected = engine === id;
            return (
              <button key={id} type="button" onClick={() => setEngine(id)}
                className={`flex flex-col items-center rounded-2xl border-2 p-5 text-center transition-all hover:-translate-y-1 ${selected ? "border-sky-400 bg-sky-400/10 shadow-glow" : "border-white/10 bg-white/5 hover:border-white/25"}`}>
                <span className="text-5xl">{e.icon}</span>
                <span className="mt-3 text-base font-bold text-white">{e.label}</span>
                <span className="mt-1 text-xs font-medium text-slate-300">{e.tagline}</span>
                <span className="mt-2 text-[11px] leading-relaxed text-slate-500">{e.description}</span>
                <span className={`mt-3 rounded-full border px-2.5 py-0.5 font-mono text-[10px] ${e.badgeClass}`}>{e.dialectHint}</span>
                {selected && <span className="mt-2 text-xs font-bold text-sky-300">selecionado</span>}
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-3 border-t border-white/10 bg-black/20 px-6 py-4 sm:flex-row sm:items-center">
          <input value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
            placeholder="Nome do banco (ex: loja_virtual)"
            className="flex-1 rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 font-mono text-sm text-white outline-none placeholder:text-slate-600 focus:border-sky-400/60" />
          <div className="flex gap-2">
            <button onClick={onCancel} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-400 hover:bg-white/5 hover:text-white">Cancelar</button>
            <button onClick={confirm} disabled={busy} className="rounded-xl bg-sky-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-40">{busy ? "Criando…" : `Criar com ${ENGINES[engine].label}`}</button>
          </div>
        </div>
        {error && <p className="border-t border-rose-400/20 bg-rose-500/10 px-6 py-2 text-xs text-rose-300">{error}</p>}
      </div>
    </div>
  );
}
