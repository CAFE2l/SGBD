import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { AuthCard } from "@/components/AuthCard";

export const metadata: Metadata = {
  title: "Entrar · SGBD Web Educacional",
  description: "Acesse sua conta para salvar bancos e histórico por usuário.",
};

export default function LoginPage() {
  return (
    <AuthShell>
      <AuthCard mode="login" />
    </AuthShell>
  );
}