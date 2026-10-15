# SGBD Project Architecture Summary

## BEFORE Changes

### Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI COMPONENTS                           │
├─────────────────────────────────────────────────────────────────┤
│  Importar/page.tsx    Console/page.tsx    Exportar/page.tsx     │
│        │                     │                  │               │
│        ▼                     ▼                  ▼               │
│  TableDetails.tsx   TableDetails.tsx    ResultTable.tsx Editable │
│        │                     │                  Grid            │
│        ▼                     ▼                  │               │
│  SchemaDiagram.tsx  TableList.tsx         useDb.exportTableCsv   │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                          HOOKS CONTEXT                            │
├─────────────────────────────────────────────────────────────────┤
│  DbProvider (useDb)   TableSelectionProvider                    │
│  - tables: TableInfo[]  - activeTable: string | null             │
│  - databases: string[]    - selectTable()                         │
│  - activeDatabase         useTableCounts() fetching counts       │
│  - refresh()              per-component                          │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DATABASE MANAGER (lib/)                       │
├─────────────────────────────────────────────────────────────────┤
│  database-manager.ts        sqlite/db.ts         persist.ts       │
│  - initManager()            - getTableSchema()              │
│  - executeSql()             - getTableData()                  │
│  - importSql()              - getForeignKeys()                │
│  - executeScript()          - importCsv()                       │
│  - listTables()             - addForeignKey()                   │
│  - switchActiveDatabase()   - addPrimaryKey()                   │
│  - createDatabase()         - exportSql() / exportTableCsv()    │
│  - ...                    - updateTableCell()                   │
│                             - resultToObject()                  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      STORAGE (IndexedDB)                          │
├─────────────────────────────────────────────────────────────────┤
│  Database bytes (Uint8Array)                                   │
│  Registry: { databases: string[], activeDatabase: string }     │
│  History: timestamps, queries, success/fail                     │
└─────────────────────────────────────────────────────────────────┘
```

### Key Issues in Current Architecture

1. **No Single Source of Truth for Schema/Data**
   - `TableDetails.tsx` fetches schema and data independently
   - `ErDiagram.tsx` has its own `refresh()` that fetches schema
   - `TableList.tsx` just displays what `useDb` provides (no row counts until loaded)
   - Each mutation in Diagram (add FK, set PK) updates DB but doesn't notify other tabs

2. **Import/Export Limitations**
   - Only supports `.sql` and `.csv`
   - CSV parsing is basic (PapaParse default settings)
   - No preview step for CSV types
   - No JSON support at all
   - Export is single-table CSV only, no batches
   - No schema-aware JSON export

3. **State Sync Issues**
   - `useDb.tables` is a snapshot at refresh time, not reactive to real-time changes
   - When import happens, `refresh()` is called but tabs may not update immediately
   - No version tracking to detect stale data

4. **Bugs**
   - Estrutura: Nullable column shows "Sim" when it should show "Não" for PK
   - Row counts: 0 shown for imported tables ( rowCount property in ImportReport is wrong)
   - Diagram: hint bar overlaps nodes
   - Dados: table clipped, single column sort indicator

---

## AFTER Changes (Planned Architecture)

### New Service Layer

```
┌─────────────────────────────────────────────────────────────────┐
│                         SERVICE LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│  db-service.ts                                                   │
│  - SINGLE source of truth for:                                   │
│    * schemaVersion: number (increments on DDL)                    │
│    * dataVersion: number (increments on DML/import)                 │
│    * listeners: Set<() => void>                                   │
│                                                                  │
│  MUTATIONS (transactional, rollback on error):                   │
│  - createTable(name, columns, options)                           │
│  - dropTable(name)                                                 │
│  - renameTable(old, new)                                           │
│  - addColumn(table, columnDef)                                   │
│  - dropColumn(table, column)                                       │
│  - renameColumn(table, old, new)                                   │
│  - changeColumnType(table, column, type, rebuild)                │
│  - setNullable(table, column, nullable)                          │
│  - setDefault(table, column, default)                            │
│  - setPrimaryKey(table, column)                                    │
│  - dropPrimaryKey(table, column)                                   │
│  - addForeignKey(...) / dropForeignKey(...)                        │
│  - insertRow(table, values)                                        │
│  - updateRow(table, rowid, values)                                 │
│  - deleteRow(table, rowid)                                         │
│                                                                  │
│  QUERIES (read from PRAGMA/sqlite_master for accuracy):          │
│  - getTables() => TableInfo[]                                      │
│  - getTableSchema(name) => TableSchema                             │
│  - getTableData(name, limit) => QueryResult                        │
│  - getForeignKeys(name) => ForeignKeyInfo[]                        │
│  - getTableCount(name) => number                                   │
│                                                                  │
│  SUBSCRIPTION:                                                     │
│  - subscribe(listener) => unsubscribe function                   │
│  - notify() => calls all listeners (emitters)                     │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DB SERVICE PROVIDER                          │
├─────────────────────────────────────────────────────────────────┤
│  DbServiceProvider                                               │
│  - Uses db-service internally                                    │
│  - Provides: tables, activeDatabase, counts, errors              │
│  - Actions: mutate(), refresh(), switchDatabase(), etc.          │
│  - Emits React context updates                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Import/Export Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        IMPORT FLOW                              │
├─────────────────────────────────────────────────────────────────┤
│  FileDropzone accepts: .sql, .csv, .json                         │
│                                                                  │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────┐              │
│  │ .sql     │──▶│ MySQL-to-    │──▶│ Fix flow     │              │
│  │ dump     │   │ SQLite conv │   │ (Correções)  │              │
│  └──────────┘   └──────────────┘   └──────────────┘              │
│                                                                  │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────┐              │
│  │ .csv     │──▶│ Parse CSV    │──▶│ Preview/     │              │
│  │          │   │ with types   │   │ Override     │              │
│  └──────────┘   └──────────────┘   └──────────────┘              │
│                                                                  │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────┐              │
│  │ .json    │──▶│ Parse JSON   │──▶│ Schema       │              │
│  │          │   │ (multi_fmt)  │   │ restore      │              │
│  └──────────┘   └──────────────┘   └──────────────┘              │
│                                                                  │
│  All flows: batch INSERT (500-1000 rows), progress bar, cancel   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        EXPORT FLOW                              │
├─────────────────────────────────────────────────────────────────┤
│  Per-table exports:                                              │
│  - SQL (SQLite/MariaDB) with types, PK, FK, defaults            │
│  - CSV (zip if multiple) with proper escaping                   │
│  - JSON: "data only" or "schema-aware" format                    │
│                                                                  │
│  Full database: SQL dump, JSON schema-aware archive              │
│                                                                  │
│  Schema-aware JSON format:                                       │
│  {                                                          │
│    tables: {                                                    │
│      tableName: {                                               │
│        columns: [{name, type, nullable, default, pk}],         │
│        primaryKey: [{name}],                                    │
│        foreignKeys: [{from, to, onDelete, onUpdate}],           │
│        rows: [...]                                               │
│      }                                                          │
│    },
│    indexes: [...]
│  }
└─────────────────────────────────────────────────────────────────┘
```

### Tab Synchronization

```
┌─────────────────────────────────────────────────────────────────┐
│                    TAB SYNCHRONIZATION                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Estrutura ◄────────────── Dados ◄────────────── Diagrama       │
│      │                      │                       │             │
│      ▼                      ▼                       ▼             │
│  TableDetails.tsx    TableDetails.tsx      ErDiagram.tsx       │
│                                                                   │
│         │                     │                     │           │
│         └──────────┬──────────┘─────────────┬─────┘           │
│                    │                        │                  │
│                    ▼                        ▼                  │
│         ┌─────────────────────────────────────────────────┐     │
│         │           DbServiceProvider (React Context)    │     │
│         │  - subscribes to db-service events               │     │
│         │  - updates state on any mutation/import/export   │     │
│         └─────────────────────────────────────────────────┘     │
│                              │                                  │
│                              ▼                                  │
│         ┌─────────────────────────────────────────────────┐     │
│         │              db-service.ts                      │     │
│         │  - All mutations go through here               │     │
│         │  - Increments schemaVersion/dataVersion       │     │
│         │  - Calls notify() → all subscribers update   │     │
│         └─────────────────────────────────────────────────┘     │
│                              │                                  │
│                              ▼                                  │
│         ┌─────────────────────────────────────────────────┐     │
│         │           SQLite Database (sql.js)             │     │
│         └─────────────────────────────────────────────────┘     │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Bug Fixes

1. **Bug 1 (PK/Nullable)**: Fixed in TableDetails.tsx - changed logic from `c.notnull === 1 ? "Não" : "Sim"` to correct boolean logic.

2. **Bug 2 (Row counts)**: Fixed in ImportReport - rowCount should be actual row count from data, not table count.

3. **Bug 3 (Diagram hint bar)**: CSS adjustment - hint bar positioned outside canvas area or made dismissible.

4. **Bug 4 (Dados clipping)**: Added horizontal scroll to ResultTable component with sticky header.