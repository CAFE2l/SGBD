"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/hooks/useAuth";

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
  const { user, loading, signOut } = useAuth();
  const visibleLinks = links.filter((l) => l.href === "/" || !!user);

  return (
    <header className="glass-panel sticky top-0 z-30 w-full rounded-b-2xl border-x-0 border-t-0 bg-slate-950/65 shadow-[0_8px_30px_rgba(2,6,23,0.5)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <span className="flex h-3 w-3 rounded-full bg-sky-400 shadow-glow" />
          SGBD
        </Link>
        <nav aria-label="Navegação principal" className="order-3 flex w-full items-center gap-1 overflow-x-auto text-xs text-slate-400 sm:order-none sm:w-auto">
          {visibleLinks.map((l) => {
            const active =
              l.href !== "/" && pathname?.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`focus-ring whitespace-nowrap rounded-lg px-3 py-1.5 transition-all duration-150 ${
                  active
                    ? "bg-sky-400/15 text-sky-300 shadow-glow-sm"
                    : "hover:bg-white/5 hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          {user && (
            <span
              className="ml-2 shrink-0 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 font-mono tabular-nums text-sky-300"
              title="Tabelas carregadas"
            >
              {tables.length} tabela{tables.length === 1 ? "" : "s"}
            </span>
          )}
        </nav>
        <div className="ml-3 flex shrink-0 items-center gap-2">
          {loading ? (
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-400/30 border-t-sky-400" />
          ) : user ? (
            <>
              <Link
                href="/perfil"
                className="focus-ring flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-3 transition-colors hover:border-sky-400/40 hover:bg-sky-400/10"
                title={user.email ? `${user.email} — ver perfil` : "Ver perfil"}
              >
                {user.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.photoURL}
                    alt=""
                    className="h-6 w-6 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-400/20 text-xs font-bold text-sky-300">
                    {(user.displayName?.[0] ?? user.email?.[0] ?? "?").toUpperCase()}
                  </span>
                )}
                <span className="max-w-[7rem] truncate text-xs text-slate-200 sm:max-w-[8rem]">
                  {user.displayName ?? user.email}
                </span>
              </Link>
              <button
                onClick={() => void signOut()}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-white/20 hover:text-white"
              >
                Sair
              </button>
            </>
          ) : (
            <>
              <Link
                href="/signup"
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition-all duration-150 hover:scale-[1.04] hover:bg-white/5 hover:text-white"
              >
                Criar conta
              </Link>
              <Link
                href="/login"
                className="rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow-glow-sm transition-all duration-150 hover:scale-[1.04] hover:bg-sky-300 hover:shadow-glow"
              >
                Entrar
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
