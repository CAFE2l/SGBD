import type { EngineId } from "@/lib/profile/engines";
import type { RefObject } from "react";
import type {
  FavoriteEntry,
  GlobalQueryEntry,
  IoHistoryEntry,
} from "@/lib/sqlite/history";

export interface DbCard {
  name: string;
  engine: EngineId;
  tableCount: number;
  rowCount: number;
  tables: { name: string; rows: number }[];
  createdAt: number | null;
  updatedAt: number | null;
}

export type FileRef = RefObject<HTMLInputElement>;

export function fmtDate(ts: number | null | undefined): string {
  if (ts == null) return "—";
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export type { FavoriteEntry, GlobalQueryEntry, IoHistoryEntry };
