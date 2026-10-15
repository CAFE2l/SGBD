/**
 * Database Service Layer - Single Source of Truth for Schema and Data
 * 
 * This module provides a centralized service for all database operations,
 * ensuring that all mutations go through a single path and that all
 * subscribers are notified of changes.
 * 
 * The service reads schema directly from PRAGMA statements to ensure
 * accuracy after any DDL/DML operation.
 */

import type { Database } from "sql.js";
import {
  ensureActiveEngine,
  saveActive,
  getActiveDatabase,
  recordDatabaseActivity,
  listTables as listTablesRaw,
} from "@/lib/database-manager";
import { rebuildTable } from "./db";
import type {
  TableInfo,
  TableSchema,
  ColumnInfo,
  QueryResult,
  ForeignKeyInfo,
} from "./types";

/** Listener function type */
type Listener = () => void;

/** Set of listener functions */
type ListenerSet = Set<Listener>;

/**
 * Internal cache for subscriptions
 */
let listeners: ListenerSet = new Set();

/**
 * Schema version counter - increments on DDL operations
 */
let schemaVersion = 0;

/**
 * Data version counter - increments on DML/imports
 */
let dataVersion = 0;

/**
 * Gets the current schema version
 */
export function getSchemaVersion(): number {
  return schemaVersion;
}

/**
 * Gets the current data version
 */
export function getDataVersion(): number {
  return dataVersion;
}

/**
 * Subscribe to database changes
 * Returns unsubscribe function
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Notify all subscribers of a change
 */
function notify(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      // Ignore listener errors
    }
  });
}

/**
 * Increment schema version and notify
 */
function bumpSchema(): void {
  schemaVersion++;
  notify();
}

/**
 * Increment data version and notify
 */
function bumpData(): void {
  dataVersion++;
  notify();
}

/**
 * Quote an identifier for SQL
 */
function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}`;
}

/**
 * Unquote an identifier
 */
function unquoteIdent(ident: string): string {
  return ident.replace(/^["`[\]]+|["`\]]+$/g, "");
}

/**
 * Validate and sanitize a table name
 */
function sanitizeTableName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

// ====================== READ OPERATIONS ======================

/**
 * Get list of tables from the active database
 */
export async function getTables(): Promise<TableInfo[]> {
  const engine = await ensureActiveEngine();
  return listTables(engine);
}

/**
 * Get table info (name and SQL) from the active database
 */
async function listTables(engine: Database): Promise<TableInfo[]> {
  const res = engine.exec(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
  );
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    name: String(row[0]),
    sql: row[1] ? String(row[1]) : null,
  }));
}

/**
 * Get schema for a specific table (columns, types, PK, FK, nullable, default)
 */
export async function getTableSchemaInternal(
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

/**
 * Get schema for a specific table (public API)
 */
export async function getTableSchema(
  table: string,
  engine?: Database
): Promise<TableSchema> {
  return getTableSchemaInternal(table, engine);
}

/**
 * Get foreign keys for a table
 */
export async function getForeignKeysInternal(
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
 * Get foreign keys for a table (public API)
 */
export async function getForeignKeys(
  table: string,
  engine?: Database
): Promise<ForeignKeyInfo[]> {
  return getForeignKeysInternal(table, engine);
}

/**
 * Get data from a table
 */
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

/**
 * Get editable table data (with rowid for updates)
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
    // vista/expressão ilegível
  }
  return cols;
}

/**
 * Convert sql.js result to object array
 */
function resultToObject(
  columns: string[],
  values: (string | number | bigint | boolean | null)[],
  message: string
): QueryResult {
  const rows: Record<string, unknown>[] = values.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      const v = row[i];
      if (v instanceof Uint8Array) {
        try {
          obj[col] = new TextDecoder().decode(v);
        } catch {
          obj[col] = Array.from(v);
        }
      } else {
        obj[col] = v;
      }
    });
    return obj;
  });
  return { columns, rows, isSelect: true, message };
}

/**
 * Get row count for a table
 */
export async function getTableCount(table: string): Promise<number> {
  const engine = await ensureActiveEngine();
  try {
    const res = engine.exec(`SELECT COUNT(*) FROM "${table}"`);
    return Number(res[0]?.values[0]?.[0] ?? 0);
  } catch {
    return 0;
  }
}

