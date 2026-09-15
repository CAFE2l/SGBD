import initSqlJs, {
  type Database,
  type SqlJsStatic,
  type SqlValue,
} from "sql.js";
import {
  loadDatabaseBytes,
  persistDatabaseBytes,
  deleteDatabaseBytes,
  persistRegistry,
  loadRegistry,
  migrateLegacyDatabase,
  type DatabaseRegistry,
} from "./sqlite/persist";
import {
  appendHistory,
  clearHistory,
  appendGlobalQueryLog,
} from "./sqlite/history";
import { engineOrDefault, type EngineId } from "./profile/engines";
import type {
  TableInfo,
  QueryResult,
  QueryScriptResult,
} from "./sqlite/types";

const DEFAULT_DB_NAME = "meu_banco";

let SQL: SqlJsStatic | null = null;
let initPromise: Promise<SqlJsStatic> | null = null;

/** Metadados de um banco (datas de criação/modificação + motor). */
export interface DbMeta {
  createdAt: number;
  updatedAt: number;
  /**
   * Motor escolhido na criação (ver `src/lib/profile/engines.ts`).
   * DECISÃO: simulado/traduzido sobre o mesmo sql.js — ver header de engines.ts.
   */
  engine?: EngineId;
}

export interface ManagerRegistry extends DatabaseRegistry {
  meta?: Record<string, DbMeta>;
  /** Contadores rápidos derivados (persistidos para leitura instantânea). */
  stats?: {
    totalQueries: number;
    totalTablesCreated: number;
    totalDatabasesCreated: number;
  };
}

/** Registro em memória; espelho do que está persistido. */
let registry: ManagerRegistry = { databases: [], activeDatabase: null };

/** Instância SQL carregada do banco atualmente ativo. */
let active: { name: string; db: Database } | null = null;

/**
 * Carrega o motor sql.js (WASM) uma única vez e habilita constraints de
 * FOREIGN KEY, que o SQLite deixa desligado por padrão.
 */
async function getSql(): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  if (!initPromise) {
    initPromise = initSqlJs({
      locateFile: () => `/sql-wasm.wasm`,
    }).then((sqljs) => {
      SQL = sqljs;
      return sqljs;
    });
  }
  return initPromise;
}

/**
 * Inicializa o gerenciador: carrega o registro, migra um banco legado de
 * versões anteriores e garante que exista um banco ativo.
 *
 * A inicialização é deduplicada com um cache de Promise para que chamadas
 * concorrentes (ex: StrictMode mountando o provider duas vezes) não caiam em
 * recursão: `createDatabase` chama `initManager` de volta enquanto a
 * inicialização ainda está em andamento, e sem o cache isso nunca resolve.
 */
let managerInitPromise: Promise<void> | null = null;

async function initManagerImpl(): Promise<void> {
  if (registry.databases.length > 0) return;
  const persisted = (await loadRegistry()) ?? {
    databases: [],
    activeDatabase: null,
    meta: {},
  };
  registry = persisted;
  if (!registry.meta) registry.meta = {};

  if (registry.databases.length === 0) {
    const migrated = await migrateLegacyDatabase(DEFAULT_DB_NAME);
    if (migrated) {
      registry.databases = [migrated];
      registry.activeDatabase = migrated;
    }
  }

  if (registry.databases.length === 0) {
    // Cria o banco padrão diretamente (sem recursão via createDatabase).
    await createDatabaseRaw(DEFAULT_DB_NAME);
  }
  if (!registry.activeDatabase && registry.databases.length > 0) {
    registry.activeDatabase = registry.databases[0];
  }
  await persistRegistry(registry);
}

export function initManager(): Promise<void> {
  if (!managerInitPromise) {
    managerInitPromise = initManagerImpl().finally(() => {
      managerInitPromise = null;
    });
  }
  return managerInitPromise;
}

/**
 * Normaliza dialetos MySQL/Postgres para o subconjunto executável no sql.js.
 * DECISÃO (ver engines.ts): tradução best-effort, não fidelidade total.
 * - backticks → aspas duplas; AUTO_INCREMENT → AUTOINCREMENT;
 * - SERIAL/BIGSERIAL → INTEGER PRIMARY KEY AUTOINCREMENT;
 * - ENUM(...) → TEXT (check de valores é ignorado nesta fase educacional).
 */
