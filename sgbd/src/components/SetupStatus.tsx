"use client";

import { useEffect, useState } from "react";
import { checkFirebaseStatus } from "@/lib/firebase/client";

type NeonStatus = {
  configured: boolean;
  connected: boolean;
  error?: string;
};

export function SetupStatus() {
  const [neon, setNeon] = useState<NeonStatus | null>(null);
  const [firebase, setFirebase] = useState(() => checkFirebaseStatus());
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/health");
        const data = (await res.json()) as NeonStatus;
        if (alive) {
          setNeon(data);
          setFirebase(checkFirebaseStatus());
        }
      } catch {
        if (alive) {
          setNeon({
            configured: true,
            connected: false,
            error: "Falha ao contactar o servidor",
          });
        }
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="glass mt-14 w-full max-w-2xl rounded-2xl p-6 text-left">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">
          Status da configuração
        </h2>
        {checking && (
          <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-sky-400" />
        )}
      </div>
      <div className="mt-4 space-y-3 text-sm">
        <NeonRow status={neon} />
        <FirebaseRow firebase={firebase} />
      </div>
    </div>
  );
}

function NeonRow({ status }: { status: NeonStatus | null }) {
  const label = !status
    ? "Verificando…"
    : !status.configured
      ? "Configure DATABASE_URL no .env.local"
      : status.connected
        ? "Conectado"
        : status.error ?? "Não conectado";

  const ok = status?.connected === true;
  const warn = status != null && !status.configured;
  return (
    <Row
      label="Neon (Postgres)"
      ok={ok}
      warn={status == null ? undefined : warn}
      hint={label}
    />
  );
}

function FirebaseRow({ firebase }: { firebase: { configured: boolean } }) {
  const ok = firebase.configured;
  return (
    <Row
      label="Firebase (Auth + Storage)"
      ok={ok}
      warn={!ok}
      hint={
        ok
          ? "Configurado"
          : "Configure NEXT_PUBLIC_FIREBASE_* no .env.local"
      }
    />
  );
}

function Row({
  label,
  ok,
  warn,
  hint,
}: {
  label: string;
  ok: boolean;
  warn?: boolean;
  hint: string;
}) {
  return (
    <div className="glass flex items-center justify-between rounded-xl px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            ok
              ? "bg-emerald-400 shadow-glow-sm"
              : warn
                ? "bg-amber-400"
                : "bg-rose-400"
          }`}
        />
        <span className="text-slate-300">{label}</span>
      </div>
      <span className="max-w-[60%] truncate text-xs text-slate-400">
        {hint}
      </span>
    </div>
  );
}
