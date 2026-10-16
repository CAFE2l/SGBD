/**
 * JSON Importer for SGBD
 * 
 * Supports multiple JSON formats:
 * 1. Array of objects = one table (named after file)
 * 2. Object with table names as keys = multiple tables
 * 3. NDJSON (newline-delimited JSON objects/arrays)
 * 4. Schema-aware format (includes columns, PK, FK metadata)
 */

import type { TableSchema, ForeignKeyInfo } from "./types";
import {
  createTableSql,
  insertStatements,
  quoteIdentifier,
} from "./export-serializers";

export type ColumnType = "INTEGER" | "REAL" | "TEXT" | "DATE" | "DATETIME" | "BOOLEAN";

export interface JsonTable {
  columns: string[];
  rows: (string | null)[][];
  types?: ColumnType[];
  name?: string;
  schema?: TableSchema & { primaryKey?: string[]; foreignKeys?: ForeignKeyInfo[] };
}

export interface JsonParseResult {
  tables: Record<string, JsonTable>;
  delimiter?: string;
}

/**
 * Result of parsing schema-aware JSON format
 */
export interface SchemaAwareTable {
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    default?: string;
    pk: boolean;
  }>;
  primaryKey?: string[];
  foreignKeys?: ForeignKeyInfo[];
  rows: Record<string, unknown>[];
}

/**
 * Detect if JSON is in schema-aware format
 */
function isSchemaAwareFormat(data: unknown): data is { tables: Record<string, SchemaAwareTable> } {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.tables !== "object" || obj.tables === null) return false;
  return Object.values(obj.tables as Record<string, unknown>).every((table) => {
    if (typeof table !== "object" || table === null) return false;
    const definition = table as Record<string, unknown>;
    return Array.isArray(definition.columns) && Array.isArray(definition.rows);
  });
}

/**
 * Check if content looks like NDJSON
 */
function isNdjson(content: string): boolean {
  const lines = content.trim().split("\n");
  if (lines.length > 1) {
    // Check if each line is a valid JSON
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        JSON.parse(line);
      } catch {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * Parse NDJSON content
 */
function parseNdjson(content: string, tableName: string): JsonTable {
  const lines = content.trim().split("\n").filter(l => l.trim().length > 0);
  const rows: (string | null)[][] = [];
  const columnSet = new Set<string>();
  
  // First pass: collect all column names
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (typeof obj === "object" && obj !== null) {
        for (const key of Object.keys(obj)) {
          columnSet.add(key);
        }
      }
    } catch {
      // Skip invalid lines
    }
  }
  
  const columns = Array.from(columnSet);
  
  // Second pass: extract values
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const row = columns.map(col => {
        const val = obj[col];
        if (val === null || val === undefined) return null;
        if (typeof val === "object") {
          // Store nested objects as JSON string
          return JSON.stringify(val);
        }
        if (typeof val === "boolean") {
          return val ? "TRUE" : "FALSE";
        }
        if (typeof val === "number") {
          return String(val);
        }
        return String(val);
      });
      rows.push(row);
    } catch {
      // Skip invalid lines
    }
  }
  
  return { columns, rows, name: tableName };
}

/**
 * Infer column type from values
 */
function inferType(values: (unknown | null)[]): ColumnType {
  let anyValue = false;
  let allNumbers = true;
  let allInt = true;
  let hasBoolean = false;
  let booleanCount = 0;
  
  for (const v of values) {
    if (v === null || v === undefined) continue;
    anyValue = true;
    
    const str = String(v);
    const lower = str.toLowerCase();
    
    // Check boolean
    if (lower === "true" || lower === "false" || 
        lower === "sim" || lower === "nao" || lower === "não" ||
        lower === "1" || lower === "0") {
      hasBoolean = true;
      booleanCount++;
      continue;
    }
    
    const num = Number(str);
    if (str !== "" && Number.isNaN(num)) {
      allNumbers = false;
    } else {
      if (num % 1 !== 0) allInt = false;
    }
  }
  
  if (!anyValue) return "TEXT";
  if (hasBoolean && booleanCount >= values.length * 0.5) return "BOOLEAN";
  if (allNumbers && allInt) return "INTEGER";
  if (allNumbers) return "REAL";
  return "TEXT";
}

/**
 * Get all keys from objects in an array (union of keys)
 */
function getAllKeys(rows: Record<string, unknown>[]): string[] {
  const keySet = new Set<string>();
  for (const row of rows) {
    if (typeof row === "object" && row !== null) {
      for (const key of Object.keys(row)) {
        keySet.add(key);
      }
    }
  }
  return Array.from(keySet);
}

