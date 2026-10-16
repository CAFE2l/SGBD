import type { Database } from "sql.js";
import type { ColumnInfo, ForeignKeyInfo, TableInfo, TableSchema } from "./types";
import {
  createTableSql,
  csvHeader,
  csvRow,
  insertStatements,
  schemaAwareTable,
  type ExportFormat,
  type SqlDialect,
} from "./export-serializers";

const CHUNK_SIZE = 5000;

export interface ExportProgress {
  table: string;
  processed: number;
  total: number;
}

export interface ExportOptions {
  delimiter?: "," | ";";
  dialect?: SqlDialect;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
  preview?: boolean;
  previewBytesRemaining?: number;
  previewLinesRemaining?: number;
}

export interface ExportResult {
  blob: Blob;
  rowCount: number;
  truncated?: boolean;
}

interface TableSnapshot {
  table: TableInfo;
  schema: TableSchema;
  foreignKeys: ForeignKeyInfo[];
  columns: string[];
  count: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Exportação cancelada.", "AbortError");
  }
}

function quoteTable(table: string): string {
  return `"${table.replaceAll('"', '""')}"`;
}

function readTableNames(engine: Database): TableInfo[] {
  const result = engine.exec(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  return (result[0]?.values ?? []).map((row) => ({
    name: String(row[0]),
    sql: row[1] == null ? null : String(row[1]),
  }));
}

function readSchema(engine: Database, table: string): TableSchema {
  const query = `PRAGMA table_info(${quoteTable(table)})`;
  const statement = engine.prepare(query);
  const columns: ColumnInfo[] = [];
  try {
    while (statement.step()) {
      const row = statement.getAsObject();
      columns.push({
        cid: Number(row.cid),
        name: String(row.name),
        type: row.type == null ? "" : String(row.type),
        notnull: Number(row.notnull),
        dflt_value: row.dflt_value == null ? null : String(row.dflt_value),
        pk: Number(row.pk),
      });
    }
  } finally {
    statement.free();
  }
  const tableInfo = readTableNames(engine).find((item) => item.name === table);
  if (!tableInfo || columns.length === 0) {
    throw new Error(`A tabela ${table} não existe ou não possui colunas.`);
  }
  return { name: table, sql: tableInfo.sql, columns };
}

function readForeignKeys(engine: Database, table: string): ForeignKeyInfo[] {
  const result = engine.exec(`PRAGMA foreign_key_list(${quoteTable(table)})`);
  const columns = result[0]?.columns ?? [];
  const indexes = Object.fromEntries(columns.map((column, index) => [column, index]));
  return (result[0]?.values ?? []).map((row) => ({
    id: Number(row[indexes.id]),
    seq: Number(row[indexes.seq]),
    table: String(row[indexes.table]),
    from: String(row[indexes.from]),
    to: String(row[indexes.to] ?? ""),
    onUpdate: String(row[indexes.on_update] ?? "NO ACTION"),
    onDelete: String(row[indexes.on_delete] ?? "NO ACTION"),
    match: String(row[indexes.match] ?? "NONE"),
  }));
}

function readCount(engine: Database, table: string): number {
  const query = `SELECT COUNT(*) FROM ${quoteTable(table)}`;
  const result = engine.exec(query);
  if (!result[0]?.values[0]) {
    throw new Error(`A consulta de contagem não retornou resultado: ${query}`);
  }
  return Number(result[0].values[0][0]);
}

function readChunk(
  database: string,
  engine: Database,
  table: string,
  offset: number,
  limit: number
): { columns: string[]; rows: Record<string, unknown>[] } {
  const query = `SELECT * FROM ${quoteTable(table)} LIMIT ${limit} OFFSET ${offset}`;
  try {
    const result = engine.exec(query);
    if (!result[0]) {
      throw new Error("o SELECT não retornou metadados de colunas");
    }
    return {
      columns: result[0].columns,
      rows: result[0].values.map((values) =>
        Object.fromEntries(result[0].columns.map((column, index) => [column, values[index]]))
      ),
    };
  } catch (error) {
    console.error("[export] falha ao ler tabela", {
      database,
      table,
      query,
      rowsReceived: 0,
      error,
    });
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Não foi possível ler a tabela ${table}: ${reason}`);
  }
}

async function yieldToBrowser(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function scanSchema(engine: Database, table: TableInfo): TableSnapshot {
  try {
    const schema = readSchema(engine, table.name);
    const foreignKeys = readForeignKeys(engine, table.name);
    return {
      table,
      schema,
      foreignKeys,
      columns: schema.columns.map((column) => column.name),
      count: readCount(engine, table.name),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Não foi possível ler a tabela ${table.name}: ${reason}`);
  }
}

