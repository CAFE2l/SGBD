/**
 * Utilitários para truncar SQL exibido na UI, evitando DOM gigantes.
 */

const PREVIEW_MAX_CHARS = 300;
const PREVIEW_MAX_LINES = 3;
const HUGE_THRESHOLD = 200_000; // 200 KB

export interface TruncatedSql {
  preview: string;
  full: string;
  length: number;
  lineCount: number;
  isHuge: boolean;
}

/**
 * Trunca SQL para exibição: retorna preview + metadados, mantendo o original
 * separado para uso em execução (não em renderização).
 */
export function truncateSql(sql: string): TruncatedSql {
  const length = sql.length;
  const lines = sql.split("\n");
  const lineCount = lines.length;
  const isHuge = length > HUGE_THRESHOLD;

  let preview = sql;
  let needsEllipsis = false;

  // Trunca por caracteres
  if (length > PREVIEW_MAX_CHARS) {
    preview = sql.slice(0, PREVIEW_MAX_CHARS);
    needsEllipsis = true;
  }

  // Trunca por linhas
  if (lineCount > PREVIEW_MAX_LINES) {
    preview = lines.slice(0, PREVIEW_MAX_LINES).join("\n");
    needsEllipsis = true;
  }

  // Adiciona "…" se truncou
  if (needsEllipsis) {
    preview += "…";
  }

  return {
    preview,
    full: sql,
    length,
    lineCount,
    isHuge,
  };
}

/**
 * Formata metadados de truncamento para exibição na UI.
 * Ex: "+1.234.567 caracteres, ~8.400 linhas"
 */
export function formatTruncatedMeta(truncated: TruncatedSql): string {
  const parts: string[] = [];
  if (truncated.length > PREVIEW_MAX_CHARS) {
    parts.push(`+${truncated.length.toLocaleString("pt-BR")} caracteres`);
  }
  if (truncated.lineCount > PREVIEW_MAX_LINES) {
    parts.push(`~${truncated.lineCount.toLocaleString("pt-BR")} linhas`);
  }
  return parts.length > 0 ? `(${parts.join(", ")})` : "";
}

/**
 * Para SQL extremamente grande, retorna apenas o início e fim com "…" no meio.
 */
export function truncateHugeSql(sql: string, startChars = 5000, endChars = 5000): string {
  if (sql.length <= startChars + endChars) {
    return sql;
  }
  return sql.slice(0, startChars) + "\n…\n[SQL muito grande para exibir completamente — use 'Copiar SQL completo']\n…\n" + sql.slice(-endChars);
}