/**
 * Convert rows of objects to array format
 */
function rowsToArray(rows: Record<string, unknown>[], columns: string[]): (string | null)[][] {
  return rows.map(row => {
    return columns.map(col => {
      const val = row[col];
      if (val === null || val === undefined) return null;
      if (typeof val === "object") {
        return JSON.stringify(val);
      }
      if (typeof val === "boolean") {
        return val ? "TRUE" : "FALSE";
      }
      if (typeof val === "number") {
        return String(val);
      }
      if (typeof val === "string") {
        return val;
      }
      return String(val);
    });
  });
}

/**
 * Parse JSON content, auto-detecting format
 */
export function parseJson(content: string, defaultTableName: string = "tabela_json"): JsonParseResult {
  // Try to parse as JSON
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    // Not valid JSON
    return { tables: {} };
  }
  
  // Check for schema-aware format first
  if (isSchemaAwareFormat(data)) {
    const result: Record<string, JsonTable> = {};
    
    for (const [tableName, tableData] of Object.entries(data.tables)) {
      const columns = tableData.columns.map(c => c.name);
      const rows = rowsToArray(tableData.rows, columns);
      
      // Reconstruct types
      const types: ColumnType[] = columns.map((_, i) => {
        const colData = tableData.columns[i];
        const typeStr = colData.type.toUpperCase();
        if (typeStr === "INTEGER") return "INTEGER";
        if (typeStr === "REAL" || typeStr === "FLOAT" || typeStr === "DOUBLE") return "REAL";
        if (typeStr === "BOOLEAN" || typeStr === "BOOL") return "BOOLEAN";
        if (typeStr === "DATE") return "DATE";
        if (typeStr === "DATETIME") return "DATETIME";
        return "TEXT";
      });
      
      result[tableName] = { columns, rows, types };
      const primaryKey = tableData.primaryKey ?? tableData.columns
        .filter((column) => column.pk)
        .map((column) => column.name);
      result[tableName].schema = {
        name: tableName,
        sql: null,
        columns: tableData.columns.map((column, index) => ({
          cid: index,
          name: column.name,
          type: column.type || "TEXT",
          notnull: column.nullable ? 0 : 1,
          dflt_value: column.default ?? null,
          pk: Math.max(primaryKey.indexOf(column.name) + 1, 0),
        })),
        primaryKey,
        foreignKeys: tableData.foreignKeys ?? [],
      };
    }
    
    return { tables: result };
  }
  
  // Check if it's an object with table names as keys (multiple tables)
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const wrappedTables = obj.tables;
    if (typeof wrappedTables === "object" && wrappedTables !== null && !Array.isArray(wrappedTables)) {
      const tableObject = wrappedTables as Record<string, unknown>;
      const allTableArrays = Object.values(tableObject).every((value) => Array.isArray(value));
      if (allTableArrays) {
        const result: Record<string, JsonTable> = {};
        for (const [tableName, values] of Object.entries(tableObject)) {
          const arr = values as Record<string, unknown>[];
          const columns = getAllKeys(arr);
          const rows = rowsToArray(arr, columns);
          const types = columns.map((column) =>
            inferType(rows.map((row) => row[columns.indexOf(column)]))
          );
          result[tableName] = { columns, rows, types };
        }
        return { tables: result };
      }
    }
    const keys = Object.keys(obj);
    
    // Check if all values are arrays of objects
    const allArrays = keys.every(k => Array.isArray(obj[k]));
    if (allArrays && keys.length > 0) {
      const result: Record<string, JsonTable> = {};
      
      for (const [tableName, tableData] of Object.entries(obj)) {
        const arr = tableData as Record<string, unknown>[];
        const columns = getAllKeys(arr);
        const rows = rowsToArray(arr, columns);
        
        // Infer types
        const types: ColumnType[] = columns.map(col => {
          const values = rows.map(r => r[columns.indexOf(col)]);
          return inferType(values);
        });
        
        result[tableName] = { columns, rows, types };
      }
      
      return { tables: result };
    }
  }
  
  // Check if it's an array of objects (single table)
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object") {
    const rows = data as Record<string, unknown>[];
    const columns = getAllKeys(rows);
    const rowArrays = rowsToArray(rows, columns);
    
    // Infer types
    const types: ColumnType[] = columns.map(col => {
      const values = rowArrays.map(r => r[columns.indexOf(col)]);
      return inferType(values);
    });
    
    return {
      tables: {
        [defaultTableName]: { columns, rows: rowArrays, types }
      }
    };
  }
  
  // Check if it's NDJSON
  if (isNdjson(content)) {
    return {
      tables: {
        [defaultTableName]: parseNdjson(content, defaultTableName)
      }
    };
  }
  
  // Fallback: try to extract from array that might have been read incorrectly
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (typeof first === "object" && first !== null && !Array.isArray(first)) {
      const rows = data as Record<string, unknown>[];
      const columns = getAllKeys(rows);
      const rowArrays = rowsToArray(rows, columns);
      
      const types: ColumnType[] = columns.map(col => {
        const values = rowArrays.map(r => r[columns.indexOf(col)]);
        return inferType(values);
      });
      
      return {
        tables: {
          [defaultTableName]: { columns, rows: rowArrays, types }
        }
      };
    }
  }
  
  // Empty or unrecognized
  return { tables: {} };
}

