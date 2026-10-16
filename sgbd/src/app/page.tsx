"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { PageShell } from "@/components/PageShell";
import { EngineBadge } from "@/components/EngineBadge";
import { TiltCard } from "@/components/ui/TiltCard";
import { StatTile } from "@/components/ui/StatTile";
import { FadeIn, FloatingOrb } from "@/components/FadeIn";
import { useAuth } from "@/hooks/useAuth";
import { useDb } from "@/hooks/useDb";
import {
  describeDatabase,
  getDatabaseEngine,
  getProfileStats,
  inspectDatabase,
} from "@/lib/sqlite/db";
import { getGlobalQueryLog, type GlobalQueryEntry } from "@/lib/sqlite/history";
import { engineOrDefault } from "@/lib/profile/engines";

interface HomeDbInfo {
  tables: number;
  rows: number;
}

export default function Home() {
  const { user } = useAuth();
  const { databases, activeDatabase, ready } = useDb();
  const [dbInfo, setDbInfo] = useState<Record<string, HomeDbInfo>>({});
  const [queries, setQueries] = useState<GlobalQueryEntry[]>([]);
  const [stats, setStats] = useState({ totalQueries: 0, totalTablesCreated: 0 });

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void Promise.all([
      getGlobalQueryLog(),
      Promise.all(
        databases.map(async (name) => {
          try {
            const [description, info] = await Promise.all([
              describeDatabase(name),
              inspectDatabase(name),
            ]);
            return [name, { tables: info.tableCount, rows: description.rowCount }] as const;
          } catch {
            return [name, { tables: 0, rows: 0 }] as const;
          }
        })
      ),
    ]).then(([log, info]) => {
      if (cancelled) return;
      setQueries(log.slice(0, 6));
      setDbInfo(Object.fromEntries(info));
      const profileStats = getProfileStats();
      setStats({
        totalQueries: profileStats.totalQueries,
        totalTablesCreated: profileStats.totalTablesCreated,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [databases, ready]);

  if (!user) {
    return (
      <PageShell>
        <section className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden text-center">
          <FloatingOrb className="-left-24 top-16 h-64 w-64 bg-sky-500/20 blur-[100px]" />
          <FloatingOrb
            className="-right-16 bottom-10 h-72 w-72 bg-cyan-400/15 blur-[110px]"
            duration={15}
            delay={1.2}
          />
          <FloatingOrb
            className="left-1/3 -top-10 h-40 w-40 bg-indigo-500/15 blur-[80px]"
            duration={18}
            delay={0.6}
          />
          <div className="relative z-10 flex flex-col items-center">
            <FadeIn>
              <span className="glass rounded-full border-sky-400/20 px-4 py-1.5 text-xs uppercase tracking-widest text-sky-300 shadow-glow-sm">
                SGBD Web Educacional
              </span>
            </FadeIn>
            <FadeIn delay={0.1}>
              <h1 className="mt-6 text-4xl font-bold tracking-tight text-white drop-shadow-[0_4px_30px_rgba(56,189,248,0.15)] sm:text-6xl">
                Importe. Consulte.
                <br />
                <span className="bg-gradient-to-r from-sky-400 to-cyan-300 bg-clip-text text-transparent">
                  Exporte dados.
                </span>
              </h1>
            </FadeIn>
            <FadeIn delay={0.2}>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg">
                Uma ferramenta visual para sala de aula: importe arquivos{" "}
                <code className="rounded bg-white/10 px-1.5 py-0.5 text-sky-300">.sql</code>{" "}
                e{" "}
                <code className="rounded bg-white/10 px-1.5 py-0.5 text-sky-300">.csv</code>,
                rode consultas SQL e explore seus dados — tudo no navegador.
              </p>
            </FadeIn>
            <FadeIn delay={0.3}>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/signup"
                  className="glass-button focus-ring rounded-xl bg-sky-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-glow hover:bg-sky-300"
                >
                  Criar conta
                </Link>
                <Link
                  href="/login"
                  className="glass-button focus-ring glass rounded-xl px-5 py-2.5 text-sm font-semibold text-sky-200 hover:bg-white/10"
                >
                  Entrar
                </Link>
              </div>
            </FadeIn>
          </div>
        </section>
      </PageShell>
    );
  }

  const displayName = user.displayName ?? user.email?.split("@")[0] ?? "Aluno";
  const totalTables = Object.values(dbInfo).reduce((sum, info) => sum + info.tables, 0);
  const visibleDatabases = databases.slice(0, 3);

  return (
    <PageShell>
      <div className="space-y-9 pb-10">
        <FadeIn>
          <section className="glass-panel relative overflow-hidden rounded-[24px] p-5 sm:p-7">
            <div className="profile-gradient-bar absolute inset-x-0 top-0 h-1.5" />
            <div className="flex flex-wrap items-center gap-4 pt-1">
              {user.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.photoURL} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-cyan-300/40" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-cyan-300/10 text-2xl font-bold text-cyan-200 ring-2 ring-cyan-300/40">
                  {displayName[0]?.toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Seu espaço de trabalho</p>
                <h1 className="mt-1 truncate text-2xl font-bold text-white sm:text-3xl">Olá, {displayName}</h1>
                <p className="mt-1 truncate text-sm text-slate-400">{user.email}</p>
              </div>
              <Link href="/perfil" className="focus-ring rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/5">
                Meu perfil
              </Link>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3">
              <StatTile label="Bancos" value={databases.length} />
              <StatTile label="Consultas" value={stats.totalQueries} />
              <StatTile label="Tabelas" value={totalTables} />
            </div>
          </section>
        </FadeIn>

        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Seus projetos</p>
              <h2 className="mt-1 text-xl font-bold text-white">Meus Bancos de Dados ({databases.length})</h2>
            </div>
            <Link href="/bancos" className="glass-button focus-ring rounded-xl bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-300">
              + Criar novo banco
            </Link>
          </div>

          {!ready ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((item) => <div key={item} className="skeleton-shimmer h-32 rounded-2xl" />)}
            </div>
          ) : databases.length === 0 ? (
            <div className="glass-panel rounded-[24px] px-6 py-10 text-center sm:px-10">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-300/10 text-3xl text-cyan-200" aria-hidden>▤</div>
              <h3 className="mt-4 text-lg font-bold text-white">Nenhum banco criado ainda</h3>
              <p className="mt-2 text-sm text-slate-400">Crie seu primeiro banco de dados e comece a consultar suas informações.</p>
              <Link href="/bancos" className="glass-button focus-ring mt-5 inline-flex rounded-xl bg-sky-400 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-300">
                + Criar novo banco
              </Link>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleDatabases.map((name, index) => (
                  <motion.div key={name} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06 }}>
                    <TiltCard className="h-full">
                      <Link href={`/console?db=${encodeURIComponent(name)}`} className="focus-ring block p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="truncate font-mono text-sm font-bold text-white">{name}</span>
                          {name === activeDatabase && <span className="status-pulse h-2 w-2 rounded-full bg-emerald-300" aria-label="Banco ativo" />}
                        </div>
                        <div className="mt-3"><EngineBadge engine={engineOrDefault(getDatabaseEngine(name))} /></div>
                        <p className="mt-3 text-xs text-slate-400">{dbInfo[name]?.tables ?? 0} tabelas · {dbInfo[name]?.rows ?? 0} linhas</p>
                      </Link>
                    </TiltCard>
                  </motion.div>
                ))}
              </div>
              {databases.length > visibleDatabases.length && (
                <Link href="/bancos" className="mt-3 inline-flex text-sm font-semibold text-cyan-200 hover:text-white">
                  Ver todos os bancos →
                </Link>
              )}
            </>
          )}
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Atividade recente</p>
              <h2 className="mt-1 text-xl font-bold text-white">Histórico de Queries</h2>
            </div>
            <Link href="/perfil" className="text-xs font-semibold text-slate-400 hover:text-cyan-200">Ver histórico completo →</Link>
          </div>
          {queries.length === 0 ? (
            <div className="glass-panel rounded-2xl p-6 text-center text-sm text-slate-400">
              {stats.totalTablesCreated ? "As consultas recentes aparecerão aqui." : "Execute sua primeira consulta no Console SQL."}
            </div>
          ) : (
            <div className="space-y-2">
              {queries.map((query) => (
                <TiltCard key={query.id} maxTilt={3} className="rounded-xl">
                  <div className="flex flex-wrap items-center gap-2 p-3 sm:p-4">
                    <span className="truncate font-mono text-xs font-semibold text-cyan-200">{query.database}</span>
                    <EngineBadge engine={engineOrDefault(query.engine)} />
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${query.success ? "bg-emerald-300/10 text-emerald-200" : "bg-rose-300/10 text-rose-200"}`}>
                      {query.success ? "OK" : "Erro"}
                    </span>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-400">{query.command}</span>
                    <time className="ml-auto text-[10px] text-slate-500">{new Date(query.timestamp).toLocaleString("pt-BR")}</time>
                    <p className="basis-full truncate font-mono text-xs text-slate-300">{query.query}</p>
                  </div>
                </TiltCard>
              ))}
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}
