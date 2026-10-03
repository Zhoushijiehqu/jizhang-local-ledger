/**
 * SQLite(WASM) 访问层。
 */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { DDL, SCHEMA_VERSION } from './schema';
import type { Cents } from './money';

export type Param = number | string | null | Uint8Array;
export type Row = Record<string, number | string | null | Uint8Array>;

let SQL: SqlJsStatic | null = null;

/** 初始化 wasm 引擎。locateFile 由宿主环境提供（浏览器用 ?url，Node 用 node_modules 路径） */
export async function loadSqlJs(locateFile?: (file: string) => string): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
  return SQL;
}

export class Db {
  raw: Database;

  constructor(raw: Database) {
    this.raw = raw;
  }

  /** 建库（首次或空库） */
  static create(sql: SqlJsStatic, bytes?: Uint8Array): Db {
    const raw = bytes ? new sql.Database(bytes) : new sql.Database();
    const db = new Db(raw);
    db.exec('PRAGMA foreign_keys = ON;');
    for (const stmt of DDL) db.exec(stmt);
    db.run("INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', ?);", [String(SCHEMA_VERSION)]);
    return db;
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  run(sql: string, params: Param[] = []): void {
    const stmt = this.raw.prepare(sql);
    try {
      stmt.bind(params as never);
      stmt.step();
    } finally {
      stmt.free();
    }
  }

  rows(sql: string, params: Param[] = []): Row[] {
    const stmt = this.raw.prepare(sql);
    const out: Row[] = [];
    try {
      stmt.bind(params as never);
      while (stmt.step()) out.push(stmt.getAsObject() as Row);
    } finally {
      stmt.free();
    }
    return out;
  }

  /** 单值：整数（金额返回“分”） */
  int(sql: string, params: Param[] = []): number {
    const r = this.rows(sql, params);
    if (r.length === 0) return 0;
    const v = Object.values(r[0])[0];
    return typeof v === 'number' ? v : Number(v ?? 0);
  }

  money(sql: string, params: Param[] = []): Cents {
    return this.int(sql, params);
  }

  str(sql: string, params: Param[] = []): string | null {
    const r = this.rows(sql, params);
    if (r.length === 0) return null;
    const v = Object.values(r[0])[0];
    return v == null ? null : String(v);
  }

  /** 事务：批量写入原子化 */
  transaction<T>(fn: () => T): T {
    this.exec('BEGIN IMMEDIATE;');
    try {
      const out = fn();
      this.exec('COMMIT;');
      return out;
    } catch (e) {
      try {
        this.exec('ROLLBACK;');
      } catch {
        /* ignore */
      }
      throw e;
    }
  }

  /** 导出为真正的 .sqlite 文件字节（可备份、可迁移） */
  export(): Uint8Array {
    const bytes = this.raw.export();
    this.exec("PRAGMA foreign_keys = ON;");
    return bytes;
  }

  restore(bytes: Uint8Array): void {
    if (!SQL) throw new Error("数据库未初始化");
    this.raw.close();
    this.raw = new SQL.Database(bytes.slice());
    this.exec("PRAGMA foreign_keys = ON;");
  }

  close(): void {
    this.raw.close();
  }
}

// 行取值小工具（SQLite 会把 INTEGER 返回为 number，布尔需自行转换）
export function rs(row: Row, key: string, fallback = ''): string {
  const v = row[key];
  return v == null ? fallback : String(v);
}
export function rn(row: Row, key: string, fallback = 0): number {
  const v = row[key];
  return v == null ? fallback : Number(v);
}
export function rb(row: Row, key: string): boolean {
  return Number(row[key] ?? 0) !== 0;
}
export function rnOpt(row: Row, key: string): number | null {
  const v = row[key];
  return v == null ? null : Number(v);
}
