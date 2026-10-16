const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(compiled, filename);
};

const {
  createTableSql,
  csvCell,
  csvHeader,
  insertStatements,
  schemaAwareTable,
  sqlLiteral,
} = require("../src/lib/sqlite/export-serializers.ts");
const { exportDatabase, exportTable } = require("../src/lib/sqlite/export-core.ts");
const { jsonToSql, parseJson } = require("../src/lib/sqlite/json-importer.ts");
const initSqlJs = require("sql.js");

let SQL;
test.before(async () => {
  SQL = await initSqlJs();
});

test("CSV quotes delimiters, quotes, newlines and preserves accents", () => {
  assert.equal(csvCell('a,"b"\nc', ","), '"a,""b""\nc"');
  assert.equal(csvCell("valor;acentuação", ";"), '"valor;acentuação"');
  assert.equal(csvCell(null), "");
  assert.equal(csvHeader(["nome", "descrição"], ";"), "nome;descrição");
});

test("JSON schema and SQL serializers preserve schema and escape SQL values", () => {
  const schema = {
    name: "Itens",
    columns: [
      { cid: 0, name: "id", type: "INTEGER", notnull: 0, dflt_value: null, pk: 1 },
      { cid: 1, name: "descrição", type: "TEXT", notnull: 1, dflt_value: "'ok'", pk: 0 },
    ],
    foreignKeys: [{ id: 0, seq: 0, table: "Produtos", from: "id", to: "id" }],
  };
  const def = schemaAwareTable(schema, [{ id: 2, descrição: null }]);
  assert.deepEqual(def.primaryKey, ["id"]);
  assert.equal(def.foreignKeys[0].from, "id");
  assert.equal(def.foreignKeys[0].table, "Produtos");
  assert.equal(def.rows[0].descrição, null);
  const create = createTableSql(schema);
  assert.match(create, /PRIMARY KEY \("id"\)/);
  assert.match(create, /FOREIGN KEY \("id"\) REFERENCES "Produtos" \("id"\)/);
  assert.equal(sqlLiteral("O'Brien"), "'O''Brien'");
  assert.deepEqual(
    insertStatements("Itens", ["descrição"], [{ descrição: "O'Brien" }]),
    ['INSERT INTO "Itens" ("descrição") VALUES\n(\'O\'\'Brien\');']
  );
});

test("exportTable reads live rows, schema, exact-case names, and empty tables", async () => {
  const db = new SQL.Database();
  db.run("PRAGMA foreign_keys=ON");
  db.run('CREATE TABLE "Parent Table" (id INTEGER PRIMARY KEY)');
  db.run('INSERT INTO "Parent Table" VALUES (9)');
  db.run('CREATE TABLE "UPPER_CASE" (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES "Parent Table"(id), note TEXT, missing TEXT)');
  db.run('CREATE TABLE "MiXeDCase" (code TEXT PRIMARY KEY, value TEXT)');
  db.run('CREATE TABLE "EMPTY_CASE" (id INTEGER PRIMARY KEY, description TEXT)');
  db.run(
    'INSERT INTO "UPPER_CASE" VALUES (1, 9, ?, NULL)',
    ['comma, quote " and\nnewline áçãõ']
  );
  db.run('INSERT INTO "MiXeDCase" VALUES (?, ?)', ["AbC", "case"]);

  const csv = await exportTable("test_db", "UPPER_CASE", "csv", db);
  const csvBytes = new Uint8Array(await csv.blob.arrayBuffer());
  assert.deepEqual(Array.from(csvBytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
  const csvText = new TextDecoder("utf-8", { ignoreBOM: true }).decode(csvBytes);
  assert.match(csvText, /"comma, quote "" and\nnewline áçãõ"/);
  assert.ok(csvText.endsWith(",\r\n"));

  const json = await exportTable("test_db", "UPPER_CASE", "json-data", db);
  const rows = JSON.parse(await json.blob.text());
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].missing, null);

  const withSchema = await exportTable("test_db", "UPPER_CASE", "json-schema", db);
  const schemaJson = JSON.parse(await withSchema.blob.text());
  assert.deepEqual(schemaJson.tables.UPPER_CASE.primaryKey, ["id"]);
  assert.equal(schemaJson.tables.UPPER_CASE.foreignKeys[0].table, "Parent Table");
  assert.equal(schemaJson.tables.UPPER_CASE.rows[0].missing, null);
  const importedSchemaDb = new SQL.Database();
  importedSchemaDb.run('CREATE TABLE "Parent Table" (id INTEGER PRIMARY KEY)');
  importedSchemaDb.run('INSERT INTO "Parent Table" VALUES (9)');
  importedSchemaDb.exec(jsonToSql(await withSchema.blob.text()));
  assert.deepEqual(
    importedSchemaDb.exec('PRAGMA table_info("UPPER_CASE")')[0].values.map((row) => row[5]),
    [1, 0, 0, 0]
  );
  assert.equal(importedSchemaDb.exec('SELECT note, missing FROM "UPPER_CASE"')[0].values[0][1], null);
  importedSchemaDb.close();

  const importedDataDb = new SQL.Database();
  importedDataDb.exec(jsonToSql(await json.blob.text(), "UPPER_CASE"));
  assert.deepEqual(importedDataDb.exec('SELECT id, missing FROM "UPPER_CASE"')[0].values[0], [1, null]);
  importedDataDb.close();

  const mixedCase = await exportTable("test_db", "MiXeDCase", "json-data", db);
  assert.equal(JSON.parse(await mixedCase.blob.text())[0].code, "AbC");
  const empty = await exportTable("test_db", "EMPTY_CASE", "csv", db);
  assert.equal(
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      new Uint8Array(await empty.blob.arrayBuffer())
    ),
    "\uFEFFid,description\r\n"
  );
  const emptySchema = await exportTable("test_db", "EMPTY_CASE", "json-schema", db);
  assert.equal(JSON.parse(await emptySchema.blob.text()).tables.EMPTY_CASE.rows.length, 0);

  const sql = await exportTable("test_db", "UPPER_CASE", "sql", db);
  const sqlText = await sql.blob.text();
  assert.match(sqlText, /FOREIGN KEY/);
  assert.match(sqlText, /comma, quote " and/);
  assert.match(sqlText, /NULL/);
  const importedSqlDb = new SQL.Database();
  importedSqlDb.run('CREATE TABLE "Parent Table" (id INTEGER PRIMARY KEY)');
  importedSqlDb.run('INSERT INTO "Parent Table" VALUES (9)');
  importedSqlDb.exec(sqlText);
  assert.deepEqual(
    importedSqlDb.exec('SELECT id, missing FROM "UPPER_CASE"')[0].values[0],
    [1, null]
  );
  importedSqlDb.close();
  db.close();
});

