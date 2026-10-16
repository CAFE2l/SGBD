import type { ForeignKeyInfo, TableSchema } from "./types";

export type SqlDialect = "sqlite" | "mysql";
export type ExportFormat = "csv" | "json-data" | "json-schema" | "sql";

export interface ExportSchema {
  name: string;
  columns: TableSchema["columns"];
  foreignKeys: ForeignKeyInfo[];
}

export function quoteIdentifier(identifier: string, dialect: SqlDialect = "sqlite"): string {
  const quote = dialect === "mysql" ? "`" : '"';
  return `${quote}${identifier.replaceAll(quote, quote + quote)}${quote}`;
}

export function csvCell(value: unknown, delimiter = ","): string {
  if (value == null) return "";
  const text =
    value instanceof Uint8Array ? new TextDecoder().decode(value) : String(value);
  if (text.includes(delimiter) || /["\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function csvHeader(columns: string[], delimiter = ","): string {
  return columns.map((column) => csvCell(column, delimiter)).join(delimiter);
}

export function csvRow(
  row: Record<string, unknown>,
  columns: string[],
  delimiter = ","
): string {
  return columns.map((column) => csvCell(row[column], delimiter)).join(delimiter);
}

export function schemaAwareTable(
  schema: ExportSchema,
  rows: Record<string, unknown>[]
) {
  const primaryKey = schema.columns
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name);

  return {
    columns: schema.columns.map((column) => ({
      name: column.name,
      type: column.type || "TEXT",
      nullable: column.notnull === 0,
      default: column.dflt_value,
      pk: column.pk > 0,
    })),
    primaryKey,
    foreignKeys: schema.foreignKeys.map(({ from, to, table, id, seq, onUpdate, onDelete, match }) => ({
      id,
      seq,
      from,
      to,
      table,
      onUpdate,
      onDelete,
      match,
    })),
    rows,
  };
}

export function sqlLiteral(value: unknown, dialect: SqlDialect = "sqlite"): string {
  if (value == null) return "NULL";
  if (value instanceof Uint8Array) {
    return `X'${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}'`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Valor numérico inválido: ${value}`);
    return String(value);
  }
  if (typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  let text = String(value);
  if (dialect === "mysql") {
    text = text
      .replaceAll("\\", "\\\\")
      .replaceAll("\0", "\\0")
      .replaceAll("\n", "\\n")
      .replaceAll("\r", "\\r")
      .replaceAll("\b", "\\b")
      .replaceAll("\t", "\\t")
      .replaceAll(String.fromCharCode(26), "\\Z");
  }
  return `'${text.replaceAll("'", "''")}'`;
}

function foreignKeyClauses(foreignKeys: ForeignKeyInfo[], dialect: SqlDialect): string[] {
  const grouped = new Map<number, ForeignKeyInfo[]>();
  for (const key of foreignKeys) {
    const group = grouped.get(key.id ?? grouped.size) ?? [];
    group.push(key);
    grouped.set(key.id ?? grouped.size, group);
  }
  return [...grouped.values()].map((keys) => {
    keys.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const first = keys[0];
    const actions = [
      first.onUpdate && first.onUpdate !== "NO ACTION" ? ` ON UPDATE ${first.onUpdate}` : "",
      first.onDelete && first.onDelete !== "NO ACTION" ? ` ON DELETE ${first.onDelete}` : "",
    ].join("");
    return `FOREIGN KEY (${keys.map((key) => quoteIdentifier(key.from, dialect)).join(", ")}) REFERENCES ${quoteIdentifier(first.table, dialect)} (${keys.map((key) => quoteIdentifier(key.to, dialect)).join(", ")})${actions}`;
  });
}

export function createTableSql(schema: ExportSchema, dialect: SqlDialect = "sqlite"): string {
  if (schema.columns.length === 0) {
    throw new Error(`A tabela ${schema.name} não possui colunas.`);
  }
  const definitions = schema.columns.map((column) => {
    const type = column.type.trim() || "TEXT";
    let definition = `${quoteIdentifier(column.name, dialect)} ${type}`;
    if (column.notnull) definition += " NOT NULL";
    if (column.dflt_value !== null) definition += ` DEFAULT ${column.dflt_value}`;
    return definition;
  });
  const primaryKey = schema.columns
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => quoteIdentifier(column.name, dialect));
  if (primaryKey.length > 0) definitions.push(`PRIMARY KEY (${primaryKey.join(", ")})`);
  definitions.push(...foreignKeyClauses(schema.foreignKeys, dialect));
  return `CREATE TABLE ${quoteIdentifier(schema.name, dialect)} (\n  ${definitions.join(",\n  ")}\n);`;
}

export function insertStatements(
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  dialect: SqlDialect = "sqlite"
): string[] {
  if (rows.length === 0 || columns.length === 0) return [];
  const names = columns.map((column) => quoteIdentifier(column, dialect)).join(", ");
  const maxRows = Math.max(1, Math.floor(900 / columns.length));
  const statements: string[] = [];
  for (let offset = 0; offset < rows.length; offset += maxRows) {
    const values = rows
      .slice(offset, offset + maxRows)
      .map(
        (row) =>
          `(${columns.map((column) => sqlLiteral(row[column], dialect)).join(", ")})`
      );
    statements.push(
      `INSERT INTO ${quoteIdentifier(table, dialect)} (${names}) VALUES\n${values.join(",\n")};`
    );
  }
  return statements;
}
