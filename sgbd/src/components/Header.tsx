"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDb } from "@/hooks/useDb";

const links = [
  { href: "/", label: "Início" },
  { href: "/importar", label: "Importar" },
  { href: "/console", label: "Console SQL" },
  { href: "/bancos", label: "Bancos" },
  { href: "/exportar", label: "Exportar" },
];

export function Header() {
  const pathname = usePathname();
  const { tables } = useDb();

  return (
    <header className="sticky top-0 z-30 w-full border-b border-white/10 bg-slate-950/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-white">
          <span className="flex h-3 w-3 rounded-full bg-sky-400 shadow-glow" />
          SGBD
        </Link>
        <nav className="flex items-center gap-1 text-xs text-slate-400">
          {links.map((l) => {
            const active =
              l.href !== "/" && pathname?.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 transition-colors ${
                  active
                    ? "bg-sky-400/15 text-sky-300"
                    : "hover:bg-white/5 hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <span
            className="ml-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 font-mono text-sky-300"
            title="Tabelas carregadas"
          >
            {tables.length} tabela{tables.length === 1 ? "" : "s"}
          </span>
        </nav>
      </div>
    </header>
  );
}
