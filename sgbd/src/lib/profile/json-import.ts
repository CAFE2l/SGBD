/**
 * Importação inteligente de JSON (requisito 5 do /perfil).
 *
 * DETECÇÃO AUTOMÁTICA:
 * - Array de objetos "planos" (só escalares) → vira TABELA relacional
 *   (colunas = união das chaves; ideal para MySQL/Postgres).
 * - Objeto único, array com objetos aninhados, ou qualquer estrutura com
 *   objetos/arrays dentro → vira COLEÇÃO de documentos: criamos uma tabela
 *   com `id INTEGER PK + data TEXT (JSON)` preservando o documento original,
 *   que é o mapeamento que "melhor encaixa no MongoDB" nesta fase
 *   (ver decisão arquitetural em `engines.ts`).
 */

export type JsonShape = "relational" | "document";

export interface JsonAnalysis {
  shape: JsonShape;
  reason: string;
  columns?: string[];
  rowCount: number;
  suggestedTable: string;
}

function isScalar(v: unknown): boolean {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

function baseName(fileName: string): string {
  const b = fileName.replace(/\.[^.]+$/, "").trim() || "dados";
  return b.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40) || "dados";
}

export function analyzeJson(text: string, fileName: string): JsonAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Arquivo .json inválido (JSON.parse falhou).");
  }
  const suggestedTable = baseName(fileName);
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return { shape: "relational", reason: "Array vazio — tabela vazia com coluna id.", columns: ["id"], rowCount: 0, suggestedTable };
    }
    const allObjects = parsed.every((r) => typeof r === "object" && r !== null && !Array.isArray(r));
    if (!allObjects) {
      return { shape: "document", reason: "Array com valores mistos — preservado como documentos JSON.", rowCount: parsed.length, suggestedTable };
    }
    const objs = parsed as Record<string, unknown>[];
    const nested = objs.some((o) => Object.values(o).some((v) => !isScalar(v)));
    if (nested) {
      return { shape: "document", reason: "Objetos com campos aninhados (arrays/objetos) — mapeia melhor para MongoDB como coleção de documentos.", rowCount: objs.length, suggestedTable };
    }
    const cols: string[] = [];
    for (const o of objs) for (const k of Object.keys(o)) if (!cols.includes(k)) cols.push(k);
    return { shape: "relational", reason: `Array de ${objs.length} objeto(s) plano(s) → tabela relacional com ${cols.length} coluna(s).`, columns: cols, rowCount: objs.length, suggestedTable };
  }
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    const vals = Object.values(obj);
    // { "tabela1": [...], "tabela2": [...] } → relacional multi-tabela? tratamos como documentos por simplicidade
    if (vals.length > 0 && vals.every((v) => Array.isArray(v))) {
      return { shape: "document", reason: "Objeto com múltiplas listas — importado como documentos (uma coleção por chave na fase atual vira 1 tabela JSON).", rowCount: vals.length, suggestedTable };
    }
    return { shape: "document", reason: "Objeto único / documento aninhado — preservado como documento JSON (ideal MongoDB).", rowCount: 1, suggestedTable };
  }
  return { shape: "document", reason: "Valor escalar — guardado como documento único.", rowCount: 1, suggestedTable };
}

function escIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function sqlLit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Gera o SQL (CREATE + INSERTs) correspondente à análise. */
export function buildJsonSql(text: string, fileName: string): { sql: string; analysis: JsonAnalysis } {
  const analysis = analyzeJson(text, fileName);
  const parsed: unknown = JSON.parse(text);
  const t = escIdent(analysis.suggestedTable);
  const parts: string[] = [];
  if (analysis.shape === "relational") {
    const cols = analysis.columns ?? ["id"];
    const defs = cols.map((c) => `${escIdent(c)} TEXT`).join(", ");
    parts.push(`CREATE TABLE IF NOT EXISTS ${t} (${defs});`);
    const rows = Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
    for (const r of rows) {
      const list = cols.map((c) => escIdent(c)).join(", ");
      const vals = cols.map((c) => sqlLit(r[c] ?? null)).join(", ");
      parts.push(`INSERT INTO ${t} (${list}) VALUES (${vals});`);
    }
  } else {
    parts.push(`CREATE TABLE IF NOT EXISTS ${t} (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT);`);
    const docs: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    for (const d of docs) {
      parts.push(`INSERT INTO ${t} (data) VALUES (${sqlLit(JSON.stringify(d))});`);
    }
  }
  return { sql: parts.join("\n"), analysis };
}
