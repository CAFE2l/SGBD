import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSection,
} from "@codemirror/autocomplete";

export type SqlAcceptMode = "tab" | "enter";

export const SQL_ACCEPT_MODES: {
  id: SqlAcceptMode;
  label: string;
  hint: string;
}[] = [
  {
    id: "tab",
    label: "Tab",
    hint: "Tab ou Enter aceita a sugestão",
  },
  {
    id: "enter",
    label: "Enter",
    hint: "Só Enter aceita; Tab recua/avança o recuo",
  },
];

export interface CreatedNames {
  tables: string[];
  columns: string[];
  items: string[];
  databases: string[];
}

export interface CompletionCatalog {
  tables: string[];
  columns: { name: string; table: string; type: string }[];
  items: { value: string; table: string; column: string }[];
  databases: string[];
  /** Nomes criados recentemente (histórico + objetos do schema). */
  created: CreatedNames;
}

const TABLE_SECTION: CompletionSection = { name: "Tabelas", rank: "dynamic" };
const COLUMN_SECTION: CompletionSection = { name: "Colunas", rank: "dynamic" };
const ITEM_SECTION: CompletionSection = { name: "Itens", rank: "dynamic" };
const DATABASE_SECTION: CompletionSection = { name: "Bancos", rank: "dynamic" };
const TYPE_SECTION: CompletionSection = { name: "Tipos", rank: "dynamic" };
const CLAUSE_SECTION: CompletionSection = { name: "Cláusulas", rank: "dynamic" };

const SQL_CLAUSES = [
  "SELECT",
  "FROM",
  "WHERE",
  "INSERT INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE FROM",
  "CREATE TABLE",
  "CREATE DATABASE",
  "ALTER TABLE",
  "DROP TABLE",
  "DROP DATABASE",
  "USE",
  "SHOW TABLES",
  "SHOW DATABASES",
  "JOIN",
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "ON",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "DISTINCT",
  "AS",
  "AND",
  "OR",
  "NOT",
  "IN",
  "LIKE",
  "BETWEEN",
  "IS NULL",
  "IS NOT NULL",
  "PRIMARY KEY",
  "FOREIGN KEY",
  "REFERENCES",
  "NOT NULL",
  "UNIQUE",
  "DEFAULT",
  "CONSTRAINT",
  "IF NOT EXISTS",
  "IF EXISTS",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
];

const SQL_TYPES = [
  "INTEGER",
  "TEXT",
  "REAL",
  "BLOB",
  "NUMERIC",
  "BOOLEAN",
  "DATE",
  "DATETIME",
];

const IDENT_RE =
  /^(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))$/;

const TABLE_TRIGGERS =
  /(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES)\s+$/i;
const COLUMN_TRIGGERS =
  /(?:SELECT|WHERE|SET|ON|BY|HAVING|AND|OR|RETURNING)\s+$/i;
