"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useDb } from "./useDb";

interface ActiveTableContextValue {
  /** Tabela atualmente "aberta" no banco ativo (contexto global). */
  activeTable: string | null;
  /** Seleciona a tabela ativa em toda a aplicação (console, ver tabelas…). */
  selectTable: (table: string | null) => void;
}

const ActiveTableContext = createContext<ActiveTableContextValue | null>(null);

/**
 * Fonte única de verdade para "qual tabela está ativa". Compartilhada entre
 * o Console SQL e a página "Ver Tabelas": clicar numa tabela em qualquer um
 * dos dois sincroniza a seleção global.
 *
 * Quando o banco ativo muda (ou nenhuma tabela está selecionada), a seleção
 * é reiniciada para a primeira tabela disponível — sempre há um contexto
 * válido dentro do banco ativo.
 */
export function TableSelectionProvider({ children }: { children: ReactNode }) {
  const { activeDatabase, tables } = useDb();
  const [activeTable, setActiveTable] = useState<string | null>(null);

  useEffect(() => {
    if (tables.length === 0) {
      setActiveTable(null);
      return;
    }
    setActiveTable((current) =>
      current && tables.some((t) => t.name === current) ? current : tables[0].name
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDatabase, tables]);

  const selectTable = useCallback((table: string | null) => {
    setActiveTable(table);
  }, []);

  return (
    <ActiveTableContext.Provider value={{ activeTable, selectTable }}>
      {children}
    </ActiveTableContext.Provider>
  );
}

export function useActiveTable(): ActiveTableContextValue {
  const ctx = useContext(ActiveTableContext);
  if (!ctx) {
    throw new Error(
      "useActiveTable deve ser usado dentro de <TableSelectionProvider>"
    );
  }
  return ctx;
}