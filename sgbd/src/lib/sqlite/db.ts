import type {
  Database,
  SqlValue,
} from "sql.js";
import {
  ensureActiveEngine,
  saveActive,
  executeSql,
  parseAndExecuteScript,
  initManager as managerInit,
  listTables as listTablesWithEngine,
} from "@/lib/database-manager";
import type {
  TableInfo,
  TableSchema,
  ColumnInfo,
  QueryResult,
  QueryScriptResult,
  ImportReport,
} from "./types";

/**
 * Facade sobre o database-manager, preservando a API usada pelas páginas
 * (Importar/Exportar/Console) e adicionando suporte a múltiplos bancos.
 */

export { splitStatements } from "@/lib/database-manager";
export {
  listDatabases,
  getActiveDatabase,
  createDatabase,
  dropDatabase,
  switchActiveDatabase,
  parseAndExecuteScript,
  initManager,
} from "@/lib/database-manager";

/** Persiste o estado atual do banco ativo (autosave). */
export function save(): void {
  saveActive();
}

/** Re-executa um script completo com suporte a CREATE DATABASE/USE/etc. */
export async function runScript(
  sqlText: string,
  options?: { stopOnError?: boolean }
): Promise<QueryScriptResult> {
  return parseAndExecuteScript(sqlText, options);
}

/** Executa uma ou mais consultas SQL no banco ativo. Retorna o último SELECT. */
export async function runQuery(sql: string): Promise<QueryResult> {
  const statements = await import("@/lib/database-manager").then((m) =>
    m.splitStatements(sql)
  );
  if (statements.length === 0) {
    throw new Error("Nenhum comando SQL encontrado.");
  }
  return executeSql(sql);
}

/** Lista as tabelas do banco ativo. */
export async function listTables(engine?: Database): Promise<TableInfo[]> {
  if (engine) return listTablesWithEngine(engine);
  return listTablesWithEngine(await ensureActiveEngine());
}

export async function tableRowCount(
  engine: Database,
  table: string
): Promise<number> {
  try {
    const res = engine.exec(`SELECT COUNT(*) FROM "${table}"`);
    return Number(res[0]?.values[0]?.[0] ?? 0);
  } catch {
    return 0;
  }
}

/** Conta linhas de uma tabela pelo nome (usa o banco ativo). */
export async function countTable(table: string): Promise<number> {
  const engine = await ensureActiveEngine();
  return tableRowCount(engine, table);
}

/** Retorna o schema (colunas + tipos) de uma tabela. */
export async function getTableSchema(
  table: string,
  engine?: Database
): Promise<TableSchema> {
  const useDb = engine ?? (await ensureActiveEngine());
  const pr = useDb.prepare(`PRAGMA table_info("${table}")`);
  const columns: ColumnInfo[] = [];
  while (pr.step()) {
    const r = pr.getAsObject();
    columns.push({
      cid: Number(r.cid),
      name: String(r.name),
      type: r.type ? String(r.type) : "",
      notnull: Number(r.notnull),
      dflt_value: r.dflt_value == null ? null : String(r.dflt_value),
      pk: Number(r.pk),
    });
  }
  pr.free();

  const tables = await listTables(useDb);
  const t = tables.find((x) => x.name === table);
  return { name: table, sql: t?.sql ?? null, columns };
}

/** Busca dados de uma tabela com limite. */
export async function getTableData(
  table: string,
  limit = 1000,
  engine?: Database
): Promise<QueryResult> {
  const useDb = engine ?? (await ensureActiveEngine());
  const res = useDb.exec(`SELECT * FROM "${table}" LIMIT ${limit};`);
  if (res.length === 0) {
    return { columns: [], rows: [], isSelect: true, message: "Tabela vazia." };
  }
  return resultToObject(res[0].columns, res[0].values, "");
}