const VALUE_TRIGGERS =
  /(?:VALUES\s*\(|VALUES\s+|=\s*|<>\s*|!=\s*|<\s*|<=\s*|>\s*|>=\s*|LIKE\s+|IN\s*\(|,\s*)$/i;
const DATABASE_TRIGGERS =
  /(?:USE|DATABASE|DATABASES)\s+$/i;
const TYPE_TRIGGERS =
  /(?:CREATE\s+TABLE[\s\S]*\(|,\s*)(?:["`]?[A-Za-z_][A-Za-z0-9_]*["`]?\s+)$/i;

export function emptyCreated(): CreatedNames {
  return { tables: [], columns: [], items: [], databases: [] };
}

export function emptyCatalog(): CompletionCatalog {
  return {
    tables: [],
    columns: [],
    items: [],
    databases: [],
    created: emptyCreated(),
  };
}

/** Junta listas de nomes criados, preservando a ordem (mais recente primeiro). */
export function mergeCreated(parts: CreatedNames[]): CreatedNames {
  const out = emptyCreated();
  const seen = {
    tables: new Set<string>(),
    columns: new Set<string>(),
    items: new Set<string>(),
    databases: new Set<string>(),
  };
  const push = (key: keyof CreatedNames, names: string[]) => {
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      const id = name.toLowerCase();
      if (seen[key].has(id)) continue;
      seen[key].add(id);
      out[key].push(name);
    }
  };
  for (const part of parts) {
    push("tables", part.tables);
    push("columns", part.columns);
    push("items", part.items);
    push("databases", part.databases);
  }
  return out;
}

export function unwrapIdent(raw: string): string {
  const t = raw.trim();
  const m = t.match(IDENT_RE);
  if (!m) return t.replace(/^["`\[]|["`\]]$/g, "");
  return m[1] || m[2] || m[3] || m[4] || t;
}

export function quoteSqlIdent(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteSqlString(value: string): string {
  if (value === "NULL") return "NULL";
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Extrai tabelas, colunas, itens (literais) e bancos recém-citados em um
 * script SQL — usado para priorizar o que o usuário acabou de criar.
 */
export function extractCreatedNames(sql: string): CreatedNames {
  const created = emptyCreated();
  const cleaned = stripSqlComments(sql);

  scanKeywordIdent(cleaned, /CREATE\s+DATABASE(?:\s+IF\s+NOT\s+EXISTS)?/gi, (name) => {
    created.databases.push(name);
  });
  scanKeywordIdent(cleaned, /USE/gi, (name) => {
    created.databases.push(name);
  });
  scanKeywordIdent(cleaned, /DROP\s+DATABASE(?:\s+IF\s+EXISTS)?/gi, (name) => {
    created.databases.push(name);
  });

  scanCreateTable(cleaned, created);
  scanKeywordIdent(cleaned, /INSERT\s+INTO/gi, (name) => {
    created.tables.push(name);
  });
  scanKeywordIdent(cleaned, /ALTER\s+TABLE/gi, (name) => {
    created.tables.push(name);
  });
  scanKeywordIdent(cleaned, /UPDATE/gi, (name) => {
    created.tables.push(name);
  });
  scanKeywordIdent(cleaned, /DROP\s+TABLE(?:\s+IF\s+EXISTS)?/gi, (name) => {
    created.tables.push(name);
  });

  scanInsertColumns(cleaned, created);
  scanAlterAddColumn(cleaned, created);
  scanValueLiterals(cleaned, created);

  return created;
}

/** Mapa nome(lower) → boost 40–99, maior = mais recente / criado pelo usuário. */
export function recencyBoosts(
  schemaCreated: CreatedNames,
  bufferCreated: CreatedNames
): Map<string, number> {
  const map = new Map<string, number>();
  const add = (names: string[], base: number) => {
    names.forEach((name, i) => {
      const key = name.toLowerCase();
      const boost = Math.max(0, base - Math.min(i, 30));
      map.set(key, Math.max(map.get(key) ?? 0, boost));
    });
  };
  add(schemaCreated.databases, 55);
  add(schemaCreated.tables, 70);
  add(schemaCreated.columns, 65);
  add(schemaCreated.items, 50);
  add(bufferCreated.databases, 90);
  add(bufferCreated.tables, 99);
  add(bufferCreated.columns, 95);
  add(bufferCreated.items, 85);
  return map;
}

export function scoreAgainstQuery(label: string, query: string): number {
  if (!query) return 0;
  const a = label.toLowerCase();
  const q = query.toLowerCase();
  if (a === q) return 400;
  if (a.startsWith(q)) return 300 - Math.min(a.length - q.length, 80);
  const idx = a.indexOf(q);
  if (idx >= 0) return 160 - Math.min(idx, 40);
  if (fuzzySubsequence(a, q)) return 40;
  return 0;
}

export function sqlCompletionSource(
  getCatalog: () => CompletionCatalog
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    const catalog = getCatalog();
    const qualified = context.matchBefore(
      /(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z0-9_]*$/
    );
    const quotedIdent = context.matchBefore(/"[^"]*$/);
    const quotedString = context.matchBefore(/'[^']*$/);
    const word = context.matchBefore(/[A-Za-z0-9_]*$/);

    let from = context.pos;
    let query = "";
    let inString = false;

    if (quotedString) {
      from = quotedString.from;
      query = quotedString.text.slice(1);
      inString = true;
    } else if (quotedIdent) {
      from = quotedIdent.from;
      query = quotedIdent.text.slice(1);
    } else if (qualified) {
      const dot = qualified.text.lastIndexOf(".");
      from = qualified.from + dot + 1;
      query = qualified.text.slice(dot + 1);
    } else if (word) {
      from = word.from;
      query = word.text;
    }

    const before = context.state.doc.sliceString(Math.max(0, from - 80), from);
    const bufferCreated = extractCreatedNames(context.state.doc.toString());
    const created = mergeCreated([bufferCreated, catalog.created]);
    const boosts = recencyBoosts(catalog.created, bufferCreated);

    const tableTrigger = TABLE_TRIGGERS.test(before);
    const columnTrigger = COLUMN_TRIGGERS.test(before);
    const valueTrigger = VALUE_TRIGGERS.test(before) || inString;
    const databaseTrigger = DATABASE_TRIGGERS.test(before);
    const typeTrigger = TYPE_TRIGGERS.test(before);

    const qualifiedTable = qualified
      ? unwrapIdent(qualified.text.slice(0, qualified.text.lastIndexOf(".")))
      : null;

    const hasTyped = query.length > 0;
    if (!hasTyped && !context.explicit && !tableTrigger && !columnTrigger && !valueTrigger && !databaseTrigger && !typeTrigger) {
      return null;
    }

    const options: Completion[] = [];

    const kindBoost = (label: string, base: number) =>
      Math.min(99, base + (boosts.get(label.toLowerCase()) ?? 0));

    if (!inString && !qualifiedTable) {
      for (const name of uniqueNames([
        ...created.tables,
        ...catalog.tables,
      ])) {
        options.push({
          label: name,
          type: "class",
          detail: isRecent(created.tables, name) ? "tabela · criada" : "tabela",
          apply: quoteSqlIdent(name),
          section: TABLE_SECTION,
          boost: kindBoost(name, 20),
        });
      }
    }

    const columnPool = qualifiedTable
      ? catalog.columns.filter(
          (c) => c.table.toLowerCase() === qualifiedTable.toLowerCase()
        )
      : catalog.columns;
    const extraCols = qualifiedTable
      ? []
      : created.columns.map((name) => ({
          name,
          table: "",
          type: "",
        }));

    if (!inString) {
      const seenCols = new Set<string>();
      for (const col of [...extraCols, ...columnPool]) {
        const key = `${col.table}.${col.name}`.toLowerCase();
        if (
          seenCols.has(key) ||
          (seenCols.has(col.name.toLowerCase()) && !col.table)
        ) {
          continue;
        }
        seenCols.add(key);
        const recent = isRecent(created.columns, col.name);
        options.push({
          label: col.name,
          type: "property",
          detail: col.table
            ? `${col.table}${col.type ? ` · ${col.type}` : ""}${recent ? " · criada" : ""}`
            : recent
              ? "coluna · criada"
              : "coluna",
          apply: quoteSqlIdent(col.name),
          section: COLUMN_SECTION,
          boost: kindBoost(col.name, 18),
        });
      }
    }

    const showItems =
      !qualifiedTable &&
      (inString || valueTrigger || context.explicit || hasTyped);
    if (showItems) {
      const seenItems = new Set<string>();
      const itemPool = [
        ...created.items.map((value) => ({
          value,
          table: "",
          column: "",
        })),
        ...catalog.items,
      ];
      for (const item of itemPool) {
        const id = item.value.toLowerCase();
        if (!item.value || seenItems.has(id)) continue;
        seenItems.add(id);
        const recent = isRecent(created.items, item.value);
        options.push({
          label: item.value,
          type: "text",
          detail: item.column
            ? `${item.table}.${item.column}${recent ? " · criado" : ""}`
            : recent
              ? "item · criado"
              : "item",
          apply: quoteSqlString(item.value),
          section: ITEM_SECTION,
          boost: kindBoost(item.value, valueTrigger || inString ? 16 : 6),
        });
      }
    }

    if (!inString && !qualifiedTable) {
      for (const name of uniqueNames([
        ...created.databases,
        ...catalog.databases,
      ])) {
        options.push({
          label: name,
          type: "namespace",
          detail: isRecent(created.databases, name) ? "banco · criado" : "banco",
          apply: quoteSqlIdent(name),
          section: DATABASE_SECTION,
          boost: kindBoost(name, databaseTrigger ? 22 : 10),
        });
      }

      for (const type of SQL_TYPES) {
        options.push({
          label: type,
          type: "type",
          detail: "tipo",
          section: TYPE_SECTION,
          boost: typeTrigger ? 8 : 0,
        });
      }

      for (const clause of SQL_CLAUSES) {
        options.push({
          label: clause,
          type: "keyword",
          detail: "cláusula",
          section: CLAUSE_SECTION,
          boost: 0,
        });
      }
    }

    const ranked = rankOptions(options, query, boosts, {
      tableTrigger,
      columnTrigger,
      valueTrigger: valueTrigger || inString,
      databaseTrigger,
      typeTrigger,
    });

    if (ranked.length === 0) return null;

    return {
      from,
      options: ranked,
      validFor: inString ? /^'[^']*$/ : /^[\w"]*$/,
    };
  };
}

export function rankOptions(
  options: Completion[],
  query: string,
  boosts: Map<string, number>,
  ctx: {
    tableTrigger: boolean;
    columnTrigger: boolean;
    valueTrigger: boolean;
    databaseTrigger: boolean;
    typeTrigger: boolean;
  }
): Completion[] {
  const scored = options.map((opt) => {
    const match = scoreAgainstQuery(opt.label, query);
    if (query && match <= 0) return null;
    let extra = 0;
    const sectionName =
      typeof opt.section === "string" ? opt.section : opt.section?.name;
    if (ctx.tableTrigger && sectionName === "Tabelas") extra += 30;
    if (ctx.columnTrigger && sectionName === "Colunas") extra += 30;
    if (ctx.valueTrigger && sectionName === "Itens") extra += 35;
    if (ctx.databaseTrigger && sectionName === "Bancos") extra += 30;
    if (ctx.typeTrigger && sectionName === "Tipos") extra += 25;
    const created = boosts.get(opt.label.toLowerCase()) ?? 0;
    return {
      opt: {
        ...opt,
        boost: Math.min(99, (opt.boost ?? 0) + extra),
      },
      score: match + extra + created,
    };
  });

  return scored
    .filter((s): s is NonNullable<typeof scored[number]> => s != null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.opt.label.localeCompare(b.opt.label);
    })
    .map((s) => s.opt)
    .slice(0, 80);
}

function isRecent(list: string[], name: string): boolean {
  const key = name.toLowerCase();
  return list.some((n) => n.toLowerCase() === key);
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const id = name.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(name);
  }
  return out;
}

function fuzzySubsequence(text: string, query: string): boolean {
  let i = 0;
  for (const ch of text) {
    if (ch === query[i]) i += 1;
    if (i >= query.length) return true;
  }
  return false;
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function skipTrivia(sql: string, i: number): number {
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

function readIdentAt(
  sql: string,
  start: number
): { name: string; next: number } | null {
  const i = skipTrivia(sql, start);
  if (i >= sql.length) return null;
  const ch = sql[i];
  if (ch === '"' || ch === "`") {
    const end = sql.indexOf(ch, i + 1);
    if (end < 0) return null;
    return { name: sql.slice(i + 1, end), next: end + 1 };
  }
  if (ch === "[") {
    const end = sql.indexOf("]", i + 1);
    if (end < 0) return null;
    return { name: sql.slice(i + 1, end), next: end + 1 };
  }
  const slice = sql.slice(i);
  const m = slice.match(/^[A-Za-z_][A-Za-z0-9_]*/);
  if (!m) return null;
  return { name: m[0], next: i + m[0].length };
}

function readBalanced(sql: string, start: number): { body: string; next: number } | null {
  if (sql[start] !== "(") return null;
  let depth = 0;
  let inStr: string | null = null;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      if (ch === inStr && sql[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inStr = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return { body: sql.slice(start + 1, i), next: i + 1 };
      }
    }
  }
  return { body: sql.slice(start + 1), next: sql.length };
}

function scanKeywordIdent(
  sql: string,
  keyword: RegExp,
  onName: (name: string) => void
): void {
  const re = new RegExp(keyword.source, keyword.flags.includes("g") ? keyword.flags : keyword.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const ident = readIdentAt(sql, m.index + m[0].length);
    if (ident?.name) onName(ident.name);
  }
}

function scanCreateTable(sql: string, created: CreatedNames): void {
  const re = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const ident = readIdentAt(sql, m.index + m[0].length);
    if (!ident) continue;
    created.tables.push(ident.name);
    const i = skipTrivia(sql, ident.next);
    if (sql[i] === "(") {
      const body = readBalanced(sql, i);
      if (body) extractColumnsFromCreateBody(body.body, created.columns);
    }
  }
}

function extractColumnsFromCreateBody(body: string, columns: string[]): void {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let inStr: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      current += ch;
      if (ch === inStr && body[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inStr = ch;
      current += ch;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);

  const skip = /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b/i;
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || skip.test(trimmed)) continue;
    const ident = readIdentAt(trimmed, 0);
    if (ident?.name) columns.push(ident.name);
  }
}

function scanInsertColumns(sql: string, created: CreatedNames): void {
  const re = /INSERT\s+INTO/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const table = readIdentAt(sql, m.index + m[0].length);
    if (!table) continue;
    const i = skipTrivia(sql, table.next);
    if (sql[i] !== "(") continue;
    const body = readBalanced(sql, i);
    if (!body) continue;
    for (const part of body.body.split(",")) {
      const ident = readIdentAt(part, 0);
      if (ident?.name) created.columns.push(ident.name);
    }
  }
}

function scanAlterAddColumn(sql: string, created: CreatedNames): void {
  const re = /ALTER\s+TABLE/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const table = readIdentAt(sql, m.index + m[0].length);
    if (!table) continue;
    const rest = sql.slice(table.next);
    const add = rest.match(/^\s+ADD(?:\s+COLUMN)?/i);
    if (!add) continue;
    const ident = readIdentAt(sql, table.next + add[0].length);
    if (ident?.name) created.columns.push(ident.name);
  }
}

function scanValueLiterals(sql: string, created: CreatedNames): void {
  const re = /VALUES\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    let i = skipTrivia(sql, m.index + m[0].length);
    while (sql[i] === "(") {
      const body = readBalanced(sql, i);
      if (!body) break;
      extractLiterals(body.body, created.items);
      i = skipTrivia(sql, body.next);
      if (sql[i] === ",") i = skipTrivia(sql, i + 1);
      else break;
    }
  }
}

function extractLiterals(body: string, items: string[]): void {
  const re = /'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[1] != null) items.push(m[1].replace(/''/g, "'"));
    else if (m[2] != null) items.push(m[2]);
  }
}