function jsonRow(row: Record<string, unknown>): string {
  return JSON.stringify(row, null, 2).replaceAll("\n", "\n  ");
}

function addRowsJson(
  parts: BlobPart[],
  rows: Record<string, unknown>[],
  firstRow: { value: boolean }
): void {
  if (rows.length === 0) return;
  parts.push(`${firstRow.value ? "\n" : ",\n"}  ${rows.map(jsonRow).join(",\n  ")}`);
  firstRow.value = false;
}

async function appendTableRows(
  database: string,
  engine: Database,
  snapshot: TableSnapshot,
  format: ExportFormat,
  parts: BlobPart[],
  options: ExportOptions,
  wrapArray = true
): Promise<void> {
  const delimiter = options.delimiter ?? ",";
  const dialect = options.dialect ?? "sqlite";
  const previewMaxBytes = options.previewBytesRemaining ?? 100 * 1024;
  const previewMaxLines = options.previewLinesRemaining ?? 200;
  const jsonFirst = { value: true };

  if (format === "csv") {
    parts.push(`\uFEFF${csvHeader(snapshot.columns, delimiter)}\r\n`);
  } else if (format === "json-data" && wrapArray) {
    parts.push("[");
  }

  let processed = 0;
  const chunkSize = options.preview ? 100 : CHUNK_SIZE;
  for (let offset = 0; offset < snapshot.count; offset += chunkSize) {
    throwIfAborted(options.signal);
    const chunk = readChunk(database, engine, snapshot.table.name, offset, chunkSize);
    if (chunk.columns.length !== snapshot.columns.length) {
      throw new Error(`Não foi possível ler a tabela ${snapshot.table.name}: o esquema mudou durante a exportação.`);
    }
    if (format === "csv") {
      parts.push(
        chunk.rows
          .map((row) => csvRow(row, snapshot.columns, delimiter))
          .join("\r\n") + (chunk.rows.length ? "\r\n" : "")
      );
    } else if (format === "json-data" || format === "json-schema") {
      addRowsJson(parts, chunk.rows, jsonFirst);
    } else if (format === "sql") {
      const statements = insertStatements(snapshot.table.name, snapshot.columns, chunk.rows, dialect);
      if (options.preview) {
        let usedBytes = new Blob(parts).size;
        let usedLines = parts.reduce(
          (count, part) =>
            count + (typeof part === "string" ? (part.match(/\n/g)?.length ?? 0) : 0),
          0
        );
        for (const statement of statements) {
          const statementBytes = new Blob([statement + "\n"]).size;
          const statementLines = (statement.match(/\n/g)?.length ?? 0) + 1;
          if (
            usedBytes + statementBytes > previewMaxBytes ||
            usedLines + statementLines >= previewMaxLines
          ) {
            parts.push("\n…\n");
            return;
          }
          parts.push(`${statement}\n`);
          usedBytes += statementBytes;
          usedLines += statementLines;
        }
      } else {
        parts.push(...statements.map((line) => `${line}\n`));
      }
    }
    processed += chunk.rows.length;
    options.onProgress?.({
      table: snapshot.table.name,
      processed,
      total: snapshot.count,
    });
    await yieldToBrowser(options.signal);
  }

  if ((format === "json-data" && wrapArray) || format === "json-schema") {
    parts.push(jsonFirst.value ? "]" : "\n]");
  }
}

