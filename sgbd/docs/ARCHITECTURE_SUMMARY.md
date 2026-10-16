# Architecture Summary: SGBD Project

## Overview

SGBD is a Next.js application (Next.js 15.3.9) that provides a full-featured SQLite database management interface in the browser using sql.js. All data is stored in IndexedDB and persists across sessions.

## Project Structure

```
src/
├── app/                    # Next.js pages
│   ├── importar/page.tsx   # Import SQL/CSV/JSON files
│   ├── exportar/page.tsx   # Export tables/databases
│   ├── console/page.tsx    # SQL console with table sidebar
│   ├── tabelas/page.tsx    # Table browser (phpMyAdmin-style)
│   └── bancos/page.tsx     # Database manager
├── components/              # Reusable UI components
│   ├── FileDropzone.tsx    # File upload area
│   ├── TableDetails.tsx    # Estrutura/Dados/Diagrama tabs
│   ├── TableList.tsx       # Sidebar table list
│   ├── ErDiagram.tsx       # ER diagram editor
│   └── ResultTable.tsx     # Data table renderer
├── hooks/                  # React hooks
│   ├── useDb.tsx           # Database context & operations
│   ├── useActiveTable.tsx  # Active table selection
│   ├── useTableCounts.ts   # Row count hooks
│   └── useToast.ts         # Toast notification hook
└── lib/sqlite/             # Data access layer
    ├── db.ts               # Core database operations (sql.js wrapper)
    ├── db-service.ts       # Service layer (exists but not fully integrated)
    ├── types.ts            # TypeScript interfaces
    ├── csv-parser.ts       # CSV parsing utilities
    ├── json-importer.ts    # JSON import utilities
    ├── json-exporter.ts    # JSON export utilities
    └── export-*.ts         # Export serialization
```

## Current State: Schema & Data State Locations

### 1. Schema State (Column Definitions, Types, PK/FK)
- **Source**: `PRAGMA table_info()` and `PRAGMA foreign_key_list()` in `db.ts`
- **Access Pattern**: Read on-demand (lazy loading)
- **Functions**:
  - `getTableSchema(table)` → `TableSchema` (name, sql, columns[])
  - `getForeignKeys(table)` → `ForeignKeyInfo[]`
  - `ColumnInfo`: { cid, name, type, notnull, dflt_value, pk }

### 2. Table List State
- **Location**: `useDb.tsx` context → `tables: TableInfo[]`
- **Update Pattern**: Refetched after DDL operations (CREATE, DROP, ALTER)
- **Refresh**: `listTables()` called in `refresh()` after mutations

### 3. Data State (Row Values)
- **Source**: Database engine via SELECT queries
- **Access Pattern**: Read on-demand (lazy loading per tab)
- **Functions**:
  - `getTableData(table, limit)` → `{ columns: string[], rows: Row[] }`
  - `getEditableTableData(table, limit)` → includes rowid

### 4. Database Context (`useDb.tsx`)
- `tables`: TableInfo[] - list of tables in active database
- `activeDatabase`: string | null - currently selected database name
- `databases`: string[] - list of saved databases
- Provides: `refresh()`, `switchDatabase()`, `importSqlScript()`, `importCsvData()`, etc.

## Three Tabs Data Flow (TableDetails.tsx)

### Estrutura Tab
```
Mount/Change → loadSchema() → getTableSchema() + getForeignKeys()
              → setSchema(), setFks()
              → Render column table with type/PK/FK/nullable info
```

### Dados Tab
```
Tab Switch → loadRows() → getTableData(table, DATA_LIMIT)
           → setRowData()
           → Render ResultTable with columns/rows
```
Note: Uses `rowData && schema?.name === name` check to avoid refetch if already loaded

### Diagrama Tab
```
Render → ErDiagram component
       → getTables() for all tables
       → getTableSchema() for each
       → getForeignKeys() for each
       → ReactFlow diagram with draggable nodes
```

## Current Issues with Tab Synchronization

### Problem 1: No Real-time Updates
When a mutation occurs (e.g., adding a column in Diagrama):
1. The mutation happens via `ALTER TABLE` SQL
2. `save()` is called (autosave to IndexedDB)
3. But tabs are NOT notified to refresh

### Problem 2: Independent Data Fetching
Each tab manages its own loading state:
- `loadSchema()` in Estrutura
- `loadRows()` in Dados  
- Separate useEffects for each

### Problem 3: No Cross-tab Communication
Changes in one tab don't trigger re-renders in others because:
- Each tab has isolated `useState` for its data
- No shared subscription mechanism

## db-service.ts: Intended Design (Not Yet Integrated)

The `db-service.ts` file implements a publish-subscribe pattern:

```typescript
// Version counters for change detection
let schemaVersion = 0;  // incremented on DDL
let dataVersion = 0;    // incremented on DML

// Subscription API
export function subscribe(listener: Listener): () => void
export function getSchemaVersion(): number
export function getDataVersion(): number

// Mutation operations
export async function createTable(...)  // bumps schema + data
export async function addColumn(...)    // bumps schema
export async function renameColumn(...) // bumps schema
export async function dropColumn(...)   // bumps schema
```

**Issue**: This service layer exists but is NOT wired into the React hooks or components. The React components still use `db.ts` directly.

## Existing Integrations

### Import Flow (importar/page.tsx)
```
File Drop → handleFile() → ext detection (sql/csv/json)
         → handleSqlFile() / handleCsvFile() / handleJsonFile()
         → importSqlScript() / importCsvData() / jsonToSql() + importSqlScript()
         → refresh() via useDb hook
```