export function normalizeDialect(sql: string, engine?: EngineId): string {
  let out = sql;
  out = out.replace(/`([^`]+)`/g, '"$1"');
  out = out.replace(/\bAUTO_INCREMENT\b/gi, "AUTOINCREMENT");
  out = out.replace(/\bBIGSERIAL\b/gi, "INTEGER PRIMARY KEY AUTOINCREMENT");
  out = out.replace(/(?<!PRIMARY KEY\s)\bSERIAL\b/gi, "INTEGER");
  out = out.replace(/\bENUM\s*\([^)]*\)/gi, "TEXT");
  // Postgres: "IF NOT EXISTS" já é aceito pelo SQLite — nada a fazer.
  void engine;
  return out;
}

/**
 * Traduz sintaxe de documento Mongo (find/insertOne/aggregate) para SQL.
 * Retorna o SQL traduzido, ou null se não for sintaxe Mongo.
 */
export function translateMongoToSql(stmt: string): string | null {
  const t = stmt.trim();
  // db.colecao.find({ campo: valor, ... })  /  db.colecao.find()
  let m = t.match(
    /^db\.([A-Za-z0-9_]+)\.find\s*\(\s*(\{[\s\S]*\})?\s*\)\s*;?\s*$/i
  );
  if (m) {
    const col = m[1];
    const filterRaw = (m[2] ?? "").trim();
    if (!filterRaw) return `SELECT * FROM "${col}" LIMIT 100;`;
    try {
      // Converte objeto JS-ish em JSON válido: chaves sem aspas → com aspas.
      const jsonish = filterRaw
        .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
        .replace(/'/g, '"');
      const filter = JSON.parse(jsonish) as Record<string, unknown>;
      const keys = Object.keys(filter);
      if (keys.length === 0) return `SELECT * FROM "${col}" LIMIT 100;`;
      const where = keys
        .map((k) => {
          const v = filter[k];
          if (v === null) return `"${k}" IS NULL`;
          if (typeof v === "number") return `"${k}" = ${v}`;
          return `"${k}" = '${String(v).replace(/'/g, "''")}'`;
        })
        .join(" AND ");
      return `SELECT * FROM "${col}" WHERE ${where} LIMIT 100;`;
    } catch {
      return `SELECT * FROM "${col}" LIMIT 100;`;
    }
  }
  // db.colecao.insertOne({ ... })
  m = t.match(/^db\.([A-Za-z0-9_]+)\.insertOne\s*\(\s*(\{[\s\S]*\})\s*\)\s*;?\s*$/i);
  if (m) {
    const col = m[1];
    try {
      const jsonish = m[2]
        .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
        .replace(/'/g, '"');
      const doc = JSON.parse(jsonish) as Record<string, unknown>;
      const cols = Object.keys(doc);
      if (cols.length === 0) throw new Error("empty");
      const colList = cols.map((c) => `"${c}"`).join(", ");
      const valList = cols
        .map((c) => {
          const v = doc[c];
          if (v === null || v === undefined) return "NULL";
          if (typeof v === "number") return String(v);
          if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
          return `'${String(v).replace(/'/g, "''")}'`;
        })
        .join(", ");
      return `INSERT INTO "${col}" (${colList}) VALUES (${valList});`;
    } catch {
      return null;
    }
  }
  // db.colecao.aggregate([...]) → aproxima com SELECT * (fase educacional)
  m = t.match(/^db\.([A-Za-z0-9_]+)\.aggregate\s*\(/i);
  if (m) {
    return `SELECT * FROM "${m[1]}" LIMIT 100;`;
  }
  return null;
}

/** Retorna o motor do banco informado (default: postgres). */
export function getDatabaseEngine(name: string): EngineId {
  return engineOrDefault(registry.meta?.[name]?.engine);
}

/** Define/troca o motor de um banco existente. */
export async function setDatabaseEngine(
  name: string,
  engine: EngineId
): Promise<void> {
  await initManager();
  if (!registry.databases.includes(name)) {
    throw new Error(`Banco "${name}" não encontrado.`);
  }
  if (!registry.meta) registry.meta = {};
  const m = registry.meta[name] ?? {
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  m.engine = engine;
  m.updatedAt = Date.now();
  registry.meta[name] = m;
  await persistRegistry(registry);
}

/**
 * Reseta o cache em memória do gerenciador (troca de usuário).
 * A próxima chamada de `initManager()` recarrega o registry do escopo novo.
 */
export function resetManagerCache(): void {
  if (active) {
    try {
      active.db.close();
    } catch {
      // silencioso
    }
  }
  active = null;
  registry = { databases: [], activeDatabase: null };
  managerInitPromise = null;
}

/** Força recarregar o registry do escopo atual (após login/logout). */
export async function reloadManagerForScope(): Promise<void> {
  resetManagerCache();
  await initManager();
  await ensureActiveEngine();
}

/** Estatísticas agregadas do usuário corrente (contadores do /perfil). */
export function getProfileStats(): {
  totalQueries: number;
  totalTablesCreated: number;
  totalDatabasesCreated: number;
} {
  const s = registry.stats;
  return {
    totalQueries: s?.totalQueries ?? 0,
    totalTablesCreated: s?.totalTablesCreated ?? 0,
    totalDatabasesCreated:
      s?.totalDatabasesCreated ?? registry.databases.length,
  };
}

/** Lista os nomes dos bancos existentes. */
export function listDatabases(): string[] {
  return [...registry.databases];
}

/** Nome do banco atualmente selecionado, ou null. */
export function getActiveDatabase(): string | null {
  return registry.activeDatabase;
}

/** Persiste o estado atual do motor ativo (autosave), sem bloquear a UI. */
export function saveActive(): void {
  if (!active) return;
  try {
    const bytes = active.db.export();
    void persistDatabaseBytes(active.name, bytes);
  } catch {
    // falha de persistência não deve quebrar a operação em andamento
  }
}

/**
 * Descarta o motor ativo da memória (exportando antes) e recarrega o banco
 * informado como ativo. Cria o banco do zero se ainda não existirem dados.
 */
export async function switchActiveDatabase(name: string): Promise<void> {
  if (active?.name === name) return;
  if (!registry.databases.includes(name)) {
    throw new Error(
      `Banco "${name}" não encontrado. Use CREATE DATABASE para criá-lo.`
    );
  }
  if (active) saveActive();
  active = null;

  const sql = await getSql();
  const persisted = await loadDatabaseBytes(name);
  const db =
    persisted && persisted.byteLength > 0
      ? new sql.Database(persisted)
      : new sql.Database();
  db.run("PRAGMA foreign_keys = ON;");
  active = { name, db };
  registry.activeDatabase = name;
  await persistRegistry(registry);
}

/**
 * Garante que há um banco ativo carregado. Se nenhum banco existir, cria o
 * banco padrão automaticamente. Retorna o motor ativo.
 */
export async function ensureActiveEngine(): Promise<Database> {
  await initManager();
  if (!active) {
    const target = registry.activeDatabase ?? DEFAULT_DB_NAME;
    await switchActiveDatabase(target);
  }
  return active!.db;
}

/** Cria um novo banco nomeado e o torna o banco ativo. */
export async function createDatabase(
  name: string,
  engine?: EngineId
): Promise<void> {
  await initManager();
  await createDatabaseRaw(name, engine);
}

/** Cria um banco sem passar por initManager (evita recursão). */
async function createDatabaseRaw(
  name: string,
  engine?: EngineId
): Promise<void> {
  const clean = sanitizeName(name);
  if (!clean) throw new Error("Nome de banco inválido.");
  if (registry.databases.includes(clean)) {
    throw new Error(`Banco "${clean}" já existe.`);
  }
  if (active) saveActive();
  active = null;
  const sql = await getSql();
  const db = new sql.Database();
  db.run("PRAGMA foreign_keys = ON;");
  active = { name: clean, db };
  registry.databases.push(clean);
  registry.activeDatabase = clean;
  const now = Date.now();
  if (!registry.meta) registry.meta = {};
  registry.meta[clean] = {
    createdAt: now,
    updatedAt: now,
    engine: engineOrDefault(engine ?? "postgres"),
  };
  if (!registry.stats) {
    registry.stats = {
      totalQueries: 0,
      totalTablesCreated: 0,
      totalDatabasesCreated: 0,
    };
  }
  registry.stats.totalDatabasesCreated += 1;
  await persistRegistry(registry);
  void persistDatabaseBytes(clean, db.export());
}

/** Atualiza a data de última modificação de um banco (persistência best-effort). */
function touchDatabase(name: string): void {
  if (!registry.meta) registry.meta = {};
  const now = Date.now();
  const m = registry.meta[name];
  if (m) m.updatedAt = now;
  else registry.meta[name] = { createdAt: now, updatedAt: now };
  void persistRegistry(registry);
}

/**
 * Registra uma atividade bem-sucedida num banco: atualiza `updatedAt` e anexa
 * uma entrada ao histórico persistido (auditoria/checkpoint per query).
 */
export function recordDatabaseActivity(
  dbName: string | null | undefined,
  command: string,
  query: string
): void {
  if (!dbName) return;
  void appendHistory(dbName, {
    timestamp: Date.now(),
    command,
    query,
    success: true,
  });
  touchDatabase(dbName);
}

/** Remove um banco nomeado (e seus dados persistidos). */
export async function dropDatabase(name: string): Promise<void> {
  await initManager();
  if (!registry.databases.includes(name)) {
    throw new Error(`Banco "${name}" não encontrado.`);
  }
  if (active?.name === name) {
    active.db.close();
    active = null;
  }
  await deleteDatabaseBytes(name);
  await clearHistory(name);
  if (registry.meta) delete registry.meta[name];
  registry.databases = registry.databases.filter((d) => d !== name);

  if (registry.activeDatabase === name) {
    registry.activeDatabase =
      registry.databases.length > 0 ? registry.databases[0] : null;
  }
  await persistRegistry(registry);

  if (active && registry.activeDatabase !== active.name) {
    active = null;
  }
  if (registry.databases.length === 0) {
    await createDatabase(DEFAULT_DB_NAME);
  } else if (!active) {
    await switchActiveDatabase(registry.activeDatabase!);
  }
}

/**
 * Inspeciona um banco sem alterar o banco ativo: número de tabelas e datas de
 * criação/última modificação (para a página "Bancos de Dados").
 */
export async function inspectDatabase(
  name: string
): Promise<{
  name: string;
  tableCount: number;
  createdAt: number | null;
  updatedAt: number | null;
  engine: EngineId;
}> {
  await initManager();
  if (!registry.databases.includes(name)) {
    throw new Error(`Banco "${name}" não encontrado.`);
  }
  const m = registry.meta?.[name];
  const sql = await getSql();
  let tableCount = 0;
  try {
    if (active?.name === name) {
      const res = active.db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
      );
      tableCount = res[0]?.values.length ?? 0;
    } else {
      const persisted = await loadDatabaseBytes(name);
      if (persisted && persisted.byteLength > 0) {
        const db = new sql.Database(persisted);
        try {
          const res = db.exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
          );
          tableCount = res[0]?.values.length ?? 0;
        } finally {
          db.close();
        }
      }
    }
  } catch {
    tableCount = 0;
  }
  return {
    name,
    tableCount,
    createdAt: m?.createdAt ?? null,
    updatedAt: m?.updatedAt ?? null,
    engine: engineOrDefault(m?.engine),
  };
}

