import Link from "next/link";
import { PageShell } from "@/components/PageShell";

export default function Home() {
  return (
    <PageShell>
      <section className="flex min-h-[70vh] flex-col items-center justify-center text-center">
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
          <code className="rounded bg-white/10 px-1.5 py-0.5 text-sky-300">.sql</code>{" "}
          e{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5 text-sky-300">.csv</code>
          , rode qualquer consulta SQL e veja seus dados como tabelas — tudo no
          navegador.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/importar"
            className="rounded-xl bg-sky-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-300"
          >
            Importar arquivo
          </Link>
          <Link
            href="/console"
            className="glass rounded-xl px-5 py-2.5 text-sm font-semibold text-sky-300 transition-colors hover:bg-white/10"
          >
            Abrir Console SQL
          </Link>
        </div>
      </section>
    </PageShell>
  );
}