**CSV Improvements Needed**: Uses Papa.parse instead of custom csv-parser.ts; missing type inference preview

### Export Flow (exportar/page.tsx)
```
Button Click → exportOne() / exportAll()
           → exportTable() / exportDatabase()
           → Formats: sql, csv, json-data, json-schema
           → download(blob)
```

## Key Types

```typescript
// From types.ts
export interface TableInfo {
  name: string;
  sql: string | null;
}

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;     // 0 or 1
  dflt_value: string | null;
  pk: number;          // 0 or 1+
}

export interface TableSchema {
  name: string;
  sql: string | null;
  columns: ColumnInfo[];
}

export interface ForeignKeyInfo {
  table: string;
  from: string;
  to: string;
}

export interface ImportReport {
  tableName: string;
  tableCount: number;
  rowCount: number;
  log: string[];
  errors: string[];
  suggestions?: SqlSuggestion[];
}
```

## Recommendations for Feature Implementation

### Feature 1: Import/Convert Between Formats

1. **CSV Import** (`handleCsvFile`):
   - Replace `Papa.parse` with `parseCsv()` from csv-parser.ts
   - Add `inferColumnType()` with DATE/DATETIME/BOOLEAN support
   - Add preview dialog with type override options
   
2. **JSON Import** (`handleJsonFile`):
   - Already uses `jsonToSql()` which calls `parseJson()`
   - `parseJson()` supports 4 formats: schema-aware, object with tables, array, NDJSON
   - Need to add progress indicator for large files

3. **Auto-detect**: Already implemented via file extension in `handleFile()`

4. **Multiple Files**: Not currently supported - FileDropzone only processes first file

### Feature 2: Live Sync for Three Tabs

1. **Integrate db-service.ts subscription pattern**:
   - Have `TableDetails` subscribe to schema/data version changes
   - On notification, refetch all three views

2. **Alternative: Use existing useEffect deps**:
   - Add dependency on a shared "version" counter
   - Increment counter in `useDb.refresh()` after mutations

3. **Implementation approach**:
   - Create `useDbVersion()` hook returning current version
   - Have all tabs depend on this version
   - When mutation occurs, bump version and re-render

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser Storage                         │
│  ┌─────────────┐     IndexedDB    ┌─────────────┐              │
│  │ Databases   │ ◄─────────────── │ Schema/Files│              │
│  │ (IndexedDB) │                  │ (IndexedDB) │              │
│  └─────────────┘                  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                       SQL.js Engine                             │
│  ┌─────────────┐                                                    │
│  │ In-Memory   │                                                    │
│  │ SQLite DB   │                                                    │
│  └─────────────┘                                                    │
│        │                                                          │
│        ▼                                                          │
│  PRAGMA table_info()  ──────► TableSchema                         │
│  PRAGMA foreign_key_list()                                         │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                     db.ts (Public API)                          │
│  - getTableSchema()                                               │
│  - getForeignKeys()                                               │
│  - getTableData()                                                 │
│  - importSql()                                                    │
│  - importCsv()                                                    │
│  - createTable(), addColumn(), dropColumn(), renameColumn()     │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    React Components                             │
│                                                                   │
│  TableDetails (Estrutura/Dados/Diagrama)                         │
│    │                                                             │
│    ├── Estrutura Tab ──► useEffect → getTableSchema()           │
│    │                     (lazy, on table select)                │
│    │                                                             │
│    ├── Dados Tab ─────► useEffect → getTableData()             │
│    │                     (lazy, on tab switch)                  │
│    │                                                             │
│    └── Diagrama Tab ───► ErDiagram component                      │
│                        → getTables() + getTableSchema()           │
│                        → ReactFlow with draggable nodes         │
│                                                                   │
│  Console Page ───► TableList (sidebar) + SqlEditor + ResultTable │
│                                                                   │
│  Import Page ───► FileDropzone → CSV Parser / JSON Importer      │
│                                                                   │
│  Export Page ───► Export Service → SQL/CSV/JSON/ZIP generation  │
└─────────────────────────────────────────────────────────────────┘
```

## State Management Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   User Action   │     │   Mutation API  │     │   Persistence   │
│ (click, drag,   │────►│ (db.ts exports) │────►│   (IndexedDB)   │
│  upload, etc)  │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                        │                        │
         │              ┌─────────┴─────────┐            │
         │              │    save() call    │            │
         │              └─────────┬─────────┘            │
         │                        │                       │
         │              ┌─────────▼─────────┐            │
         │              │   DatabaseManager  │◄───────────┘
         │              │   (indexeddb.ts)   │  (autosave)
         │              └─────────┬─────────┘
         │                        │
         │              ┌─────────▼─────────┐
         │              │  useDb.refresh()    │
         │              │  (via context)     │
         │              └─────────┬─────────┘
         │                        │
         │              ┌─────────▼─────────┐
         │              │  Components re-     │
         │              │  render with new  │
         │              │  props/state      │
         │              └────────────────────┘
```

## Mutation Handling (For Live Sync)

Currently:
1. Mutations are executed via `ALTER TABLE` SQL in db.ts functions
2. `save()` is called to persist to IndexedDB
3. No explicit notification to React components

Needed for Feature 2:
1. Add version counter in db-service.ts
2. Have components subscribe to version changes
3. On version change, all tabs re-fetch their data