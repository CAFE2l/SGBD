import type { SqlSuggestion } from "./types";
import { recordLearningSeen } from "./fix-learning";
import { validateStatementSyntax } from "@/lib/database-manager";

/**
 * Sugestões de correção automática para comandos SQL que falharam durante a
 * importação de um arquivo .sql. O objetivo é converter dump MySQL "de
 * phpMyAdmin/WordPress" para o subconjunto que o sql.js (SQLite) aceita.
 *
 * Cada sugestão é marcada com uma ação:
 * - "remove": o comando é descartável; basta ignorá-lo na reimportação.
 * - "fix": há uma versão corrigida em `fixed`, validada contra o sql.js.
 * - "manual": erro não-pegável aqui; exige edição manual no Console SQL.
 */

/** Semântica de gating: só corrigimos erros de sintaxe, nunca os semânticos. */
export function isSyntaxLike(message: string): boolean {
  const m = message.toLowerCase();
  if (m.startsWith("near ")) return true;
  return (
    m.includes("syntax error") ||
    m.includes("unrecognized token") ||
    m.includes("no such collation") ||
    m.includes("autoincrement is only allowed")
  );
}

/** Remove bytes de controle ilegais no SQL (mantém \t \n \r). */
export function sanitizeControlCharacters(sql: string): string {
  return sql.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/** Traduz INSERT IGNORE / ON DUPLICATE KEY UPDATE do MySQL para SQLite. */
export function fixInsertMySqlClauses(sql: string): string {
  let out = sql
    .replace(/^\s*INSERT\s+IGNORE\s+INTO/i, "INSERT OR IGNORE INTO")
    .replace(/`([^`]+)`/g, '"$1"');
  out = out.replace(/\s+ON\s+DUPLICATE\s+KEY\s+UPDATE[\s\S]*$/i, "");
  return out.trim();
}

/**
 * Converte literais binários de colunas `bit(1)` do MySQL (como o phpMyAdmin
 * serializa) em booleanos aceitos pelo SQLite, dentro de um INSERT:
 * - `_binary '\0'`  → FALSE (bit 0)
 * - `_binary ''`    → TRUE (bit armazenado, valor não-nulo de 1 bit)
 * - `_binary '\1'`  → TRUE (bit 1)
 * - `_binary '0'` → FALSE / `_binary '1'` → TRUE
 * - `b'0'` → FALSE / `b'1'` → TRUE
 * A conversão é local ao literal; colunas `bit(1)` do CREATE TABLE já mapeiam
 * para BOOLEAN em `mapColumnType`, mantendo os dois lados sincronizados.
 */
export function fixBinaryBitLiterals(sql: string): string {
  return sql
    .replace(/_binary\s*'(\\1)'/gi, "TRUE")
    .replace(/_binary\s*'(\\0)'/gi, "FALSE")
    .replace(/_binary\s*''/gi, "TRUE")
    .replace(/_binary\s*'0'/gi, "FALSE")
    .replace(/_binary\s*'1'/gi, "TRUE")
    .replace(/\bb'(0)'/gi, "FALSE")
    .replace(/\bb'(1)'/gi, "TRUE");
}

/**
 * Sanitiza um `fixed` gerado: roda o parser de validação (mesmo motor do
 * import original, sql.js) e devolve o SQL se passar, ou null + mensagem de
 * erro se a sintaxe ainda for inválida — evitando sugerir uma correção
 * que sabemos que vai falhar (ex: `near "_binary": syntax error`).
 */
async function revalidate(
  fixed: string,
  ruleId: string
): Promise<{ valid: true } | { valid: false; error: string }> {
  const error = await validateStatementSyntax(fixed);
  if (error) return { valid: false, error };
  recordLearningSeen(ruleId);
  return { valid: true };
}

/**
 * Gera uma sugestão de correção para um comando que falhou na importação.
 * `index` é 1-based (usado no log como #N).
 *
 * Correções "fix" são revalidadas contra o parser do sql.js antes de serem
 * oferecidas; se a versão corrigida ainda tiver erro de sintaxe, cai para
 * "manual" em vez de marcar um checkbox que vai falhar de novo.
 */
export async function suggestSqlFix(
  index: number,
  keyword: string,
  sql: string,
  message: string
): Promise<SqlSuggestion> {
  const base = {
    index,
    keyword,
    original: sql,
    message,
  };

  const kw =
    sql.trim().match(/^([a-z]+)/i)?.[1]?.toUpperCase() ?? keyword;

  // ----- Comandos descartáveis (precedência sobre a análise de erro) -----
  if (kw === "SET") {
    recordLearningSeen("set-session");
    return {
      ...base,
      action: "remove",
      ruleId: "set-session",
      reason:
        "Configurações de sessão do MySQL (SET) não existem no SQLite; podem ser descartadas com segurança.",
    };
  }
  if (/^(LOCK|UNLOCK)\s+TABLES/i.test(sql)) {
    recordLearningSeen("lock-tables");
    return {
      ...base,
      action: "remove",
      ruleId: "lock-tables",
      reason:
        "LOCK/UNLOCK TABLES é exclusivo do MySQL; o sql.js controla concorrência internamente.",
    };
  }
  if (/^(START\s+TRANSACTION|BEGIN(?:\s+TRANSACTION)?|COMMIT|ROLLBACK)(\s|;|$)/i.test(sql)) {
    recordLearningSeen("tx-markers");
    return {
      ...base,
      action: "remove",
      ruleId: "tx-markers",
      reason:
        "Início/fim de transação desnecessário na importação: cada comando roda em autocommit.",
    };
  }

  // ----- USE com aspas invertidas (forma comum em dumps phpMyAdmin) -----
  if (kw === "USE" && /`/.test(sql)) {
    const fixed = sql.replace(/`([^`]+)`/g, "$1");
    const check = await revalidate(fixed, "use-backticks");
    if (check.valid) {
      return {
        ...base,
        action: "fix",
        ruleId: "use-backticks",
        fixed,
        reason: "Aspas invertidas removidas do nome do banco.",
      };
    }
  }

  // ----- Atalho de sintaxe: erros semânticos ficam para o usuário -----
  if (!isSyntaxLike(message)) {
    return {
      ...base,
      action: "manual",
      ruleId: "semantic",
      reason:
        "O erro parece envolver schema ou dados (não mera sintaxe); não é seguro corrigir automaticamente.",
    };
  }

  // ----- INSERT -----
  if (kw === "INSERT") {
    const hasControlChars = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(sql);
    const hasBinaryBit = /_binary\s*'/i.test(sql) || /\bb'[01]'/i.test(sql);
    const hasMySqlClauses =
      /^\s*INSERT\s+IGNORE\s+/i.test(sql) ||
      /ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(sql);
    if (hasControlChars || hasBinaryBit || hasMySqlClauses) {
      const fixed = fixInsertMySqlClauses(
        fixBinaryBitLiterals(sanitizeControlCharacters(sql))
      );
      const reasons: string[] = [];
      if (hasControlChars) {
        reasons.push(
          "caracteres de controle inválidos foram removidos dos valores"
        );
      }
      if (hasBinaryBit) {
        reasons.push(
          "literais binários de bit(1) (_binary/b'..') convertidos para TRUE/FALSE"
        );
      }
      if (/^\s*INSERT\s+IGNORE\s+/i.test(sql)) {
        reasons.push("INSERT IGNORE convertido para INSERT OR IGNORE");
      }
      if (/ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(sql)) {
        reasons.push("ON DUPLICATE KEY UPDATE (MySQL) removido");
      }
      const ruleId = hasBinaryBit
        ? "insert-binary-boolean"
        : hasControlChars
          ? "insert-control-chars"
          : "insert-mysql-clauses";
      const check = await revalidate(fixed, ruleId);
      if (!check.valid) {
        return {
          ...base,
          action: "manual",
          ruleId,
          reason:
            `A correção automática ainda falhou na validação (${check.error}); revise o comando manualmente.`,
        };
      }
      return {
        ...base,
        action: "fix",
        ruleId,
        fixed,
        reason: reasons.join("; ").replace(/^./, (c) => c.toUpperCase()) + ".",
      };
    }
  }

  // ----- CREATE TABLE -----
  if (kw === "CREATE" && /^\s*CREATE\s+TABLE/i.test(sql)) {
    const fixed = fixCreateTable(sql);
    if (fixed) {
      const check = await revalidate(fixed, "create-table-mysql");
      if (check.valid) {
        return {
          ...base,
          action: "fix",
          ruleId: "create-table-mysql",
          fixed,
          reason:
            "Sintaxe de CREATE TABLE do MySQL convertida para o SQLite (tipos, chaves e opções de tabela).",
        };
      }
    }
  }

  recordLearningSeen("unknown");
  return {
    ...base,
    action: "manual",
    ruleId: "unknown",
    reason:
      "Não foi possível gerar uma correção automática confiável; edite manualmente no Console SQL.",
  };
}

// ---------------------------------------------------------------------------
// fixCreateTable
// ---------------------------------------------------------------------------

/** Troca aspas invertidas por aspas duplas dentro de um trecho SQL. */
function dq(sql: string): string {
  return sql.replace(/`([^`]+)`/g, '"$1"');
}

