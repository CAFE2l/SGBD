import {
  ensureActiveEngine,
  getActiveDatabase,
  switchActiveDatabase,
} from "@/lib/database-manager";
import {
  exportDatabase as exportDatabaseFromEngine,
  exportTable as exportTableFromEngine,
  type ExportOptions,
  type ExportResult,
} from "./export-core";
import type { ExportFormat } from "./export-serializers";

async function engineForDatabase(database: string) {
  if (getActiveDatabase() !== database) await switchActiveDatabase(database);
  const engine = await ensureActiveEngine();
  const activeDatabase = getActiveDatabase();
  if (activeDatabase !== database) {
    throw new Error(`O banco ${database} não está ativo (banco atual: ${activeDatabase ?? "nenhum"}).`);
  }
  return engine;
}

export async function exportTable(
  database: string,
  table: string,
  format: ExportFormat,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const engine = await engineForDatabase(database);
  return exportTableFromEngine(database, table, format, engine, options);
}

export async function exportDatabase(
  database: string,
  format: ExportFormat,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const engine = await engineForDatabase(database);
  return exportDatabaseFromEngine(database, format, engine, options);
}

export type { ExportOptions, ExportProgress } from "./export-core";
export type { ExportFormat } from "./export-serializers";