test("whole-database JSON, SQL, ZIP, preview limits, and 100k-row progress", async () => {
  const db = new SQL.Database();
  db.run('CREATE TABLE "Bulk Rows" (id INTEGER PRIMARY KEY, note TEXT)');
  db.run("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000) INSERT INTO \"Bulk Rows\" SELECT x, 'linha ' || x FROM n");
  db.run('CREATE TABLE "Vazia" (id INTEGER PRIMARY KEY)');

  let lastProgress = 0;
  const json = await exportDatabase("large_db", "json-data", db, {
    onProgress: ({ processed }) => { lastProgress = processed; },
  });
  const jsonContent = await json.blob.text();
  const imported = parseJson(jsonContent);
  assert.equal(imported.tables["Bulk Rows"].rows.length, 100000);
  assert.equal(lastProgress, 100000);
  assert.equal(jsonToSql(jsonContent).includes('CREATE TABLE "Bulk Rows"'), true);

  const schema = await exportDatabase("large_db", "json-schema", db);
  const schemaData = JSON.parse(await schema.blob.text());
  assert.equal(schemaData.tables["Vazia"].rows.length, 0);
  assert.equal(schemaData.tables["Bulk Rows"].columns[0].pk, true);
  const schemaRestore = new SQL.Database();
  schemaRestore.exec(jsonToSql(await schema.blob.text()));
  assert.equal(schemaRestore.exec('PRAGMA table_info("Vazia")')[0].values.length, 1);
  schemaRestore.close();

  const sql = await exportDatabase("large_db", "sql", db);
  assert.ok((await sql.blob.text()).includes('INSERT INTO "Bulk Rows"'));

  const preview = await exportDatabase("large_db", "sql", db, { preview: true });
  const previewText = await preview.blob.text();
  assert.equal(preview.truncated, true);
  assert.ok(new TextEncoder().encode(previewText).length <= 100 * 1024);
  assert.ok(previewText.split("\n").length <= 200);
  assert.match(previewText, /…/);

  const archive = await exportDatabase("large_db", "csv", db);
  assert.equal(archive.blob.type, "application/zip");
  const archiveBytes = new Uint8Array(await archive.blob.arrayBuffer());
  assert.equal(new DataView(archiveBytes.buffer).getUint32(0, true), 0x04034b50);
  assert.ok(new TextDecoder().decode(archiveBytes).includes("Bulk Rows.csv"));

  db.close();
});

test("CSV and SQL dialect serializers apply delimiters and MySQL escapes", () => {
  assert.equal(csvCell("a;b", ";"), '"a;b"');
  assert.equal(sqlLiteral("a\\b\n'c", "mysql"), "'a\\\\b\\n''c'");
});
