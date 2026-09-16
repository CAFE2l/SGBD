/**
 * Motores suportados na criação de bancos + decisão arquitetural explícita.
 *
 * ── DECISÃO ARQUITETURAL (leia antes de mexer) ─────────────────────────────
 * Hoje o projeto executa 100% no navegador via sql.js (SQLite em WASM),
 * persistido em IndexedDB por usuário (ver `user-scope.ts`). O Neon
 * (Postgres serverless) existe no `.env` e em `src/lib/neon/*`, mas NÃO é o
 * caminho de execução das queries do Console — ele serve para health-check e
 * como rota futura de sincronização server-side.
 *
 * Por isso os 3 "motores" abaixo são, nesta fase, SIMULADOS/TRADUZIDOS sobre o
 * mesmo motor relacional:
 *  - MySQL e PostgreSQL: dialetos SQL quase idênticos ao SQLite para o
 *    subconjunto educacional (CREATE TABLE, INSERT, SELECT, JOIN, FK…).
 *    Validamos a sintaxe como SQL padrão e executamos direto no sql.js.
 *    Diferenças reais (SERIAL vs AUTOINCREMENT, backticks, ENUM, etc.) são
 *    normalizadas pelo `normalizeDialect()` em database-manager.
 *  - MongoDB: sintaxe de documento (`db.col.find({...})`, `insertOne`,
 *    `aggregate`) é TRADUZIDA para SQL equivalente (SELECT/INSERT sobre uma
 *    tabela com o mesmo nome da coleção). Documentos aninhados são achatados
 *    em colunas TEXT (JSON.stringify) na importação — ver `json-import.ts`.
 *
 * Alternativa considerada e REJEITADA por enquanto: bancos realmente
 * distintos (um container MySQL + um Mongo por aluno, ou schemas Neon por
 * usuário). Isso daria fidelidade total, mas exigiria provisionamento por
 * conta, credenciais por aluno, latência de rede e custo — inviável para uso
 * em sala de aula offline-first. Quando houver backend multi-tenant, basta
 * trocar `executeSql()` por um dispatcher que roteia pelo `engine` gravado no
 * registry (o campo já existe e viaja com o banco).
 * ────────────────────────────────────────────────────────────────────────────
 */

export type EngineId = "mysql" | "postgres" | "mongodb";

export interface EngineMeta {
  id: EngineId;
  label: string;
  short: string;
  /** Frase curta explicativa para o aluno (pedida no escopo). */
  tagline: string;
  description: string;
  /** Cor principal (badge / borda do card). */
  color: string;
  badgeClass: string;
  dotClass: string;
  /** Ícone/emoji — sem dependências externas para não inchar o bundle. */
  icon: string;
  dialectHint: string;
  placeholder: string;
}

export const ENGINES: Record<EngineId, EngineMeta> = {
  mysql: {
    id: "mysql",
    label: "MySQL",
    short: "MySQL",
    tagline: "O relacional mais usado no mercado e em sala de aula.",
    description:
      "O clássico das aulas de BD: tabelas, chaves primárias e estrangeiras. Ideal para aprender JOIN e modelagem relacional.",
    color: "#f59e0b",
    badgeClass:
      "border-amber-400/40 bg-amber-400/10 text-amber-300",
    dotClass: "bg-amber-400",
    icon: "🐬",
    dialectHint: "SQL padrão (CREATE TABLE, SELECT, JOIN…)",
    placeholder:
      "CREATE TABLE alunos (id INTEGER PRIMARY KEY, nome TEXT, turma TEXT);\nINSERT INTO alunos (nome, turma) VALUES ('Ana', '3A');\nSELECT * FROM alunos;",
  },
  postgres: {
    id: "postgres",
    label: "PostgreSQL",
    short: "Postgres",
    tagline: "Banco relacional robusto, com recursos SQL avançados.",
    description:
      "SQL turbinado: CTEs, window functions, tipos ricos. Mesma base relacional do MySQL, com superpoderes para consultas avançadas.",
    color: "#38bdf8",
    badgeClass: "border-sky-400/40 bg-sky-400/10 text-sky-300",
    dotClass: "bg-sky-400",
    icon: "🐘",
    dialectHint: "SQL avançado (CTE, WINDOW, RETURNING…)",
    placeholder:
      "CREATE TABLE pedidos (id INTEGER PRIMARY KEY, cliente TEXT, total REAL);\nINSERT INTO pedidos VALUES (1, 'Bia', 99.9);\nSELECT cliente, SUM(total) OVER () AS acumulado FROM pedidos;",
  },
  mongodb: {
    id: "mongodb",
    label: "MongoDB",
    short: "MongoDB",
    tagline: "Banco de documentos, flexível, sem schema fixo.",
    description:
      "Sem tabelas rígidas: cada registro é um documento JSON. Ótimo para dados aninhados e prototipagem rápida.",
    color: "#34d399",
    badgeClass:
      "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    dotClass: "bg-emerald-400",
    icon: "🍃",
    dialectHint: "Documentos: db.colecao.find({ … })",
    placeholder:
      'db.alunos.insertOne({ nome: "Ana", turma: "3A", notas: [8, 9] })\ndb.alunos.find({ turma: "3A" })',
  },
};

export const ENGINE_IDS: EngineId[] = ["mysql", "postgres", "mongodb"];

export function isEngineId(v: unknown): v is EngineId {
  return v === "mysql" || v === "postgres" || v === "mongodb";
}

export function engineOrDefault(v: unknown): EngineId {
  return isEngineId(v) ? v : "postgres";
}