export async function exportTable(
  database: string,
  tableName: string,
  format: ExportFormat,
  engine: Database,
  options: ExportOptions = {}
): Promise<ExportResult> {
  try {
    throwIfAborted(options.signal);
    const table = readTableNames(engine).find((item) => item.name === tableName);
    if (!table) throw new Error(`A tabela ${tableName} não existe no banco ${database}.`);
    const snapshot = scanSchema(engine, table);
    const parts: BlobPart[] = [];
    if (format === "json-schema") {
      parts.push(`{\n  "tables": {\n    ${JSON.stringify(tableName)}: {\n`);
      const tableDef = schemaAwareTable({ ...snapshot.schema, foreignKeys: snapshot.foreignKeys }, []);
      parts.push(`      "columns": ${JSON.stringify(tableDef.columns, null, 2).replaceAll("\n", "\n      ")},\n`);
      parts.push(`      "primaryKey": ${JSON.stringify(tableDef.primaryKey)},\n`);
      parts.push(`      "foreignKeys": ${JSON.stringify(tableDef.foreignKeys)},\n      "rows": [`);
    }
    if (format === "sql") {
      const dialect = options.dialect ?? "sqlite";
      if (dialect === "sqlite") parts.push("PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n");
      else parts.push("START TRANSACTION;\n");
      parts.push(`${createTableSql({ name: tableName, columns: snapshot.schema.columns, foreignKeys: snapshot.foreignKeys }, dialect)}\n`);
      parts.push("\n");
    }

    await appendTableRows(database, engine, snapshot, format, parts, options);

    if (format === "json-schema") parts.push("\n    }\n  }\n}");
    if (format === "sql") {
      if (options.dialect !== "mysql") parts.push("COMMIT;\n");
    }
    return {
      blob: new Blob(parts, {
        type:
          format === "csv"
            ? "text/csv;charset=utf-8"
            : format.startsWith("json")
              ? "application/json;charset=utf-8"
              : "application/sql;charset=utf-8",
      }),
      rowCount: snapshot.count,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    const reason = error instanceof Error ? error.message : String(error);
    if (reason.startsWith(`Não foi possível ler a tabela ${tableName}:`)) throw error;
    throw new Error(`Não foi possível ler a tabela ${tableName}: ${reason}`);
  }
}

export async function exportDatabase(
  database: string,
  format: ExportFormat,
  engine: Database,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const tables = readTableNames(engine);
  const parts: BlobPart[] = [];
  const snapshots = tables.map((table) => scanSchema(engine, table));
  const totalRows = snapshots.reduce((sum, snapshot) => sum + snapshot.count, 0);
  const processed = { value: 0 };
  let exportedRows = 0;
  let previewTruncated = false;

  if (format === "csv") {
    const entries: Array<{ name: string; data: Blob }> = [];
    for (const snapshot of snapshots) {
      throwIfAborted(options.signal);
      const tableParts: BlobPart[] = [];
      const rowsBeforeTable = processed.value;
      await appendTableRows(database, engine, snapshot, "csv", tableParts, {
        ...options,
        onProgress: (progress) => {
          processed.value = rowsBeforeTable + progress.processed;
          options.onProgress?.({ ...progress, processed: processed.value, total: totalRows });
        },
      });
      entries.push({ name: `${snapshot.table.name}.csv`, data: new Blob(tableParts) });
      processed.value = rowsBeforeTable + snapshot.count;
      exportedRows += snapshot.count;
    }
    return {
      blob: await zipBlobs(entries),
      rowCount: exportedRows,
    };
  }

  if (format === "sql") {
    if (options.dialect === "mysql") parts.push("START TRANSACTION;\n\n");
    else parts.push("-- Dump SGBD\nPRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n\n");
  } else if (format === "json-data") {
    parts.push("{\n  \"tables\": {");
  } else if (format === "json-schema") {
    parts.push("{\n  \"tables\": {");
  }

  for (const [index, snapshot] of snapshots.entries()) {
    throwIfAborted(options.signal);
    const tableName = snapshot.table.name;
    if (format === "sql") {
      parts.push(`${createTableSql({ name: tableName, columns: snapshot.schema.columns, foreignKeys: snapshot.foreignKeys }, options.dialect)}\n\n`);
    } else if (format === "json-data") {
      parts.push(`${index ? "," : ""}\n    ${JSON.stringify(tableName)}: [`);
    } else if (format === "json-schema") {
      const def = schemaAwareTable({ ...snapshot.schema, foreignKeys: snapshot.foreignKeys }, []);
      parts.push(`${index ? "," : ""}\n    ${JSON.stringify(tableName)}: {\n`);
      parts.push(`      "columns": ${JSON.stringify(def.columns, null, 2).replaceAll("\n", "\n      ")},\n`);
      parts.push(`      "primaryKey": ${JSON.stringify(def.primaryKey)},\n`);
      parts.push(`      "foreignKeys": ${JSON.stringify(def.foreignKeys)},\n      "rows": [`);
    }

    if (format === "sql" || format === "json-data" || format === "json-schema") {
      const localParts: BlobPart[] = [];
      const rowsBeforeTable = processed.value;
      const previewBytesRemaining =
        100 * 1024 - new Blob(parts).size - (options.preview ? 40 : 0);
      const previewLinesRemaining =
        200 -
        parts.reduce(
          (count, part) =>
            count + (typeof part === "string" ? (part.match(/\n/g)?.length ?? 0) : 0),
          0
        ) -
        (options.preview ? 3 : 0);
      await appendTableRows(database, engine, snapshot, format, localParts, {
        ...options,
        previewBytesRemaining,
        previewLinesRemaining,
        onProgress: (progress) => {
          processed.value = rowsBeforeTable + progress.processed;
          options.onProgress?.({
            ...progress,
            processed: Math.min(totalRows, processed.value),
            total: totalRows,
          });
        },
      }, false);
      processed.value = rowsBeforeTable + snapshot.count;
      for (const part of localParts) parts.push(part);
      previewTruncated ||= options.preview === true && localParts.some((part) => part === "\n…\n");
    }
    exportedRows += snapshot.count;
    if (format === "json-data" || format === "json-schema") {
      if (format === "json-schema") parts.push("\n    }");
      else parts.push("\n    ]");
    }
    if (previewTruncated) break;
  }

  if (format === "sql") parts.push(options.dialect === "mysql" ? "\nCOMMIT;\n" : "\nCOMMIT;\n");
  if (format === "json-data" || format === "json-schema") parts.push("\n  }\n}");

  if (options.preview && format === "sql") {
    return {
      blob: new Blob(parts, { type: "application/sql;charset=utf-8" }),
      rowCount: exportedRows,
      truncated: previewTruncated,
    };
  }

  return {
    blob: new Blob(parts, {
      type:
        format === "json-data" || format === "json-schema"
          ? "application/json;charset=utf-8"
          : "application/sql;charset=utf-8",
    }),
    rowCount: exportedRows,
  };
}

async function zipBlobs(entries: Array<{ name: string; data: Blob }>): Promise<Blob> {
  const encoder = new TextEncoder();
  const localParts: ArrayBuffer[] = [];
  const centralParts: ArrayBuffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = new Uint8Array(await entry.data.arrayBuffer());
    const crc = crc32(data);
    const local = new ArrayBuffer(30 + name.length);
    const localBytes = new Uint8Array(local);
    const view = new DataView(local);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    localBytes.set(name, 30);
    localParts.push(local, data.buffer as ArrayBuffer);

    const central = new ArrayBuffer(46 + name.length);
    const centralBytes = new Uint8Array(central);
    const centralView = new DataView(central);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    centralBytes.set(name, 46);
    centralParts.push(central);
    offset += local.byteLength + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new ArrayBuffer(22);
  const endView = new DataView(end);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
