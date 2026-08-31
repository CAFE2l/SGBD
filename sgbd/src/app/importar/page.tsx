"use client";

import { useCallback, useState } from "react";
import Papa from "papaparse";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { FileDropzone } from "@/components/FileDropzone";
import { useDb } from "@/hooks/useDb";
import type { ImportReport } from "@/lib/sqlite/types";

type ColumnType = "INTEGER" | "REAL" | "TEXT";

interface CsvState {
  fileName: string;
  columns: string[];
  rows: (string | null)[][];
  preview: (string | null)[][];
  types: ColumnType[];
}

export default function ImportarPage() {
  const { tables, importSqlScript, importCsvData, databases, activeDatabase, switchDatabase, createNewDatabase } = useDb();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "parsing" | "preview" | "done">(
    "idle"
  );
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sqlName, setSqlName] = useState("");
  const [targetDb, setTargetDb] = useState<string>(() => activeDatabase ?? "");
  const [csv, setCsv] = useState<CsvState | null>(null);
  const [csvTableName, setCsvTableName] = useState("");

  const handleFile = useCallback(
    (file: File) => {
      setError(null);
      setReport(null);
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "sql") {
        handleSqlFile(file);
      } else if (ext === "csv") {
        handleCsvFile(file);
      } else {
        setError(
          "Formato não suportado. Envie um arquivo .sql ou .csv."
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleSqlFile = useCallback(
    async (file: File) => {
      setPhase("parsing");
      setBusy(true);
      setSqlName(file.name);
      try {
        if (targetDb) await switchDatabase(targetDb);
        const text = await file.text();
        const rep = await importSqlScript(text);
        setReport(rep);
        setPhase("done");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("idle");
      } finally {
        setBusy(false);
      }
    },
    [targetDb, switchDatabase, importSqlScript]
  );

  const handleCsvFile = useCallback(
    async (file: File) => {
      setPhase("parsing");
      setBusy(true);
      const name = file.name.replace(/\.csv$/i, "");
      setCsvTableName(name);
      try {
        const text = await file.text();
        const res = Papa.parse<string[]>(text, {
          skipEmptyLines: true,
        });
        if (res.errors.length) {
          throw new Error(
            `Erro ao ler CSV: ${res.errors[0].message}`
          );
        }
        const data = res.data.filter((r) => r.length > 0);
        if (data.length < 2) {
          throw new Error("CSV sem header ou sem linhas de dados.");
        }
        const columns = data[0];
        const rows: (string | null)[][] = data.slice(1).map((r) => {
          return columns.map((_, i) => (r[i] ?? "").trim() || null);
        });
        // garantir que nenhuma linha tenha mais colunas que o header
        const types = columns.map((_, ci) => {
          const values = rows.map((r) => r[ci]);
          return inferType(values);
        });
        setCsv({
          fileName: file.name,
          columns,
          rows,
          preview: rows.slice(0, 10),
          types,
        });
        setPhase("preview");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("idle");
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const confirmCsv = useCallback(async () => {
    if (!csv) return;
    setBusy(true);
    setError(null);
    try {
      if (targetDb) await switchDatabase(targetDb);
      const rep = await importCsvData(
        { columns: csv.columns, rows: csv.rows },
        csvTableName,
        csv.types
      );
      setReport(rep);
      setCsv(null);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("preview");
    } finally {
      setBusy(false);
    }
  }, [csv, csvTableName, importCsvData, targetDb, switchDatabase]);

  const setType = (idx: number, type: ColumnType) => {
    setCsv((c) => (c ? { ...c, types: c.types.map((t, i) => (i === idx ? type : t)) } : c));
  };

  return (
    <PageShell>
      <h1 className="text-2xl font-bold text-white">Importar dados</h1>
      <p className="mt-1 text-sm text-slate-400">
        Envie um arquivo <code className="text-sky-300">.sql</code> (dump) ou{" "}
        <code className="text-sky-300">.csv</code> para criar tabelas.
      </p>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {phase === "idle" && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <label className="text-xs font-semibold text-slate-400">
            Importar no banco:
          </label>
          <select
            value={targetDb}
            onChange={(e) => setTargetDb(e.target.value)}
            className="rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 font-mono text-sm text-sky-300 outline-none focus:border-sky-400/60"
          >
            {databases.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            onClick={async () => {
              const name = prompt("Nome do novo banco:");
              if (name && name.trim()) {
                try {
                  await createNewDatabase(name.trim());
                  setTargetDb(name.trim());
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }
            }}
            className="rounded-lg bg-sky-400/15 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-400/25"
          >
            + Criar novo banco
          </button>
        </div>
      )}

      {phase === "parsing" && (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/5 py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
          <p className="text-sm text-slate-400">
            Processando <span className="text-sky-300">{sqlName || "arquivo"}</span>…
          </p>
        </div>
      )}

      {phase === "idle" && (
        <div className="mt-8">
          <FileDropzone accept=".sql,.csv" onFile={handleFile} />
        </div>
      )}

      {phase === "preview" && csv && (
        <CsvPreview
          csv={csv}
          tableName={csvTableName}
          onNameChange={setCsvTableName}
          onTypeChange={(i, t) => setType(i, t)}
          busy={busy}
          onCancel={() => {
            setCsv(null);
            setPhase("idle");
          }}
          onConfirm={confirmCsv}
        />
      )}

      {phase === "done" && report && (
        <DoneState
          report={report}
          onImportAnother={() => {
            setReport(null);
            setPhase("idle");
          }}
        />
      )}

      <div className="mt-10">
        <h2 className="mb-2 text-sm font-semibold text-slate-300">
          Tabelas carregadas ({tables.length})
        </h2>
        {tables.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-500">
            Nenhum dado importado ainda. Use o upload acima para começar, ou{" "}
            <Link href="/console" className="text-sky-300 underline">
              abra o Console SQL
            </Link>
            .
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {tables.map((t) => (
              <div
                key={t.name}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3"
              >
                <span className="font-mono text-sm text-sky-300">{t.name}</span>
                <Link
                  href="/console"
                  className="rounded-lg bg-sky-400/15 px-2.5 py-1 text-xs font-semibold text-sky-300 hover:bg-sky-400/25"
                >
                  Ir para o Console
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

function CsvPreview({
  csv,
  tableName,
  onNameChange,
  onTypeChange,
  busy,
  onCancel,
  onConfirm,
}: {
  csv: CsvState;
  tableName: string;
  onNameChange: (n: string) => void;
  onTypeChange: (i: number, t: ColumnType) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5">
      <div>
        <h3 className="text-sm font-semibold text-white">Confirmar importação</h3>
        <p className="text-xs text-slate-500">{csv.fileName} · {csv.rows.length} linha(s)</p>
      </div>

      <div>
        <label className="block text-xs text-slate-400">Nome da tabela</label>
        <input
          value={tableName}
          onChange={(e) => onNameChange(e.target.value)}
          className="mt-1 w-full max-w-xs rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white outline-none focus:border-sky-400/60"
        />
      </div>

      <div>
        <h4 className="mb-1 text-xs text-slate-400">Tipos de coluna inferidos</h4>
        <div className="flex flex-wrap gap-2">
          {csv.columns.map((c, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1"
            >
              <span className="font-mono text-[11px] text-sky-300">{c}</span>
              <select
                value={csv.types[i]}
                onChange={(e) => onTypeChange(i, e.target.value as ColumnType)}
                className="rounded bg-slate-800 px-1 py-0.5 text-[11px] text-slate-300 outline-none"
              >
                <option value="INTEGER">INTEGER</option>
                <option value="REAL">REAL</option>
                <option value="TEXT">TEXT</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900/80">
            <tr>
              {csv.columns.map((c, i) => (
                <th
                  key={i}
                  className="px-2 py-1.5 font-mono text-sky-300"
                >{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {csv.preview.map((row, ri) => (
              <tr key={ri} className="hover:bg-white/5">
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="max-w-[140px] truncate border-t border-white/5 px-2 py-1 text-slate-300"
                    title={cell ?? ""}
                  >
                    {cell ?? <span className="text-slate-600 italic">NULL</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onConfirm}
          disabled={busy || !tableName.trim()}
          className="rounded-xl bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-40"
        >
          {busy ? "Importando…" : "Criar tabela e importar"}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-400 hover:bg-white/5"
        >
          Cancelar
        </button>
        {!tableName.trim() && (
          <span className="text-xs text-amber-400">
            Informe um nome de tabela válido.
          </span>
        )}
      </div>
    </div>
  );
}

function DoneState({
  report,
  onImportAnother,
}: {
  report: ImportReport;
  onImportAnother: () => void;
}) {
  return (
    <div className="mt-8 space-y-4 rounded-2xl border border-sky-400/20 bg-sky-400/5 p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
          ✓
        </span>
        <div>
          <h3 className="text-sm font-semibold text-white">Importação concluída</h3>
          <p className="text-xs text-slate-400">
            {report.tableCount} tabela(s) no banco atual.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-3 font-mono text-xs text-slate-300">
        {report.log.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
        {report.errors.map((e, i) => (
          <div key={"e" + i} className="text-rose-300">
            {e}
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <Link
          href="/console"
          className="rounded-xl bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-300"
        >
          Ir para o Console SQL
        </Link>
        <button
          onClick={onImportAnother}
          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-400 hover:bg-white/5"
        >
          Importar outro arquivo
        </button>
      </div>
    </div>
  );
}

function inferType(values: (string | null)[]): ColumnType {
  let anyValue = false;
  let allNumbers = true;
  let allInt = true;
  for (const v of values) {
    if (v == null || v === "") continue;
    anyValue = true;
    const num = Number(v);
    if (Number.isNaN(num)) {
      allNumbers = false;
    } else if (num % 1 !== 0) {
      allInt = false;
    }
  }
  if (!anyValue) return "TEXT";
  if (allNumbers && allInt) return "INTEGER";
  if (allNumbers) return "REAL";
  return "TEXT";
}
