import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { DbProvider } from "@/hooks/useDb";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "SGBD Web Educacional",
  description:
    "Ferramenta visual para importar, consultar e exportar bancos de dados em sala de aula.",
  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${inter.variable} min-h-screen bg-[#0a0e1a] text-foreground antialiased`}
      >
        <DbProvider>{children}</DbProvider>
      </body>
    </html>
  );
}
