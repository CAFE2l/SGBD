export interface TableInfo {
  name: string;
  sql: string | null;
}

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export interface TableSchema {
  name: string;
  sql: string | null;
  columns: ColumnInfo[];
}

export type Row = Record<string, unknown>;

export interface QueryResult {
  columns: string[];
  rows: Row[];
  /** true quando o comando foi um SELECT (tem colunas/linhas retornadas) */
  isSelect: boolean;
  /** número de linhas afetadas (INSERT/UPDATE/DELETE) */
  affected?: number;
  /** comando executado, para exibição */
  message: string;
}

export interface CsvInference {
  type: string;
  sample: string;
}

export interface ScriptStatementResult {
  index: number;
  sql: string;
  keyword: string;
  success: boolean;
  message: string;
  result?: QueryResult;
}

export interface QueryScriptResult {
  statements: ScriptStatementResult[];
  /** linhas prontas para exibição no log (✅/❌ por comando) */
  log: string[];
  /** primeiro erro, se houve (quando stopOnError) */
  error: string | null;
  /** último resultado tabular (SELECT/SHOW) para renderizar como tabela */
  final: QueryResult | null;
}

/**
 * Ação sugerida para corrigir um comando SQL que falhou na importação.
 * - "remove": o comando é descartável (SET/LOCK/UNLOCK), basta ignorá-lo.
 * - "fix": existe uma versão corrigida executável (ver `fixed`).
 * - "manual": não é possível corrigir automaticamente; exige edição manual.
 */
export type SqlSuggestionAction = "remove" | "fix" | "manual";

/** Sugestão de correção para um comando que falhou na importação. */
export interface SqlSuggestion {
  /** Índice do comando no arquivo original (1-based, usado no log como #N). */
  index: number;
  /** Palavra-chave do comando (CREATE, INSERT, SET…). */
  keyword: string;
  /** SQL original que falhou. */
  original: string;
  /** Mensagem de erro retornada pelo motor. */
  message: string;
  /** Ação sugerida. */
  action: SqlSuggestionAction;
  /** Explicação curta da sugestão, em português. */
  reason: string;
  /** SQL corrigido (presente quando action === "fix"). */
  fixed?: string;
  /** Identificador da regra de correção (para estatísticas de aprendizado). */
  ruleId: string;
}

export interface ImportReport {
  tableName: string;
  tableCount: number;
  rowCount: number;
  log: string[];
  errors: string[];
  /** SQL equivalente à importação (CREATE + INSERTs, ou script .sql original). */
  code: string;
  /** Sugestões de correção para comandos que falharam (quando aplicável). */
  suggestions?: SqlSuggestion[];
}