// ====================== MUTATION OPERATIONS ======================

/**
 * Create a new table with columns
 */
export async function createTable(
  name: string,
  columns: Array<{ name: string; type: string | null; notnull: boolean; dflt: string | null; pk: boolean }>
): Promise<void> {
  const engine = await ensureActiveEngine();
  const cleanName = sanitizeTableName(name);
  if (!cleanName) throw new Error("Nome de tabela inválido.");

  // Check if table exists
  const existing = await getTables();
  if (existing.some((t) => t.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error(`A tabela "${cleanName}" já existe.`);
  }

  const colDefs = columns.map((c) => {
    let def = `"${c.name}"`;
    if (c.type) def += ` ${c.type}`;
    if (c.pk) def += " PRIMARY KEY";
    if (c.notnull) def += " NOT NULL";
    if (c.dflt) def += ` DEFAULT ${c.dflt}`;
    return def;
  });

  const sql = `CREATE TABLE "${cleanName}" (${colDefs.join(", ")});`;
  engine.exec(sql);
  saveActive();
  recordDatabaseActivity(getActiveDatabase(), "CREATE", sql);
  bumpSchema();
  bumpData();
}

/**
 * Drop a table
 */
export async function dropTable(name: string): Promise<void> {
  const engine = await ensureActiveEngine();
  const cleanName = sanitizeTableName(name);

  const sql = `DROP TABLE "${cleanName}"`;
  engine.exec(sql);
  saveActive();
  recordDatabaseActivity(getActiveDatabase(), "DROP", sql);
  bumpSchema();
  bumpData();
}

/**
 * Rename a table
 */
export async function renameTable(oldName: string, newName: string): Promise<void> {
  const engine = await ensureActiveEngine();
  const cleanOld = sanitizeTableName(oldName);
  const cleanNew = sanitizeTableName(newName);

  const sql = `ALTER TABLE "${cleanName}" RENAME TO "${cleanNew}";`;
  engine.exec(sql);
  saveActive();
  recordDatabaseActivity(getActiveDatabase(), "ALTER", sql);
  bumpSchema();
}

/**
 * Add a column to a table (SQLite supports this directly)
 */
export async function addColumn(
  table: string,
  column: { name: string; type: string; notnull: boolean; dflt: string | null }
): Promise<void> {
  const engine = await ensureActiveEngine();
  const def = `"${column.name}" ${column.type}`;
  const sql = `ALTER TABLE "${table}" ADD COLUMN ${def}${column.notnull ? " NOT NULL" : ""}${column.dflt ? ` DEFAULT ${column.dflt}` : ""};`;
  engine.exec(sql);
  saveActive();
  recordDatabaseActivity(getActiveDatabase(), "ALTER", sql);
  bumpSchema();
}

/**
 * Drop a column from a table (requires table rebuild)
 */
export async function dropColumn(table: string, column: string): Promise<void> {
  const currentSchema = await getTableSchemaInternal(table);
  const colIndex = currentSchema.columns.findIndex((c) => c.name === column);
  
  if (colIndex === -1) {
    throw new Error(`Coluna "${column}" não encontrada.`);
  }

  // Rebuild table without the column
  const newCols = currentSchema.columns.filter((c) => c.name !== column);
  
  if (newCols.length === 0) {
    throw new Error("Não é possível remover a última coluna.");
  }

  const colDefs = newCols.map((c) => {
    let def = `"${c.name}"`;
    if (c.type) def += ` ${c.type}`;
    if (c.pk) def += " PRIMARY KEY";
    if (c.notnull) def += " NOT NULL";
    if (c.dflt_value) def += ` DEFAULT ${c.dflt_value}`;
    return def;
  }).join(", ");

  const engine = await ensureActiveEngine();
  const tmpTable = `__sgbd_tmp_mig_${Date.now()}`;
  
  engine.run("PRAGMA foreign_keys=OFF;");
  
  try {
    engine.exec(`CREATE TABLE "${tmpTable}" (${colDefs});`);
    engine.exec(`INSERT INTO "${tmpTable}" SELECT ${newCols.map(c => `"${c.name}"`).join(", ")} FROM "${table}";`);
    engine.exec(`DROP TABLE "${table}";`);
    engine.exec(`ALTER TABLE "${tmpTable}" RENAME TO "${table}";`);
    engine.run("PRAGMA foreign_keys=ON;");
    
    saveActive();
    recordDatabaseActivity(getActiveDatabase(), "ALTER", `DROP COLUMN ${column} from ${table}`);
    bumpSchema();
    bumpData();
  } catch (e) {
    engine.run("PRAGMA foreign_keys=ON;");
    throw e;
  }
}

/**
 * Rename a column (requires table rebuild in SQLite < 3.35.0, otherwise supported directly)
 */
export async function renameColumn(table: string, oldName: string, newName: string): Promise<void> {
  // Check if we can use RENAME COLUMN directly
  try {
    const engine = await ensureActiveEngine();
    const sql = `ALTER TABLE "${table}" RENAME COLUMN "${oldName}" TO "${newName}";`;
    engine.exec(sql);
    saveActive();
    recordDatabaseActivity(getActiveDatabase(), "ALTER", sql);
    bumpSchema();
    return;
  } catch {
    // Fall back to rebuild pattern
  }

  // Rebuild pattern
  const engine = await ensureActiveEngine();
  const schema = await getTableSchemaInternal(table, engine);
  const newCols = schema.columns.map(c => {
    if (c.name === oldName) return { ...c, name: newName };
    return c;
  });

  const colDefs = newCols.map((c) => {
    let def = `"${c.name}"`;
    if (c.type) def += ` ${c.type}`;
    if (c.pk) def += " PRIMARY KEY";
    if (c.notnull) def += " NOT NULL";
    if (c.dflt_value) def += ` DEFAULT ${c.dflt_value}`;
    return def;
  }).join(", ");

  const tmpTable = `__sgbd_tmp_mig_${Date.now()}`;
  
  engine.run("PRAGMA foreign_keys=OFF;");
  
  try {
    engine.exec(`CREATE TABLE "${tmpTable}" (${colDefs});`);
    const colSelect = newCols.map(c => {
      // Need to use original column name in SELECT if renamed
      const origName = c.name === newName ? oldName : c.name;
      return `"${origName}" AS "${c.name}"`;
    }).join(", ");
    engine.exec(`INSERT INTO "${tmpTable}" SELECT ${colSelect} FROM "${table}";`);
    engine.exec(`DROP TABLE "${table}";`);
    engine.exec(`ALTER TABLE "${tmpTable}" RENAME TO "${table}";`);
    engine.run("PRAGMA foreign_keys=ON;");
    
    saveActive();
    recordDatabaseActivity(getActiveDatabase(), "ALTER", `RENAME COLUMN ${oldName} TO ${newName} in ${table}`);
    bumpSchema();
  } catch (e) {
    engine.run("PRAGMA foreign_keys=ON.");
    throw e;
  }
}

/**
 * Change column type (requires rebuild in SQLite)
 */
export async function changeColumnType(
  table: string,
  column: string,
  newType: string
): Promise<void> {
  const engine = await ensureActiveEngine();
  const schema = await getTableSchemaInternal(table, engine);
  
  const newCols = schema.columns.map(c => {
    if (c.name === column) return { ...c, type: newType };
    return c;
  });

  const colDefs = newCols.map((c) => {
    let def = `"${c.name}"`;
    if (c.type) def += ` ${c.type}`;
    if (c.pk) def += " PRIMARY KEY";
    if (c.notnull) def += " NOT NULL";
    if (c.dflt_value) def += ` DEFAULT ${c.dflt_value}`;
    return def;
  }).join(", ");

  const tmpTable = `__sgbd_tmp_mig_${Date.now()}`;
  
  engine.run("PRAGMA foreign_keys=OFF;");
  
  try {
    engine.exec(`CREATE TABLE "${tmpTable}" (${colDefs});`);
    engine.exec(`INSERT INTO "${tmpTable}" SELECT * FROM "${table}";`);
    engine.exec(`DROP TABLE "${table}";`);
    engine.exec(`ALTER TABLE "${tmpTable}" RENAME TO "${table}";`);
    engine.run("PRAGMA foreign_keys=ON;");
    
    saveActive();
    recordDatabaseActivity(getActiveDatabase(), "ALTER", `ALTER TYPE ${column} TO ${newType}`);
    bumpSchema();
  } catch (e) {
    engine.run("PRAGMA foreign_keys=ON.");
    throw e;
  }
}

/**
 * Set primary key on a column
 */
export async function setPrimaryKey(table: string, column: string): Promise<void> {
  // Implementation uses addPrimaryKey from db.ts
  const { addPrimaryKey } = await import("./db");
  await addPrimaryKey(table, column);
  bumpSchema();
  bumpData();
}

/**
 * Remove primary key from a column
 */
export async function dropPrimaryKey(table: string, column: string): Promise<void> {
  const { dropPrimaryKey } = await import("./db");
  await dropPrimaryKey(table, column);
  bumpSchema();
}

/**
 * Add a foreign key constraint
 */
export async function addForeignKey(
  table: string,
  column: string,
  refTable: string,
  refColumn: string
): Promise<void> {
  const { addForeignKey: addFkRaw } = await import("./db");
  await addFkRaw(table, column, refTable, refColumn);
  bumpSchema();
}

/**
 * Remove a foreign key constraint
 */
export async function dropForeignKey(
  table: string,
  column: string,
  refTable: string,
  refColumn: string
): Promise<void> {
  const { dropForeignKey: dropFkRaw } = await import("./db");
  await dropFkRaw(table, column, refTable, refColumn);
  bumpSchema();
}

/**
 * Insert a row into a table
 */
export async function insertRow(
  table: string,
  values: Record<string, unknown>
): Promise<void> {
  const engine = await ensureActiveEngine();
  const cols = Object.keys(values);
  const colNames = cols.map(c => `"${c}"`).join(", ");
  const placeholders = cols.map(() => "?").join(", ");
  
  const stmt = `INSERT INTO "${table}" (${colNames}) VALUES (${placeholders});`;
  const params = cols.map(c => {
    const v = values[c];
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return v;
    return String(v);
  });
  
  engine.exec(stmt, params);
  saveActive();
  recordDatabaseActivity(getActiveDatabase(), "INSERT", stmt);
  bumpData();
}

/**
 * Update a row in a table
 */
export async function updateRow(
  table: string,
  rowid: number,
  values: Record<string, unknown>
): Promise<number> {
  const engine = await ensureActiveEngine();
  const cols = Object.keys(values);
  const updates = cols.map(c => `"${c}" = ?`).join(", ");
  const params = [...cols.map(c => {
    const v = values[c];
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return v;
    return String(v);
  }), rowid];
  
  const stmt = `UPDATE "${table}" SET ${updates} WHERE rowid = ?;`;
  engine.exec(stmt, params);
  const affected = engine.getRowsModified();
  saveActive();
  recordDatabaseActivity(getActiveDatabase(), "UPDATE", stmt);
  bumpData();
  return affected;
}

/**
 * Delete a row from a table
 */
export async function deleteRow(table: string, rowid: number): Promise<void> {
  const engine = await ensureActiveEngine();
  const stmt = `DELETE FROM "${table}" WHERE rowid = ?;`;
  engine.exec(stmt, [rowid]);
  saveActive();
  recordDatabaseActivity(getActiveDatabase(), "DELETE", stmt);
  bumpData();
}

/**
 * Get the SQL CREATE statement for a table
 */
export async function getTableCreateSql(table: string): Promise<string | null> {
  const engine = await ensureActiveEngine();
  const res = engine.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name = "${table}";`);
  return res[0]?.values[0]?.[0] ? String(res[0].values[0][0]) : null;
}

/**
 * Trigger a manual refresh (forces notify)
 */
export function refresh(): void {
  notify();
}

/**
 * Export utilities
 */

/**
 * Build SQL from table schema and data (for export)
 */
export async function buildExportSql(
  table: string,
  options?: { includeData: boolean; format: "sqlite" | "mysql" }
): Promise<string> {
  const schema = await getTableSchemaInternal(table);
  const includeData = options?.includeData ?? true;
  const format = options?.format ?? "sqlite";
  
  const colDefs = schema.columns.map(c => {
    let def = `"${c.name}"`;
    let type = c.type || "TEXT";
    
    // Convert to MySQL format if needed
    if (format === "mysql") {
      type = type.replace(/\bTEXT\b/g, "LONGTEXT")
                  .replace(/\bINTEGER\b/g, "INT")
                  .replace(/\bREAL\b/g, "DOUBLE");
    }
    
    if (type) def += ` ${type}`;
    if (c.pk > 0) {
      if (format === "mysql") {
        def = `PRIMARY KEY (${def})`; // Will be combined later
      } else {
        def += " PRIMARY KEY";
      }
    }
    if (c.notnull) def += " NOT NULL";
    if (c.dflt_value) {
      def += ` DEFAULT ${c.dflt_value}`;
    }
    return def;
  }).join(", ");
  
  const finalColDefs = schema.columns.map(c => {
    let def = `"${c.name}"`;
    let type = c.type || "TEXT";
    if (format === "mysql") {
      type = type.replace(/\bTEXT\b/g, "LONGTEXT")
                  .replace(/\bINTEGER\b/g, "INT")
                  .replace(/\bREAL\b/g, "DOUBLE");
    }
    if (type) def += ` ${type}`;
    if (c.notnull) def += " NOT NULL";
    if (c.dflt_value) def += ` DEFAULT ${c.dflt_value}`;
    return def;
  }).join(", ");
  
  let sql = `CREATE TABLE "${table}" (${finalColDefs});`;
  
  if (includeData) {
    const data = await getTableData(table, Number.MAX_SAFE_INTEGER);
    for (const row of data.rows) {
      const cols = Object.keys(row).map(c => `"${c}"`).join(", ");
      const vals = Object.keys(row).map(c => {
        const v = row[c];
        if (v === null) return "NULL";
        if (typeof v === "number") return String(v);
        return `'${String(v).replace(/'/g, "''")}'`;
      }).join(", ");
      sql += `\nINSERT INTO "${table}" (${cols}) VALUES (${vals});`;
    }
  }
  
  return sql;
}

