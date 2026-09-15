import { getIDB } from "./persist";
import { scopedKey } from "../profile/user-scope";

const HISTORY_PREFIX = "history:";
const GLOBAL_LOG_KEY = "profile:query-log";
const FAVORITES_KEY = "profile:favorites";
const IO_HISTORY_KEY = "profile:io-history";

export interface HistoryEntry {
  /** timestamp em ms (Date.now()) no momento da execução */
  timestamp: number;
  /** comando-chave (CREATE, INSERT, UPDATE, DELETE, ALTER, DROP…) */
  command: string;
  /** texto SQL original */
  query: string;
  /** sempre true nesta fase (só gravamos execuções bem-sucedidas) */
  success: boolean;
}

/**
 * Entrada do log GLOBAL de queries (todos os bancos do usuário).
 * Diferente do `HistoryEntry` (por banco, só escritas com sucesso), aqui
 * registramos TODA execução com banco, status, duração e motor — base das
 * seções "Histórico de Queries" e contadores do /perfil.
 */
export interface GlobalQueryEntry {
  id: string;
  timestamp: number;
  database: string;
  query: string;
  command: string;
  success: boolean;
  message: string;
  durationMs: number;
  engine: string;
  favorite?: boolean;
}

export interface FavoriteEntry {
  id: string;
  database: string;
  query: string;
  command: string;
  createdAt: number;
}

export interface IoHistoryEntry {
  id: string;
  timestamp: number;
  direction: "import" | "export";
  format: "sql" | "csv" | "json";
  fileName: string;
  database: string;
  tableName?: string;
  rows?: number;
  success: boolean;
  message?: string;
}

function keyFor(dbName: string): string {
  return scopedKey(`${HISTORY_PREFIX}${dbName}`);
}

function skey(k: string): string {
  return scopedKey(k);
}

function uid(): string {
  try {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } catch {
    return String(Date.now());
  }
}

/**
 * Recupera o histórico de queries de um banco nomeado, do mais recente para o
 * mais antigo. Retorna lista vazia caso não exista histórico ainda.
 */
export async function getHistory(dbName: string): Promise<HistoryEntry[]> {
  try {
    const db = await getIDB();
    const value = (await db.get("sqlite", keyFor(dbName))) as
      | HistoryEntry[]
      | undefined;
    return value ?? [];
  } catch {
    return [];
  }
}

/**
 * Adiciona uma entrada ao histórico de um banco nomeado. O histórico é
 * persistido no IndexedDB sob a chave `history:<nome-do-banco>` e sobrevive a
 * reloads de página.
 *
 * A leitura + escrita acontecem numa única transação readwrite: como
 * transações IndexedDB no mesmo store são serializadas, isso evita que
 * registros concorrentes (várias queries bem-sucedidas seguidas) se
 * sobrescrevam.
 */
export async function appendHistory(
  dbName: string,
  entry: HistoryEntry
): Promise<void> {
  try {
    const db = await getIDB();
    const tx = db.transaction("sqlite", "readwrite");
    const store = tx.store;
    const existing = (await store.get(keyFor(dbName))) as
      | HistoryEntry[]
      | undefined;
    const next = [entry, ...(existing ?? [])].slice(0, 500);
    await store.put(next, keyFor(dbName));
    await tx.done;
  } catch {
    // histórico é best-effort; não deve quebrar a execução
  }
}

/** Apaga o histórico de um banco (usado quando o banco é excluído). */
export async function clearHistory(dbName: string): Promise<void> {
  try {
    const db = await getIDB();
    await db.delete("sqlite", keyFor(dbName));
  } catch {
    // silencioso
  }
}

/* ── Log global de queries (todos os bancos) ─────────────────────────── */

export async function getGlobalQueryLog(): Promise<GlobalQueryEntry[]> {
  try {
    const db = await getIDB();
    const value = (await db.get("sqlite", skey(GLOBAL_LOG_KEY))) as
      | GlobalQueryEntry[]
      | undefined;
    return value ?? [];
  } catch {
    return [];
  }
}

export async function appendGlobalQueryLog(
  entry: Omit<GlobalQueryEntry, "id">
): Promise<GlobalQueryEntry> {
  const full: GlobalQueryEntry = { ...entry, id: uid() };
  try {
    const db = await getIDB();
    const tx = db.transaction("sqlite", "readwrite");
    const existing = (await tx.store.get(skey(GLOBAL_LOG_KEY))) as
      | GlobalQueryEntry[]
      | undefined;
    const next = [full, ...(existing ?? [])].slice(0, 1000);
    await tx.store.put(next, skey(GLOBAL_LOG_KEY));
    await tx.done;
  } catch {
    // best-effort
  }
  return full;
}

export async function clearGlobalQueryLog(): Promise<void> {
  try {
    const db = await getIDB();
    await db.delete("sqlite", skey(GLOBAL_LOG_KEY));
  } catch {
    // silencioso
  }
}

/* ── Favoritos ───────────────────────────────────────────────────────── */

export async function getFavorites(): Promise<FavoriteEntry[]> {
  try {
    const db = await getIDB();
    const value = (await db.get("sqlite", skey(FAVORITES_KEY))) as
      | FavoriteEntry[]
      | undefined;
    return value ?? [];
  } catch {
    return [];
  }
}

export async function toggleFavorite(entry: {
  database: string;
  query: string;
  command: string;
}): Promise<{ favorited: boolean; list: FavoriteEntry[] }> {
  const list = await getFavorites();
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  const idx = list.findIndex(
    (f) =>
      f.database === entry.database && norm(f.query) === norm(entry.query)
  );
  let next: FavoriteEntry[];
  let favorited: boolean;
  if (idx >= 0) {
    next = list.filter((_, i) => i !== idx);
    favorited = false;
  } else {
    next = [
      {
        id: uid(),
        database: entry.database,
        query: entry.query,
        command: entry.command,
        createdAt: Date.now(),
      },
      ...list,
    ].slice(0, 200);
    favorited = true;
  }
  try {
    const db = await getIDB();
    await db.put("sqlite", next, skey(FAVORITES_KEY));
  } catch {
    // best-effort
  }
  return { favorited, list: next };
}

export async function isFavorite(
  database: string,
  query: string
): Promise<boolean> {
  const list = await getFavorites();
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  return list.some(
    (f) => f.database === database && norm(f.query) === norm(query)
  );
}

/* ── Histórico de Import/Export ──────────────────────────────────────── */

export async function getIoHistory(): Promise<IoHistoryEntry[]> {
  try {
    const db = await getIDB();
    const value = (await db.get("sqlite", skey(IO_HISTORY_KEY))) as
      | IoHistoryEntry[]
      | undefined;
    return value ?? [];
  } catch {
    return [];
  }
}

export async function appendIoHistory(
  entry: Omit<IoHistoryEntry, "id" | "timestamp">
): Promise<IoHistoryEntry> {
  const full: IoHistoryEntry = {
    ...entry,
    id: uid(),
    timestamp: Date.now(),
  };
  try {
    const db = await getIDB();
    const tx = db.transaction("sqlite", "readwrite");
    const existing = (await tx.store.get(skey(IO_HISTORY_KEY))) as
      | IoHistoryEntry[]
      | undefined;
    const next = [full, ...(existing ?? [])].slice(0, 300);
    await tx.store.put(next, skey(IO_HISTORY_KEY));
    await tx.done;
  } catch {
    // best-effort
  }
  return full;
}

export async function clearIoHistory(): Promise<void> {
  try {
    const db = await getIDB();
    await db.delete("sqlite", skey(IO_HISTORY_KEY));
  } catch {
    // silencioso
  }
}