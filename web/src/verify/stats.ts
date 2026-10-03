/** 统计图表的边界校验；只使用内存样例账本。运行：npx tsx src/verify/stats.ts */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Db, loadSqlJs } from '../core/db';
import { Repo } from '../core/repo';
import { MetricsEngine, dateOf } from '../core/metrics';
import { buildFreshLedger, LEDGER_ID } from '../core/seed';

const require = createRequire(import.meta.url);
const SQL = await loadSqlJs(f => path.join(path.dirname(require.resolve('sql.js')), f));
const repo = new Repo(Db.create(SQL));
buildFreshLedger(repo);
const engine = new MetricsEngine(repo);
const month = engine.monthRange(dateOf(2026, 9, 25));
const prior = engine.monthRange(dateOf(2026, 8, 25));
const mealId = repo.categories(LEDGER_ID).find(c => c.name === '三餐')!.id;
const mealParent = repo.categories(LEDGER_ID).find(c => c.name === '餐饮')!.id;
const busId = repo.categories(LEDGER_ID).find(c => c.name === '地铁')!.id;
const socialId = repo.categories(LEDGER_ID).find(c => c.name === '社交')!.id;
const fixture = (id: string, amount: number, categoryId: string | null = mealId, exclude = false, kind: 'expense' | 'income' = 'expense', occurredAt = dateOf(2026, 9, 25)) => repo.insertTxn({
  id, ledgerId: LEDGER_ID, accountId: 'A_WECHAT', toAccountId: null, categoryId, kind, flowType: null,
  original: amount, discount: 0, fee: 0, refund: 0, amount, occurredAt, note: id, locationName: null,
  reimbursement: 'none', excludeFromStats: exclude, billCycleId: null, refundOfId: null
});
for (const [i, amount] of [0, 999, 1000, 1999, 2000, 4999, 5000, 9999, 10000, 49999, 50000].entries()) fixture(`b${i}`, amount);
fixture('missing', 1234, null);
fixture('deleted-category', 2345, busId);
repo.db.run('UPDATE category SET deleted_at=? WHERE id=?', [dateOf(2026, 9, 26), busId]);
fixture('excluded', 999999, mealId, true);
fixture('income', 888888, null, false, 'income');
fixture('last-period-only', 12000, socialId, false, 'expense', dateOf(2026, 8, 15));
const data = engine.expenseChartData(LEDGER_ID, month, prior);
const total = engine.periodSummary(LEDGER_ID, month, 'elapsed', dateOf(2026, 10, 1)).expense;
assert.equal(data.categories.reduce((n, c) => n + c.amount, 0), total);
assert.equal(data.days.reduce((n, d) => n + d.values.reduce((a, b) => a + b, 0), 0), total);
for (const d of data.days) assert.equal(d.values.reduce((a, b) => a + b, 0), d.total);
assert.equal(data.bins.reduce((n, b) => n + b.count, 0), 13);
assert.equal(data.bins[0].count, 2);
assert.equal(data.bins[1].count, 3); // 10、19.99、未分类12.34
assert.equal(data.bins[2].count, 3); // 20、49.99、已删除分类23.45
assert.equal(data.bins.at(-1)?.count, 1);
for (const b of data.bins) assert.equal(engine.filterTxns(LEDGER_ID, {
  from: month.start, to: month.end, kinds: ['expense'], excludeFromStats: false,
  minAmount: b.min, maxAmount: b.max === null ? null : b.max - 1
}).length, b.count);
const missing = data.categories.find(c => c.id === 'uncategorized')!;
assert.equal(missing.amount, 3579);
assert.equal(engine.filterTxns(LEDGER_ID, { kinds: ['expense'], categoryId: 'uncategorized', excludeFromStats: false }).length, 2);
const meal = data.groups.find(c => c.id === mealParent)!;
assert.equal(meal.min, 0); assert.equal(meal.max, 50000);
assert.equal(meal.median, 4999);
assert.equal(meal.q1, 1500); assert.equal(meal.q3, 10000); // 插值到分，四舍五入
assert.equal(data.comparison.find(c => c.id === socialId)?.previous, 12000);
assert.equal(data.comparison.find(c => c.id === socialId)?.current, 0);
assert.equal(engine.denominatorDays(LEDGER_ID, month, 'elapsed', dateOf(2026, 10, 1)), 30);
assert.equal(engine.denominatorDays(LEDGER_ID, engine.weekRange(dateOf(2026, 9, 25)), 'elapsed', dateOf(2026, 10, 1)), 7);
const emptyRange = engine.monthRange(dateOf(2027, 1, 1));
const empty = engine.expenseChartData(LEDGER_ID, emptyRange, emptyRange);
assert.equal(empty.groups.length, 0); assert.equal(empty.categories.length, 0); assert.equal(empty.bins.every(b => b.count === 0), true);
console.log('图表金额、逐日分类矩阵、分箱边界、未分类、排除统计、分位数、上期独有分类、历史日均和空数据通过。');
