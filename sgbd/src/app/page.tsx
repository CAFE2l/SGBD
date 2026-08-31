import { SetupStatus } from "@/components/SetupStatus";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <BackgroundGlow />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-16">
        <Navigation />

        <section className="mt-8 flex w-full flex-col items-center text-center">
          <span className="glass rounded-full px-4 py-1.5 text-xs tracking-widest text-sky-300 uppercase">
            SGBD Web Educacional
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-6xl">
            Importe. Consulte.
            <br />
            <span className="bg-gradient-to-r from-sky-400 to-cyan-300 bg-clip-text text-transparent">
              Exporte dados.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg">
            Uma ferramenta visual para sala de aula: importe arquivos{" "}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-sky-300">
              .sql
            </code>{" "}
            e{" "}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-sky-300">
              .csv
            </code>
            , rode qualquer consulta SQL e veja seus dados como tabelas.
          </p>
        </section>

        <SetupStatus />
      </div>
    </main>
  );
}

function BackgroundGlow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-sky-500/20 blur-[120px]" />
      <div className="absolute bottom-0 left-0 h-80 w-80 rounded-full bg-cyan-500/10 blur-[100px]" />
      <div className="absolute right-0 top-1/3 h-72 w-72 rounded-full bg-indigo-500/10 blur-[100px]" />
    </div>
  );
}

function Navigation() {
  return (
    <nav className="glass flex w-full items-center justify-between rounded-2xl px-5 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <span className="flex h-3 w-3 rounded-full bg-sky-400 shadow-glow" />
        SGBD
      </div>
      <div className="flex items-center gap-1 text-xs text-slate-400">
        <span className="rounded-lg px-3 py-1.5 hover:bg-white/5">Importar</span>
        <span className="rounded-lg px-3 py-1.5 hover:bg-white/5">
          Console SQL
        </span>
        <span className="rounded-lg px-3 py-1.5 hover:bg-white/5">Exportar</span>
      </div>
    </nav>
  );
}
