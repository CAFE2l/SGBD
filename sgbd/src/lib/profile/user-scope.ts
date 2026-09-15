/**
 * Escopo por usuário para a persistência local (IndexedDB).
 *
 * REQUISITO: "Meus Bancos de Dados — persistidos e vinculados à conta dele
 * (não à sessão local) — ele deve conseguir sair, voltar depois, e continuar
 * de onde parou."
 *
 * IMPLEMENTAÇÃO ATUAL (local-first, por conta):
 * - Todas as chaves do IndexedDB ganham o prefixo `u:<uid>:` quando há um
 *   usuário Firebase autenticado (uid estável entre sessões/dispositivos no
 *   mesmo navegador). Sem login, cai no namespace legado `anon:` (global).
 * - Sair e voltar no MESMO navegador restaura tudo (bytes dos bancos,
 *   registry, histórico) porque o uid é o mesmo.
 * - Trocar de conta no mesmo navegador isola os dados (cada uid enxerga só o
 *   seu namespace). Na primeira vez de um uid novo, migramos o namespace
 *   legado/anônimo para ele (best-effort) para não "perder" bancos criados
 *   antes do login.
 *
 * LIMITE CONHECIDO (documentado de propósito): IndexedDB é por origem +
 * navegador. "Sair, voltar depois" no mesmo dispositivo funciona; ver os
 * mesmos bancos em OUTRO dispositivo/navegador exige sincronização server-side
 * (Neon por usuário ou Firestore). O caminho de migração: os bytes exportados
 * por `persistDatabaseBytes` + o `ManagerRegistry` já são serializáveis — é só
 * POSTá-los para uma API route autenticada (Firebase ID token) que grave no
 * Neon numa tabela `user_databases(uid, name, bytes, meta)`. Nenhuma mudança
 * de API no `database-manager` seria necessária além de trocar o backend de
 * `persist.ts`.
 */

import { openDB, type IDBPDatabase } from "idb";

let currentUid: string | null = null;
let dbPromise: Promise<IDBPDatabase> | null = null;

const DB_NAME = "sgbd-web";
const STORE = "sqlite";

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

export function getIDB(): Promise<IDBPDatabase> {
  return getDB();
}

/** Define o usuário corrente; deve ser chamado pelo AuthProvider/useDb. */
export function setCurrentUid(uid: string | null): void {
  currentUid = uid && uid.length > 0 ? uid : null;
}

export function getCurrentUid(): string | null {
  return currentUid;
}

/** Prefixo de namespace: `u:<uid>:` logado, `anon:` anônimo/global. */
function scopePrefix(): string {
  return currentUid ? `u:${currentUid}:` : "anon:";
}

export function scopedKey(key: string): string {
  if (key.startsWith("u:") || key.startsWith("anon:")) return key;
  return `${scopePrefix()}${key}`;
}

/** Lista todas as chaves do store (para migração/varredura). */
export async function listAllKeys(): Promise<string[]> {
  try {
    const db = await getDB();
    const keys = (await db.getAllKeys(STORE)) as unknown[];
    return keys.map(String);
  } catch {
    return [];
  }
}

async function copyKey(from: string, to: string): Promise<void> {
  if (from === to) return;
  try {
    const db = await getDB();
    const value = await db.get(STORE, from);
    if (value === undefined) return;
    await db.put(STORE, value, to);
  } catch {
    // best-effort
  }
}

/**
 * Migra o namespace anônimo/legado para o usuário que acabou de logar,
 * sem apagar a origem (merge sem sobrescrever o que já existe no destino).
 * Chaves migradas: `registry`, `db:<nome>`, `history:<nome>`, `meta`, etc.
 */
export async function migrateAnonToUser(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const keys = await listAllKeys();
    const destPrefix = `u:${uid}:`;
    for (const k of keys) {
      const isAnon = k.startsWith("anon:");
      const isLegacy =
        !k.startsWith("u:") &&
        !k.startsWith("anon:") &&
        (k === "registry" ||
          k.startsWith("db:") ||
          k.startsWith("history:") ||
          k.startsWith("profile:"));
      if (!isAnon && !isLegacy) continue;
      const bare = isAnon ? k.slice("anon:".length) : k;
      const dest = `${destPrefix}${bare}`;
      const db = await getDB();
      const exists = (await db.get(STORE, dest)) !== undefined;
      if (!exists) {
        await copyKey(k, dest);
      }
    }
  } catch {
    // silencioso
  }
}
