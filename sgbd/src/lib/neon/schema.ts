import { randomUUID } from "crypto";
import { config } from "@/lib/config";

/**
 * Gera um identificador de schema de sessão no formato:
 *   aluno_<alias>_<yyyymmdd>
 * Se alias for omitido, usa um resumo curto aleatório.
 */
export function buildSchemaName(alias?: string): string {
  const base = (alias ?? "aula").toLowerCase().replace(/[^a-z0-9]/g, "_");
  const safe = base.slice(0, 24);
  const date = new Date();
  const ymd =
    String(date.getFullYear()) +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0");
  return `aluno_${safe}_${ymd}`;
}

/**
 * Prefixo para um schema único por sessão de upload (evita colisão
 * quando dois uploads do mesmo aluno acontecem no mesmo dia).
 */
export function buildSchemaNameUnique(alias?: string): string {
  const short = randomUUID().slice(0, 6);
  return `${buildSchemaName(alias)}_${short}`;
}

/**
 * Padrões de grafia válidos para nomes de schema gerados por nós.
 * Usado para validar o schema antes de montar a query.
 */
export const SCHEMA_NAME_PATTERN = /^[a-z0-9_]+$/;

export function isValidSchemaName(name: string): boolean {
  return SCHEMA_NAME_PATTERN.test(name) && name.length <= 63;
}

/**
 * Expiração configurada (horas) dos schemas de importação.
 */
export function schemaTtlMs(): number {
  return config.schemaTtlHours * 60 * 60 * 1000;
}
