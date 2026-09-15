import type { EngineId } from "@/lib/profile/engines";
export interface DbCard {
  name: string; engine: EngineId; tableCount: number; rowCount: number;
  tables: { name: string; rows: number }[];
  createdAt: number | null; updatedAt: number | null;
}
export function fmtDate(ts: number | null | undefined): string {
  if (ts == null) return "—";
  return new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
