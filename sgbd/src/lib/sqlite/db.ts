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
  recordDatabaseActivity,
  getActiveDatabase,
} from "@/lib/database-manager";
import type {
  TableInfo,
  TableSchema,
  ColumnInfo,
  QueryResult,
  QueryScriptResult,
  ImportReport,
} from "./types";
import type { Completion } from "@codemirror/autocomplete";
import type { SQLNamespace } from "@codemirror/lang-sql";

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
  inspectDatabase,
  recordDatabaseActivity,
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

/**
 * Retorna o schema no formato usado pelo autocomplete SQL do CodeMirror.
 * A leitura é feita diretamente no motor ativo a cada chamada para que
 * CREATE/ALTER/importações e trocas de banco sejam refletidos imediatamente.
 */
export async function getSchemaCompletions(
  dbName: string
): Promise<SQLNamespace> {
  if (getActiveDatabase() !== dbName) {
    return {};
  }

  const engine = await ensureActiveEngine();
  const schema: Record<string, SQLNamespace> = {};
  const tables = await listTables(engine);

  for (const table of tables) {
    const tableSchema = await getTableSchema(table.name, engine);
    const columns: Completion[] = tableSchema.columns.map((column) => ({
      label: column.name,
      type: "property",
      detail: column.type || "TEXT",
    }));
    schema[table.name] = {
      self: {
        label: table.name,
        type: "class",
        detail: "tabela",
      },
      children: columns,
    };
  }

  return schema;
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

/** Tipo com a definição de uma chave estrangeira de uma tabela. */
export interface ForeignKeyInfo {
  table: string;
  from: string;
  to: string;
}

/** Lista as FKs declaradas de uma tabela (PRAGMA foreign_key_list). */
export async function getForeignKeys(
  table: string,
  engine?: Database
): Promise<ForeignKeyInfo[]> {
  const useDb = engine ?? (await ensureActiveEngine());
  const res = useDb.exec(`PRAGMA foreign_key_list("${table}")`);
  if (res.length === 0) return [];
  const idx: Record<string, number> = {};
  res[0].columns.forEach((c, i) => {
    idx[c] = i;
  });
  return res[0].values.map((v) => ({
    table: String(v[idx["table"]]),
    from: String(v[idx["from"]]),
    to: String(v[idx["to"]] ?? ""),
  }));
}

/**
 * Busca dados editáveis de uma tabela: inclui a coluna `__rowid__` para que
 * edições possam ser persistidas com UPDATE.
 */
export async function getEditableTableData(
  table: string,
  limit = 500,
  engine?: Database
): Promise<QueryResult> {
  const useDb = engine ?? (await ensureActiveEngine());
  const res = useDb.exec(
    `SELECT rowid AS __rowid__, * FROM "${table}" LIMIT ${limit};`
  );
  if (res.length === 0) {
    return { columns: [], rows: [], isSelect: true, message: "Tabela vazia." };
  }
  return resultToObject(res[0].columns, res[0].values, "");
}

/**
 * Aplica uma correção de célula na tabela do banco ativo via UPDATE e registra
 * a atividade no histórico. Retorna o número de linhas afetadas.
 */
export async function updateTableCell(
  table: string,
  rowid: number,
  column: string,
  value: string
): Promise<number> {
  const engine = await ensureActiveEngine();
  const schema = await getTableSchema(table, engine);
  const col = schema.columns.find((c) => c.name === column);
  const bound: SqlValue = value === "" ? null : coerceByType(col, value);

  engine.exec(`UPDATE "${table}" SET "${column}" = ? WHERE rowid = ${rowid};`, [
    bound,
  ]);
  const affected = engine.getRowsModified();
  save();

  const literal = bound === null ? "NULL" : literalOf(value, col);
  const stmt = `UPDATE "${table}" SET "${column}" = ${literal} WHERE rowid = ${rowid};`;
  recordDatabaseActivity(getActiveDatabase(), "UPDATE", stmt);
  return affected;
}

function coerceByType(
  col: ColumnInfo | undefined,
  value: string
): number | string {
  const t = (col?.type ?? "TEXT").toUpperCase();
  if (t.includes("INT")) {
    const n = Number(value);
    return Number.isNaN(n) ? value : Math.trunc(n);
  }
  if (t.includes("REAL") || t.includes("DOU") || t.includes("FLOA")) {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  return value;
}

function literalOf(value: string, col: ColumnInfo | undefined): string {
  const t = (col?.type ?? "TEXT").toUpperCase();
  if (t.includes("INT") || t.includes("REAL") || t.includes("DOU") || t.includes("FLOA")) {
    const n = Number(value);
    if (!Number.isNaN(n)) return String(n);
  }
  return sqlLiteral(value);
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

/** Renderiza uma célula do CSV como literal SQL conforme o tipo da coluna. */
function csvCellLiteral(type: string, v: string | null): string {
  if (v == null || v === "") return "NULL";
  if (type === "INTEGER") {
    const n = Number(v);
    return Number.isInteger(n) ? String(n) : sqlLiteral(v);
  }
  if (type === "REAL") {
    const n = Number(v);
    return Number.isNaN(n) ? sqlLiteral(v) : String(n);
  }
  return sqlLiteral(v);
}

/** Monta o dump de uma importação CSV (CREATE TABLE + INSERTs). */
export function buildCsvSql(
  tableName: string,
  columns: string[],
  rows: (string | null)[][],
  types: string[]
): string {
  const cols = columns.map((c) => `"${c}"`).join(", ");
  const parts: string[] = [];
  parts.push(
    `CREATE TABLE "${tableName}" (${columns
      .map((c, i) => `"${c}" ${types[i]}`)
      .join(", ")});`
  );
  for (let r = 0; r < rows.length; r++) {
    const values = columns
      .map((_, ci) => csvCellLiteral(types[ci], rows[r][ci] ?? null))
      .join(", ");
    parts.push(`INSERT INTO "${tableName}" (${cols}) VALUES (${values});`);
  }
  return parts.join("\n");
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

  const code = buildCsvSql(cleanName, uniqueCols, parsed.rows, types);
  recordDatabaseActivity(getActiveDatabase(), "IMPORT", code);

  return {
    tableName: cleanName,
    tableCount: 1,
    rowCount: inserted,
    log,
    errors,
    code,
  };
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
    code: sql,
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