/** Renomeia um banco (bytes + registry + meta + histórico). */
export async function renameDatabase(
  oldName: string,
  newName: string
): Promise<string> {
  await initManager();
  const clean = sanitizeName(newName);
  if (!clean) throw new Error("Nome de banco inválido.");
  if (!registry.databases.includes(oldName)) {
    throw new Error(`Banco "${oldName}" não encontrado.`);
  }
  if (registry.databases.includes(clean)) {
    throw new Error(`Banco "${clean}" já existe.`);
  }
  const bytes = await loadDatabaseBytes(oldName);
  const sql = await getSql();
  const fresh =
    bytes && bytes.byteLength > 0 ? new sql.Database(bytes) : new sql.Database();
  if (active?.name === oldName) {
    try {
      active.db.close();
    } catch {
      // silencioso
    }
    active = { name: clean, db: fresh };
  }
  await persistDatabaseBytes(clean, fresh.export());
  if (active?.name !== clean) {
    try {
      fresh.close();
    } catch {
      // silencioso
    }
  }
  await deleteDatabaseBytes(oldName);
  registry.databases = registry.databases.map((n) =>
    n === oldName ? clean : n
  );
  if (registry.activeDatabase === oldName) registry.activeDatabase = clean;
  if (registry.meta?.[oldName]) {
    if (!registry.meta) registry.meta = {};
    registry.meta[clean] = { ...registry.meta[oldName], updatedAt: Date.now() };
    delete registry.meta[oldName];
  }
  await persistRegistry(registry);
  await ensureActiveEngine();
  return clean;
}

