/**
 * JSON Exporter for SGBD
 * 
 * Supports two export modes:
 * 1. Data only: Just the rows as an array of objects
 * 2. Schema-aware: Full schema with columns, PK, FK, types, defaults
 */

import type { TableSchema, ForeignKeyInfo } from "./types";

/**
 * Data-only JSON format
 */
export type JsonDataOnly = Record<string, unknown>[];

/**
 * Schema-aware JSON format
 */
export interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  pk: boolean;
}

export interface ForeignKeyDef {
  from: string;
  to: string;
  table: string;
}

export interface TableDef {
  columns: ColumnDef[];
  primaryKey?: string[];
  foreignKeys?: ForeignKeyDef[];
  rows: JsonDataOnly;
}

export interface SchemaAwareExport {
  tables: Record<string, TableDef>;
  indexes?: Record<string, unknown[]>;
}

/**
 * Convert a TableSchema to ColumnDef[]
 */
function schemaToColumns(schema: TableSchema): ColumnDef[] {
  return schema.columns.map(c => ({
    name: c.name,
    type: c.type || "TEXT",
    nullable: c.notnull === 0,
    default: c.dflt_value,
    pk: c.pk > 0,
  }));
}

/**
 * Extract primary key columns
 */
function extractPrimaryKey(schema: TableSchema): string[] | undefined {
  const pkCols = schema.columns.filter(c => c.pk > 0);
  if (pkCols.length === 0) return undefined;
  return pkCols.map(c => c.name).sort((a, b) => 
    schema.columns.find(c => c.name === a)!.pk - schema.columns.find(c => c.name === b)!.pk
  );
}

/**
 * Build a column map for FK lookups
 */
function buildFkMap(fks: ForeignKeyInfo[]): Map<string, string> {
  const fkMap = new Map<string, string>();
  for (const fk of fks) {
    fkMap.set(`${fk.from}@${fk.table}`, fk.to);
  }
  return fkMap;
}

/**
 * Convert FK info to FK def
 */
function fkToDef(fk: ForeignKeyInfo): ForeignKeyDef {
  return {
    from: fk.from,
    to: fk.to,
    table: fk.table,
  };
}

/**
 * Export a table as data-only JSON
 */
export async function exportTableDataAsJson(
  table: string,
  data: { columns: string[]; rows: Record<string, unknown>[] }
): Promise<JsonDataOnly> {
  // Just return the rows
  return data.rows;
}

/**
 * Export a table as schema-aware JSON
 */
export async function exportTableAsSchemaAwareJson(
  table: string,
  schema: TableSchema,
  fks: ForeignKeyInfo[],
  data: { columns: string[]; rows: Record<string, unknown>[] }
): Promise<TableDef> {
  const columns = schemaToColumns(schema);
  const primaryKey = extractPrimaryKey(schema);
  const foreignKeys = fks.map(fkToDef);
  
  return {
    columns,
    primaryKey,
    foreignKeys: foreignKeys.length > 0 ? foreignKeys : undefined,
    rows: data.rows,
  };
}

/**
 * Build the complete schema-aware export for a database
 */
export async function buildSchemaAwareExport(
  tables: Array<{
    name: string;
    schema: TableSchema;
    fks: ForeignKeyInfo[];
    data: { columns: string[]; rows: Record<string, unknown>[] };
  }>
): Promise<SchemaAwareExport> {
  const tablesMap: Record<string, TableDef> = {};
  
  for (const t of tables) {
    const def = await exportTableAsSchemaAwareJson(t.name, t.schema, t.fks, t.data);
    tablesMap[t.name] = def;
  }
  
  return {
    tables: tablesMap,
  };
}

/**
 * Export database as CSV (zip if multiple tables)
 */
export function buildCsvZip(tables: Array<{
  name: string;
  data: { columns: string[]; rows: Record<string, unknown>[] };
}>): string {
  // This would typically use a zip library like JSZip
  // For now, we'll concatenate with a separator and let the UI handle zipping
  const parts: string[] = [];
  
  for (const t of tables) {
    const csv = tableToCsv(t.name, t.data);
    parts.push(`=== FILE: ${t.name}.csv ===\n${csv}`);
  }
  
  return parts.join("\n\n");
}

/**
 * Convert table data to CSV string
 */
export function tableToCsv(
  tableName: string,
  data: { columns: string[]; rows: Record<string, unknown>[] }
): string {
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  
  const header = data.columns.map(esc).join(",");
  const lines = data.rows.map(row => 
    data.columns.map(col => esc(row[col])).join(",")
  );
  
  return [header, ...lines].join("\n");
}

/**
 * Estimate if table has nested objects that should be stored as JSON
 */
export function hasNestedJson(data: Record<string, unknown>[]): boolean {
  for (const row of data) {
    for (const val of Object.values(row)) {
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Mark columns that contain nested JSON for proper export
 */
export function getJsonColumns(data: Record<string, unknown>[]): Set<string> {
  const jsonCols = new Set<string>();
  
  for (const row of data) {
    for (const [col, val] of Object.entries(row)) {
      if (typeof val === "object" && val !== null) {
        jsonCols.add(col);
      }
    }
  }
  
  return jsonCols;
}