/** Extrai o conteúdo entre o par de parênteses que abre em `openIdx`. */
function matchParens(
  sql: string,
  openIdx: number
): { inner: string; rest: string } | null {
  let depth = 0;
  let q: "'" | '"' | null = null;
  for (let i = openIdx; i < sql.length; i++) {
    const ch = sql[i];
    if (q) {
      if (ch === q) {
        if (sql[i + 1] === q) {
          i++;
        } else {
          q = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return {
          inner: sql.slice(openIdx + 1, i),
          rest: sql.slice(i + 1),
        };
      }
    }
  }
  return null;
}

/** Divide a lista de colunas em cláusulas de nível superior. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  let q: "'" | '"' | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (q) {
      cur += ch;
      if (ch === q) {
        if (body[i + 1] === q) {
          cur += body[i + 1];
          i++;
        } else {
          q = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === "(") {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ")") {
      depth--;
      cur += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** Conteúdo do primeiro par de parênteses de uma cláusula, ou null. */
function innerParens(clause: string): string | null {
  const idx = clause.indexOf("(");
  if (idx < 0) return null;
  const m = matchParens(clause, idx);
  return m ? m.inner.trim() : null;
}

/** Mapeia tipos MySQL para tipos aceitos pelo SQLite (com afinidade). */
function mapColumnType(typeFull: string): string {
  const t = typeFull.toLowerCase();
  const base = t.match(/^([a-z]+)/)?.[1] ?? t;
  switch (base) {
    case "tinyint":
      return /^tinyint\s*\(\s*1\s*\)/.test(t) ? "BOOLEAN" : "INTEGER";
    case "smallint":
    case "mediumint":
    case "int":
    case "integer":
      return "INTEGER";
    case "bigint":
      return "BIGINT";
    case "decimal":
    case "numeric":
      return "NUMERIC";
    case "float":
    case "double":
    case "real":
    case "double precision":
      return "REAL";
    case "bool":
    case "boolean":
    case "bit":
      return "BOOLEAN";
    case "datetime":
    case "timestamp":
    case "smalldatetime":
      return "TIMESTAMP";
    case "time":
    case "date":
      return "TEXT";
    case "char":
    case "varchar":
    case "nchar":
    case "nvarchar":
    case "varcharacter":
    case "text":
    case "tinytext":
    case "mediumtext":
    case "longtext":
    case "enum":
    case "set":
    case "json":
      return "TEXT";
    case "year":
      return "INTEGER";
    case "binary":
    case "varbinary":
    case "blob":
    case "tinyblob":
    case "mediumblob":
    case "longblob":
    case "uuid":
      return "BLOB";
    default:
      // Tipos desconhecidos passam literais: o SQLite aceita qualquer nome.
      return typeFull.replace(/`/g, '"');
  }
}

interface CreateState {
  /** true quando uma coluna AUTO_INCREMENT virou INTEGER PRIMARY KEY. */
  autoPromoted: boolean;
}

/** Corrige uma cláusula de nível superior (coluna ou constraint). */
function fixCreateClause(clause: string, state: CreateState): string | null {
  const c = clause.trim();
  const lower = c.toLowerCase();

  if (/^constraint\b/.test(lower)) {
    return dq(c); // CONSTRAINT ... FOREIGN KEY/UNIQUE/CHECK: SQLite aceita
  }
  if (/^primary\s+key\b/.test(lower)) {
    const cols = innerParens(c);
    if (cols == null) return null;
    if (state.autoPromoted) return null; // já é a PK da coluna promovida
    return `PRIMARY KEY (${dq(cols)})`;
  }
  if (/^unique(\s+key)?\b/.test(lower)) {
    const cols = innerParens(c);
    if (cols == null) return null;
    return `UNIQUE (${dq(cols)})`;
  }
  if (
    /^(key|index|fulltext(\s+key)?|spatial(\s+key)?)\b/.test(lower)
  ) {
    return null; // índices secundários: SQLite os cria por transparência
  }
  if (/^foreign\s+key\b/.test(lower)) {
    return dq(c);
  }
  if (/^check\b/.test(lower)) {
    return dq(c);
  }

  // Cláusula de coluna
  const nameMatch = c.match(
    /^(`[^`]+`|"[^"]+"|[A-Za-z0-9_]+)\s+([a-zA-Z][a-zA-Z0-9_]*\s*\([^)]*\)|[a-zA-Z][a-zA-Z0-9_]*)([\s\S]*)$/
  );
  if (!nameMatch) return dq(c);
  const name = dq(nameMatch[1]);
  const colType = mapColumnType(nameMatch[2]);
  const rest = nameMatch[3];

  const hasAuto = /\bAUTO_INCREMENT\b/i.test(rest);
  let attrs = rest
    .replace(/\bUNSIGNED\b/gi, " ")
    .replace(/\bZEROFILL\b/gi, " ")
    .replace(/\bON\s+UPDATE\s+CURRENT_TIMESTAMP\s*(\([^)]*\))?/gi, " ")
    .replace(/\bCHARACTER\s+SET\s+[A-Za-z0-9_]+/gi, " ")
    .replace(/\b(?:CHARSET|COLLATE)\s+[A-Za-z0-9_]+/gi, " ")
    .replace(/\bCOMMENT\s+'[^']*'/g, " ")
    .replace(/\bUSING\s+(?:BTREE|HASH)/gi, " ")
    .replace(/b'(0|1)'/gi, "$1")
    .replace(/`/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  if (hasAuto) {
    state.autoPromoted = true;
    const notNull = /\bNOT\s+NULL\b/i.test(attrs) ? " NOT NULL" : "";
    attrs = attrs
      .replace(/\bNOT\s+NULL\b/gi, " ")
      .replace(/\bPRIMARY\s+KEY\b/gi, " ")
      .replace(/\bAUTO_INCREMENT\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return `${name} INTEGER PRIMARY KEY AUTOINCREMENT${notNull}${
      attrs ? " " + attrs : ""
    }`;
  }

  return `${name} ${colType}${attrs ? " " + attrs : ""}`;
}

/**
 * Converte um `CREATE TABLE` do MySQL para uma versão executável no sql.js.
 * Retorna null quando não consegue (o chamador então cai em "manual").
 */
export function fixCreateTable(sql: string): string | null {
  const headMatch = sql
    .trim()
    .match(/^\s*(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)/i);
  if (!headMatch) return null;
  const openIdx = sql.indexOf("(");
  if (openIdx < 0) return null;
  const parsed = matchParens(sql, openIdx);
  if (!parsed) return null;

  const header = dq(sql.slice(0, openIdx).trimEnd());
  // Opções de tabela após o fechamento: ENGINE=, DEFAULT CHARSET=, COLLATE=…
  // → descartadas (é a origem típica do erro `near "=": syntax error`).
  void parsed.rest;

  const clauses = splitTopLevel(parsed.inner);
  const state: CreateState = { autoPromoted: false };
  const kept: string[] = [];
  for (const clause of clauses) {
    const fixed = fixCreateClause(clause, state);
    if (fixed != null) kept.push(fixed);
  }
  if (kept.length === 0) return null;

  const body = kept.map((k) => "  " + k.trim()).join(",\n");
  return `${header} (\n${body}\n);`;
}