/**
 * Read JSON from file content (handles both regular JSON and NDJSON)
 */
export function readJsonFile(content: string, tableNameHint: string = "tabela_json"): JsonTable | null {
  const result = parseJson(content, tableNameHint);
  
  // If we have tables, return the first one or a specific one if hinted
  const tableNames = Object.keys(result.tables);
  if (tableNames.length === 0) return null;
  
  if (tableNames.length === 1) {
    return result.tables[tableNames[0]];
  }
  
  // Multiple tables - return the one matching the hint, or first
  if (result.tables[tableNameHint]) {
    return result.tables[tableNameHint];
  }
  
  return result.tables[tableNames[0]];
}

/**
 * Check if JSON contains schema information that can be restored
 */
export function hasSchemaInfo(content: string): boolean {
  try {
    const data = JSON.parse(content);
    return isSchemaAwareFormat(data) ||
           (typeof data === "object" && data !== null && !Array.isArray(data) &&
            Object.values(data as Record<string, unknown>).every(v => 
              Array.isArray(v) && v.length > 0 && typeof v[0] === "object"));
  } catch {
    return false;
  }
}

/**
 * Extract schema information from JSON (for table creation)
 */
export interface ExtractedSchema {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    default?: string | null;
    pk: boolean;
  }>;
  primaryKey?: string[];
  foreignKeys?: ForeignKeyInfo[];
}

export function extractSchemaFromJson(content: string, tableName: string): ExtractedSchema | null {
  const result = parseJson(content, tableName);
  const table = Object.values(result.tables)[0];
  
  if (!table || !table.rows || table.rows.length === 0) {
    return null;
  }

  const columns = table.columns.map((name, i) => ({
    name,
    type: table.types?.[i] || "TEXT",
    nullable: true,
    default: null as string | null,
    pk: false,
  }));
  
  return {
    name: tableName,
    columns,
    primaryKey: undefined,
    foreignKeys: undefined,
  };
}

/**
 * Rebuilds JSON exports as a SQLite script for the browser import flow.
 */
export function jsonToSql(content: string, defaultTableName = "tabela_json"): string {
  const parsed = parseJson(content, defaultTableName);
  const entries = Object.entries(parsed.tables);
  if (entries.length === 0) {
    throw new Error("O arquivo JSON não contém tabelas reconhecidas.");
  }
  const statements = ["PRAGMA foreign_keys=OFF;"];

  for (const [name, table] of entries) {
    if (table.columns.length === 0) {
      if (table.rows.length === 0 && !table.schema) continue;
      throw new Error(`A tabela ${name} no JSON não possui colunas.`);
    }
    if (table.schema) {
      statements.push(createTableSql({
        name,
        columns: table.schema.columns,
        foreignKeys: table.schema.foreignKeys ?? [],
      }));
    } else {
      const columns = table.columns.map((column, index) => {
        const type = table.types?.[index] ?? "TEXT";
        return `${quoteIdentifier(column)} ${type}`;
      });
      statements.push(`CREATE TABLE ${quoteIdentifier(name)} (${columns.join(", ")});`);
    }
    const rows = table.rows.map((values) =>
      Object.fromEntries(table.columns.map((column, index) => [column, values[index] ?? null]))
    );
    for (const statement of insertStatements(name, table.columns, rows)) {
      statements.push(statement);
    }
  }

  if (statements.length === 1) {
    throw new Error("O JSON só contém tabelas vazias sem esquema para restaurar.");
  }
  statements.push("PRAGMA foreign_keys=ON;");
  return statements.join("\n");
}