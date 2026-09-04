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

export interface ImportReport {
  tableName: string;
  tableCount: number;
  rowCount: number;
  log: string[];
  errors: string[];
  /** SQL equivalente à importação (CREATE + INSERTs, ou script .sql original). */
  code: string;
}
