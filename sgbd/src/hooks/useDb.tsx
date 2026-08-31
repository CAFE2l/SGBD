"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  initDatabase,
  importCsv,
  importSql,
  runScript,
  runQuery,
  listTables,
  resetDatabase,
  listDatabases,
  getActiveDatabase,
  switchActiveDatabase,
  createDatabase,
} from "@/lib/sqlite/db";
import type {
  ImportReport,
  QueryResult,
  QueryScriptResult,
  TableInfo,
} from "@/lib/sqlite/types";

interface DbContextValue {
  ready: boolean;
  databases: string[];
  activeDatabase: string | null;
  tables: TableInfo[];
  error: string | null;
  refresh: () => Promise<void>;
  switchDatabase: (name: string) => Promise<void>;
  createNewDatabase: (name: string) => Promise<string>;
  executeScript: (sql: string) => Promise<QueryScriptResult>;
  executeQuery: (sql: string) => Promise<QueryResult>;
  importSqlScript: (sql: string) => Promise<ImportReport>;
  importCsvData: (
    parsed: { columns: string[]; rows: (string | null)[][] },
    tableName: string,
    explicitTypes?: string[]
  ) => Promise<ImportReport>;
  reset: () => Promise<void>;
}

const DbContext = createContext<DbContextValue | null>(null);

export function DbProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [activeDatabase, setActiveDatabase] = useState<string | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const syncState = useCallback(() => {
    setDatabases(listDatabases());
    setActiveDatabase(getActiveDatabase());
  }, []);

  const refresh = useCallback(async () => {
    try {
      const t = await listTables();
      if (mounted.current) {
        setTables(t);
        syncState();
        setError(null);
      }
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [syncState]);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        await initDatabase();
        if (mounted.current) {
          syncState();
          const t = await listTables();
          setTables(t);
          setReady(true);
        }
      } catch (e) {
        if (mounted.current) {
          setError(e instanceof Error ? e.message : String(e));
          setReady(true);
        }
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [syncState]);

  const switchDatabase = useCallback(
    async (name: string) => {
      await switchActiveDatabase(name);
      await refresh();
    },
    [refresh]
  );

  const createNewDatabase = useCallback(
    async (name: string) => {
      await createDatabase(name);
      await refresh();
      return name;
    },
    [refresh]
  );

  const executeScript = useCallback(
    async (sql: string) => {
      const result = await runScript(sql);
      await refresh();
      return result;
    },
    [refresh]
  );

  const executeQuery = useCallback(
    async (sql: string) => {
      const result = await runQuery(sql);
      await refresh();
      return result;
    },
    [refresh]
  );

  const importSqlScript = useCallback(
    async (sql: string) => {
      const report = await importSql(sql);
      await refresh();
      return report;
    },
    [refresh]
  );

  const importCsvData = useCallback(
    async (
      parsed: { columns: string[]; rows: (string | null)[][] },
      tableName: string,
      explicitTypes?: string[]
    ) => {
      const report = await importCsv(parsed, tableName, explicitTypes);
      await refresh();
      return report;
    },
    [refresh]
  );

  const reset = useCallback(async () => {
    await resetDatabase();
    await refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      ready,
      databases,
      activeDatabase,
      tables,
      error,
      refresh,
      switchDatabase,
      createNewDatabase,
      executeScript,
      executeQuery,
      importSqlScript,
      importCsvData,
      reset,
    }),
    [
      ready,
      databases,
      activeDatabase,
      tables,
      error,
      refresh,
      switchDatabase,
      createNewDatabase,
      executeScript,
      executeQuery,
      importSqlScript,
      importCsvData,
      reset,
    ]
  );

  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export function useDb(): DbContextValue {
  const ctx = useContext(DbContext);
  if (!ctx) {
    throw new Error("useDb deve ser usado dentro de <DbProvider>");
  }
  return ctx;
}