/** Duplica um banco (cópia profunda dos bytes + meta nova). */
export async function duplicateDatabase(
  source: string,
  target?: string
): Promise<string> {
  await initManager();
  if (!registry.databases.includes(source)) {
    throw new Error(`Banco "${source}" não encontrado.`);
  }
  let clean = sanitizeName(target ?? `${source}_copia`);
  if (!clean) throw new Error("Nome de banco inválido.");
  if (registry.databases.includes(clean)) {
    let i = 2;
    while (registry.databases.includes(`${clean}_${i}`)) i++;
    clean = `${clean}_${i}`;
  }
  const bytes =
    active?.name === source ? active.db.export() : await loadDatabaseBytes(source);
  const sql = await getSql();
  const copy =
    bytes && bytes.byteLength > 0 ? new sql.Database(bytes) : new sql.Database();
  if (active) saveActive();
  active = { name: clean, db: copy };
  registry.databases.push(clean);
  registry.activeDatabase = clean;
  const srcMeta = registry.meta?.[source];
  if (!registry.meta) registry.meta = {};
  const now = Date.now();
  registry.meta[clean] = {
    createdAt: now,
    updatedAt: now,
    engine: engineOrDefault(srcMeta?.engine),
  };
  if (!registry.stats) {
    registry.stats = { totalQueries: 0, totalTablesCreated: 0, totalDatabasesCreated: 0 };
  }
  registry.stats.totalDatabasesCreated += 1;
  await persistRegistry(registry);
  void persistDatabaseBytes(clean, copy.export());
  return clean;
}

