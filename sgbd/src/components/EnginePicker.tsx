"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ENGINES, ENGINE_IDS, type EngineId } from "@/lib/profile/engines";

/**
 * Modal de criação de banco em 2 etapas (stepper):
 *  1. Escolha do motor (PostgreSQL / MySQL / MongoDB) em cards grandes;
 *  2. Nome do banco (valida caracteres permitidos + unicidade).
 *
 * Os motores são SIMULADOS (ver `src/lib/profile/engines.ts`): o "motor"
 * escolhido é persistido no registry e usado para traduzir/validar o dialeto,
 * mas tudo executa sobre a mesma camada relacional.
 */
export function EnginePicker({
  defaultName = "",
  existingNames = [],
  onCancel,
  onConfirm,
  busy = false,
}: {
  defaultName?: string;
  /** Nomes de bancos já existentes, para validar unicidade no passo 2. */
  existingNames?: string[];
  onCancel: () => void;
  onConfirm: (name: string, engine: EngineId) => void;
  busy?: boolean;
}) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState<1 | 2>(1);
  const [engine, setEngine] = useState<EngineId | null>(null);
  const [name, setName] = useState(defaultName);
  const [submitted, setSubmitted] = useState(false);
  const dirRef = useRef<1 | -1>(1);

  const goTo = useCallback((next: 1 | 2) => {
    dirRef.current = next === 2 ? 1 : -1;
    setStep(next);
  }, []);

  const goNext = useCallback(() => {
    if (!engine) return;
    goTo(2);
  }, [engine, goTo]);

  // Fecha com ESC (se não estiver processando uma criação).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  const trimmed = name.trim();
  const existing = useMemo(
    () => new Set(existingNames.map((n) => n.trim())),
    [existingNames]
  );
  const validChars = /^[A-Za-z0-9_]+$/.test(trimmed);
  const duplicate = existing.has(trimmed);

  let errorText: string | null = null;
  if (trimmed === "") {
    if (submitted) errorText = "Dê um nome ao banco.";
  } else if (!validChars) {
    errorText = "Use apenas letras, números e sublinhado (_).";
  } else if (duplicate) {
    errorText = `O banco "${trimmed}" já existe. Escolha outro nome.`;
  }

  const canSubmit = trimmed !== "" && validChars && !duplicate && !busy;

  const confirm = useCallback(() => {
    setSubmitted(true);
    if (!canSubmit || !engine) return;
    onConfirm(trimmed, engine);
  }, [canSubmit, engine, onConfirm, trimmed]);

  const transition = { duration: 0.16, ease: "easeOut" as const };
  const slide = reduce ? 0 : 36;
  const stepVariants = {
    enter: (d: number) => ({ opacity: 0, x: slide * d }),
    center: { opacity: 1, x: 0 },
    exit: (d: number) => ({ opacity: 0, x: -slide * d }),
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Novo banco de dados"
      >
        {/* Cabeçalho: título + stepper */}
        <div className="border-b border-white/10 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-sky-300">Novo banco</p>
              <h2 className="mt-1 text-xl font-bold text-white">
                {step === 1 ? "Escolha o motor do seu banco" : "Dê um nome ao seu banco"}
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {step === 1
                  ? "Cada motor fala um dialeto diferente no Console SQL."
                  : engine
                    ? `Será criado com o motor ${ENGINES[engine].label}.`
                    : ""}
              </p>
            </div>
            <button
              onClick={onCancel}
              disabled={busy}
              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/5 hover:text-white disabled:opacity-40"
              title="Fechar (Esc)"
            >
              ✕
            </button>
          </div>

          {/* Indicador de passos */}
          <div className="mt-4 flex items-center gap-2">
            {[1, 2].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold transition-colors ${
                    step > s
                      ? "border-sky-400/50 bg-sky-400/15 text-sky-300"
                      : step === s
                        ? "border-sky-400/70 bg-sky-400/20 text-sky-200"
                        : "border-white/10 bg-white/5 text-slate-500"
                  }`}
                >
                  {step > s ? "✓" : s}
                </span>
                <span
                  className={`text-[11px] font-medium ${
                    step === s ? "text-slate-200" : "text-slate-500"
                  }`}
                >
                  {s === 1 ? "Motor" : "Nome"}
                </span>
                {s < 2 && <span className="h-px w-6 bg-white/10" />}
              </div>
            ))}
          </div>
        </div>

        {/* Conteúdo com transição entre passos */}
        <AnimatePresence mode="wait" initial={false} custom={dirRef.current}>
          <motion.div
            key={step}
            custom={dirRef.current}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
          >
            {step === 1 ? (
              <div className="grid gap-3 p-6 sm:grid-cols-3">
                {ENGINE_IDS.map((id) => {
                  const e = ENGINES[id];
                  const selected = engine === id;
                  const dimmed = engine !== null && !selected;
                  return (
                    <motion.button
                      key={id}
                      type="button"
                      onClick={() => setEngine(id)}
                      whileHover={!selected && !dimmed ? { y: -4 } : undefined}
                      aria-pressed={selected}
                      className={`relative flex flex-col items-center rounded-2xl border-2 p-5 text-center transition-[opacity,filter] duration-200 ${
                        selected ? "" : "border-white/10 bg-white/5"
                      } ${dimmed ? "opacity-40 saturate-50" : ""}`}
                      style={
                        selected
                          ? {
                              borderColor: e.color,
                              backgroundColor: `${e.color}14`,
                              boxShadow: `0 0 28px ${e.color}55`,
                            }
                          : undefined
                      }
                      title={`Criar banco com ${e.label}`}
                    >
                      {selected && <EngineCheck color={e.color} reduce={reduce} />}
                      <span className="text-5xl" aria-hidden>
                        {e.icon}
                      </span>
                      <span className="mt-3 text-base font-bold text-white">
                        {e.label}
                      </span>
                      <span className="mt-1.5 text-xs leading-relaxed text-slate-400">
                        {e.tagline}
                      </span>
                      <span
                        className={`mt-3 rounded-full border px-2.5 py-0.5 font-mono text-[10px] ${e.badgeClass}`}
                      >
                        {e.dialectHint}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            ) : (
              <div className="p-6">
                {/* Resumo do motor escolhido + atalho para trocar */}
                {engine && (
                  <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <span className="text-lg" aria-hidden>
                      {ENGINES[engine].icon}
                    </span>
                    <span className="text-xs text-slate-400">Motor:</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ENGINES[engine].badgeClass}`}>
                      {ENGINES[engine].label}
                    </span>
                    <button
                      onClick={() => goTo(1)}
                      disabled={busy}
                      className="ml-auto text-[11px] font-medium text-sky-300 hover:text-sky-200 disabled:opacity-40"
                    >
                      Trocar motor →
                    </button>
                  </div>
                )}

                <label className="block text-xs font-semibold text-slate-400">
                  Nome do banco
                </label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirm();
                  }}
                  placeholder="ex: loja_virtual"
                  disabled={busy}
                  className={`mt-1.5 w-full rounded-xl border bg-slate-900 px-4 py-3 font-mono text-sm text-white outline-none placeholder:text-slate-600 disabled:opacity-50 focus:border-sky-400/60 ${
                    errorText ? "border-rose-400/60" : "border-white/10"
                  }`}
                />
                <p className="mt-2 text-[11px] text-slate-500">
                  Letras, números e sublinhado (_). O nome deve ser único entre
                  os bancos.
                </p>
                {errorText && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-2 text-xs text-rose-300"
                    role="alert"
                  >
                    {errorText}
                  </motion.p>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Rodapé (dependente do passo) */}
        <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-black/20 px-6 py-4">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-400 hover:bg-white/5 hover:text-white disabled:opacity-40"
          >
            Cancelar
          </button>
          <div className="flex items-center gap-2">
            {step === 2 && (
              <button
                onClick={() => goTo(1)}
                disabled={busy}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-40"
              >
                Voltar
              </button>
            )}
            {step === 1 ? (
              <button
                onClick={goNext}
                disabled={engine === null}
                className="rounded-xl bg-sky-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-40"
              >
                Continuar
              </button>
            ) : (
              <button
                onClick={confirm}
                disabled={!canSubmit}
                className="rounded-xl bg-sky-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-40"
              >
                {busy ? "Criando…" : "Criar banco"}
              </button>
            )}
          </div>
        </div>

        {/* Nota didática: decisão arquitetural explícita */}
        <div className="border-t border-white/10 bg-slate-950/60 px-6 py-2 text-center text-[10px] text-slate-600">
          Ambiente simulado para fins didáticos — os dialetos são traduzidos
          sobre uma mesma camada relacional. Decisão documentada em{" "}
          <code className="font-mono text-slate-500">src/lib/profile/engines.ts</code>.
        </div>
      </div>
    </div>
  );
}

/** "Check" animado que confirma a escolha do motor dentro do card. */
function EngineCheck({ color, reduce }: { color: string; reduce: boolean | null }) {
  return (
    <motion.span
      initial={{ scale: reduce ? 1 : 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 20 }}
      className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold text-slate-950"
      style={{ backgroundColor: color }}
      aria-hidden
    >
      ✓
    </motion.span>
  );
}