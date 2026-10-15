/**
 * CSV Parser for SGBD
 * 
 * Features:
 * - UTF-8 BOM handling
 * - Auto-detect delimiter (comma, semicolon, tab, pipe)
 * - Quoted field parsing with escaped quotes
 * - Embedded newline support
 * - Trailing blank line handling
 * - Column name sanitization
 * - Type inference (INTEGER, REAL, TEXT, DATE, DATETIME, BOOLEAN)
 */

export interface CsvParseResult {
  columns: string[];
  rows: (string | null)[][];
  delimiter: string;
}

export type ColumnType = "INTEGER" | "REAL" | "TEXT" | "DATE" | "DATETIME" | "BOOLEAN";

/**
 * Detect the delimiter used in CSV content
 * Tries comma, semicolon, tab, pipe in order of likelihood
 */
function detectDelimiter(content: string): string {
  const lines = content.split("\n").filter(l => l.trim().length > 0);
  if (lines.length < 2) return ",";
  
  // Count potential delimiters in the first two lines
  const firstLine = lines[0];
  const secondLine = lines[1];
  
  const delimiters = [",", ";", "\t", "|"];
  const counts: Record<string, number> = {};
  
  for (const delim of delimiters) {
    const firstCount = (firstLine.match(new RegExp(`\\${delim}`, "g")) || []).length;
    const secondCount = (secondLine.match(new RegExp(`\\${delim}`, "g")) || []).length;
    counts[delim] = firstCount + secondCount;
  }
  
  // Find delimiter with highest consistent count
  let bestDelim = ",";
  let bestScore = 0;
  
  for (const delim of delimiters) {
    const score = counts[delim];
    if (score > bestScore) {
      bestScore = score;
      bestDelim = delim;
    }
  }
  
  // Handle special case: tab
  if (bestDelim === "\t") return "\t";
  
  return bestDelim;
}

/**
 * Parse CSV content into columns and rows
 * Handles quoted fields, escaped quotes, and embedded newlines
 */
export function parseCsv(content: string): CsvParseResult {
  // Remove UTF-8 BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  
  // Remove trailing blank lines
  while (content.endsWith("\n")) {
    content = content.slice(0, -1);
  }
  while (content.endsWith("\r")) {
    content = content.slice(0, -1);
  }
  
  const delimiter = detectDelimiter(content);
  const lines = splitCsvLines(content);
  
  if (lines.length === 0) {
    return { columns: [], rows: [], delimiter };
  }
  
  const columns = parseCsvLine(lines[0], delimiter);
  const rows: (string | null)[][] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i], delimiter);
    rows.push(row);
  }
  
  return { columns, rows, delimiter };
}

/**
 * Split CSV content into individual lines (handling quoted newlines)
 */
function splitCsvLines(content: string): string[] {
  const lines: string[] = [];
  let currentLine = "";
  let inQuotes = false;
  let escapeNext = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    
    if (escapeNext) {
      currentLine += char;
      escapeNext = false;
      continue;
    }
    
    if (char === "\\" && inQuotes) {
      escapeNext = true;
      continue;
    }
    
    if (char === '"') {
      inQuotes = !inQuotes;
      currentLine += char;
      continue;
    }
    
    if (!inQuotes && (char === "\n" || char === "\r")) {
      // Handle \r\n
      if (char === "\r" && i + 1 < content.length && content[i + 1] === "\n") {
        i++;
      }
      if (currentLine.trim() !== "") {
        lines.push(currentLine);
      }
      currentLine = "";
      continue;
    }
    
    currentLine += char;
  }
  
  // Add last line if not empty
  if (currentLine.trim() !== "") {
    lines.push(currentLine);
  }
  
  return lines;
}

/**
 * Parse a single CSV line into fields
 * Preserves the original quote style but extracts field values
 */
function parseCsvLine(line: string, delimiter: string): (string | null)[] {
  const fields: (string | null)[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    const nextChar = i + 1 < line.length ? line[i + 1] : "";
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        currentField += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }
    
    if (!inQuotes && char === delimiter) {
      fields.push(currentField || null);
      currentField = "";
      i++;
      continue;
    }
    
    currentField += char;
    i++;
  }
  
  // Add the last field
  fields.push(currentField || null);
  
  return fields;
}

/**
 * Detect if a string represents a date
 * Supports ISO format (YYYY-MM-DD) and Brazilian format (DD/MM/YYYY)
 */
function isDate(value: string): boolean {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/; // ISO: 2024-01-15
  const brDateRegex = /^\d{2}\/\d{2}\/\d{4}$/; // Brazilian: 15/01/2024
  return dateRegex.test(value) || brDateRegex.test(value);
}

/**
 * Detect if a string represents a datetime
 * Supports ISO format (YYYY-MM-DDTHH:MM:SS) and Brazilian datetime
 */