/**
 * Build JSON export (schema-aware or data only)
 */
export async function buildJsonExport(
  table: string,
  options?: { includeSchema: boolean }
): Promise<unknown> {
  const includeSchema = options?.includeSchema ?? false;
  
  if (includeSchema) {
    // Schema-aware format
    const schema = await getTableSchemaInternal(table);
    const fks = await getForeignKeysInternal(table);
    const data = await getTableData(table, Number.MAX_SAFE_INTEGER);
    
    const columns = schema.columns.map(c => ({
      name: c.name,
      type: c.type || "TEXT",
      nullable: c.notnull === 0,
      default: c.dflt_value,
      pk: c.pk > 0,
    }));
    
    // Find primary key column(s)
    const pkCols = schema.columns.filter(c => c.pk > 0).map(c => ({name: c.name, order: c.pk}));
    const primaryKey = pkCols.length > 0 ? pkCols.sort((a,b) => a.order - b.order).map(p => p.name) : undefined;
    
    // Build foreign keys array
    const foreignKeys = fks.map(fk => ({
      from: fk.from,
      to: fk.to,
      table: fk.table,
    }));
    
    return {
      table,
      columns: schema.columns.map(c => ({
        name: c.name,
        type: c.type || "TEXT",
        nullable: c.notnull === 0,
        default: c.dflt_value,
        pk: c.pk > 0,
      })),
      primaryKey,
      foreignKeys,
      rows: data.rows,
    };
  } else {
    // Data only
    const data = await getTableData(table, Number.MAX_SAFE_INTEGER);
    return data.rows;
  }
}

/**
 * Build CSV export for a table
 */
export async function buildCsvExport(table: string): Promise<string> {
  const data = await getTableData(table, Number.MAX_SAFE_INTEGER);
  
  const esc = (v: unknown): string => {
    if (v === null) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  
  const header = data.columns.map(esc).join(",");
  const lines = data.rows.map(r => data.columns.map(c => esc(r[c])).join(","));
  
  return [header, ...lines].join("\n");
}