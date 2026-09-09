import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { FadeIn, FloatingOrb } from "@/components/FadeIn";

export default function Home() {
  return (
    <PageShell>
      <section className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden text-center">
        {/* Profundidade 3D: orbes de vidro flutuando ao fundo */}
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
            <span className="glass rounded-full border-sky-400/20 px-4 py-1.5 text-xs tracking-widest text-sky-300 uppercase shadow-glow-sm">
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
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-sky-300">
                .sql
              </code>{" "}
              e{" "}
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-sky-300">
                .csv
              </code>
              , rode qualquer consulta SQL e veja seus dados como tabelas — tudo
              no navegador.
            </p>
          </FadeIn>
          <FadeIn delay={0.3}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/importar"
                className="rounded-xl bg-sky-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-glow transition-all duration-200 hover:scale-[1.04] hover:bg-sky-300 hover:shadow-[0_0_30px_rgba(56,189,248,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              >
                Importar arquivo
              </Link>
              <Link
                href="/console"
                className="glass rounded-xl px-5 py-2.5 text-sm font-semibold text-sky-300 shadow-glow-sm transition-all duration-200 hover:scale-[1.04] hover:bg-white/10 hover:text-sky-200 hover:shadow-[0_0_25px_rgba(56,189,248,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
              >
                Abrir Console SQL
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>
    </PageShell>
  );
}