import type {
  Database,
  SqlValue,
} from "sql.js";
import {
  ensureActiveEngine,
  saveActive,
  executeSql,
  parseAndExecuteScript,
  splitStatements as splitSqlStatements,
  initManager as managerInit,
  listTables as listTablesWithEngine,
  recordDatabaseActivity,
  getActiveDatabase,
  listDatabases,
  resetActiveDatabase,
} from "@/lib/database-manager";
import type {
  TableInfo,
  TableSchema,
  ColumnInfo,
  QueryResult,
  QueryScriptResult,
  ImportReport,
  SqlSuggestion,
} from "./types";
import { suggestSqlFix } from "./sql-fixes";
import { recordLearningFixed } from "./fix-learning";
import { truncateSql, formatTruncatedMeta } from "./sql-truncate";
import type { SQLNamespace } from "@codemirror/lang-sql";
import { getHistory } from "./history";
import {
  emptyCatalog,
  extractCreatedNames,
  mergeCreated,
  type CompletionCatalog,
} from "./completions";

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
  renameDatabase,
  duplicateDatabase,
  exportDatabaseSql,
  describeDatabase,
  getDatabaseEngine,
  setDatabaseEngine,
  getProfileStats,
  resetActiveDatabase,
  reloadManagerForScope,
  resetManagerCache,
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
  if (!getActiveDatabase()) return [];
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
  const tables = (await listTables(engine)).slice().sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const table of tables) {
    const tableSchema = await getTableSchema(table.name, engine);
    const columns = tableSchema.columns
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((column) => ({
        label: column.name,
        type: "property" as const,
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

const MAX_DISTINCT_PER_COLUMN = 12;
const MAX_ITEM_VALUE_LEN = 80;

/**
 * Catálogo usado pelo autocomplete: tabelas, colunas, itens distintos,
 * bancos e nomes recém-criados (histórico) para ranquear sugestões.
 */
export async function getCompletionCatalog(
  dbName: string
): Promise<CompletionCatalog> {
  const databases = listDatabases();
  const catalog: CompletionCatalog = {
    ...emptyCatalog(),
    databases,
  };

  try {
    const history = await getHistory(dbName);
    catalog.created = mergeCreated(
      history.slice(0, 80).map((entry) => extractCreatedNames(entry.query))
    );
  } catch {
    // histórico é opcional para o autocomplete
  }

  if (getActiveDatabase() !== dbName) {
    return catalog;
  }

  const engine = await ensureActiveEngine();
  const tables = await listTables(engine);
  catalog.tables = tables.map((t) => t.name);

  for (const table of tables) {
    const tableSchema = await getTableSchema(table.name, engine);
    for (const column of tableSchema.columns) {
      catalog.columns.push({
        name: column.name,
        table: table.name,
        type: column.type || "TEXT",
      });
      const type = (column.type || "").toUpperCase();
      if (type.includes("BLOB")) continue;
      try {
        const quotedTable = `"${table.name.replace(/"/g, '""')}"`;
        const quotedCol = `"${column.name.replace(/"/g, '""')}"`;
        const res = engine.exec(
          `SELECT DISTINCT ${quotedCol} FROM ${quotedTable} WHERE ${quotedCol} IS NOT NULL LIMIT ${MAX_DISTINCT_PER_COLUMN}`
        );
        const values = res[0]?.values ?? [];
        for (const row of values) {
          const raw = row[0];
          if (raw == null) continue;
          const value = String(raw);
          if (!value || value.length > MAX_ITEM_VALUE_LEN) continue;
          catalog.items.push({
            value,
            table: table.name,
            column: column.name,
          });
        }
      } catch {
        // coluna não consultável (expressão gerada, etc.)
      }
    }
  }

  return catalog;
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

/** Busca dados de uma tabela com limite. Colunas de tipo booleano (BOOLEAN/BOOL,
 *  ex: vindas de `bit(1)` corrigido) são expostas como true/false reais. */
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
  const booleanCols = booleanColumnsOf(useDb, table);
  const result = resultToObject(res[0].columns, res[0].values, "");
  if (booleanCols.size > 0) {
    result.rows = result.rows.map((row) => {
      const obj: Record<string, unknown> = { ...row };
      for (const col of booleanCols) {
        const v = obj[col];
        if (v === 0 || v === 1) obj[col] = Boolean(v);
      }
      return obj;
    });
  }
  return result;
}

/** Nomes das colunas declaradas BOOLEAN/BOOL (em maiúsculas). */
function booleanColumnsOf(engine: Database, table: string): Set<string> {
  const cols = new Set<string>();
  try {
    const pr = engine.prepare(`PRAGMA table_info("${table}")`);
    while (pr.step()) {
      const r = pr.getAsObject();
      const type = r.type ? String(r.type).toUpperCase() : "";
      if (type === "BOOLEAN" || type === "BOOL") cols.add(String(r.name));
    }
    pr.free();
  } catch {
    // vista/expressão ilegível — segue sem conversão
  }
  return cols;
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

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function unquoteIdent(ident: string): string {
  return ident.replace(/^["`[\]]+|["`\]]+$/g, "");
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inSingle) {
      current += ch;
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === '"') inDouble = false;
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
    if (ch === "(") {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ")") {
      depth--;
      current += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function firstIdent(seg: string): string | null {
  const m = seg.match(
    /^\s*(".+?"|`.+?`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*/
  );
  return m ? unquoteIdent(m[1]) : null;
}

interface ParsedCreateTable {
  name: string;
  segments: string[];
}

function parseCreateTable(sql: string): ParsedCreateTable | null {
  const m = sql.match(
    /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(".+?"|`.+?`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/i
  );
  if (!m) return null;
  return {
    name: unquoteIdent(m[1]),
    segments: splitTopLevel(m[2].trim()),
  };
}

function tableFkSegMatches(
  seg: string,
  column: string,
  refTable: string,
  refColumn: string
): boolean {
  const m = seg.match(
    /^\s*(?:CONSTRAINT\s+(?:"[^"]*"|[^\s()]+)\s+)?FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+(".+?"|`.+?`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/i
  );
  if (!m) return false;
  const cols = splitTopLevel(m[1]).map(unquoteIdent);
  const refCols = splitTopLevel(m[3]).map(unquoteIdent);
  return (
    cols.length === 1 &&
    refCols.length === 1 &&
    cols[0] === column &&
    unquoteIdent(m[2]) === refTable &&
    refCols[0] === refColumn
  );
}

function inlineRefMatches(
  seg: string,
  refTable: string,
  refColumn: string
): boolean {
  const m = seg.match(
    /REFERENCES\s+(".+?"|`.+?`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?/i
  );
  if (!m) return false;
  if (unquoteIdent(m[1]) !== refTable) return false;
  if (!m[2]) return false;
  const cols = splitTopLevel(m[2]).map(unquoteIdent);
  return cols.length === 1 && cols[0] === refColumn;
}

function stripInlineRef(seg: string): string {
  const m = seg.match(/^(.*?)\s+REFERENCES\b[\s\S]*$/i);
  return (m ? m[1] : seg).trim().replace(/,\s*$/, "");
}

function createTableSqlOf(
  engine: Database,
  table: string
): string | null {
  const res = engine.exec(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=${quoteIdent(table)};`
  );
  const sql = res[0]?.values[0]?.[0];
  return typeof sql === "string" && sql ? sql : null;
}

/** Recria uma tabela aplicando `transform` no CREATE TABLE (SQLite não
 *  suporta ALTER TABLE ADD CONSTRAINT / DROP CONSTRAINT). */
function rebuildTable(
  engine: Database,
  table: string,
  transform: (segments: string[]) => string[]
): void {
  const createSql = createTableSqlOf(engine, table);
  if (!createSql) {
    throw new Error(`Não foi possível redefinir a tabela "${table}".`);
  }
  const parsed = parseCreateTable(createSql);
  if (!parsed) {
    throw new Error(`Não foi possível interpretar o CREATE TABLE de "${table}".`);
  }
  const segments = transform(parsed.segments);
  if (segments.length === 0) {
    throw new Error(`A redefinição de "${table}" resultaria em uma tabela vazia.`);
  }

  const idxRes = engine.exec(
    `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=${quoteIdent(table)} AND sql IS NOT NULL;`
  );
  const indexes: string[] = [];
  if (idxRes.length > 0) {
    for (const row of idxRes[0].values) {
      if (typeof row[0] === "string" && row[0]) indexes.push(row[0]);
    }
  }

  const tmp = `__sgbd_fk_${table}_mig`;
  const stmts = [
    "PRAGMA foreign_keys=OFF;",
    `DROP TABLE IF EXISTS ${quoteIdent(tmp)};`,
    `CREATE TABLE ${quoteIdent(tmp)} (${segments.join(", ")});`,
    `INSERT INTO ${quoteIdent(tmp)} SELECT * FROM ${quoteIdent(table)};`,
    `DROP TABLE ${quoteIdent(table)};`,
    `ALTER TABLE ${quoteIdent(tmp)} RENAME TO ${quoteIdent(table)};`,
    ...indexes,
    "PRAGMA foreign_keys=ON;",
  ];
  try {
    engine.run(stmts.join(";"));
  } catch (e) {
    try {
      engine.run("PRAGMA foreign_keys=ON;");
    } catch {
      // silencioso
    }
    throw e;
  }
}

/**
 * Cria um relacionamento FOREIGN KEY real no banco ativo. O SQL canônico
 * (ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY) é registrado no histórico;
 * o SQLite não suporta essa sintaxe, então a tabela é recriada mantendo
 * colunas, dados e índices e incorporando a constraint no CREATE TABLE.
 */
export async function addForeignKey(
  table: string,
  column: string,
  refTable: string,
  refColumn: string
): Promise<void> {
  if (!table || !column || !refTable || !refColumn) {
    throw new Error("Tabela/colunas inválidas para o relacionamento.");
  }
  const engine = await ensureActiveEngine();
  const existing = await getForeignKeys(table, engine);
  if (
    existing.some(
      (fk) => fk.from === column && fk.table === refTable && fk.to === refColumn
    )
  ) {
    throw new Error(
      `O relacionamento "${table}.${column} → ${refTable}.${refColumn}" já existe no schema real.`
    );
  }

  const stmt = `ALTER TABLE ${quoteIdent(table)} ADD CONSTRAINT ${quoteIdent(
    `fk_${table}_${column}`
  )} FOREIGN KEY (${quoteIdent(column)}) REFERENCES ${quoteIdent(
    refTable
  )} (${quoteIdent(refColumn)});`;

  try {
    engine.exec(stmt);
  } catch {
    rebuildTable(engine, table, (segments) => [
      ...segments,
      `FOREIGN KEY (${quoteIdent(column)}) REFERENCES ${quoteIdent(
        refTable
      )} (${quoteIdent(refColumn)})`,
    ]);
    const after = await getForeignKeys(table, engine);
    if (
      !after.some(
        (fk) => fk.from === column && fk.table === refTable && fk.to === refColumn
      )
    ) {
      throw new Error("Não foi possível gravar a constraint no schema real.");
    }
  }
  save();
  recordDatabaseActivity(getActiveDatabase(), "ALTER", stmt);
}

/** Remove uma FOREIGN KEY real do banco ativo (DROP CONSTRAINT no SQL canônico). */
export async function dropForeignKey(
  table: string,
  column: string,
  refTable: string,
  refColumn: string
): Promise<void> {
  if (!table || !column || !refTable || !refColumn) {
    throw new Error("Tabela/colunas inválidas para o relacionamento.");
  }
  const engine = await ensureActiveEngine();
  const original = await getForeignKeys(table, engine);
  if (
    !original.some(
      (fk) => fk.from === column && fk.table === refTable && fk.to === refColumn
    )
  ) {
    throw new Error(
      `Relacionamento "${table}.${column} → ${refTable}.${refColumn}" não encontrado no schema real.`
    );
  }

  rebuildTable(engine, table, (segments) => {
    const kept: string[] = [];
    for (const seg of segments) {
      const colName = firstIdent(seg);
      if (tableFkSegMatches(seg, column, refTable, refColumn)) continue;
      if (colName === column && inlineRefMatches(seg, refTable, refColumn)) {
        const stripped = stripInlineRef(seg);
        if (stripped) kept.push(stripped);
        continue;
      }
      kept.push(seg);
    }
    return kept;
  });

  const after = await getForeignKeys(table, engine);
  if (
    after.some(
      (fk) => fk.from === column && fk.table === refTable && fk.to === refColumn
    )
  ) {
    throw new Error("Não foi possível remover a constraint do schema real.");
  }
    save();
  const stmt = `ALTER TABLE ${quoteIdent(table)} DROP CONSTRAINT ${quoteIdent(
    `fk_${table}_${column}`
  )};`;
  recordDatabaseActivity(getActiveDatabase(), "ALTER", stmt);
}

/**
 * Define uma coluna como chave primária no schema real do banco
 * (ALTER TABLE … ADD CONSTRAINT … PRIMARY KEY). O SQLite não suporta
 * essa sintaxe, então a tabela é recriada via rebuildTable.
 *
 * Validações antes de aplicar:
 * - A coluna deve existir;
 * - Não pode já ser PK;
 * - Não pode ter valores duplicados (exceto NULL).
 */
export async function addPrimaryKey(
  table: string,
  column: string
): Promise<void> {
  if (!table || !column) {
    throw new Error("Tabela/coluna inválida para a constraint PRIMARY KEY.");
  }
  const engine = await ensureActiveEngine();
  const schema = await getTableSchema(table, engine);
  const col = schema.columns.find((c) => c.name === column);
  if (!col) {
    throw new Error(`Coluna "${column}" não encontrada na tabela "${table}".`);
  }
  if (col.pk > 0) {
    throw new Error(`A coluna "${column}" já é chave primária.`);
  }

  // Verifica duplicatas (NULLs são ignorados pelo GROUP BY)
  const dupRes = engine.exec(
    `SELECT 1 FROM ${quoteIdent(table)} WHERE ${quoteIdent(column)} IS NOT NULL GROUP BY ${quoteIdent(column)} HAVING COUNT(*) > 1 LIMIT 1;`
  );
  if (dupRes.length > 0 && dupRes[0]?.values?.length > 0) {
    throw new Error(
      `Não é possível definir "${column}" como chave primária: há valores duplicados. Remova os duplicatas antes de promover.`
    );
  }

  const stmt = `ALTER TABLE ${quoteIdent(table)} ADD CONSTRAINT ${quoteIdent(
    `pk_${table}_${column}`
  )} PRIMARY KEY (${quoteIdent(column)});`;

  try {
    engine.exec(stmt);
  } catch {
    // SQLite: recria a tabela removendo PKs existentes e aplicando a nova
    rebuildTable(engine, table, (segments) => {
      const result: string[] = [];
      for (const seg of segments) {
        // Remove inline PRIMARY KEY de qualquer coluna
        const cleaned = seg
          .replace(/\s+PRIMARY\s+KEY\b\s*(?:ASC|DESC)?\s*/gi, " ")
          .trim();
        // Pula constraints table-level PRIMARY KEY existentes
        if (
          /^\s*(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(/i.test(cleaned)
        ) {
          continue;
        }
        if (cleaned) result.push(cleaned);
      }
      result.push(`PRIMARY KEY (${quoteIdent(column)})`);
      return result;
    });

    // Verifica se a constraint foi aplicada
    const after = await getTableSchema(table, engine);
    const afterCol = after.columns.find((c) => c.name === column);
    if (!afterCol || afterCol.pk === 0) {
      throw new Error("Não foi possível aplicar a constraint PRIMARY KEY no schema real.");
    }
  }
  save();
  recordDatabaseActivity(getActiveDatabase(), "ALTER", stmt);
}

/**
 * Remove a constraint PRIMARY KEY de uma coluna no schema real do banco
 * (ALTER TABLE … DROP CONSTRAINT …). O SQLite não suporta DROP CONSTRAINT,
 * então a tabela é recriada via rebuildTable removendo a PK da coluna
 * (inline ou table-level).
 */
export async function dropPrimaryKey(
  table: string,
  column: string
): Promise<void> {
  if (!table || !column) {
    throw new Error("Tabela/coluna inválida para remover PRIMARY KEY.");
  }
  const engine = await ensureActiveEngine();
  const schema = await getTableSchema(table, engine);
  const col = schema.columns.find((c) => c.name === column);
  if (!col) {
    throw new Error(`Coluna "${column}" não encontrada na tabela "${table}".`);
  }
  if (col.pk === 0) {
    throw new Error(`A coluna "${column}" não é chave primária.`);
  }

  const stmt = `ALTER TABLE ${quoteIdent(table)} DROP CONSTRAINT ${quoteIdent(
    `pk_${table}_${column}`
  )};`;

  try {
    engine.exec(stmt);
  } catch {
    // SQLite: recria a tabela removendo a PK da coluna alvo
    rebuildTable(engine, table, (segments) => {
      const result: string[] = [];
      for (const seg of segments) {
        // Primeiro: verifica constraint table-level PRIMARY KEY
        const pkMatch = seg.match(
          /^\s*(?:CONSTRAINT\s+(\S+)\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i
        );
        if (pkMatch) {
          const pkCols = splitTopLevel(pkMatch[2]).map(unquoteIdent);
          const remaining = pkCols.filter((c) => c !== column);
          if (remaining.length === 0) {
            continue; // remove a PK inteira
          }
          const rebuilt = `PRIMARY KEY (${remaining
            .map(quoteIdent)
            .join(", ")})`;
          result.push(rebuilt);
          continue;
        }
        // Depois: remove inline PRIMARY KEY da coluna alvo
        const colName = firstIdent(seg);
        if (colName === column) {
          const cleaned = seg
            .replace(/\s+PRIMARY\s+KEY\b\s*(?:ASC|DESC)?\s*/gi, " ")
            .trim();
          if (cleaned) result.push(cleaned);
          continue;
        }
        result.push(seg.trim());
      }
      return result;
    });

    // Verifica se a PK foi removida
    const after = await getTableSchema(table, engine);
    const afterCol = after.columns.find((c) => c.name === column);
    if (afterCol && afterCol.pk > 0) {
      throw new Error("Não foi possível remover a constraint PRIMARY KEY do schema real.");
    }
  }
  save();
  recordDatabaseActivity(getActiveDatabase(), "ALTER", stmt);
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

  // Desliga foreign keys
  engine.run("PRAGMA foreign_keys = OFF;");

  try {
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
  } finally {
    engine.run("PRAGMA foreign_keys = ON;");
  }
}

/** Importa um script SQL com suporte a CREATE DATABASE/USE, no banco ativo. */
export async function importSql(sql: string): Promise<ImportReport> {
  const log: string[] = [];
  const errors: string[] = [];
  const suggestions: SqlSuggestion[] = [];

  const engine = await ensureActiveEngine();
  const preparedSql = await prepareImportedIdColumns(sql, engine);

  // Desliga foreign keys para evitar erros de ordem de inserção
  engine.run("PRAGMA foreign_keys = OFF;");

  try {
    const res = await parseAndExecuteScript(preparedSql, { stopOnError: false });
    for (const s of res.statements) {
      if (s.success) {
        log.push(`#${s.index} ${s.keyword}: ${s.message}`);
      } else {
        errors.push(`#${s.index} ${s.keyword}: ${s.message}`);
        suggestions.push(await suggestSqlFix(s.index, s.keyword, s.sql, s.message));
      }
    }

  } finally {
    // Reativa foreign keys ao final
    engine.run("PRAGMA foreign_keys = ON;");
  }

  // Detecta dependências entre comandos falhados
  const suggestionsWithDeps = detectDependencies(suggestions);

  const tables = await listTables(engine);
  
  // Calculate total row count across all tables
  let totalRowCount = 0;
  for (const t of tables) {
    try {
      const count = await countTable(t.name);
      totalRowCount += count;
    } catch {
      // Ignore errors for individual tables
    }
  }
  
  return {
    tableName: tables.map((t) => t.name).join(", "),
    tableCount: tables.length,
    rowCount: totalRowCount,
    log,
    errors,
    code: sql,
    suggestions: suggestionsWithDeps,
  };
}

/**
 * Dumps educacionais podem incluir `_id` nos INSERTs, mas omiti-lo no schema
 * (ou apontar para uma tabela antiga sem essa coluna). Harmoniza o schema
 * somente quando o próprio arquivo importa explicitamente `_id`.
 */
async function prepareImportedIdColumns(
  sql: string,
  engine: Database
): Promise<string> {
  const statements = splitSqlStatements(sql);
  const tablesNeedingId = new Set<string>();

  for (const statement of statements) {
    const insert = statement.match(
      /^\s*INSERT(?:\s+OR\s+\w+)?\s+INTO\s+(".+?"|`.+?`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*VALUES\b/i
    );
    if (!insert) continue;
    const columns = splitTopLevel(insert[2]).map((column) => unquoteIdent(column.trim()));
    if (columns.some((column) => column.toLowerCase() === "_id")) {
      tablesNeedingId.add(unquoteIdent(insert[1]));
    }
  }

  if (tablesNeedingId.size === 0) return sql;

  const tables = await listTables(engine);
  for (const name of tablesNeedingId) {
    const table = tables.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!table) continue;
    const columns = engine.exec(`PRAGMA table_info(${quoteIdent(table.name)})`);
    const hasId = columns[0]?.values.some(
      (row) => String(row[1]).toLowerCase() === "_id"
    );
    if (!hasId) {
      engine.run(`ALTER TABLE ${quoteIdent(table.name)} ADD COLUMN "_id" TEXT;`);
      saveActive();
    }
  }

  return statements
    .map((statement) => {
      const create = parseCreateTable(statement);
      if (
        !create ||
        ![...tablesNeedingId].some(
          (name) => name.toLowerCase() === create.name.toLowerCase()
        ) ||
        create.segments.some((segment) => firstIdent(segment)?.toLowerCase() === "_id")
      ) {
        return statement;
      }
      return statement.replace(/\)\s*$/, ', "_id" TEXT)');
    })
    .join(";\n");
}

/**
 * Detecta dependências entre comandos falhados: se um comando falha com
 * "no such table X" e um comando anterior falhou ao criar X, marca como dependente.
 */
function detectDependencies(suggestions: SqlSuggestion[]): SqlSuggestion[] {
  // Mapa de índice -> nome da tabela criada (quando o comando é CREATE TABLE)
  const createdTables = new Map<number, string>();

  // Primeira passagem: identifica tabelas que comandos falhados tentaram criar
  for (const s of suggestions) {
    if (s.keyword === "CREATE" && /CREATE\s+TABLE/i.test(s.original)) {
      const match = s.original.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(\w+)["`\]]?/i);
      if (match) {
        createdTables.set(s.index, match[1]);
      }
    }
  }

  // Segunda passagem: marca comandos como dependentes
  const result: SqlSuggestion[] = [];
  for (const s of suggestions) {
    // Verifica se o erro é "no such table"
    const noSuchTableMatch = s.message.match(/no such table\s*[:\s]*([^\s)]+)/i);
    if (noSuchTableMatch) {
      const missingTable = noSuchTableMatch[1].replace(/["`']/g, "");
      // Busca um comando anterior que tenta criar essa tabela
      for (const [creatorIndex, tableName] of createdTables) {
        if (creatorIndex < s.index && tableName.toLowerCase() === missingTable.toLowerCase()) {
          // Encontrou dependência
          const originalTrunc = truncateSql(s.original);
          result.push({
            ...s,
            action: "dependente",
            originalTruncated: originalTrunc.preview,
            originalMeta: formatTruncatedMeta(originalTrunc),
            dependsOn: creatorIndex,
          });
          continue;
        }
      }
    }
    // Se não marcou como dependente, mantém original
    result.push(s);
  }

  return result;
}

/**
 * Divide um INSERT multi-row em vários INSERTs menores para evitar
 * sobrecarregar o sql.js. Respeita strings literais e parênteses aninhados.
 */
export function chunkLargeInsert(sql: string, maxRows = 500): string[] {
  // Verifica se é um INSERT com VALUES múltiplos
  const insertMatch = sql.match(/^INSERT\s+INTO\s+([^\s(]+)\s*\(([^)]+)\)\s+VALUES\s+/i);
  if (!insertMatch) return [sql];

  const tableName = insertMatch[1];
  const columns = insertMatch[2];
  const valuesPart = sql.slice(insertMatch[0].length);

  // Divide os valores em linhas, respeitando strings e parênteses
  const rows: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < valuesPart.length; i++) {
    const ch = valuesPart[i];
    const next = valuesPart[i + 1];

    if (inString) {
      current += ch;
      if (ch === stringChar) {
        if (next === stringChar) {
          current += next;
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }

    if (ch === "(") {
      depth++;
      current += ch;
      continue;
    }

    if (ch === ")") {
      depth--;
      current += ch;
      if (depth === 0) {
        rows.push(current.trim());
        current = "";
        // Pula vírgula e espaço após o fechamento
        if (next === ",") {
          i++;
          // Pula espaços
          while (i + 1 < valuesPart.length && /\s/.test(valuesPart[i + 1])) {
            i++;
          }
        }
        continue;
      }
      continue;
    }

    current += ch;
  }

  // Se houver algo pendente, adiciona
  if (current.trim()) {
    rows.push(current.trim());
  }

  // Se não há múltiplas linhas, retorna original
  if (rows.length <= maxRows) return [sql];

  // Divide em chunks
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += maxRows) {
    const chunkRows = rows.slice(i, i + maxRows);
    const chunkSql = `INSERT INTO ${tableName} (${columns}) VALUES ${chunkRows.join(", ")};`;
    chunks.push(chunkSql);
  }

  return chunks;
}

/**
 * Reimporta apenas os comandos que falharam, aplicando as correções
 * selecionadas pelo usuário (recomendação: não re-executar o arquivo inteiro,
 * pois tabelas já criadas gerariam "table already exists").
 *
 * Comandos não selecionados (ou "manual") são mantidos como erros pendentes
 * na nova sugestão. Retorna um novo ImportReport espelhando o resultado.
 */
export async function importSqlWithCorrections(
  sql: string,
  suggestions: SqlSuggestion[],
  selectedIndexes: number[]
): Promise<ImportReport> {
  const log: string[] = [];
  const errors: string[] = [];
  const pending: SqlSuggestion[] = [];
  const selected = new Set(selectedIndexes);

  console.log("[importSqlWithCorrections] início", {
    comandosFalhos: suggestions.length,
    selecionados: selected.size,
  });

  const engine = await ensureActiveEngine();
  engine.run("PRAGMA foreign_keys = OFF;");

  try {
    // Primeira passagem: aplica correções (remove/fix)
    for (const suggestion of suggestions) {
      const label = `#${suggestion.index} ${suggestion.keyword}`;
      if (!selected.has(suggestion.index)) {
        console.log(`[importSqlWithCorrections] ${label}: não selecionado — mantido como pendente.`);
        errors.push(`${label}: ${suggestion.message}`);
        pending.push(suggestion);
        continue;
      }

      if (suggestion.action === "remove") {
        console.log(`[importSqlWithCorrections] ${label}: descartado (${suggestion.ruleId}).`);
        log.push(`${label}: ignorado (sugestão: ${suggestion.reason.toLowerCase()})`);
        continue;
      }

      if (suggestion.action === "fix" && suggestion.fixed) {
        console.log(`[importSqlWithCorrections] Aplicando correção da linha ${suggestion.index} (${suggestion.ruleId})…`);
        try {
          // Chunks large INSERTs
          const statementsToRun = chunkLargeInsert(suggestion.fixed);
          for (const stmt of statementsToRun) {
            await runQuery(stmt);
          }
          console.log(`[importSqlWithCorrections] ${label}: correção aplicada com sucesso.`);
          log.push(`${label}: corregido`);
          recordLearningFixed(suggestion.ruleId);
          const kw = suggestion.keyword;
          if (kw === "CREATE" || kw === "INSERT" || kw === "REPLACE") {
            recordDatabaseActivity(getActiveDatabase(), kw, suggestion.fixed);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(
            `[importSqlWithCorrections] ${label}: correção automática falhou`,
            e,
            e instanceof Error ? e.message : undefined,
            e instanceof Error ? e.stack : undefined
          );
          errors.push(`${label}: ${msg}`);
          pending.push({
            ...suggestion,
            action: "manual",
            reason:
              "A correção automática também falhou; revise o comando manualmente.",
          });
        }
        continue;
      }

      // action === "dependente" ou "manual"
      console.log(`[importSqlWithCorrections] ${label}: ${suggestion.action} — mantido como pendente.`);
      errors.push(`${label}: ${suggestion.message}`);
      pending.push(suggestion);
    }

    // Segunda passagem: re-executa comandos dependentes na ordem original
    // após as correções dos pais terem sido aplicadas
    const dependentSuggestions = suggestions.filter(
      (s) => s.action === "dependente" && selected.has(s.index)
    );

    if (dependentSuggestions.length > 0) {
      console.log("[importSqlWithCorrections] Re-executando comandos dependentes…");
      // Ordena pelo índice original para manter a ordem
      dependentSuggestions.sort((a, b) => a.index - b.index);

      for (const suggestion of dependentSuggestions) {
        const label = `#${suggestion.index} ${suggestion.keyword}`;
        console.log(`[importSqlWithCorrections] Re-executando ${label}…`);
        try {
          // Chunks large INSERTs
          const statementsToRun = chunkLargeInsert(suggestion.original);
          for (const stmt of statementsToRun) {
            await runQuery(stmt);
          }
          console.log(`[importSqlWithCorrections] ${label}: re-execução bem-sucedida.`);
          log.push(`${label}: re-executado com sucesso`);
          // Remove da lista de pendentes
          const pendingIdx = pending.findIndex((p) => p.index === suggestion.index);
          if (pendingIdx >= 0) pending.splice(pendingIdx, 1);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(
            `[importSqlWithCorrections] ${label}: re-execução falhou`,
            e,
            e instanceof Error ? e.message : undefined,
            e instanceof Error ? e.stack : undefined
          );
          errors.push(`${label}: ${msg}`);
          // Atualiza para manual se ainda falhar
          const pendingIdx = pending.findIndex((p) => p.index === suggestion.index);
          if (pendingIdx >= 0) {
            pending[pendingIdx] = {
              ...suggestion,
              action: "manual",
              reason: "Ainda falha após a correção da dependência; revise manualmente.",
            };
          }
        }
      }
    }

    console.log("[importSqlWithCorrections] Atualizando catálogo de tabelas pós-correção…");
    const tables = await listTables(engine);
    const rep: ImportReport = {
      tableName: tables.map((t) => t.name).join(", "),
      tableCount: tables.length,
      rowCount: tables.length,
      log,
      errors,
      code: sql,
      suggestions: pending.length > 0 ? pending : undefined,
    };
    console.log("[importSqlWithCorrections] fim", {
      errors: rep.errors.length,
      pendentes: pending.length,
      tabelas: rep.tableCount,
    });
    return rep;
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error(
      "[importSqlWithCorrections] falha na cadeia de correções",
      error,
      error?.message,
      error?.stack
    );
    throw error;
  } finally {
    engine.run("PRAGMA foreign_keys = ON;");
  }
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
  await resetActiveDatabase();
}