function isDateTime(value: string): boolean {
  const isoDatetime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;
  const brDatetime = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/;
  return isoDatetime.test(value) || brDatetime.test(value);
}

/**
 * Detect if a value represents a boolean
 */
function isBoolean(value: string): boolean {
  const lower = value.toLowerCase().trim();
  return lower === "true" || lower === "false" || 
         lower === "sim" || lower === "nao" || lower === "não" ||
         lower === "1" || lower === "0" ||
         value === "S" || value === "N";
}

/**
 * Convert boolean string to standard form
 */
function toBooleanString(value: string): string {
  const lower = value.toLowerCase().trim();
  if (lower === "true" || lower === "sim" || lower === "1" || value === "S") return "TRUE";
  return "FALSE";
}

/**
 * Infer column types from all values in the column
 * Returns INTEGER, REAL, TEXT, DATE, DATETIME, or BOOLEAN
 */
export function inferColumnType(values: (string | null)[]): ColumnType {
  let anyValue = false;
  let allNumbers = true;
  let allInt = true;
  let hasDate = false;
  let hasDatetime = false;
  let hasBoolean = false;
  let booleanCount = 0;
  
  for (const v of values) {
    if (v == null || v === "") continue;
    anyValue = true;
    const trimmed = v.trim();
    
    // Check for boolean
    if (isBoolean(trimmed)) {
      hasBoolean = true;
      booleanCount++;
      continue;
    }
    
    // Check for datetime
    if (isDateTime(trimmed)) {
      hasDatetime = true;
      continue;
    }
    
    // Check for date
    if (isDate(trimmed)) {
      hasDate = true;
      continue;
    }
    
    const num = Number(trimmed);
    if (trimmed !== "" && Number.isNaN(num)) {
      allNumbers = false;
    } else {
      if (num % 1 !== 0) allInt = false;
    }
  }
  
  if (!anyValue) return "TEXT";
  
  // Boolean column if most values are boolean
  if (hasBoolean && booleanCount >= values.length * 0.5) {
    return "BOOLEAN";
  }
  
  if (allNumbers && allInt) return "INTEGER";
  if (allNumbers) return "REAL";
  if (hasDatetime) return "DATETIME";
  if (hasDate) return "DATE";
  
  return "TEXT";
}

/**
 * Check if a column name is a SQL reserved keyword
 */
function isReservedKeyword(name: string): boolean {
  const reserved = [
    "select", "from", "where", "insert", "update", "delete", "create", "drop",
    "table", "index", "view", "join", "left", "right", "inner", "outer",
    "on", "and", "or", "not", "in", "like", "between", "is", "null", "not",
    "primary", "key", "foreign", "references", "constraint", "default",
    "check", "unique", "not", "null", "asc", "desc", "order", "by",
    "group", "having", "limit", "offset", "as", "distinct", "all", "any",
    "exists", "case", "when", "then", "else", "end", "cast", "collate",
    "current_date", "current_time", "current_timestamp", "now", "today",
    "id", "table", "column", "row", "index", "name", "value", "data"
  ];
  return reserved.includes(name.toLowerCase());
}

/**
 * Sanitize column names: trim, replace invalid chars, handle duplicates
 */
export function sanitizeColumnNames(columns: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  
  for (let i = 0; i < columns.length; i++) {
    let name = columns[i].trim().replace(/[^a-zA-Z0-9_]/g, "_");
    
    // Handle empty names
    if (name === "" || name.length === 0) {
      name = `col_${i + 1}`;
    }
    
    // Handle reserved keywords by prefixing
    if (isReservedKeyword(name)) {
      name = `col_${name}`;
    }
    
    // Handle duplicates
    let lowerName = name.toLowerCase();
    let counter = 1;
    while (seen.has(lowerName)) {
      name = `${name}_${counter}`;
      lowerName = name.toLowerCase();
      counter++;
    }
    
    seen.add(lowerName);
    result.push(name);
  }
  
  return result;
}

/**
 * Parse CSV and type-infer columns
 * Returns clean columns, rows, and inferred types for each column
 */
export interface CsvParseWithTypesResult {
  columns: string[];
  rows: (string | null)[][];
  types: ColumnType[];
  delimiter: string;
}

export function parseCsvWithTypes(content: string): CsvParseWithTypesResult {
  const parsed = parseCsv(content);
  const { columns, rows } = parsed;
  
  // Sanitize column names
  const cleanColumns = sanitizeColumnNames(columns);
  
  // Transpose rows for type inference
  const columnValues: (string | null)[][] = [];
  for (let i = 0; i < cleanColumns.length; i++) {
    columnValues[i] = [];
    for (const row of rows) {
      const val = row[i];
      columnValues[i].push(val == null || val === "" ? null : val);
    }
  }
  
  // Infer types for each column
  const types: ColumnType[] = columnValues.map(inferColumnType);
  
  return {
    columns: cleanColumns,
    rows,
    types,
    delimiter: parsed.delimiter,
  };
}