/** Converte um resultado bruto do sql.js em objeto tabular. */
export function resultToObject(
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

function inferType(values: (string | null)[]): string {
  let allNull = true;
  let allNumeric = true;
  let allInt = true;

  for (const v of values) {
    if (v == null || v === "") continue;
    allNull = false;
    const num = Number(v);
    if (v.trim() !== "" && Number.isNaN(num)) allNumeric = false;
    if (num % 1 !== 0) allInt = false;
  }

  if (allNull) return "TEXT";
  if (allNumeric && allInt) return "INTEGER";
  if (allNumeric) return "REAL";
  return "TEXT";
}

function sqlLiteral(v: string | null): string {
  if (v == null) return "NULL";
  return "'" + v.replace(/'/g, "''") + "'";
}

/** Importa um arquivo CSV já parseado como tabela nomeada no banco ativo. */
export async function importCsv(
  parsed: { columns: string[]; rows: (string | null)[][] },
  tableName: string,
  explicitTypes?: string[]
): Promise<ImportReport> {
  const engine = await ensureActiveEngine();
  const log: string[] = [];
  const errors: string[] = [];

  const cleanName = tableName.trim().replace(/[^a-zA-Z0-9_]/g, "_");
  if (!cleanName) throw new Error("Nome de tabela inválido.");

  const columns = parsed.columns.map(
    (c) =>
      c.trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "col"
  );
  const seen = new Set<string>();
  const uniqueCols = columns.map((c) => {
    let name = c;
    let i = 1;
    while (seen.has(name.toLowerCase())) {
      name = `${c}_${i++}`;
    }
    seen.add(name.toLowerCase());
    return name;
  });

  const existing = await listTables(engine);
  if (existing.some((t) => t.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error(
      `A tabela "${cleanName}" já existe. Use Resetar banco ou escolha outro nome.`
    );
  }

  const types = uniqueCols.map((_, ci) => {
    const provided = explicitTypes?.[ci]?.toUpperCase();
    if (provided === "INTEGER" || provided === "REAL" || provided === "TEXT") {
      return provided;
    }
    const values = parsed.rows.map((r) => r[ci] ?? null);
    return inferType(values);
  });

  const createSql = `CREATE TABLE "${cleanName}" (${uniqueCols
    .map((c, i) => `"${c}" ${types[i]}`)
    .join(", ")});`;
  engine.exec(createSql);
  log.push(`Tabela "${cleanName}" criada (${uniqueCols.join(", ")}).`);

  const insertStmt = `INSERT INTO "${cleanName}" (${uniqueCols
    .map((c) => `"${c}"`)
    .join(", ")}) VALUES (${uniqueCols.map(() => "?").join(", ")});`;
  const stmt = engine.prepare(insertStmt);
  let inserted = 0;
  for (const row of parsed.rows) {
    try {
      const bound = uniqueCols.map((_, ci) => {
        const raw = row[ci];
        if (raw == null || raw === "") return null;
        const type = types[ci];
        if (type === "INTEGER") {
          const n = Number(raw);
          return Number.isInteger(n) ? n : raw;
        }
        if (type === "REAL") {
          const n = Number(raw);
          return Number.isNaN(n) ? raw : n;
        }
        return raw;
      });
      stmt.run(bound);
      inserted++;
    } catch (e) {
      errors.push(`Linha ${inserted + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  stmt.free();

  save();
  log.push(`${inserted} linha(s) inserida(s).`);
  if (errors.length) log.push(`${errors.length} erro(s) ignorado(s).`);

  return { tableName: cleanName, tableCount: 1, rowCount: inserted, log, errors };
}

/** Importa um script SQL com suporte a CREATE DATABASE/USE, no banco ativo. */
export async function importSql(sql: string): Promise<ImportReport> {
  const log: string[] = [];
  const errors: string[] = [];
  const res = await parseAndExecuteScript(sql, { stopOnError: false });
  for (const s of res.statements) {
    if (s.success) log.push(`#${s.index} ${s.keyword}: ${s.message}`);
    else errors.push(`#${s.index} ${s.keyword}: ${s.message}`);
  }
  const engine = await ensureActiveEngine();
  const tables = await listTables(engine);
  return {
    tableName: tables.map((t) => t.name).join(", "),
    tableCount: tables.length,
    rowCount: tables.length,
    log,
    errors,
  };
}

/** Inicializa o banco (motor + restauração do persistido). Retorna tabelas. */
export async function initDatabase(): Promise<TableInfo[]> {
  await managerInit();
  return listTables();
}

/** Exporta o banco ativo inteiro como dump SQL (CREATE + INSERT). */
export async function exportSql(): Promise<string> {
  const engine = await ensureActiveEngine();
  const tables = await listTables(engine);
  const parts: string[] = [];
  parts.push("-- Dump gerado pelo SGBD Web Educacional");
  parts.push("PRAGMA foreign_keys=OFF;");
  parts.push("BEGIN TRANSACTION;");
  parts.push("");

  for (const t of tables) {
    const schema = await getTableSchema(t.name, engine);
    const create = schema.sql ?? t.sql ?? `CREATE TABLE "${t.name}";`;
    parts.push(create);
    parts.push("");
    const data = await getTableData(t.name, Number.MAX_SAFE_INTEGER, engine);
    if (data.rows.length > 0) {
      const cols = data.columns.map((c) => `"${c}"`).join(", ");
      for (const row of data.rows) {
        const values = data.columns
          .map((c) => {
            const v = row[c];
            if (v == null) return "NULL";
            if (typeof v === "number") return String(v);
            return sqlLiteral(String(v));
          })
          .join(", ");
        parts.push(`INSERT INTO "${t.name}" (${cols}) VALUES (${values});`);
      }
      parts.push("");
    }
  }
  parts.push("COMMIT;");
  return parts.join("\n");
}

/** Exporta uma tabela como CSV (do banco ativo). */
export async function exportTableCsv(table: string): Promise<string> {
  const data = await getTableData(table, Number.MAX_SAFE_INTEGER);
  const esc = (v: unknown): string => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const header = data.columns.map(esc).join(",");
  const lines = data.rows.map((r) => data.columns.map((c) => esc(r[c])).join(","));
  return [header, ...lines].join("\n");
}

/**
 * Zera o banco ativo: apaga e recria uma instância vazia com o mesmo nome,
 * mantendo o registro de bancos inalterado.
 */
export async function resetDatabase(): Promise<void> {
  const src = await import("@/lib/database-manager");
  const name = src.getActiveDatabase() ?? "meu_banco";
  await src.dropDatabase(name).catch(() => undefined);
  // dropDatabase recria o banco padrão se for o único; para manter o nome
  // original, recria explicitamente e o seleciona.
  if (!src.listDatabases().includes(name)) {
    await src.createDatabase(name);
  }
  await src.switchActiveDatabase(name).catch(() => undefined);
}