/** Dump SQL de qualquer banco (sem trocar o ativo). */
export async function exportDatabaseSql(name: string): Promise<string> {
  await initManager();
  if (!registry.databases.includes(name)) throw new Error(`Banco "${name}" não encontrado.`);
  if (active?.name === name) {
    const { exportSql } = await import("./sqlite/db");
    return exportSql();
  }
  const sql = await getSql();
  const bytes = await loadDatabaseBytes(name);
  if (!bytes || bytes.byteLength === 0) return "-- banco vazio\n";
  const db = new sql.Database(bytes);
  try {
    const res = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
    const parts = [`-- Dump do banco "${name}"`, "PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;", ""];
    if (res.length > 0) {
      for (const row of res[0].values) {
        const tname = String(row[0]);
        parts.push(row[1] ? String(row[1]) : `CREATE TABLE "${tname}";`);
        parts.push("");
        try {
          const data = db.exec(`SELECT * FROM "${tname}";`);
          if (data.length > 0) {
            const cols = data[0].columns.map((c) => `"${c}"`).join(", ");
            for (const r of data[0].values) {
              const vals = r.map((v) => v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`).join(", ");
              parts.push(`INSERT INTO "${tname}" (${cols}) VALUES (${vals});`);
            }
            parts.push("");
          }
        } catch { /* ignora dados ilegíveis */ }
      }
    }
    parts.push("COMMIT;");
    return parts.join("\n");
  } finally {
    db.close();
  }
}

/** Tabelas + linhas de um banco (cards do /perfil). */
export async function describeDatabase(name: string): Promise<{ tableCount: number; rowCount: number; tables: { name: string; rows: number }[] }> {
  await initManager();
  if (!registry.databases.includes(name)) throw new Error(`Banco "${name}" não encontrado.`);
  const sql = await getSql();
  let db: Database | null = null;
  let owned = false;
  try {
    if (active?.name === name) { db = active.db; }
    else {
      const bytes = await loadDatabaseBytes(name);
      if (!bytes || bytes.byteLength === 0) return { tableCount: 0, rowCount: 0, tables: [] };
      db = new sql.Database(bytes);
      owned = true;
    }
    const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
    const names: string[] = res.length > 0 ? res[0].values.map((r) => String(r[0])) : [];
    const tables: { name: string; rows: number }[] = [];
    let rowCount = 0;
    for (const t of names) {
      let rows = 0;
      try {
        const c = db.exec(`SELECT COUNT(*) FROM "${t}"`);
        rows = Number(c[0]?.values[0]?.[0] ?? 0);
      } catch { rows = 0; }
      tables.push({ name: t, rows });
      rowCount += rows;
    }
    return { tableCount: names.length, rowCount, tables };
  } finally {
    if (owned && db) { try { db.close(); } catch { /* silencioso */ } }
  }
}

export async function listTablesActive(): Promise<TableInfo[]> {
  const engine = await ensureActiveEngine();
  return listTables(engine);
}

/** Lista as tabelas de um motor específico. */
export async function listTables(engine: Database): Promise<TableInfo[]> {
  const res = engine.exec(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
  );
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    name: String(row[0]),
    sql: row[1] ? String(row[1]) : null,
  }));
}

/** Converte um valor SqlValue para formas seguras de serialização JSON. */
function toJs(v: SqlValue): unknown {
  if (v instanceof Uint8Array) {
    try {
      return new TextDecoder().decode(v);
    } catch {
      return Array.from(v);
    }
  }
  return v;
}

/** Converte um resultado bruto do sql.js em objeto tabular. */
function resultToObject(
  columns: string[],
  values: SqlValue[][],
  message: string
): QueryResult {
  const rows: Record<string, unknown>[] = values.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = toJs(row[i]);
    });
    return obj;
  });
  return { columns, rows, isSelect: true, message };
}

/**
 * Divide um script SQL em comandos individuais, ignorando `;` dentro de
 * strings literais e comentários.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  const tokens = sql.split("");
  for (let i = 0; i < tokens.length; i++) {
    const ch = tokens[i];
    const next = tokens[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        current += "\n";
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        current += "*/";
        i++;
      }
      continue;
    }
    if (inSingle) {
      current += ch;
      if (ch === "'") {
        if (next === "'") {
          current += next;
          i++;
        } else {
          inSingle = false;
        }
      }
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === '"') {
        if (next === '"') {
          current += next;
          i++;
        } else {
          inDouble = false;
        }
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      inLineComment = true;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      current += "/*";
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      continue;
    }
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);

  return statements.filter(Boolean);
}

/** Identifica a primeira palavra-chave de um comando (para rotular no log). */
function firstKeyword(sql: string): string {
  const m = sql.replace(/^--.*$/gm, "").match(/^\s*([a-z]+)/i);
  return m ? m[1].toUpperCase() : "SQL";
}

const WRITE_KEYWORDS = new Set([
  "CREATE",
  "INSERT",
  "UPDATE",
  "DELETE",
  "ALTER",
  "DROP",
  "REPLACE",
]);

/** Define se um comando bem-sucedido deve virar entrada de histórico. */
function shouldRecordHistory(keyword: string, stmt: string): boolean {
  if (!WRITE_KEYWORDS.has(keyword)) return false;
  // DROP DATABASE exclui o banco inteiro; não faz sentido registrar no ativo.
  if (keyword === "DROP" && /^DROP\s+DATABASE/i.test(stmt)) return false;
  return true;
}

function sanitizeName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Executa um comando SQL real no motor ativo (CREATE TABLE, INSERT, SELECT…).
 * `engine` é omitido para usar o banco ativo atual.
 *
 * Instrumentação (base do /perfil):
 * - normaliza o dialeto do motor do banco (MySQL/Postgres → SQLite);
 * - traduz sintaxe Mongo (`db.col.find`) para SQL equivalente;
 * - mede `durationMs` e grava TODA execução no log global com status.
 */
export async function executeSql(
  sql: string,
  engine?: Database
): Promise<QueryResult> {
  const useDb = engine ?? (await ensureActiveEngine());
  const dbName = registry.activeDatabase ?? "—";
  const eng = dbName !== "—" ? getDatabaseEngine(dbName) : "postgres";
  // Mongo: tenta traduzir antes de normalizar.
  const mongoTranslated =
    eng === "mongodb" ? translateMongoToSql(sql) : null;
  const normalized = normalizeDialect(mongoTranslated ?? sql, eng);
  const started = performance.now();
  const beforeRows = useDb.getRowsModified();
  let lastResult: QueryResult | null = null;

  const finish = async (
    r: QueryResult | null,
    success: boolean,
    message: string
  ): Promise<QueryResult> => {
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    bumpQueryStats();
    void appendGlobalQueryLog({
      timestamp: Date.now(),
      database: dbName,
      query: sql,
      command: mongoTranslated ? "FIND" : firstKeyword(normalized),
      success,
      message,
      durationMs,
      engine: eng,
    });
    if (!r) {
      return {
        columns: [],
        rows: [],
        isSelect: false,
        affected: 0,
        message,
      };
    }
    return r;
  };

  try {
    const results = useDb.exec(normalized);
    if (results.length > 0) {
      const last = results[results.length - 1];
      lastResult = resultToObject(
        last.columns,
        last.values,
        `${last.values.length} linha(s) retornada(s)`
      );
    }

    if (lastResult) {
      saveActive();
      return finish(lastResult, true, lastResult.message);
    }

    const affected = useDb.getRowsModified() - beforeRows;
    saveActive();
    return finish(
      {
        columns: [],
        rows: [],
        isSelect: false,
        affected,
        message: `${affected} linha(s) afetada(s)`,
      },
      true,
      `${affected} linha(s) afetada(s)`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const friendly = friendlyError(normalized, msg);
    await finish(null, false, friendly);
    throw new Error(friendly);
  }
}

/** Incrementa contadores de queries/tabelas do usuário corrente. */
function bumpQueryStats(byTables = 0): void {
  if (!registry.stats) {
    registry.stats = {
      totalQueries: 0,
      totalTablesCreated: 0,
      totalDatabasesCreated: registry.databases.length,
    };
  }
  registry.stats.totalQueries += 1;
  if (byTables > 0) registry.stats.totalTablesCreated += byTables;
  void persistRegistry(registry);
}

interface StatementOutcome {
  index: number;
  sql: string;
  keyword: string;
  success: boolean;
  message: string;
  result?: QueryResult;
}

/**
 * Processa um script SQL completo, interpretando comandos de gerenciamento
 * (CREATE DATABASE, USE, DROP DATABASE, SHOW DATABASES, SHOW TABLES) e
 * enviando os demais comandos ao motor SQLite do banco ativo.
 *
 * @param stopOnError se true, interrompe no primeiro erro (padrão).
 */
export async function parseAndExecuteScript(
  sqlText: string,
  options: { stopOnError?: boolean } = {}
): Promise<QueryScriptResult> {
  const stopOnError = options.stopOnError ?? true;
  const statements = splitStatements(sqlText);
  const outcomes: StatementOutcome[] = [];
  let error: string | null = null;

  if (statements.length === 0) {
    return { statements: [], log: [], error: null, final: null };
  }

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const keyword = firstKeyword(stmt);
    const base: StatementOutcome = {
      index: i + 1,
      sql: stmt,
      keyword,
      success: false,
      message: "",
    };

    try {
      // ----- Comandos de gerenciamento (tratados pela aplicação) -----
      if (keyword === "CREATE") {
        await applyCreate(stmt, base);
      } else if (keyword === "USE") {
        await applySwitch(stmt, base);
      } else if (keyword === "DROP") {
        await applyDrop(stmt, base);
      } else if (keyword === "SHOW") {
        await applyShow(stmt, base);
      } else {
        // ----- Comando SQL real -----
        const result = await executeSql(stmt);
        base.message = describeSqlResult(stmt, result);
        base.result = result;
        base.success = true;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      base.message = friendlyError(stmt, msg);
      base.success = false;
      outcomes.push(base);
      if (stopOnError) {
        error = base.message;
        break;
      }
      continue;
    }

    outcomes.push(base);
    // Auditória implícita: query de escrita bem-sucedida vira histórico.
    if (base.success && shouldRecordHistory(keyword, stmt)) {
      recordDatabaseActivity(registry.activeDatabase, keyword, stmt);
    }
  }

  const log = outcomes.map(
    (o) => `${o.success ? "✅" : "❌"} #${o.index} ${o.keyword}: ${o.message}`
  );

  const selectResults = outcomes
    .map((o) => o.result)
    .filter((r): r is QueryResult => !!r && r.isSelect);

  return {
    statements: outcomes,
    log,
    error: error ?? (outcomes.some((o) => !o.success) ? "Script finalizado com erros." : null),
    final: selectResults.length > 0 ? selectResults[selectResults.length - 1] : null,
  };
}

async function applyCreate(stmt: string, base: StatementOutcome): Promise<void> {
  const m = stmt.match(/^CREATE\s+DATABASE\s+(IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/i);
  if (m) {
    const ifNotExists = !!m[1];
    const name = sanitizeName(m[2]);
    const existed = listDatabases().includes(name);
    if (existed) {
      if (!ifNotExists) {
        throw new Error(`Banco "${name}" já existe.`);
      }
      await switchActiveDatabase(name);
      base.message = `Banco "${name}" já existia (mantido como ativo).`;
      base.success = true;
      return;
    }
    await createDatabase(name);
    base.message = `Banco "${name}" criado e selecionado.`;
    base.success = true;
    return;
  }
  const r = await executeSql(stmt);
  base.message = describeSqlResult(stmt, r);
  base.result = r;
  base.success = true;
}

async function applySwitch(stmt: string, base: StatementOutcome): Promise<void> {
  const m = stmt.match(/^USE\s+([a-zA-Z0-9_]+)/i);
  if (!m) {
    throw new Error("Comando USE mal formado.");
  }
  const name = sanitizeName(m[1]);
  if (!listDatabases().includes(name)) {
    throw new Error(
      `Banco "${name}" não encontrado. Use CREATE DATABASE para criá-lo.`
    );
  }
  await switchActiveDatabase(name);
  base.message = `Usando banco "${name}".`;
  base.success = true;
}

async function applyDrop(stmt: string, base: StatementOutcome): Promise<void> {
  const m = stmt.match(/^DROP\s+DATABASE\s+(IF\s+EXISTS\s+)?([a-zA-Z0-9_]+)/i);
  if (!m) {
    const r = await executeSql(stmt);
    base.message = describeSqlResult(stmt, r);
    base.result = r;
    base.success = true;
    return;
  }
  const name = sanitizeName(m[2]);
  const existed = listDatabases().includes(name);
  if (!existed && !m[1]) {
    throw new Error(`Banco "${name}" não encontrado.`);
  }
  await dropDatabase(name);
  base.message = existed
    ? `Banco "${name}" removido.`
    : `Banco "${name}" não existia (nada a remover).`;
  base.success = true;
}

async function applyShow(stmt: string, base: StatementOutcome): Promise<void> {
  const kind = stmt.match(/^SHOW\s+(DATABASES|TABLES|DATABASE(?:\s+\w+)?)/i);
  const kw = kind ? kind[1].toUpperCase() : "";
  if (kw.includes("DATABASES")) {
    const names = listDatabases();
    base.result = resultToObject(
      ["Database"],
      names.map((n) => [n]),
      `${names.length} banco(s)`
    );
    base.message = `${names.length} banco(s) listado(s).`;
    base.success = true;
    return;
  }
  if (kw.includes("TABLES")) {
    const tables = await listTablesActive();
    base.result = resultToObject(
      ["Tables_in_" + registry.activeDatabase],
      tables.map((t) => [t.name]),
      `${tables.length} tabela(s)`
    );
    base.message = `${tables.length} tabela(s) listada(s).`;
    base.success = true;
    return;
  }
  const r = await executeSql(stmt);
  base.message = describeSqlResult(stmt, r);
  base.result = r;
  base.success = true;
}

function describeSqlResult(stmt: string, r: QueryResult): string {
  const kw = firstKeyword(stmt);
  if (r.isSelect) return `${r.rows.length} linha(s) retornada(s)`;
  if (kw === "INSERT") return `${r.affected ?? 0} linha(s) inserida(s)`;
  if (kw === "UPDATE") return `${r.affected ?? 0} linha(s) atualizada(s)`;
  if (kw === "DELETE") return `${r.affected ?? 0} linha(s) removida(s)`;
  return r.affected != null
    ? `${r.affected} linha(s) afetada(s)`
    : `Executado com sucesso.`;
}

/** Converte erros de FOREIGN KEY em mensagens amigáveis. */
function friendlyError(stmt: string, msg: string): string {
  const m = /FOREIGN KEY constraint failed/i.test(msg);
  if (m) {
    const ref = stmt.match(/FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\w+)\s*\(([^)]+)\)/i);
    if (ref) {
      return `Não é possível inserir: o ${ref[1].trim()} não existe na tabela ${ref[2]}.`;
    }
    return "Violação de FOREIGN KEY: o valor referenciado não existe na tabela relacionada.";
  }
  const notFound = msg.includes("no such table");
  if (notFound) {
    const t = stmt.match(/FROM\s+(\w+)|\binto\s+(\w+)|\bTABLE\s+(\w+)/i);
    const name = t ? t[1] || t[2] || t[3] : "";
    return name
      ? `Tabela "${name}" não existe no banco ativo. (${msg})`
      : `Tabela não encontrada. (${msg})`;
  }
  return msg;
}
