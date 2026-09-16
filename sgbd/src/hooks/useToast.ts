import { useCallback, useState } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

/**
 * Hook leve de toasts. Auto-remove após `durationMs`.
 * Não requer provider — o caller renderiza <ToastContainer> onde quiser.
 */
export function useToast(durationMs = 4000) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback(
    (message: string, type: ToastType = "info", duration = durationMs) => {
      const id = `__toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const t: Toast = { id, message, type };
      setToasts((prev) => [...prev, t]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, duration);
      return id;
    },
    [durationMs]
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast, dismissToast };
}
