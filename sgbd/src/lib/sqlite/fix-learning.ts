/**
 * Estatísticas leves de aprendizado de correções (fase 2): contadores
 * `seen`/`fixed` por regra, persistidos em localStorage no navegador.
 * O objetivo futuro é ranquear regras e, eventualmente, aplicá-las de forma
 * automática com base na taxa de sucesso observada.
 */

const STORAGE_KEY = "sgbd:fix:stats:v1";

export interface FixStats {
  seen: Record<string, number>;
  fixed: Record<string, number>;
}

export function emptyFixStats(): FixStats {
  return { seen: {}, fixed: {} };
}

function readStats(): FixStats {
  if (typeof window === "undefined") return emptyFixStats();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyFixStats();
    const parsed = JSON.parse(raw) as Partial<FixStats>;
    return {
      seen: parsed.seen ?? {},
      fixed: parsed.fixed ?? {},
    };
  } catch {
    return emptyFixStats();
  }
}

function patchStats(s: FixStats): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // armazenamento indisponível: estatísticas são best-effort
  }
}

/** Registra que uma regra de correção foi sugerida. */
export function recordLearningSeen(ruleId: string): void {
  const stats = readStats();
  stats.seen[ruleId] = (stats.seen[ruleId] ?? 0) + 1;
  patchStats(stats);
}

/** Registra que uma correção sugerida foi aplicada com sucesso. */
export function recordLearningFixed(ruleId: string): void {
  const stats = readStats();
  stats.fixed[ruleId] = (stats.fixed[ruleId] ?? 0) + 1;
  patchStats(stats);
}

/** Retorna as estatísticas atuais de aprendizado. */
export function getLearningStats(): FixStats {
  return readStats();
}