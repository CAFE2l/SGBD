"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { friendlyAuthError } from "@/lib/firebase/auth";

type Mode = "login" | "signup";

type FieldErrors = Partial<Record<"name" | "email" | "password", string>>;

export function AuthCard({ mode }: { mode: Mode }) {
  const router = useRouter();
  const { user, loading, configured, signInGoogle, signInEmail, signUpEmail } =
    useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"google" | "form" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const isLogin = mode === "login";

  // Já autenticado? Leva de volta para a home após resolver a sessão.
  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  const clearFieldError = (field: keyof FieldErrors) => {
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  /** Valida o formulário e retorna os erros por campo (empty = válido). */
  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (!isLogin && !name.trim()) {
      errors.name = "Informe seu nome.";
    }
    const trimEmail = email.trim();
    if (!trimEmail) {
      errors.email = "Informe seu e-mail.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimEmail)) {
      errors.email = "Informe um e-mail válido.";
    }
    if (!password) {
      errors.password = "Digite sua senha.";
    } else if (password.length < 6) {
      errors.password = "A senha deve ter pelo menos 6 caracteres.";
    }
    return errors;
  };

  const handleGoogle = async () => {
    setFormError(null);
    setBusy("google");
    try {
      await signInGoogle();
      router.replace("/");
    } catch (e) {
      setFormError(friendlyAuthError(e));
    } finally {
      setBusy(null);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const errors = validate();
    const hasErrors = Object.values(errors).some(Boolean);
    setFieldErrors(errors);
    setFormError(null);
    if (hasErrors) return;

    setBusy("form");
    const trimEmail = email.trim();
    const task = isLogin
      ? signInEmail(trimEmail, password)
      : signUpEmail(name.trim(), trimEmail, password);
    task
      .then(() => router.replace("/"))
      .catch((err) => setFormError(friendlyAuthError(err)))
      .finally(() => setBusy(null));
  };

  if (!configured) {
    return (
      <div className="w-full max-w-md rounded-2xl border border-amber-400/30 bg-amber-500/10 p-6 text-center">
        <p className="text-sm font-semibold text-amber-300">
          Firebase não configurado
        </p>
        <p className="mt-2 text-xs leading-relaxed text-amber-200/80">
          Preencha as variáveis <code>NEXT_PUBLIC_FIREBASE_*</code> no{" "}
          <code>.env.local</code> e reinicie o servidor. No Firebase Console,
          habilite os provedores E-mail/Senha e Google em Authentication →
          Sign-in method.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 shadow-[0_20px_60px_-15px_rgba(2,6,23,0.8),0_0_20px_rgba(56,189,248,0.2)] backdrop-blur-xl">
      <h2 className="text-xl font-bold text-white">
        {isLogin ? "Entrar" : "Criar conta"}
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        {isLogin
          ? "Acesse para salvar seus bancos e histórico por usuário."
          : "Crie sua conta para ter bancos e histórico próprios."}
      </p>

      <button
        onClick={handleGoogle}
        disabled={busy !== null}
        className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-[0_10px_25px_-8px_rgba(0,0,0,0.5)] transition-all duration-200 hover:scale-[1.02] hover:bg-slate-50 hover:shadow-[0_12px_30px_-8px_rgba(0,0,0,0.6)] disabled:pointer-events-none disabled:opacity-60"
      >
        <GoogleIcon />
        {busy === "google" ? "Abrindo…" : "Continuar com Google"}
      </button>

      <div className="my-6 flex items-center gap-3 text-[11px] text-slate-500">
        <span className="h-px flex-1 bg-white/10" />
        ou
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {!isLogin && (
          <Field
            label="Nome"
            hint="Como quer ser chamado"
            error={fieldErrors.name}
          >
            <Input
              value={name}
              onChange={(v) => {
                setName(v);
                clearFieldError("name");
              }}
              placeholder="Seu nome"
              autoComplete="name"
              invalid={!!fieldErrors.name}
            />
          </Field>
        )}
        <Field label="E-mail" error={fieldErrors.email}>
          <Input
            value={email}
            onChange={(v) => {
              setEmail(v);
              clearFieldError("email");
            }}
            placeholder="voce@escola.edu.br"
            type="email"
            autoComplete="email"
            invalid={!!fieldErrors.email}
          />
        </Field>
        <Field label="Senha" error={fieldErrors.password}>
          <Input
            value={password}
            onChange={(v) => {
              setPassword(v);
              clearFieldError("password");
            }}
            placeholder="••••••••"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            invalid={!!fieldErrors.password}
          />
        </Field>

        {formError && (
          <p
            role="alert"
            className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
          >
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={busy !== null}
          className="w-full rounded-xl bg-sky-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-glow transition-all duration-200 hover:scale-[1.02] hover:bg-sky-300 hover:shadow-[0_0_30px_rgba(56,189,248,0.45)] disabled:pointer-events-none disabled:opacity-60"
        >
          {busy === "form"
            ? isLogin
              ? "Entrando…"
              : "Criando conta…"
            : isLogin
              ? "Entrar"
              : "Criar conta"}
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-slate-500">
        {isLogin ? "Ainda não tem conta?" : "Já tem uma conta?"}{" "}
        <Link
          href={isLogin ? "/signup" : "/login"}
          className="font-semibold text-sky-300 hover:text-sky-200"
        >
          {isLogin ? "Crie uma" : "Entrar"}
        </Link>
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block">
        <span className="text-xs font-semibold text-slate-400">
          {label}
          {hint && (
            <span className="ml-1 font-normal text-slate-600">({hint})</span>
          )}
        </span>
        <span className="mt-1 block">{children}</span>
      </label>
      {error && (
        <p role="alert" className="mt-1 text-xs text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  invalid?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      autoComplete={autoComplete}
      aria-invalid={invalid || undefined}
className={`w-full rounded-xl border bg-black/20 px-3.5 py-2.5 text-sm text-white outline-none backdrop-blur transition-all placeholder:text-slate-600 ${
            invalid
              ? "border-rose-400/60 focus:border-rose-400"
              : "border-white/10 focus:border-sky-400/60 focus:shadow-[0_0_14px_rgba(56,189,248,0.15)]"
          }`}
    />
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}