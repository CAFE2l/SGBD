"use client";

import { useState } from "react";
import { useDb } from "@/hooks/useDb";

export function ResetButton() {
  const { reset } = useDb();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (!confirm) {
      setConfirm(true);
      setTimeout(() => setConfirm(false), 3000);
      return;
    }
    setBusy(true);
    await reset();
    setConfirm(false);
    setBusy(false);
  };

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
        confirm
          ? "border-rose-400/40 bg-rose-500/15 text-rose-300"
          : "border-white/10 bg-white/5 text-slate-400 hover:border-rose-400/30 hover:text-rose-300"
      }`}
    >
      {busy ? "Apagando…" : confirm ? "Confirmar exclusão?" : "Resetar banco"}
    </button>
  );
}
