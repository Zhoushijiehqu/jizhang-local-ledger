/**
 * 数据库结构（schema_version = 1）
 *
 * 设计约束：
 *  1) 金额一律 INTEGER 分，杜绝浮点误差
 *  2) 所有实体用稳定字符串 ID，禁用索引定位
 *  3) 原价/优惠/手续费/退款全部落库，禁止用备注承载
 *  4) 报销状态、账单周期状态显式建模，批量更新禁止触碰状态字段
 */
export const SCHEMA_VERSION = 1;

export const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS ledger (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      symbol     TEXT NOT NULL DEFAULT '💡',
      currency   TEXT NOT NULL DEFAULT 'CNY',
      is_default INTEGER NOT NULL DEFAULT 0,
      archived   INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
  );`,

  `CREATE TABLE IF NOT EXISTS account (
      id                    TEXT PRIMARY KEY,
      ledger_id             TEXT NOT NULL,
      name                  TEXT NOT NULL,
      group_type            TEXT NOT NULL,
      account_kind          TEXT NOT NULL,
      icon                  TEXT NOT NULL DEFAULT '',
      card_no_mask          TEXT,
      currency              TEXT NOT NULL DEFAULT 'CNY',
      initial_balance_cents INTEGER NOT NULL DEFAULT 0,
      credit_limit_cents    INTEGER NOT NULL DEFAULT 0,
      bill_day              INTEGER,
      repay_day             INTEGER,
      group_name            TEXT,
      hidden                INTEGER NOT NULL DEFAULT 0,
      is_family_credit      INTEGER NOT NULL DEFAULT 0,
      sort_order            INTEGER NOT NULL DEFAULT 0,
      created_at            REAL NOT NULL,
      updated_at            REAL NOT NULL,
      deleted_at            REAL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_account_ledger ON account(ledger_id, group_type, sort_order);`,

  `CREATE TABLE IF NOT EXISTS category (
      id          TEXT PRIMARY KEY,
      ledger_id   TEXT NOT NULL,
      parent_id   TEXT,
      name        TEXT NOT NULL,
      direction   TEXT NOT NULL,
      icon        TEXT NOT NULL DEFAULT '',
      color_hex   TEXT NOT NULL DEFAULT '#8E8E93',
      icon_style  TEXT NOT NULL DEFAULT 'mono',
      is_system   INTEGER NOT NULL DEFAULT 0,
      archived    INTEGER NOT NULL DEFAULT 0,
      hidden      INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  REAL NOT NULL,
      updated_at  REAL NOT NULL,
      deleted_at  REAL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_category_parent ON category(ledger_id, direction, parent_id, sort_order);`,

  `CREATE TABLE IF NOT EXISTS txn (
      id                    TEXT PRIMARY KEY,
      ledger_id             TEXT NOT NULL,
      account_id            TEXT NOT NULL,
      to_account_id         TEXT,
      category_id           TEXT,
      kind                  TEXT NOT NULL,
      flow_type             TEXT,
      original_cents        INTEGER NOT NULL DEFAULT 0,
      discount_cents        INTEGER NOT NULL DEFAULT 0,
      fee_cents             INTEGER NOT NULL DEFAULT 0,
      refund_cents          INTEGER NOT NULL DEFAULT 0,
      amount_cents          INTEGER NOT NULL DEFAULT 0,
      occurred_at           REAL NOT NULL,
      note                  TEXT NOT NULL DEFAULT '',
      location_name         TEXT,
      reimbursement_status  TEXT NOT NULL DEFAULT 'none',
      exclude_from_stats    INTEGER NOT NULL DEFAULT 0,
      bill_cycle_id         TEXT,
      refund_of_id          TEXT,
      created_at            REAL NOT NULL,
      updated_at            REAL NOT NULL,
      deleted_at            REAL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_txn_ledger_time ON txn(ledger_id, occurred_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_txn_account_time ON txn(account_id, occurred_at);`,
  `CREATE INDEX IF NOT EXISTS idx_txn_category_time ON txn(category_id, occurred_at);`,
  `CREATE INDEX IF NOT EXISTS idx_txn_kind ON txn(ledger_id, kind, occurred_at);`,
  `CREATE INDEX IF NOT EXISTS idx_txn_reimb ON txn(ledger_id, reimbursement_status);`,

  `CREATE TABLE IF NOT EXISTS tag (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      color_hex  TEXT NOT NULL DEFAULT '#8E8E93',
      sort_order INTEGER NOT NULL DEFAULT 0
  );`,

  `CREATE TABLE IF NOT EXISTS txn_tag (
      txn_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (txn_id, tag_id)
  );`,

  `CREATE TABLE IF NOT EXISTS budget (
      id           TEXT PRIMARY KEY,
      ledger_id    TEXT NOT NULL,
      category_id  TEXT,
      period       TEXT NOT NULL DEFAULT 'monthly',
      amount_cents INTEGER NOT NULL DEFAULT 0,
      carry_over   INTEGER NOT NULL DEFAULT 0,
      start_date   REAL NOT NULL,
      created_at   REAL NOT NULL,
      updated_at   REAL NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS bill_cycle (
      id                TEXT PRIMARY KEY,
      account_id        TEXT NOT NULL,
      period_start      REAL NOT NULL,
      period_end        REAL NOT NULL,
      statement_date    REAL,
      due_date          REAL,
      bill_amount_cents INTEGER,
      paid_cents        INTEGER NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'open',
      created_at        REAL NOT NULL,
      updated_at        REAL NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_cycle_account ON bill_cycle(account_id, period_start);`,

  `CREATE TABLE IF NOT EXISTS save_plan (
      id              TEXT PRIMARY KEY,
      ledger_id       TEXT NOT NULL,
      name            TEXT NOT NULL,
      emoji           TEXT NOT NULL DEFAULT '',
      plan_type       TEXT NOT NULL,
      frequency       TEXT NOT NULL DEFAULT 'monthly',
      start_date      REAL NOT NULL,
      end_date        REAL NOT NULL,
      target_cents    INTEGER NOT NULL DEFAULT 0,
      from_account_id TEXT,
      to_account_id   TEXT,
      archived        INTEGER NOT NULL DEFAULT 0,
      created_at      REAL NOT NULL,
      updated_at      REAL NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS save_card (
      id           TEXT PRIMARY KEY,
      plan_id      TEXT NOT NULL,
      seq          INTEGER NOT NULL,
      due_date     REAL NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'pending',
      txn_id       TEXT,
      created_at   REAL NOT NULL,
      updated_at   REAL NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_card_plan ON save_card(plan_id, seq);`,

  `CREATE TABLE IF NOT EXISTS save_record (
      id           TEXT PRIMARY KEY,
      plan_id      TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      occurred_at  REAL NOT NULL,
      note         TEXT NOT NULL DEFAULT '',
      created_at   REAL NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS template (
      id           TEXT PRIMARY KEY,
      ledger_id    TEXT NOT NULL,
      name         TEXT NOT NULL,
      emoji        TEXT NOT NULL DEFAULT '',
      direction    TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      category_id  TEXT,
      account_id   TEXT,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   REAL NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS preference (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
  );`
];
