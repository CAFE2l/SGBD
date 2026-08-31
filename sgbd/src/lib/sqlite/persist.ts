import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "sgbd-web";
const STORE = "sqlite";

/** Chave usada pela versão antiga (banco único global). */
const LEGACY_KEY = "database-bytes";
/** Chave do registro de múltiplos bancos. */
const REGISTRY_KEY = "registry";

const NAME_PREFIX = "db:";

export interface DatabaseRegistry {
  databases: string[];
  activeDatabase: string | null;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

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

/** Converte um nome de banco para a chave de armazenamento. */
function nameToKey(name: string): string {
  return `${NAME_PREFIX}${name}`;
}

/**
 * Persiste o binário (Uint8Array) de um banco nomeado no IndexedDB.
 * Retorna true em caso de sucesso.
 */
export async function persistDatabaseBytes(
  name: string,
  bytes: Uint8Array
): Promise<boolean> {
  try {
    const db = await getDB();
    await db.put(STORE, bytes, nameToKey(name));
    return true;
  } catch {
    return false;
  }
}

/**
 * Recupera o binário de um banco nomeado, ou null se não existir.
 */
export async function loadDatabaseBytes(
  name: string
): Promise<Uint8Array | null> {
  try {
    const db = await getDB();
    const value = (await db.get(STORE, nameToKey(name))) as
      | Uint8Array
      | undefined;
    return value ?? null;
  } catch {
    return null;
  }
}

/**
 * Apaga o binário de um banco nomeado do IndexedDB.
 */
export async function deleteDatabaseBytes(name: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE, nameToKey(name));
  } catch {
    // silencioso
  }
}

/**
 * Salva o registro de bancos (lista + ativo atual).
 */
export async function persistRegistry(
  registry: DatabaseRegistry
): Promise<boolean> {
  try {
    const db = await getDB();
    await db.put(STORE, registry, REGISTRY_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Carrega o registro de bancos, ou null se não existir.
 */
export async function loadRegistry(): Promise<DatabaseRegistry | null> {
  try {
    const db = await getDB();
    const value = (await db.get(STORE, REGISTRY_KEY)) as
      | DatabaseRegistry
      | undefined;
    return value ?? null;
  } catch {
    return null;
  }
}

/**
 * Migra um banco único legado (armazenado em `database-bytes`) para a forma
 * nomeada `db:<nome>`, retornando o nome migrado ou null se não havia nada.
 */
export async function migrateLegacyDatabase(
  targetName: string
): Promise<string | null> {
  try {
    const db = await getDB();
    const legacy = (await db.get(STORE, LEGACY_KEY)) as Uint8Array | undefined;
    if (!legacy || legacy.byteLength === 0) {
      await db.delete(STORE, LEGACY_KEY);
      return null;
    }
    await db.put(STORE, legacy, nameToKey(targetName));
    await db.delete(STORE, LEGACY_KEY);
    return targetName;
  } catch {
    return null;
  }
}

/**
 * (Backward-compat) Salva o binário exportado do sql.js no IndexedDB.
 * Agora grava no banco nomeado informado.
 */
export async function persistDatabase(bytes: Uint8Array): Promise<boolean> {
  return persistDatabaseBytes("__legacy_single__", bytes);
}

/**
 * (Backward-compat) Recupera o binário salvo, ou null.
 */
export async function loadPersistedDatabase(): Promise<Uint8Array | null> {
  return loadDatabaseBytes("__legacy_single__");
}

/**
 * (Backward-compat) Apaga o banco persistido e o armazenamento.
 */
export async function clearPersistedDatabase(): Promise<void> {
  await deleteDatabaseBytes("__legacy_single__");
}
