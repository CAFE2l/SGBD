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
import type {
  TableInfo,
  QueryResult,
  QueryScriptResult,
} from "./sqlite/types";

const DEFAULT_DB_NAME = "meu_banco";

let SQL: SqlJsStatic | null = null;
let initPromise: Promise<SqlJsStatic> | null = null;

/** Registro em memória; espelho do que está persistido. */
let registry: DatabaseRegistry = { databases: [], activeDatabase: null };

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
 */
export async function initManager(): Promise<void> {
  if (registry.databases.length > 0) return;
  const persisted = (await loadRegistry()) ?? {
    databases: [],
    activeDatabase: null,
  };
  registry = persisted;

  if (registry.databases.length === 0) {
    const migrated = await migrateLegacyDatabase(DEFAULT_DB_NAME);
    if (migrated) {
      registry.databases = [migrated];
      registry.activeDatabase = migrated;
    }
  }

  if (registry.databases.length === 0) {
    await createDatabase(DEFAULT_DB_NAME);
  }
  if (!registry.activeDatabase && registry.databases.length > 0) {
    registry.activeDatabase = registry.databases[0];
  }
  await persistRegistry(registry);
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
export async function createDatabase(name: string): Promise<void> {
  await initManager();
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
  await persistRegistry(registry);
  void persistDatabaseBytes(clean, db.export());
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

/** Lista as tabelas do banco ativo. */
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

function sanitizeName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Executa um comando SQL real no motor ativo (CREATE TABLE, INSERT, SELECT…).
 * `engine` é omitido para usar o banco ativo atual.
 */
export async function executeSql(
  sql: string,
  engine?: Database
): Promise<QueryResult> {
  const useDb = engine ?? (await ensureActiveEngine());
  const beforeRows = useDb.getRowsModified();
  let lastResult: QueryResult | null = null;

  const results = useDb.exec(sql);
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
    return lastResult;
  }

  const affected = useDb.getRowsModified() - beforeRows;
  saveActive();
  return {
    columns: [],
    rows: [],
    isSelect: false,
    affected,
    message: `${affected} linha(s) afetada(s)`,
  };
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
    const name = sanitizeName(m[2]);
    const existed = listDatabases().includes(name);
    await createDatabase(name);
    base.message = existed
      ? `Banco "${name}" já existia (mantido como ativo).`
      : `Banco "${name}" criado e selecionado.`;
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
