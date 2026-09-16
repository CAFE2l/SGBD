"use client";

import { useEffect, useState } from "react";
import { countTable } from "@/lib/sqlite/db";
import type { TableInfo } from "@/lib/sqlite/types";

/**
 * Carrega a contagem de linhas de cada tabela da lista (ex: sidebar do
 * Console SQL e "Ver Tabelas"). Recarrega sempre que a lista muda.
 */
export function useTableCounts(tables: TableInfo[]) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (tables.length === 0) {
      setCounts({});
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      const next: Record<string, number> = {};
      for (const t of tables) {
        try {
          next[t.name] = await countTable(t.name);
        } catch {
          next[t.name] = 0;
        }
      }
      if (!cancelled) setCounts(next);
    })().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tables]);

  return { counts, loading };
}