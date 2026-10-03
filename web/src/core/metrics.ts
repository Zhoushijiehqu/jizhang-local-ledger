/**
 * 唯一聚合层（Single Source of Truth）。
 *
 * 铁律：UI 层不允许出现任何 SUM、任何金额相减，所有数字必须来自本类。
 */
import { Db, rb, rn, rnOpt, rs, type Param, type Row } from './db';
import { Repo } from './repo';
import type {
  Account, AssetsSnapshot, BudgetSnapshot, CategorySlice, CreditCardSnapshot, DateRange,
  DayStat, Ledger, PeriodSummary, RunningDebt, SavePlan, SavePlanProgress, Txn
} from './types';
import {
  ACCOUNT_GROUP_ORDER, FLOW_ORDER, IS_LIABILITY, type AccountGroup, type DayDenominator,
  type Direction, type FlowType, type TxnKind
} from './enums';
import { divCents, sumCents } from './money';
import type { Cents } from './money';

// ---------- 日期工具（本地时区，与 'unixepoch','localtime' 一致） ----------

export const toSec = (d: Date): number => Math.floor(d.getTime() / 1000);
export const fromSec = (s: number): Date => new Date(s * 1000);

export function dateOf(y: number, mo: number, d: number, h = 12, mi = 0): number {
  return toSec(new Date(y, mo - 1, d, h, mi, 0, 0));
}

function startOfDaySec(s: number): number {
  const d = fromSec(s);
  d.setHours(0, 0, 0, 0);
  return toSec(d);
}

function addDaysSec(s: number, n: number): number {
  const d = fromSec(s);
  d.setDate(d.getDate() + n);
  return toSec(d);
}

function addMonthsSec(s: number, n: number) {
  const d = fromSec(s);
  d.setMonth(d.getMonth() + n);
  return toSec(d);
}

function diffDays(a: number, b: number): number {
  return Math.round((startOfDaySec(b) - startOfDaySec(a)) / 86400);
}

