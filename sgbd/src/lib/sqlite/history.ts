import { getIDB } from "./persist";

const HISTORY_PREFIX = "history:";

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

function keyFor(dbName: string): string {
  return `${HISTORY_PREFIX}${dbName}`;
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