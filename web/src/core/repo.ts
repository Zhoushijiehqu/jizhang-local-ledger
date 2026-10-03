/** 仓储层（写入走白名单，禁止整对象覆盖） */
import { Db, rn, rnOpt, rs, rb, type Param } from './db';
import type {
  Account, BillCycle, Budget, Category, Ledger, SaveCard, SavePlan, SaveRecord, Txn
} from './types';
import type { AccountGroup, AccountKind, CategoryIconStyle, Direction, FlowType, ReimbursementStatus, SaveCardStatus, SaveFrequency, SavePlanType, TxnKind } from './enums';
import type { BudgetPeriod } from './enums';
import type { Cents } from './money';

const now = () => Math.floor(Date.now() / 1000);

export class Repo {
  private seq = 0;
  constructor(readonly db: Db) {}

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${String(this.seq).padStart(4, '0')}_${Date.now()}`;
  }

  // ---------- 读 ----------

  ledgers(): Ledger[] {
    return this.db.rows(`SELECT * FROM ledger WHERE archived=0 ORDER BY sort_order, name;`).map(r => ({
      id: rs(r, 'id'), name: rs(r, 'name'), symbol: rs(r, 'symbol'), currency: rs(r, 'currency'),
      isDefault: rb(r, 'is_default'), archived: rb(r, 'archived'), sortOrder: rn(r, 'sort_order')
    }));
  }

  defaultLedger(): Ledger | null {
    const r = this.db.rows(`SELECT * FROM ledger ORDER BY is_default DESC, sort_order LIMIT 1;`)[0];
    if (!r) return null;
    return {
      id: rs(r, 'id'), name: rs(r, 'name'), symbol: rs(r, 'symbol'), currency: rs(r, 'currency'),
      isDefault: rb(r, 'is_default'), archived: rb(r, 'archived'), sortOrder: rn(r, 'sort_order')
    };
  }

  accounts(ledgerId?: string): Account[] {
    const sql = ledgerId
      ? `SELECT * FROM account WHERE deleted_at IS NULL AND ledger_id=? ORDER BY sort_order, name;`
      : `SELECT * FROM account WHERE deleted_at IS NULL ORDER BY sort_order, name;`;
    const params: Param[] = ledgerId ? [ledgerId] : [];
    return this.db.rows(sql, params).map(r => ({
      id: rs(r, 'id'), ledgerId: rs(r, 'ledger_id'), name: rs(r, 'name'),
      group: rs(r, 'group_type') as AccountGroup, kind: rs(r, 'account_kind') as AccountKind,
      icon: rs(r, 'icon'), cardNoMask: rs(r, 'card_no_mask') || null, currency: rs(r, 'currency'),
      initialBalance: rn(r, 'initial_balance_cents'), creditLimit: rn(r, 'credit_limit_cents'),
      billDay: rnOpt(r, 'bill_day'), repayDay: rnOpt(r, 'repay_day'),
      groupName: rs(r, 'group_name') || null, hidden: rb(r, 'hidden'),
      isFamilyCredit: rb(r, 'is_family_credit'), sortOrder: rn(r, 'sort_order')
    }));
  }

  categories(ledgerId: string, direction?: Direction): Category[] {
    const sql = direction
      ? `SELECT * FROM category WHERE deleted_at IS NULL AND ledger_id=? AND direction=? ORDER BY sort_order, name;`
      : `SELECT * FROM category WHERE deleted_at IS NULL AND ledger_id=? ORDER BY sort_order, name;`;
    const params: Param[] = direction ? [ledgerId, direction] : [ledgerId];
    return this.db.rows(sql, params).map(r => ({
      id: rs(r, 'id'), ledgerId: rs(r, 'ledger_id'), parentId: rs(r, 'parent_id') || null,
      name: rs(r, 'name'), direction: rs(r, 'direction') as Direction, icon: rs(r, 'icon'),
      colorHex: rs(r, 'color_hex'), iconStyle: rs(r, 'icon_style') as CategoryIconStyle,
      isSystem: rb(r, 'is_system'), archived: rb(r, 'archived'), hidden: rb(r, 'hidden'),
      sortOrder: rn(r, 'sort_order')
    }));
  }

  txns(ledgerId: string, opt: { from?: number; to?: number; accountId?: string } = {}): Txn[] {
    let sql = `SELECT * FROM txn WHERE deleted_at IS NULL AND ledger_id=?`;
    const params: Param[] = [ledgerId];
    if (opt.from != null) { sql += ` AND occurred_at>=?`; params.push(opt.from); }
    if (opt.to != null) { sql += ` AND occurred_at<?`; params.push(opt.to); }
    if (opt.accountId) { sql += ` AND (account_id=? OR to_account_id=?)`; params.push(opt.accountId, opt.accountId); }
    sql += ` ORDER BY occurred_at ASC;`;
    return this.db.rows(sql, params).map(r => this.mapTxn(r));
  }

  private mapTxn(r: Record<string, number | string | null | Uint8Array>): Txn {
    return {
      id: rs(r, 'id'), ledgerId: rs(r, 'ledger_id'), accountId: rs(r, 'account_id'),
      toAccountId: rs(r, 'to_account_id') || null, categoryId: rs(r, 'category_id') || null,
      kind: rs(r, 'kind') as TxnKind, flowType: (rs(r, 'flow_type') || null) as FlowType | null,
      original: rn(r, 'original_cents'), discount: rn(r, 'discount_cents'), fee: rn(r, 'fee_cents'),
      refund: rn(r, 'refund_cents'), amount: rn(r, 'amount_cents'), occurredAt: rn(r, 'occurred_at'),
      note: rs(r, 'note'), locationName: rs(r, 'location_name') || null,
      reimbursement: rs(r, 'reimbursement_status') as ReimbursementStatus,
      excludeFromStats: rb(r, 'exclude_from_stats'),
      billCycleId: rs(r, 'bill_cycle_id') || null, refundOfId: rs(r, 'refund_of_id') || null
    };
  }

  billCycles(accountId?: string): BillCycle[] {
    const sql = accountId
      ? `SELECT * FROM bill_cycle WHERE account_id=? ORDER BY period_start DESC;`
      : `SELECT * FROM bill_cycle ORDER BY period_start DESC;`;
    const params: Param[] = accountId ? [accountId] : [];
    return this.db.rows(sql, params).map(r => ({
      id: rs(r, 'id'), accountId: rs(r, 'account_id'),
      periodStart: rn(r, 'period_start'), periodEnd: rn(r, 'period_end'),
      statementDate: rnOpt(r, 'statement_date'), dueDate: rnOpt(r, 'due_date'),
      billAmount: rnOpt(r, 'bill_amount_cents'), paid: rn(r, 'paid_cents'),
      status: rs(r, 'status') as BillCycle['status']
    }));
  }

  totalBudget(ledgerId: string): Budget | null {
    const r = this.db.rows(
      `SELECT * FROM budget WHERE ledger_id=? AND category_id IS NULL ORDER BY start_date DESC LIMIT 1;`,
      [ledgerId]
    )[0];
    if (!r) return null;
    return {
      id: rs(r, 'id'), ledgerId: rs(r, 'ledger_id'), categoryId: rs(r, 'category_id') || null,
      period: rs(r, 'period') as BudgetPeriod, amount: rn(r, 'amount_cents'),
      carryOver: rb(r, 'carry_over'), startDate: rn(r, 'start_date')
    };
  }

  savePlans(ledgerId?: string): SavePlan[] {
    const sql = ledgerId
      ? `SELECT * FROM save_plan WHERE ledger_id=? AND archived=0 ORDER BY start_date;`
      : `SELECT * FROM save_plan WHERE archived=0 ORDER BY start_date;`;
    const params: Param[] = ledgerId ? [ledgerId] : [];
    return this.db.rows(sql, params).map(r => ({
      id: rs(r, 'id'), ledgerId: rs(r, 'ledger_id'), name: rs(r, 'name'), emoji: rs(r, 'emoji'),
      type: rs(r, 'plan_type') as SavePlanType, frequency: rs(r, 'frequency') as SaveFrequency,
      startDate: rn(r, 'start_date'), endDate: rn(r, 'end_date'), target: rn(r, 'target_cents'),
      fromAccountId: rs(r, 'from_account_id') || null, toAccountId: rs(r, 'to_account_id') || null,
      archived: rb(r, 'archived')
    }));
  }

  saveCards(planId: string): SaveCard[] {
    return this.db.rows(`SELECT * FROM save_card WHERE plan_id=? ORDER BY seq;`, [planId]).map(r => ({
      id: rs(r, 'id'), planId: rs(r, 'plan_id'), seq: rn(r, 'seq'), dueDate: rn(r, 'due_date'),
      amount: rn(r, 'amount_cents'), status: rs(r, 'status') as SaveCardStatus,
      txnId: rs(r, 'txn_id') || null
    }));
  }

  saveRecords(planId: string) {
    return this.db.rows(`SELECT * FROM save_record WHERE plan_id=? ORDER BY occurred_at;`, [planId]).map(r => ({
      id: rs(r, 'id'), planId: rs(r, 'plan_id'), amount: rn(r, 'amount_cents'),
      occurredAt: rn(r, 'occurred_at'), note: rs(r, 'note')
    })) as SaveRecord[];
  }

  templates(ledgerId: string) {
    return this.db.rows(`SELECT * FROM template WHERE ledger_id=? ORDER BY sort_order;`, [ledgerId]).map(r => ({
      id: rs(r, 'id'), ledgerId: rs(r, 'ledger_id'), name: rs(r, 'name'), emoji: rs(r, 'emoji'),
      direction: rs(r, 'direction') as Direction, amount: rn(r, 'amount_cents'),
      categoryId: rs(r, 'category_id') || null, accountId: rs(r, 'account_id') || null,
      sortOrder: rn(r, 'sort_order')
    }));
  }

  // ---------- 写 ----------

  insertLedger(l: Ledger): void {
    this.db.run(
      `INSERT INTO ledger(id,name,symbol,currency,is_default,archived,sort_order) VALUES(?,?,?,?,?,?,?);`,
      [l.id, l.name, l.symbol, l.currency, l.isDefault ? 1 : 0, l.archived ? 1 : 0, l.sortOrder]
    );
  }

  updateLedgerAllowedFields(id: string, f: { name?: string; archived?: boolean; sortOrder?: number; symbol?: string }): void {
    if (f.name !== undefined) this.db.run(`UPDATE ledger SET name=? WHERE id=?;`, [f.name, id]);
    if (f.symbol !== undefined) this.db.run(`UPDATE ledger SET symbol=? WHERE id=?;`, [f.symbol, id]);
    if (f.archived !== undefined) this.db.run(`UPDATE ledger SET archived=? WHERE id=?;`, [f.archived ? 1 : 0, id]);
    if (f.sortOrder !== undefined) this.db.run(`UPDATE ledger SET sort_order=? WHERE id=?;`, [f.sortOrder, id]);
  }

  /** 切换默认账本：单一事务，避免出现两个 is_default=1 */
  setDefaultLedger(id: string): void {
    this.db.transaction(() => {
      this.db.run(`UPDATE ledger SET is_default=0;`);
      this.db.run(`UPDATE ledger SET is_default=1 WHERE id=?;`, [id]);
    });
  }

  txnCount(ledgerId: string): number {
    return this.db.int(`SELECT COUNT(*) AS v FROM txn WHERE deleted_at IS NULL AND ledger_id=?;`, [ledgerId]);
  }

  updateSaveCardStatus(cardId: string, status: 'pending' | 'saved', txnId: string | null = null): void {
    this.db.run(`UPDATE save_card SET status=?, txn_id=?, updated_at=? WHERE id=?;`,
      [status, txnId, now(), cardId]);
  }

  insertAccount(a: Account): void {
    const t = now();
    this.db.run(
      `INSERT INTO account(id,ledger_id,name,group_type,account_kind,icon,card_no_mask,currency,
        initial_balance_cents,credit_limit_cents,bill_day,repay_day,group_name,hidden,
        is_family_credit,sort_order,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);`,
      [a.id, a.ledgerId, a.name, a.group, a.kind, a.icon, a.cardNoMask, a.currency,
       a.initialBalance, a.creditLimit, a.billDay, a.repayDay, a.groupName,
       a.hidden ? 1 : 0, a.isFamilyCredit ? 1 : 0, a.sortOrder, t, t]
    );
  }

  updateInitialBalance(accountId: string, balance: Cents): void {
    this.db.run(`UPDATE account SET initial_balance_cents=?, updated_at=? WHERE id=?;`, [balance, now(), accountId]);
  }

  /** 仅按白名单字段更新，禁止整对象覆盖 */
  updateAccountAllowedFields(
    accountId: string,
    fields: { name?: string; icon?: string; hidden?: boolean; sortOrder?: number; groupName?: string }
  ): void {
    if (fields.name !== undefined) this.db.run(`UPDATE account SET name=? WHERE id=?;`, [fields.name, accountId]);
    if (fields.icon !== undefined) this.db.run(`UPDATE account SET icon=? WHERE id=?;`, [fields.icon, accountId]);
    if (fields.hidden !== undefined) this.db.run(`UPDATE account SET hidden=? WHERE id=?;`, [fields.hidden ? 1 : 0, accountId]);
    if (fields.sortOrder !== undefined) this.db.run(`UPDATE account SET sort_order=? WHERE id=?;`, [fields.sortOrder, accountId]);
    if (fields.groupName !== undefined) this.db.run(`UPDATE account SET group_name=? WHERE id=?;`, [fields.groupName, accountId]);
    this.db.run(`UPDATE account SET updated_at=? WHERE id=?;`, [now(), accountId]);
  }

  insertCategory(c: Category): void {
    const t = now();
    this.db.run(
      `INSERT INTO category(id,ledger_id,parent_id,name,direction,icon,color_hex,icon_style,
        is_system,archived,hidden,sort_order,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?);`,
      [c.id, c.ledgerId, c.parentId, c.name, c.direction, c.icon, c.colorHex, c.iconStyle,
       c.isSystem ? 1 : 0, c.archived ? 1 : 0, c.hidden ? 1 : 0, c.sortOrder, t, t]
    );
  }

  insertTxn(t: Txn): void {
    const ts = now();
    this.db.run(
      `INSERT INTO txn(id,ledger_id,account_id,to_account_id,category_id,kind,flow_type,
        original_cents,discount_cents,fee_cents,refund_cents,amount_cents,occurred_at,note,
        location_name,reimbursement_status,exclude_from_stats,bill_cycle_id,refund_of_id,
        created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);`,
      [t.id, t.ledgerId, t.accountId, t.toAccountId, t.categoryId, t.kind, t.flowType,
       t.original, t.discount, t.fee, t.refund, t.amount, t.occurredAt, t.note,
       t.locationName, t.reimbursement, t.excludeFromStats ? 1 : 0, t.billCycleId, t.refundOfId,
       ts, ts]
    );
  }

  /** 白名单字段更新：禁止整对象覆盖，也不允许批量改到状态字段 */
  updateTxnAllowedFields(id: string, f: {
    note?: string; categoryId?: string | null; accountId?: string; occurredAt?: number;
    reimbursement?: ReimbursementStatus; excludeFromStats?: boolean; locationName?: string | null;
  }): void {
    if (f.note !== undefined) this.db.run(`UPDATE txn SET note=? WHERE id=?;`, [f.note, id]);
    if (f.categoryId !== undefined) this.db.run(`UPDATE txn SET category_id=? WHERE id=?;`, [f.categoryId, id]);
    if (f.accountId !== undefined) this.db.run(`UPDATE txn SET account_id=? WHERE id=?;`, [f.accountId, id]);
    if (f.occurredAt !== undefined) this.db.run(`UPDATE txn SET occurred_at=? WHERE id=?;`, [f.occurredAt, id]);
    if (f.reimbursement !== undefined) this.db.run(`UPDATE txn SET reimbursement_status=? WHERE id=?;`, [f.reimbursement, id]);
    if (f.excludeFromStats !== undefined) this.db.run(`UPDATE txn SET exclude_from_stats=? WHERE id=?;`, [f.excludeFromStats ? 1 : 0, id]);
    if (f.locationName !== undefined) this.db.run(`UPDATE txn SET location_name=? WHERE id=?;`, [f.locationName, id]);
    this.db.run(`UPDATE txn SET updated_at=? WHERE id=?;`, [now(), id]);
  }

  /** 软删除（可恢复；不做物理删除，避免误删） */
  softDeleteTxn(id: string): void {
    this.db.run(`UPDATE txn SET deleted_at=?, updated_at=? WHERE id=?;`, [now(), now(), id]);
  }

  restoreTxn(id: string): void {
    this.db.run(`UPDATE txn SET deleted_at=NULL, updated_at=? WHERE id=?;`, [now(), id]);
  }

  /**
   * 账单详情编辑（白名单字段）。
   * 允许改：金额四件套（原价/优惠/手续费/退款，实付自动推导）、分类、账户、时间、
   * 备注、地点、报销状态、是否计入统计。
   * 刻意不改 kind/flow_type —— 它们决定资金语义（转账 vs 支出），改了会让余额口径错乱。
   */
  updateTxnFull(id: string, f: {
    original?: Cents; discount?: Cents; fee?: Cents; refund?: Cents;
    categoryId?: string | null; accountId?: string; occurredAt?: number;
    note?: string; locationName?: string | null;
    reimbursement?: ReimbursementStatus; excludeFromStats?: boolean;
  }): void {
    if (f.original !== undefined) this.db.run(`UPDATE txn SET original_cents=? WHERE id=?;`, [f.original, id]);
    if (f.discount !== undefined) this.db.run(`UPDATE txn SET discount_cents=? WHERE id=?;`, [f.discount, id]);
    if (f.fee !== undefined) this.db.run(`UPDATE txn SET fee_cents=? WHERE id=?;`, [f.fee, id]);
    if (f.refund !== undefined) this.db.run(`UPDATE txn SET refund_cents=? WHERE id=?;`, [f.refund, id]);
    if (f.original !== undefined || f.discount !== undefined || f.refund !== undefined) {
      // 实付 = 原价 − 优惠 − 退款
      const row = this.db.rows(`SELECT original_cents, discount_cents, refund_cents FROM txn WHERE id=?;`, [id])[0];
      const amount = Number(row?.original_cents ?? 0) - Number(row?.discount_cents ?? 0) - Number(row?.refund_cents ?? 0);
      this.db.run(`UPDATE txn SET amount_cents=? WHERE id=?;`, [amount, id]);
    }
    if (f.categoryId !== undefined) this.db.run(`UPDATE txn SET category_id=? WHERE id=?;`, [f.categoryId, id]);
    if (f.accountId !== undefined) this.db.run(`UPDATE txn SET account_id=? WHERE id=?;`, [f.accountId, id]);
    if (f.occurredAt !== undefined) this.db.run(`UPDATE txn SET occurred_at=? WHERE id=?;`, [f.occurredAt, id]);
    if (f.note !== undefined) this.db.run(`UPDATE txn SET note=? WHERE id=?;`, [f.note, id]);
    if (f.locationName !== undefined) this.db.run(`UPDATE txn SET location_name=? WHERE id=?;`, [f.locationName, id]);
    if (f.reimbursement !== undefined) this.db.run(`UPDATE txn SET reimbursement_status=? WHERE id=?;`, [f.reimbursement, id]);
    if (f.excludeFromStats !== undefined) this.db.run(`UPDATE txn SET exclude_from_stats=? WHERE id=?;`, [f.excludeFromStats ? 1 : 0, id]);
    this.db.run(`UPDATE txn SET updated_at=? WHERE id=?;`, [now(), id]);
  }

  countTxnsOfAccount(accountId: string): number {
    return this.db.int(
      `SELECT COUNT(*) AS v FROM txn WHERE deleted_at IS NULL AND (account_id=? OR to_account_id=?);`,
      [accountId, accountId]);
  }

  /** 账户编辑（白名单）：名称/图标/类型/分组/卡号/初始余额/额度/账单日/还款日/隐藏 */
  updateAccountFull(id: string, f: {
    name?: string; icon?: string; kind?: string; group?: string; cardNoMask?: string | null;
    initialBalance?: Cents; creditLimit?: Cents; billDay?: number | null; repayDay?: number | null;
    hidden?: boolean; sortOrder?: number;
  }): void {
    if (f.name !== undefined) this.db.run(`UPDATE account SET name=? WHERE id=?;`, [f.name, id]);
    if (f.icon !== undefined) this.db.run(`UPDATE account SET icon=? WHERE id=?;`, [f.icon, id]);
    if (f.kind !== undefined) this.db.run(`UPDATE account SET account_kind=? WHERE id=?;`, [f.kind, id]);
    if (f.group !== undefined) this.db.run(`UPDATE account SET group_type=? WHERE id=?;`, [f.group, id]);
    if (f.cardNoMask !== undefined) this.db.run(`UPDATE account SET card_no_mask=? WHERE id=?;`, [f.cardNoMask, id]);
    if (f.initialBalance !== undefined) this.db.run(`UPDATE account SET initial_balance_cents=? WHERE id=?;`, [f.initialBalance, id]);
    if (f.creditLimit !== undefined) this.db.run(`UPDATE account SET credit_limit_cents=? WHERE id=?;`, [f.creditLimit, id]);
    if (f.billDay !== undefined) this.db.run(`UPDATE account SET bill_day=? WHERE id=?;`, [f.billDay, id]);
    if (f.repayDay !== undefined) this.db.run(`UPDATE account SET repay_day=? WHERE id=?;`, [f.repayDay, id]);
    if (f.hidden !== undefined) this.db.run(`UPDATE account SET hidden=? WHERE id=?;`, [f.hidden ? 1 : 0, id]);
    if (f.sortOrder !== undefined) this.db.run(`UPDATE account SET sort_order=? WHERE id=?;`, [f.sortOrder, id]);
    this.db.run(`UPDATE account SET updated_at=? WHERE id=?;`, [now(), id]);
  }

  /** 账户删除：软删除（有流水时建议改为隐藏，见调用方） */
  softDeleteAccount(id: string): void {
    this.db.run(`UPDATE account SET deleted_at=?, updated_at=? WHERE id=?;`, [now(), now(), id]);
  }

  // ---- 存钱计划 ----

  updateSavePlanFull(id: string, f: {
    name?: string; emoji?: string; type?: string; frequency?: string;
    startDate?: number; endDate?: number; target?: Cents;
    fromAccountId?: string | null; toAccountId?: string | null;
  }): void {
    if (f.name !== undefined) this.db.run(`UPDATE save_plan SET name=? WHERE id=?;`, [f.name, id]);
    if (f.emoji !== undefined) this.db.run(`UPDATE save_plan SET emoji=? WHERE id=?;`, [f.emoji, id]);
    if (f.type !== undefined) this.db.run(`UPDATE save_plan SET plan_type=? WHERE id=?;`, [f.type, id]);
    if (f.frequency !== undefined) this.db.run(`UPDATE save_plan SET frequency=? WHERE id=?;`, [f.frequency, id]);
    if (f.startDate !== undefined) this.db.run(`UPDATE save_plan SET start_date=? WHERE id=?;`, [f.startDate, id]);
    if (f.endDate !== undefined) this.db.run(`UPDATE save_plan SET end_date=? WHERE id=?;`, [f.endDate, id]);
    if (f.target !== undefined) this.db.run(`UPDATE save_plan SET target_cents=? WHERE id=?;`, [f.target, id]);
    if (f.fromAccountId !== undefined) this.db.run(`UPDATE save_plan SET from_account_id=? WHERE id=?;`, [f.fromAccountId, id]);
    if (f.toAccountId !== undefined) this.db.run(`UPDATE save_plan SET to_account_id=? WHERE id=?;`, [f.toAccountId, id]);
    this.db.run(`UPDATE save_plan SET updated_at=? WHERE id=?;`, [now(), id]);
  }

  /** 删除计划：连带清掉它的卡片与存入记录（不做级联外键，显式处理，避免孤儿数据） */
  deleteSavePlan(id: string): void {
    this.db.transaction(() => {
      this.db.run(`DELETE FROM save_card WHERE plan_id=?;`, [id]);
      this.db.run(`DELETE FROM save_record WHERE plan_id=?;`, [id]);
      this.db.run(`DELETE FROM save_plan WHERE id=?;`, [id]);
    });
  }

  archiveSavePlan(id: string, archived: boolean): void {
    this.db.run(`UPDATE save_plan SET archived=? WHERE id=?;`, [archived ? 1 : 0, id]);
  }

  deleteSaveCards(planId: string): void {
    this.db.run(`DELETE FROM save_card WHERE plan_id=?;`, [planId]);
  }

  insertBillCycle(c: BillCycle): void {
    const t = now();
    this.db.run(
      `INSERT INTO bill_cycle(id,account_id,period_start,period_end,statement_date,due_date,
        bill_amount_cents,paid_cents,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?);`,
      [c.id, c.accountId, c.periodStart, c.periodEnd, c.statementDate, c.dueDate,
       c.billAmount, c.paid, c.status, t, t]
    );
  }

  updateBudget(ledgerId: string, amount: Cents, carryOver: boolean, period: BudgetPeriod): void {
    const t = now();
    const existing = this.totalBudget(ledgerId);
    if (existing) {
      this.db.run(`UPDATE budget SET amount_cents=?, carry_over=?, period=?, updated_at=? WHERE id=?;`,
        [amount, carryOver ? 1 : 0, period, t, existing.id]);
    } else {
      this.db.run(
        `INSERT INTO budget(id,ledger_id,category_id,period,amount_cents,carry_over,start_date,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?);`,
        [this.nextId('B'), ledgerId, null, period, amount, carryOver ? 1 : 0, t, t, t]);
    }
  }

  updateCategoryAllowedFields(id: string, f: {
    name?: string; icon?: string; colorHex?: string; archived?: boolean; sortOrder?: number;
    iconStyle?: string; parentId?: string | null;
  }, cascadeColorToChildren = false): void {
    if (f.name !== undefined) this.db.run(`UPDATE category SET name=? WHERE id=?;`, [f.name, id]);
    if (f.icon !== undefined) this.db.run(`UPDATE category SET icon=? WHERE id=?;`, [f.icon, id]);
    if (f.colorHex !== undefined) {
      this.db.run(`UPDATE category SET color_hex=? WHERE id=?;`, [f.colorHex, id]);
      // 一级分类改色时可选择同时修改二级
      if (cascadeColorToChildren) {
        this.db.run(`UPDATE category SET color_hex=? WHERE parent_id=?;`, [f.colorHex, id]);
      }
    }
    if (f.archived !== undefined) this.db.run(`UPDATE category SET archived=? WHERE id=?;`, [f.archived ? 1 : 0, id]);
    if (f.sortOrder !== undefined) this.db.run(`UPDATE category SET sort_order=? WHERE id=?;`, [f.sortOrder, id]);
    if (f.iconStyle !== undefined) this.db.run(`UPDATE category SET icon_style=? WHERE id=?;`, [f.iconStyle, id]);
    if (f.parentId !== undefined) this.db.run(`UPDATE category SET parent_id=? WHERE id=?;`, [f.parentId, id]);
    this.db.run(`UPDATE category SET updated_at=? WHERE id=?;`, [now(), id]);
  }

  softDeleteCategory(id: string): void {
    // 级联：先处理子类（含归档子类），避免出现孤立节点
    this.db.run(`UPDATE category SET deleted_at=? WHERE parent_id=?;`, [now(), id]);
    this.db.run(`UPDATE category SET deleted_at=? WHERE id=?;`, [now(), id]);
  }

  deleteTemplate(id: string): void {
    this.db.run(`DELETE FROM template WHERE id=?;`, [id]);
  }

  insertBudget(b: Budget): void {
    const t = now();
    this.db.run(
      `INSERT INTO budget(id,ledger_id,category_id,period,amount_cents,carry_over,start_date,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?);`,
      [b.id, b.ledgerId, b.categoryId, b.period, b.amount, b.carryOver ? 1 : 0, b.startDate, t, t]
    );
  }

  insertSavePlan(p: SavePlan): void {
    const t = now();
    this.db.run(
      `INSERT INTO save_plan(id,ledger_id,name,emoji,plan_type,frequency,start_date,end_date,
        target_cents,from_account_id,to_account_id,archived,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?);`,
      [p.id, p.ledgerId, p.name, p.emoji, p.type, p.frequency, p.startDate, p.endDate,
       p.target, p.fromAccountId, p.toAccountId, p.archived ? 1 : 0, t, t]
    );
  }

  insertSaveCard(c: SaveCard): void {
    const t = now();
    this.db.run(
      `INSERT INTO save_card(id,plan_id,seq,due_date,amount_cents,status,txn_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?);`,
      [c.id, c.planId, c.seq, c.dueDate, c.amount, c.status, c.txnId, t, t]
    );
  }

  insertSaveRecord(r: SaveRecord): void {
    this.db.run(
      `INSERT INTO save_record(id,plan_id,amount_cents,occurred_at,note,created_at) VALUES(?,?,?,?,?,?);`,
      [r.id, r.planId, r.amount, r.occurredAt, r.note, now()]
    );
  }

  insertTemplate(t: {
    id: string; ledgerId: string; name: string; emoji: string; direction: Direction;
    amount: Cents; categoryId: string | null; accountId: string | null; sortOrder: number;
  }): void {
    this.db.run(
      `INSERT INTO template(id,ledger_id,name,emoji,direction,amount_cents,category_id,account_id,sort_order,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?);`,
      [t.id, t.ledgerId, t.name, t.emoji, t.direction, t.amount, t.categoryId, t.accountId, t.sortOrder, now()]
    );
  }

  setPreference(key: string, value: string): void {
    this.db.run(`INSERT OR REPLACE INTO preference(key,value) VALUES(?,?);`, [key, value]);
  }

  preference(key: string): string | null {
    return this.db.str(`SELECT value FROM preference WHERE key=?;`, [key]);
  }
}
