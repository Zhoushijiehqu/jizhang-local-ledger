import { Db, loadSqlJs } from './db';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { SCHEMA_VERSION } from './schema';
export async function inspectBackup(bytes: Uint8Array) {
  const SQL = await loadSqlJs(() => wasmUrl);
  const db = new Db(new SQL.Database(bytes.slice()));
  try {
    if (db.str('PRAGMA integrity_check;') !== 'ok') throw new Error('备份损坏');
    if (db.int("SELECT value FROM meta WHERE key='schema_version';") !== SCHEMA_VERSION) throw new Error('备份版本与当前软件不一致');
    for (const table of ['ledger','account','category','txn','budget','template','preference','save_plan','save_card','save_record']) db.rows(`SELECT * FROM ${table} LIMIT 0;`);
    if (db.rows('PRAGMA foreign_key_check;').length) throw new Error('备份中有缺失的账户或分类关联');
    const coverage = db.rows('SELECT MIN(occurred_at) AS first, MAX(occurred_at) AS last FROM txn WHERE deleted_at IS NULL;')[0];
    const count = db.int('SELECT COUNT(*) FROM txn WHERE deleted_at IS NULL;');
    const deleted = db.int('SELECT COUNT(*) FROM txn WHERE deleted_at IS NOT NULL;');
    const ledgers = db.rows('SELECT name FROM ledger WHERE archived=0;').map(row => String(row.name));
    return {count, deleted, ledgers, first: Number(coverage.first) || null, last: Number(coverage.last) || null};
  } finally { db.close(); }
}