function ymd(s: number): string {
  const d = fromSec(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- 聚合层 ----------

export interface TxnFilter {
  keyword?: string;
  from?: number;
  to?: number;
  minAmount?: Cents | null;
  maxAmount?: Cents | null;
  accountId?: string | null;
  categoryId?: string | null;
  reimbOnly?: 'pending' | 'done' | 'received' | null;
  hasRefund?: boolean;
  hasDiscount?: boolean;
  hasFee?: boolean;
  excludeFromStats?: boolean;
  flowTypes?: FlowType[];
  kinds?: TxnKind[];
  sort?: 'timeDesc' | 'timeAsc' | 'amountDesc' | 'amountAsc';
}

export interface SearchSummary {
  expense: Cents;
  income: Cents;
  balance: Cents;
  refund: Cents;
  refundIncome: Cents;
  discount: Cents;
  fee: Cents;
  pending: Cents;
  done: Cents;
  received: Cents;
  count: number;
}

export interface ExpenseChartData {
  previousCount: number;
  days: Array<{ date: number; total: Cents; values: Cents[] }>;
  categories: Array<{ id: string; name: string; color: string; amount: Cents; count: number }>;
  comparison: Array<{ id: string; name: string; current: Cents; previous: Cents }>;
  bins: Array<{ label: string; min: Cents; max: Cents | null; count: number }>;
  groups: Array<{ id: string; name: string; color: string; min: Cents; q1: Cents; median: Cents; q3: Cents; max: Cents;
    points: Array<{ id: string; amount: Cents; note: string }> }>;
}

export class MetricsEngine {
  constructor(readonly repo: Repo) {}
  get db(): Db {
    return this.repo.db;
  }

  // ===== 账户余额 =====

  /** 账户显示余额（唯一实现）：资金/充值/应收 = 初始 + 流水净影响；信用/应付 = −欠款 */
  accountBalance(account: Account): Cents {
    if (account.group === 'credit') {
      return -this.creditCardSnapshot(account.id).currentDebt;
    }
    if (account.group === 'payable') {
      return -Math.abs(this.runningBalance(account.id, 0));
    }
    return this.runningBalance(account.id, account.initialBalance);
  }

  /** 流水净影响（不含初始余额），供种子数据反推初始值 */
  runningBalanceExcludingInitial(accountId: string): Cents {
    return this.runningBalance(accountId, 0);
  }

  private runningBalance(accountId: string, initial: Cents): Cents {
    const out = this.db.money(
      `SELECT COALESCE(SUM(CASE
          WHEN account_id = ? THEN
              -- 支出走「原价 − 优惠 + 手续费」（退款由 refund_credit 单独回流，见 enums.balanceDeltaOf）
              CASE kind WHEN 'expense' THEN -(original_cents - discount_cents + fee_cents)
                        WHEN 'transfer' THEN -amount_cents
                        WHEN 'recharge' THEN -amount_cents
                        WHEN 'repay' THEN -amount_cents
                        WHEN 'collect' THEN -amount_cents
                        WHEN 'borrow_out' THEN -amount_cents
                        ELSE amount_cents END
          ELSE 0 END), 0) AS v
       FROM txn WHERE deleted_at IS NULL AND account_id = ?;`,
      [accountId, accountId]
    );
    const inflow = this.db.money(
      `SELECT COALESCE(SUM(CASE WHEN kind IN ('transfer','recharge','collect') THEN amount_cents ELSE 0 END),0) AS v
       FROM txn WHERE deleted_at IS NULL AND to_account_id = ?;`,
      [accountId]
    );
    return initial + out + inflow;
  }

  // ===== 资产总览（7.2） =====

  assetsSnapshot(ledgerId: string): AssetsSnapshot {
    const accounts = this.repo.accounts(ledgerId).filter(a => !a.hidden);
    let totalAssets = 0;
    let totalLiabilities = 0;
    const byGroup: Partial<Record<AccountGroup, Cents>> = {};
    const accountCount: Partial<Record<AccountGroup, number>> = {};

    for (const a of accounts) {
      const bal = this.accountBalance(a);
      if (IS_LIABILITY[a.group]) {
        totalLiabilities += Math.abs(bal);
        byGroup[a.group] = (byGroup[a.group] ?? 0) + Math.abs(bal);
      } else {
        totalAssets += bal;
        byGroup[a.group] = (byGroup[a.group] ?? 0) + bal;
      }
      accountCount[a.group] = (accountCount[a.group] ?? 0) + 1;
    }
    return {
      totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities, byGroup, accountCount
    };
  }

  /** 按组列出账户（顺序：资金 → 信用 → 充值 → 应收） */
  accountsByGroup(ledgerId: string): Array<{ group: AccountGroup; accounts: Account[] }> {
    const accounts = this.repo.accounts(ledgerId).filter(a => !a.hidden);
    return ACCOUNT_GROUP_ORDER
      .filter(g => accounts.some(a => a.group === g))
      .map(g => ({
        group: g,
        accounts: accounts.filter(a => a.group === g).sort((x, y) => x.sortOrder - y.sortOrder)
      }));
  }

  /** 组汇总：负债组取绝对值（截图「信用账户 欠款: ¥70.90」） */
  groupTotal(ledgerId: string, group: AccountGroup): Cents {
    const accounts = this.repo.accounts(ledgerId).filter(a => a.group === group && !a.hidden);
    return sumCents(accounts.map(a => (IS_LIABILITY[group] ? Math.abs(this.accountBalance(a)) : this.accountBalance(a))));
  }

  // ===== 周期汇总（7.3） =====

  periodSummary(
    ledgerId: string,
    range: DateRange,
    denominator: DayDenominator = 'elapsed',
    nowSec: number = toSec(new Date())
  ): PeriodSummary {
    const p: Param[] = [ledgerId, range.start, range.end];

    const expense = this.db.money(
      `SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
       WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense'
         AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;`, p);
    const income = this.db.money(
      `SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
       WHERE deleted_at IS NULL AND ledger_id=? AND kind='income'
         AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;`, p);
    const discount = this.db.money(
      `SELECT COALESCE(SUM(discount_cents),0) AS v FROM txn
       WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense' AND occurred_at>=? AND occurred_at<?;`, p);
    const refund = this.db.money(
      `SELECT COALESCE(SUM(refund_cents),0) AS v FROM txn
       WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense' AND occurred_at>=? AND occurred_at<?;`, p);
    const fee = this.db.money(
      `SELECT COALESCE(SUM(fee_cents),0) AS v FROM txn
       WHERE deleted_at IS NULL AND ledger_id=? AND kind IN ('expense','income') AND occurred_at>=? AND occurred_at<?;`, p);
    // 退款收入 ≠ 退款：只有"未关联原支出的独立退款入账"才算退款收入；
    // 关联原支出的退款属于回冲（已计入「退款」指标），故 05/30 那笔 2.00 不计入 → 截图显示 ¥0.00 ✔
    const refundIncome = this.db.money(
      `SELECT COALESCE(SUM(t.amount_cents),0) AS v FROM txn t
       JOIN category c ON c.id = t.category_id
       WHERE t.deleted_at IS NULL AND t.ledger_id=? AND t.kind='refund_credit'
         AND t.refund_of_id IS NULL
         AND c.direction='income' AND t.occurred_at>=? AND t.occurred_at<?;`, p);

    const pending = this.db.money(
      `SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
       WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense'
         AND reimbursement_status='pending' AND occurred_at>=? AND occurred_at<?;`, p);
    const done = this.db.money(
      `SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
       WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense'
         AND reimbursement_status='done' AND occurred_at>=? AND occurred_at<?;`, p);
    const received = this.db.money(
      `SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
       WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense'
         AND reimbursement_status='received' AND occurred_at>=? AND occurred_at<?;`, p);

    const flows = FLOW_ORDER.map(type => ({
      type,
      amount: this.db.money(
        `SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
         WHERE deleted_at IS NULL AND ledger_id=? AND flow_type=? AND occurred_at>=? AND occurred_at<?;`,
        [ledgerId, type, range.start, range.end])
    }));

    const days = this.denominatorDays(ledgerId, range, denominator, nowSec);
    const d = Math.max(days, 1);
    const balance = income - expense;

    return {
      range, expense, income, balance, refund, refundIncome, discount, fee,
      pendingReimbursement: pending, doneReimbursement: done,
      reimbursementReceived: received, flows,
      denominatorDays: days,
      dailyExpense: divCents(expense, d),
      dailyIncome: divCents(income, d),
      dailyBalance: divCents(balance, d),
      averageExpense: divCents(expense, d)
    };
  }

  /** 日均分母（默认 elapsed） */
  denominatorDays(ledgerId: string, range: DateRange, denominator: DayDenominator, nowSec: number): number {
    switch (denominator) {
      case 'natural':
        return Math.max(diffDays(range.start, range.end), 1);
      case 'elapsed': {
        // 区间结束为不包含的边界，已结束的周期不能额外算下一天。
        if (nowSec >= range.end) return Math.max(diffDays(range.start, range.end), 1);
        const end = Math.min(nowSec, range.end);
        if (end < range.start) return 1;
        return Math.max(diffDays(range.start, end) + 1, 1);
      }
      case 'spending': {
        const n = this.db.int(
          `SELECT COUNT(DISTINCT date(occurred_at,'unixepoch','localtime')) AS v FROM txn
           WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense'
             AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;`,
          [ledgerId, range.start, range.end]);
        return Math.max(n, 1);
      }
      case 'active': {
        // 有数据天数：区间内出现过收入或支出的天数（收支各自去重）
        const n = this.db.int(
          `SELECT COUNT(DISTINCT date(occurred_at,'unixepoch','localtime')) AS v FROM txn
           WHERE deleted_at IS NULL AND ledger_id=? AND kind IN ('expense','income')
             AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;`,
          [ledgerId, range.start, range.end]);
        return Math.max(n, 1);
      }
    }
  }

  /**
   * 通用「平均值」：周期总额 ÷ 指定口径天数。
   *
   * 这三个位置的分母并不一致：
   *  · 账本页月度图表「平均值」= 月度支出 ÷ 自然日
   *  · 统计页周图表「平均值」  = 周期额 ÷ 有数据天数
   *  · 统计页「日均支出」      = 周期支出 ÷ 已过天数
   * 因此不硬编码任一种，由调用方显式指定口径。
   */
  average(ledgerId: string, range: DateRange, direction: Direction, basis: DayDenominator,
          nowSec: number = toSec(new Date())): Cents {
    const kind = direction === 'expense' ? 'expense' : 'income';
    const total = this.db.money(
      `SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
       WHERE deleted_at IS NULL AND ledger_id=? AND kind=?
         AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;`,
      [ledgerId, kind, range.start, range.end]);
    const days = this.denominatorDays(ledgerId, range, basis, nowSec);
    return divCents(total, days);
  }

  // ===== 账单搜索 =====

  /**
   * 账单筛选（唯一实现）。
   * 关键词同时匹配 备注 / 地点 / 分类名（含父类）/ 账户名 / 金额文本。
   * 分类筛选会自动展开子分类（选「餐饮」即含「三餐/咖啡…」）。
   */
  filterTxns(ledgerId: string, f: TxnFilter): Txn[] {
    const cats = this.repo.categories(ledgerId);
    const accounts = this.repo.accounts(ledgerId);
    const catById = new Map(cats.map((c) => [c.id, c]));
    const accById = new Map(accounts.map((a) => [a.id, a]));

    const catSet = new Set<string>();
    const topIds = new Set(cats.filter(c => c.parentId === null).map(c => c.id));
    const classifiedIds = new Set(cats.filter(c => c.parentId === null || topIds.has(c.parentId)).map(c => c.id));
    if (f.categoryId) {
      catSet.add(f.categoryId);
      for (const c of cats) if (c.parentId === f.categoryId) catSet.add(c.id);
    }

    const kw = (f.keyword ?? '').trim().toLowerCase();
    let list = this.repo.txns(ledgerId, { from: f.from, to: f.to });

    list = list.filter((t) => {
      if (f.kinds && f.kinds.length > 0 && !f.kinds.includes(t.kind)) return false;
      if (f.accountId && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
      if (f.categoryId === 'uncategorized') {
        if (t.categoryId && classifiedIds.has(t.categoryId)) return false;
      } else if (catSet.size > 0 && !(t.categoryId && catSet.has(t.categoryId))) return false;
      if (f.reimbOnly && t.reimbursement !== f.reimbOnly) return false;
      if (f.hasRefund && t.refund <= 0) return false;
      if (f.hasDiscount && t.discount <= 0) return false;
      if (f.hasFee && t.fee <= 0) return false;
      if (f.excludeFromStats !== undefined && t.excludeFromStats !== f.excludeFromStats) return false;
      const abs = Math.abs(t.amount);
      if (f.minAmount != null && abs < f.minAmount) return false;
      if (f.maxAmount != null && abs > f.maxAmount) return false;
      if (f.flowTypes && f.flowTypes.length > 0 && !(t.flowType && f.flowTypes.includes(t.flowType))) return false;
      if (kw) {
        const c = t.categoryId ? catById.get(t.categoryId) : null;
        const parent = c?.parentId ? catById.get(c.parentId) : null;
        const acc = accById.get(t.accountId);
        const hay = [
          t.note, t.locationName ?? '', c?.name ?? '', parent?.name ?? '', acc?.name ?? '',
          (t.amount / 100).toFixed(2), String(t.amount / 100)
        ].join(' ').toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });

    switch (f.sort ?? 'timeDesc') {
      case 'timeAsc': list.sort((a, b) => a.occurredAt - b.occurredAt); break;
      case 'amountDesc': list.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)); break;
      case 'amountAsc': list.sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount)); break;
      default: list.sort((a, b) => b.occurredAt - a.occurredAt);
    }
    return list;
  }

  /**
   * 对任意流水集合做汇总（唯一实现）。
   * 与 SQL 版 periodSummary 共用同一套口径定义 —— 验收脚本会断言两者在整月/整周集合上完全相等（AC-22）。
   */
  summarize(txns: Txn[]): SearchSummary {
    let expense = 0, income = 0, refund = 0, refundIncome = 0, discount = 0, fee = 0;
    let pending = 0, done = 0, received = 0;
    for (const t of txns) {
      if (t.kind === 'expense') {
        if (!t.excludeFromStats) expense += t.amount;
        refund += t.refund;
        discount += t.discount;
        fee += t.fee;
        if (t.reimbursement === 'pending') pending += t.amount;
        else if (t.reimbursement === 'done') done += t.amount;
        else if (t.reimbursement === 'received') received += t.amount;
      } else if (t.kind === 'income') {
        if (!t.excludeFromStats) income += t.amount;
        fee += t.fee;
      } else if (t.kind === 'refund_credit' && t.refundOfId === null) {
        refundIncome += t.amount;
      }
    }
    return {
      expense, income, balance: income - expense, refund, refundIncome, discount, fee,
      pending, done, received, count: txns.length
    };
  }

  /** 按日分组（搜索结果用），组内含当日收支合计 */
  groupByDay(txns: Txn[]): Array<{ date: number; expense: Cents; income: Cents; txns: Txn[] }> {
    const map = new Map<number, { date: number; expense: Cents; income: Cents; txns: Txn[] }>();
    for (const t of txns) {
      const d = fromSec(t.occurredAt);
      const day = toSec(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0));
      let g = map.get(day);
      if (!g) { g = { date: day, expense: 0, income: 0, txns: [] }; map.set(day, g); }
      if (t.kind === 'expense' && !t.excludeFromStats) g.expense += t.amount;
      if (t.kind === 'income' && !t.excludeFromStats) g.income += t.amount;
      g.txns.push(t);
    }
    return Array.from(map.values()).sort((a, b) => b.date - a.date);
  }

  // ===== 净资产趋势 =====

  /**
   * 区间内逐日净资产：以"当前净资产"为基准向前回推，单次遍历全部流水。
   * 净值变动 = 收入 − 支出（流转在账户间转移，对净值中性；退款入账已含在实付口径内）。
   */
  netWorthSeries(ledgerId: string, range: DateRange): Array<{ date: number; value: Cents }> {
    const current = this.assetsSnapshot(ledgerId).netWorth;
    const txns = this.repo.txns(ledgerId, { from: range.start, to: range.end });
    const days = this.dailySeries(ledgerId, range);
    const deltaByDay = new Map<number, Cents>();
    for (const t of txns) {
      const d = startOfDaySec(t.occurredAt);
      let delta = 0;
      if (t.kind === 'expense' && !t.excludeFromStats) delta = -t.amount;
      else if (t.kind === 'income' && !t.excludeFromStats) delta = t.amount;
      if (delta !== 0) deltaByDay.set(d, (deltaByDay.get(d) ?? 0) + delta);
    }
    // 从最后一天（= 当前净资产）向前回推
    const out: Array<{ date: number; value: Cents }> = new Array(days.length);
    let acc = current;
    for (let i = days.length - 1; i >= 0; i--) {
      const d = days[i].date;
      out[i] = { date: d, value: acc };
      acc -= deltaByDay.get(d) ?? 0;
    }
    return out;
  }

  // ===== 分类占比（两级） =====

  categoryBreakdown(ledgerId: string, range: DateRange, direction: Direction): CategorySlice[] {
    const kind = direction === 'expense' ? 'expense' : 'income';
    const raw = this.db.rows(
      `SELECT COALESCE(c.id,'uncategorized') AS cid, SUM(t.amount_cents) AS amt, COUNT(*) AS cnt
       FROM txn t LEFT JOIN category c ON c.id = t.category_id
       WHERE t.deleted_at IS NULL AND t.ledger_id=? AND t.kind=?
         AND t.exclude_from_stats=0 AND t.occurred_at>=? AND t.occurred_at<?
       GROUP BY cid;`,
      [ledgerId, kind, range.start, range.end]
    );
    const own = new Map<string, { amount: Cents; count: number }>();
    for (const r of raw) own.set(rs(r, 'cid'), { amount: rn(r, 'amt'), count: rn(r, 'cnt') });

    const cats = this.repo.categories(ledgerId, direction);
    const topLevel = cats.filter(c => c.parentId === null);

    const topSlices: CategorySlice[] = [];
    for (const c of topLevel) {
      const children = cats.filter(x => x.parentId === c.id);
      let amount = own.get(c.id)?.amount ?? 0;
      let count = own.get(c.id)?.count ?? 0;
      for (const ch of children) {
        amount += own.get(ch.id)?.amount ?? 0;
        count += own.get(ch.id)?.count ?? 0;
      }
      if (amount === 0 && count === 0) continue;
      topSlices.push({
        categoryId: c.id, name: c.name, icon: c.icon, colorHex: c.colorHex,
        amount, count, parentId: null, percentOfTotal: 0, percentOfParent: null
      });
    }
    // 未分类及已删除分类的历史账单也需计入，保证分类合计与收支总额一致。
    const topIds = new Set(topLevel.map(c => c.id));
    const classifiedIds = new Set(cats.filter(c => c.parentId === null || topIds.has(c.parentId)).map(c => c.id));
    const missing = [...own].filter(([id]) => !classifiedIds.has(id));
    if (missing.length) topSlices.push({
      categoryId: 'uncategorized', name: '未分类', icon: '🏷', colorHex: '#9aa1ab',
      amount: sumCents(missing.map(([, v]) => v.amount)), count: missing.reduce((n, [, v]) => n + v.count, 0),
      parentId: null, percentOfTotal: 0, percentOfParent: null
    });
    topSlices.sort((a, b) => b.amount - a.amount);
    const total = sumCents(topSlices.map(s => s.amount));

    const childSlices: CategorySlice[] = [];
    for (const parent of topSlices) {
      const children = cats.filter(x => x.parentId === parent.categoryId);
      const subs: CategorySlice[] = [];
      for (const ch of children) {
        const o = own.get(ch.id);
        if (!o || o.count === 0) continue;
        subs.push({
          categoryId: ch.id, name: ch.name, icon: ch.icon, colorHex: ch.colorHex,
          amount: o.amount, count: o.count, parentId: parent.categoryId,
          percentOfTotal: total === 0 ? 0 : o.amount / total,
          percentOfParent: parent.amount === 0 ? 0 : o.amount / parent.amount
        });
      }
      subs.sort((a, b) => b.amount - a.amount);
      childSlices.push(...subs);
    }

    return [
      ...topSlices.map(s => ({ ...s, percentOfTotal: total === 0 ? 0 : s.amount / total })),
      ...childSlices
    ];
  }

  // ===== 日历 =====

  /** 图表数据在此统一计算：金额单位为分，分箱区间左闭右开。 */
  expenseChartData(ledgerId: string, range: DateRange, previousRange: DateRange): ExpenseChartData {
    const slices = this.categoryBreakdown(ledgerId, range, 'expense').filter(c => c.parentId === null);
    const categories = slices.map(c => ({ id: c.categoryId, name: c.name, color: c.colorHex, amount: c.amount, count: c.count }));
    const cats = this.repo.categories(ledgerId, 'expense');
    const parentIds = new Set(cats.filter(c => c.parentId === null).map(c => c.id));
    const parentOf = (id: string | null) => {
      const cat = cats.find(c => c.id === id);
      return cat && (cat.parentId === null || parentIds.has(cat.parentId)) ? cat.parentId ?? cat.id : 'uncategorized';
    };
    const txns = this.filterTxns(ledgerId, { from: range.start, to: range.end, kinds: ['expense'], excludeFromStats: false });
    const days = this.dailySeries(ledgerId, range).map(d => ({ date: d.date, total: d.expense, values: categories.map(() => 0) }));
    const byDay = new Map(days.map(d => [d.date, d]));
    const byCategory = new Map(categories.map((c, i) => [c.id, i]));
    for (const t of txns) {
      const day = byDay.get(startOfDaySec(t.occurredAt));
      const i = byCategory.get(parentOf(t.categoryId));
      if (day && i !== undefined) day.values[i] += t.amount;
    }
    const edges = [0, 1000, 2000, 5000, 10000, 50000];
    const labels = ['0–10', '10–20', '20–50', '50–100', '100–500', '500及以上'];
    const bins = edges.map((min, i) => ({ label: labels[i], min, max: edges[i + 1] ?? null,
      count: txns.filter(t => t.amount >= min && (edges[i + 1] === undefined || t.amount < edges[i + 1])).length }));
    const quantile = (sorted: Cents[], p: number) => {
      const i = (sorted.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i);
      return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo));
    };
    const groups = categories.map(c => {
      const points = txns.filter(t => parentOf(t.categoryId) === c.id).map(t => ({ id: t.id, amount: t.amount, note: t.note }));
      const sorted = points.map(t => t.amount).sort((a, b) => a - b);
      return { id: c.id, name: c.name, color: c.color, min: sorted[0] ?? 0, q1: quantile(sorted, .25) || 0,
        median: quantile(sorted, .5) || 0, q3: quantile(sorted, .75) || 0, max: sorted[sorted.length - 1] ?? 0, points };
    });
    const previous = this.categoryBreakdown(ledgerId, previousRange, 'expense').filter(c => c.parentId === null);
    const names = new Map([...previous, ...slices].map(c => [c.categoryId, c.name]));
    const comparison = [...names].map(([id, name]) => ({ id, name,
      current: slices.find(c => c.categoryId === id)?.amount ?? 0,
      previous: previous.find(c => c.categoryId === id)?.amount ?? 0
    })).sort((a, b) => Math.max(b.current, b.previous) - Math.max(a.current, a.previous));
    return { days, categories, comparison, bins, groups, previousCount: previous.reduce((n, c) => n + c.count, 0) };
  }

  dayStat(ledgerId: string, daySec: number): DayStat {
    const start = startOfDaySec(daySec);
    const end = addDaysSec(start, 1);
    const p: Param[] = [ledgerId, start, end];
    const expense = this.db.money(
      `SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn WHERE deleted_at IS NULL AND ledger_id=?
         AND kind='expense' AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;`, p);
    const income = this.db.money(
      `SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn WHERE deleted_at IS NULL AND ledger_id=?
         AND kind='income' AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;`, p);
    const txnCount = this.db.int(
      `SELECT COUNT(*) AS v FROM txn WHERE deleted_at IS NULL AND ledger_id=?
         AND kind IN ('expense','income') AND occurred_at>=? AND occurred_at<?;`, p);
    return { date: start, expense, income, balance: income - expense, txnCount };
  }

  /** 整月日历：一次性聚合，禁止逐日 N+1 */
  monthCalendar(ledgerId: string, monthSec: number): DayStat[] {
    const d0 = fromSec(monthSec);
    const start = toSec(new Date(d0.getFullYear(), d0.getMonth(), 1, 0, 0, 0, 0));
    const next = toSec(new Date(d0.getFullYear(), d0.getMonth() + 1, 1, 0, 0, 0, 0));
    const rows = this.db.rows(
      `SELECT date(occurred_at,'unixepoch','localtime') AS d,
              SUM(CASE WHEN kind='expense' AND exclude_from_stats=0 THEN amount_cents ELSE 0 END) AS exp,
              SUM(CASE WHEN kind='income' AND exclude_from_stats=0 THEN amount_cents ELSE 0 END) AS inc,
              COUNT(*) AS cnt
       FROM txn WHERE deleted_at IS NULL AND ledger_id=? AND kind IN ('expense','income')
         AND occurred_at>=? AND occurred_at<?
       GROUP BY d;`,
      [ledgerId, start, next]
    );
    const map = new Map<string, Row>();
    for (const r of rows) map.set(rs(r, 'd'), r);

    const out: DayStat[] = [];
    for (let s = start; s < next; s = addDaysSec(s, 1)) {
      const key = ymd(s);
      const r = map.get(key);
      out.push({
        date: s,
        expense: r ? rn(r, 'exp') : 0,
        income: r ? rn(r, 'inc') : 0,
        balance: r ? rn(r, 'inc') - rn(r, 'exp') : 0,
        txnCount: r ? rn(r, 'cnt') : 0
      });
    }
    return out;
  }

  dailySeries(ledgerId: string, range: DateRange): DayStat[] {
    const out: DayStat[] = [];
    for (let s = startOfDaySec(range.start); s < range.end; s = addDaysSec(s, 1)) {
      out.push(this.dayStat(ledgerId, s));
    }
    return out;
  }

  // ===== 信用卡（7.5） =====

  creditCardSnapshot(accountId: string): CreditCardSnapshot {
    const account = this.repo.accounts().find(a => a.id === accountId);
    if (!account) {
      return {
        accountId, currentDebt: 0, creditLimit: 0, availableCredit: 0,
        cycleOutflow: 0, cycleInflow: 0, cycle: null, runningDebt: []
      };
    }
    const cycles = this.repo.billCycles(accountId);
    const cycle = cycles.find(c => c.status === 'open') ?? cycles[0] ?? null;

    if (!cycle) {
      return {
        accountId, currentDebt: 0, creditLimit: account.creditLimit,
        availableCredit: account.creditLimit, cycleOutflow: 0, cycleInflow: 0,
        cycle: null, runningDebt: []
      };
    }

    const p: Param[] = [accountId, cycle.periodStart, cycle.periodEnd];
    // 流出按【原价】计算（退款为独立一笔回流，不在此扣减）
    const outflow = this.db.money(
      `SELECT COALESCE(SUM(original_cents),0) AS v FROM txn
       WHERE deleted_at IS NULL AND account_id=? AND kind='expense' AND occurred_at>=? AND occurred_at<?;`, p);
    const refundIn = this.db.money(
      `SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
       WHERE deleted_at IS NULL AND account_id=? AND kind='refund_credit' AND occurred_at>=? AND occurred_at<?;`, p);
    const repayIn = this.db.money(
      `SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
       WHERE deleted_at IS NULL AND to_account_id=? AND kind IN ('repay','transfer','recharge')
         AND occurred_at>=? AND occurred_at<?;`, p);
    const debt = outflow - refundIn;

    // 逐笔欠款：支出按原价累计、退款入账冲减、还款不计入（60.00 → 63.00 → 61.00 → 70.90 ✔）
    const items = this.db.rows(
      `SELECT id, kind, original_cents, amount_cents FROM txn
       WHERE deleted_at IS NULL AND account_id=? AND occurred_at>=? AND occurred_at<?
       ORDER BY occurred_at;`, p);
    let run = 0;
    const runningDebt: RunningDebt[] = [];
    for (const it of items) {
      const kind = rs(it, 'kind');
      if (kind === 'expense') run += rn(it, 'original_cents');
      else if (kind === 'refund_credit') run -= rn(it, 'amount_cents');
      runningDebt.push({ txnId: rs(it, 'id'), debtAfter: run });
    }

    return {
      accountId, currentDebt: debt, creditLimit: account.creditLimit,
      availableCredit: account.creditLimit - debt,
      cycleOutflow: outflow, cycleInflow: refundIn + repayIn,
      cycle, runningDebt
    };
  }

  // ===== 存钱计划（7.6） =====

  allSavePlans(): SavePlan[] {
    return this.repo.savePlans();
  }

  savePlanProgress(planId: string): SavePlanProgress | null {
    const plan = this.allSavePlans().find(p => p.id === planId);
    if (!plan) return null;
    const cards = this.repo.saveCards(planId);
    const records = this.repo.saveRecords(planId);
    const saved = sumCents([
      ...cards.filter(c => c.status === 'saved').map(c => c.amount),
      ...records.map(r => r.amount)
    ]);
    return {
      plan, saved, remaining: plan.target - saved,
      progress: plan.target === 0 ? 0 : saved / plan.target,
      cards, cardSaved: cards.filter(c => c.status === 'saved').length, cardTotal: cards.length
    };
  }

  // ===== 预算 =====

  budgetSnapshot(ledgerId: string, refSec: number, nowSec: number): BudgetSnapshot {
    const budget = this.repo.totalBudget(ledgerId);
    const base = budget?.amount ?? 0;
    // 关键修复：按 period 选择统计区间——此前无论选周/月都只用月区间，周预算等于失效
    const period = budget?.period ?? 'monthly';
    const range = period === 'weekly' ? this.weekRange(refSec) : this.monthRange(refSec);
    const used = this.db.money(
      `SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
       WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense'
         AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;`,
      [ledgerId, range.start, range.end]);
    let carried = 0;
    if (budget?.carryOver && base > 0) {
      const first = period === 'weekly' ? this.weekRange(budget.startDate) : this.monthRange(budget.startDate);
      if (first.start < range.start) {
        const a = fromSec(first.start), b = fromSec(range.start);
        const periods = period === 'monthly'
          ? (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth()
          : Math.round(diffDays(first.start, range.start) / 7);
        const previousUsed = this.db.money(`SELECT COALESCE(SUM(amount_cents),0) FROM txn WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense' AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;`, [ledgerId, first.start, range.start]);
        carried = periods * base - previousUsed;
      }
    }
    const total = base + carried;
    const remaining = total - used;
    // 剩余日均 = 剩余预算 ÷ 剩余天数（不含今天）
    const tomorrow = addDaysSec(startOfDaySec(nowSec), 1);
    const daysLeft = Math.max(diffDays(tomorrow, startOfDaySec(range.end)), 1);
    return {
      total, base, carried, used, remaining, daysLeft,
      remainingDaily: divCents(remaining, daysLeft),
      carryOver: budget?.carryOver ?? false
    };
  }

  // ===== 日期区间 =====

  monthRange(dateSec: number): DateRange {
    const d = fromSec(dateSec);
    const start = toSec(new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0));
    const end = toSec(new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0));
    return { start, end };
  }

  /** 周一至周日（统计页「按周统计」、预算按周均以此为准） */
  weekRange(dateSec: number): DateRange {
    const d = new Date(startOfDaySec(dateSec) * 1000);
    const dow = d.getDay(); // 0 = 周日
    const start = addDaysSec(toSec(d), -((dow + 6) % 7)); // 周一为一周起点
    return { start, end: addDaysSec(start, 7) };
  }

  dayRange(dateSec: number): DateRange {
    const start = startOfDaySec(dateSec);
    return { start, end: addDaysSec(start, 1) };
  }
}

export { rnOpt, rb };
