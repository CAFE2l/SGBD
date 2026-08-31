import { Pool } from "@neondatabase/serverless";
import { config, isNeonConfigured } from "@/lib/config";

let pool: Pool | null = null;

/**
 * Retorna um pool de conexões Neon, criando sob demanda.
 * Em ambiente serverless é seguro reutilizar o pool entre requisições.
 */
export function getPool(): Pool {
  if (!isNeonConfigured()) {
    throw new Error("DATABASE_URL não configurada no .env.local");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: config.neon.databaseUrl,
      max: 3,
    });
  }
  return pool;
}

export interface NeonStatus {
  configured: boolean;
  connected: boolean;
  error?: string;
}

/**
 * Testa a conectividade com o Neon executando uma query trivial.
 */
export async function checkNeonConnection(): Promise<NeonStatus> {
  if (!isNeonConfigured()) {
    return { configured: false, connected: false };
  }
  try {
    const p = getPool();
    const res = await p.query("SELECT 1 AS ok");
    const connected = res.rows[0]?.ok === 1;
    return { configured: true, connected };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { configured: true, connected: false, error: message };
  }
}

/**
 * Escapa um identificador (nome de schema/tabela/coluna) para SQL.
 * Evita injeção por nomes vindos de input do usuário.
 */
export function ident(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}
