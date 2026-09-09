import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { AuthCard } from "@/components/AuthCard";

export const metadata: Metadata = {
  title: "Criar conta · SGBD Web Educacional",
  description: "Crie sua conta para ter bancos e histórico próprios.",
};

export default function SignupPage() {
  return (
    <AuthShell>
      <AuthCard mode="signup" />
    </AuthShell>
  );
}