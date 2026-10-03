/**
 * 内核验收（Node 环境运行）：以 6 张截图的数值为基准逐项校验聚合层
 * 运行：npm run verify
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { Db, loadSqlJs } from '../core/db';
import { Repo } from '../core/repo';
import { MetricsEngine, fromSec, dateOf } from '../core/metrics';
import { planCardAmounts, planCardDueDates } from '../core/plan';
import { buildFreshLedger, buildSampleData, ACC, CAT, LEDGER_ID, NOW } from '../core/seed';
import { pct, sumCents, yuan, type Cents } from '../core/money';

let pass = 0;
let fail = 0;

function check(label: string, actual: Cents, expectedYuan: number) {
  const expected = Math.round(expectedYuan * 100);
  if (actual === expected) {
    pass++;
    console.log(`  ✅ ${label}：¥${(actual / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}：实际 ${actual / 100} ≠ 期望 ${expectedYuan}`);
  }
}
function checkInt(label: string, actual: number, expected: number) {
  if (actual === expected) { pass++; console.log(`  ✅ ${label}：${actual}`); }
  else { fail++; console.log(`  ❌ ${label}：实际 ${actual} ≠ 期望 ${expected}`); }
}
function checkPct(label: string, ratio: number, expectedPercent: number, tol = 0.005) {
  if (Math.abs(ratio * 100 - expectedPercent) <= tol) { pass++; console.log(`  ✅ ${label}：${pct(ratio)}`); }
  else { fail++; console.log(`  ❌ ${label}：实际 ${pct(ratio)} ≠ 期望 ${expectedPercent.toFixed(2)}%`); }
}
function checkStr(label: string, actual: string, expected: string) {
  if (actual === expected) { pass++; console.log(`  ✅ ${label}：${actual}`); }
  else { fail++; console.log(`  ❌ ${label}：实际 ${actual} ≠ 期望 ${expected}`); }
}
const section = (t: string) => console.log(`\n【${t}】`);

async function main() {
  console.log('══════════════════════════════════════════════════');
  console.log(' 记账 · 内核验收（Web 版，基准时点 2024-05-30）');
  console.log('══════════════════════════════════════════════════');

  // Node 环境加载 wasm：指向 node_modules/sql.js/dist
  const require = createRequire(import.meta.url);
  const sqlJsDir = path.dirname(require.resolve('sql.js'));
  const SQL = await loadSqlJs((f) => path.join(sqlJsDir, f));

  const db = Db.create(SQL);
  const repo = new Repo(db);
  const engine = buildSampleData(repo);
  const now = NOW;

  // —— AC-01
  section('AC-01 账本页 · 总支出 / 总收入 / 结余');
  const month = engine.monthRange(now);
  const ms = engine.periodSummary(LEDGER_ID, month, 'elapsed', now);
  check('总支出', ms.expense, 2915.9);
  check('总收入', ms.income, 9985.06);
  check('结余', ms.balance, 7069.16);

  // —— AC-02
  section('AC-02 账本页 · 预算卡');
  const budget = engine.budgetSnapshot(LEDGER_ID, now, now);
  check('总预算', budget.total, 3000);
  check('剩余预算', budget.remaining, 84.1);
  check('剩余日均（剩余天数不含今天：仅 5/31）', budget.remainingDaily, 84.1);

  // —— AC-34 预算周期（月/周）真正影响统计区间（修复：此前 snapshot 永远按月，周预算失效）
  section('AC-34 预算周期（月/周）真正影响统计区间');
  {
    const ref = dateOf(2026, 9, 15); // 取一个落在月中的周二，便于区分月/周区间
    repo.updateBudget(LEDGER_ID, yuan(3000), true, 'monthly');
    const m = engine.budgetSnapshot(LEDGER_ID, ref, ref);
    repo.updateBudget(LEDGER_ID, yuan(3000), true, 'weekly');
    const w = engine.budgetSnapshot(LEDGER_ID, ref, ref);
    const ok = w.daysLeft < m.daysLeft && m.daysLeft > 7 && w.daysLeft <= 7;
    if (ok) { pass++; console.log(`  ✅ 周期真正生效：按周 ${w.daysLeft} 天 < 按月 ${m.daysLeft} 天`); }
    else { fail++; console.log(`  ❌ 周期未生效：按周 ${w.daysLeft} 天 / 按月 ${m.daysLeft} 天`); }
    repo.updateBudget(LEDGER_ID, yuan(3000), true, 'monthly'); // 还原演示数据
  }

  // —— AC-03 / AC-04
  section('AC-03 / AC-04 资产页 · 净资产与分组');
  const assets = engine.assetsSnapshot(LEDGER_ID);
  check('总资产', assets.totalAssets, 46997.06);
  check('总负债', assets.totalLiabilities, 70.9);
  check('净资产', assets.netWorth, 46926.16);
  check('资金账户余额合计', assets.byGroup.fund ?? 0, 45817.06);
  checkInt('资金账户数量', assets.accountCount.fund ?? 0, 4);
  check('信用账户欠款', assets.byGroup.credit ?? 0, 70.9);
  checkInt('信用账户数量', assets.accountCount.credit ?? 0, 1);
  check('充值账户余额合计', assets.byGroup.prepaid ?? 0, 180);
  checkInt('充值账户数量', assets.accountCount.prepaid ?? 0, 2);
  check('应收账户余额（截图未拍到，由总资产差额反推）', assets.byGroup.receivable ?? 0, 1000);

  // —— AC-05 / AC-06
  section('AC-05 / AC-06 信用卡详情与账单周期');
  const card = engine.creditCardSnapshot(ACC.citic);
  check('当前欠款', card.currentDebt, 70.9);
  check('可用额度', card.availableCredit, 19929.1);
  check('账单周期流出（按原价）', card.cycleOutflow, 72.9);
  check('账单周期流入（退款入账 2.00 + 还款 60.00）', card.cycleInflow, 62);
  checkStr('账单状态', card.cycle?.status === 'open' ? '未出账' : String(card.cycle?.status), '未出账');
  const seq = card.runningDebt.map((r) => r.debtAfter);
  console.log(`    逐笔欠款序列：${seq.map((c) => '¥' + (c / 100).toFixed(2)).join(' → ')}`);
  if (seq.length === 4 && seq[0] === 6000 && seq[1] === 6300 && seq[2] === 6100 && seq[3] === 7090) {
    pass++; console.log('  ✅ 逐笔欠款 60.00 → 63.00 → 61.00 → 70.90');
  } else { fail++; console.log('  ❌ 逐笔欠款序列不符'); }

  // —— AC-07
  section('AC-07 统计页 · 按周统计（2024-05-27 ~ 06-02，周一为起点）');
  const week = engine.weekRange(now);
  const ws = engine.periodSummary(LEDGER_ID, week, 'elapsed', now);
  check('周期支出', ws.expense, 335.9);
  check('周期收入', ws.income, 2167);
  check('周期结余', ws.balance, 1831.1);
  checkInt('日均分母天数（已过天数口径）', ws.denominatorDays, 4);
  check('日均支出', ws.dailyExpense, 83.97);
  check('日均收入', ws.dailyIncome, 541.75);
  check('日均结余', ws.dailyBalance, 457.77);
  check('退款', ws.refund, 2);
  check('优惠', ws.discount, 1);
  check('手续费', ws.fee, 0);
  check('退款收入（关联原支出的退款不计入）', ws.refundIncome, 0);
  const flowMap = new Map(ws.flows.map((f) => [f.type, f.amount]));
  check('流转·转账', flowMap.get('transfer') ?? 0, 0);
  check('流转·借出', flowMap.get('borrowOut') ?? 0, 1000);

  // —— AC-08
  section('AC-08 统计页 · 收入分类详情（周期内）');
  const inc = engine.categoryBreakdown(LEDGER_ID, week, 'income');
  const incTop = inc.filter((s) => s.parentId === null);
  check('总收入', sumCents(incTop.map((s) => s.amount)), 2167);
  for (const s of incTop) console.log(`    ${s.name}：¥${(s.amount / 100).toFixed(2)}　${pct(s.percentOfTotal)}　${s.count} 笔`);
  const byName = (n: string) => incTop.find((s) => s.name === n);
  checkPct('副业占比', byName('副业')?.percentOfTotal ?? 0, 36.92);
  checkPct('公积金占比', byName('公积金')?.percentOfTotal ?? 0, 33.23);
  checkPct('奖金占比', byName('奖金')?.percentOfTotal ?? 0, 23.07);
  checkPct('红包占比', byName('红包')?.percentOfTotal ?? 0, 6.23);

  // —— AC-09
  section('AC-09 周账单汇总表（日期 / 支出 / 收入 / 结余）');
  const series = engine.dailySeries(LEDGER_ID, week);
  checkInt('汇总表行数（周一~周日）', series.length, 7);
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  for (const d of series) {
    const dt = fromSec(d.date);
    console.log(`    ${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')} ${wd[dt.getDay()]}　支出 ¥${(d.expense / 100).toFixed(2)}　收入 ¥${(d.income / 100).toFixed(2)}　结余 ¥${(d.balance / 100).toFixed(2)}`);
  }
  const thu = series.find((d) => fromSec(d.date).getDay() === 4);
  check('周四支出（05/30）', thu?.expense ?? 0, 54.9);
  check('周四收入（05/30）', thu?.income ?? 0, 200);
  check('周四结余', thu?.balance ?? 0, 145.1);
  check('逐日支出合计', sumCents(series.map((d) => d.expense)), 335.9);
  check('逐日收入合计', sumCents(series.map((d) => d.income)), 2167);

  // —— AC-11
  section('AC-11 账本页 · 05/30 当日明细');
  const day = engine.dayStat(LEDGER_ID, now);
  check('当日支出', day.expense, 54.9);
  check('当日收入', day.income, 200);
  const dr = engine.dayRange(now);
  const dayTxns = repo.txns(LEDGER_ID, { from: dr.start, to: dr.end }).sort((a, b) => b.occurredAt - a.occurredAt);
  for (const t of dayTxns.filter((t) => t.kind === 'expense')) {
    const d = fromSec(t.occurredAt);
    console.log(`    ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}　原价 ¥${(t.original / 100).toFixed(2)}　优惠 ¥${(t.discount / 100).toFixed(2)}　退款 ¥${(t.refund / 100).toFixed(2)}　实付 ¥${(t.amount / 100).toFixed(2)}`);
  }
  check('当日 3 笔实付合计', sumCents(dayTxns.filter((t) => t.kind === 'expense').map((t) => t.amount)), 54.9);

  // —— AC-12
  section('AC-12 账本页 · 分类占比（月度）');
  const slices = engine.categoryBreakdown(LEDGER_ID, month, 'expense');
  const top = slices.filter((s) => s.parentId === null);
  for (const s of top) console.log(`    ${s.name}：¥${(s.amount / 100).toFixed(2)}　占全部 ${pct(s.percentOfTotal)}　${s.count} 笔`);
  const meal = top.find((s) => s.name === '餐饮');
  check('餐饮金额', meal?.amount ?? 0, 728.9);
  checkInt('餐饮笔数', meal?.count ?? 0, 21);
  if (meal) checkPct('餐饮占全部', meal.percentOfTotal, 25);
  const m3 = slices.find((s) => s.name === '三餐');
  check('三餐金额', m3?.amount ?? 0, 441);
  checkInt('三餐笔数', m3?.count ?? 0, 8);
  if (m3?.percentOfParent != null) checkPct('三餐占父类（餐饮）', m3.percentOfParent, 60.5);
  check('分类金额合计', sumCents(top.map((s) => s.amount)), 2915.9);

  // —— AC-10
  section('AC-10 存钱页 · 计划进度');
  for (const p of engine.allSavePlans().sort((a, b) => a.name.localeCompare(b.name))) {
    const prog = engine.savePlanProgress(p.id)!;
    console.log(`    ${p.name}${p.emoji} [${p.type === 'fixed' ? '定额存钱' : '灵活存钱'}] 目标 ¥${(p.target / 100).toFixed(2)}　已存 ¥${(prog.saved / 100).toFixed(2)}　剩余未存 ¥${(prog.remaining / 100).toFixed(2)}　${pct(prog.progress)}`);
    if (p.id === 'P1') {
      check('提前还房贷 已存', prog.saved, 100000);
      check('提前还房贷 剩余未存', prog.remaining, 400000);
      checkPct('提前还房贷 进度', prog.progress, 20);
    }
    if (p.id === 'P2') {
      check('深造基金 已存', prog.saved, 15000);
      check('深造基金 剩余未存', prog.remaining, 9000);
      checkPct('深造基金 进度', prog.progress, 62.5);
      checkInt('存钱卡片总数（24 期）', prog.cardTotal, 24);
      checkInt('已存卡片数', prog.cardSaved, 15);
    }
  }

  // —— 三处「平均值」的三种分母（需求 7.3）
  section('AC-21 平均值口径（参考 App 三处分母各不相同）');
  check('账本页月图平均值（÷ 自然日 31）', engine.average(LEDGER_ID, month, 'expense', 'natural', now), 94.06);
  check('统计页周图平均值（÷ 有数据天数 5）', engine.average(LEDGER_ID, week, 'income', 'active', now), 433.4);
  check('统计页日均支出（÷ 已过天数 4）', ws.dailyExpense, 83.97);
  checkInt('自然日分母', engine.denominatorDays(LEDGER_ID, month, 'natural', now), 31);
  checkInt('有数据天数分母（周）', engine.denominatorDays(LEDGER_ID, week, 'active', now), 5);
  checkInt('已过天数分母（周）', engine.denominatorDays(LEDGER_ID, week, 'elapsed', now), 4);

  // —— 补充
  section('补充校验 · 口径一致性（对应 AC-13 / AC-19）');
  checkInt('中信卡流水笔数（含退款入账与还款）', repo.txns(LEDGER_ID, { accountId: ACC.citic }).length, 5);
  check('账本页月度支出与分类合计差额', sumCents(top.map((s) => s.amount)) - ms.expense, 0);
  const cal = engine.monthCalendar(LEDGER_ID, now);
  checkInt('5 月日历天数', cal.length, 31);
  check('日历逐日支出合计 = 月度总支出', sumCents(cal.map((d) => d.expense)), 2915.9);
  check('日历逐日收入合计 = 月度总收入', sumCents(cal.map((d) => d.income)), 9985.06);
  const d30 = cal.find((d) => fromSec(d.date).getDate() === 30);
  check('日历 5/30 支出', d30?.expense ?? 0, 54.9);

  // —— AC-22 搜索面板：两套聚合实现必须完全一致
  section('AC-22 搜索口径一致性（in-memory summarize ≡ SQL periodSummary）');
  const monthAll = engine.filterTxns(LEDGER_ID, { from: month.start, to: month.end });
  const monthSum = engine.summarize(monthAll);
  check('整月支出（搜索汇总 vs SQL）', monthSum.expense - ms.expense, 0);
  check('整月收入（搜索汇总 vs SQL）', monthSum.income - ms.income, 0);
  check('整月退款', monthSum.refund, 2);
  check('整月优惠', monthSum.discount, 1);
  check('整月手续费', monthSum.fee, 0);
  const weekAll = engine.filterTxns(LEDGER_ID, { from: week.start, to: week.end });
  const weekSum = engine.summarize(weekAll);
  check('整周支出（搜索汇总 vs SQL）', weekSum.expense - ws.expense, 0);
  check('整周收入（搜索汇总 vs SQL）', weekSum.income - ws.income, 0);

  section('AC-23 搜索筛选能力');
  checkInt('关键词「地铁」命中（支出 + 退款入账各一笔）', engine.filterTxns(LEDGER_ID, { keyword: '地铁' }).length, 2);
  checkInt('分类筛「餐饮」自动含子类', engine.filterTxns(LEDGER_ID, {
    from: month.start, to: month.end, categoryId: CAT.meal
  }).length, 21);
  // 手算核对：住房 517.94 / 美妆 307.91 / 其他 313.28 + 工资 5000 / 奖金 1000+500 /
  // 公积金 960+720 / 副业 400+300+300 / 借出 1000 = 12 笔
  checkInt('金额 ≥ ¥300 命中笔数', engine.filterTxns(LEDGER_ID, { minAmount: yuan(300) }).length, 12);
  checkInt('只看流转', engine.filterTxns(LEDGER_ID, { flowTypes: ['repay', 'collect', 'transfer', 'recharge', 'borrowIn', 'borrowOut'] }).length, 2);
  checkInt('含退款', engine.filterTxns(LEDGER_ID, { hasRefund: true }).length, 1);
  checkInt('含优惠', engine.filterTxns(LEDGER_ID, { hasDiscount: true }).length, 1);
  checkInt('待报销', engine.filterTxns(LEDGER_ID, { reimbOnly: 'pending' }).length, 3);
  // 手算核对：餐饮 21（三餐8/水果4/咖啡4/蔬菜3/甜品2）+ 其他一级 13 = 34 笔
  checkInt('只看支出', engine.filterTxns(LEDGER_ID, { kinds: ['expense'] }).length, 34);
  const byAmountDesc = engine.filterTxns(LEDGER_ID, { sort: 'amountDesc' });
  check('金额降序首条 = 最大一笔', byAmountDesc[0]?.amount ?? 0, 5000);
  const byAmountAsc = engine.filterTxns(LEDGER_ID, { sort: 'amountAsc' });
  check('金额升序首条 = 最小一笔', byAmountAsc[0]?.amount ?? 0, 1);
  const groups = engine.groupByDay(weekAll);
  checkInt('搜索结果按日分组数（周内 5 天有数据）', groups.length, 5);
  check('05/30 分组当日支出', groups.find((g) => new Date(g.date * 1000).getDate() === 30)?.expense ?? 0, 54.90);

  // —— AC-24 写入链路：记账面板落库后聚合实时联动
  section('AC-24 写入链路（记一笔 → 聚合联动 → 软删除回滚）');
  const nwBefore = engine.assetsSnapshot(LEDGER_ID).netWorth;
  const expBefore = engine.periodSummary(LEDGER_ID, month, 'elapsed', now).expense;
  const newId = repo.nextId('T');
  repo.insertTxn({
    id: newId, ledgerId: LEDGER_ID, accountId: ACC.alipay, toAccountId: null,
    categoryId: CAT.meal3, kind: 'expense', flowType: null,
    original: yuan(100), discount: 0, fee: 0, refund: 0, amount: yuan(100),
    occurredAt: now, note: '验收写入', locationName: null, reimbursement: 'none',
    excludeFromStats: false, billCycleId: null, refundOfId: null
  });
  check('写入后净资产减少 ¥100', nwBefore - engine.assetsSnapshot(LEDGER_ID).netWorth, 100);
  check('写入后月度支出增加 ¥100', engine.periodSummary(LEDGER_ID, month, 'elapsed', now).expense - expBefore, 100);
  checkInt('写入后支出笔数 34 → 35', engine.filterTxns(LEDGER_ID, { kinds: ['expense'] }).length, 35);
  repo.softDeleteTxn(newId);
  check('软删除后净资产回到原值', engine.assetsSnapshot(LEDGER_ID).netWorth - nwBefore, 0);
  check('软删除后月度支出回到原值', engine.periodSummary(LEDGER_ID, month, 'elapsed', now).expense - expBefore, 0);

  // —— AC-25 存钱模块写入链路
  section('AC-25 存钱写入（卡片勾选 / 灵活存入 → 进度实时联动）');
  const p2 = engine.savePlanProgress('P2')!;
  check('勾选前已存', p2.saved, 15000);
  const pending1 = p2.cards.find((c) => c.status === 'pending')!;
  repo.updateSaveCardStatus(pending1.id, 'saved');
  const p2b = engine.savePlanProgress('P2')!;
  check('勾选一期后已存 +¥1,000', p2b.saved - p2.saved, 1000);
  check('剩余未存同步减少', p2.remaining - p2b.remaining, 1000);
  checkPct('进度随之更新为 66.67%', p2b.progress, 66.67, 0.01);
  repo.updateSaveCardStatus(pending1.id, 'pending');
  checkInt('撤销后回到 15 期', engine.savePlanProgress('P2')!.cardSaved, 15);

  const p1 = engine.savePlanProgress('P1')!;
  repo.insertSaveRecord({
    id: 'SR_TEST', planId: 'P1', amount: yuan(5000), occurredAt: now, note: '验收存入'
  });
  check('灵活计划存入 ¥5,000 后已存', engine.savePlanProgress('P1')!.saved - p1.saved, 5000);
  checkPct('灵活计划进度变为 21.00%', engine.savePlanProgress('P1')!.progress, 21, 0.01);
  repo.db.run(`DELETE FROM save_record WHERE id='SR_TEST';`);

  // —— AC-26 多账本隔离
  section('AC-26 多账本：隔离性与默认唯一性');
  const newLedgerId = 'L_TEST';
  repo.insertLedger({
    id: newLedgerId, name: '测试账本', symbol: '📗', currency: 'CNY',
    isDefault: false, archived: false, sortOrder: 9
  });
  checkInt('新账本流水为 0', repo.txns(newLedgerId).length, 0);
  check('新账本净资产为 0', engine.assetsSnapshot(newLedgerId).netWorth, 0);
  check('主账本净资产不受影响', engine.assetsSnapshot(LEDGER_ID).netWorth, 46926.16);
  checkInt('账本总数 1 → 2', repo.ledgers().length, 2);
  repo.setDefaultLedger(newLedgerId);
  checkInt('默认账本唯一（is_default=1 恰好 1 个）', repo.ledgers().filter((l) => l.isDefault).length, 1);
  checkStr('默认账本已切换', repo.defaultLedger()?.name ?? '', '测试账本');
  repo.setDefaultLedger(LEDGER_ID);
  repo.updateLedgerAllowedFields(newLedgerId, { archived: true });
  checkInt('归档后不在切换列表（可见账本回到 1 个）', repo.ledgers().length, 1);

  // —— AC-27 全新账本（清空后开始真实记账）
  section('AC-27 清空演示数据 → 全新空账本');
  {
    const SQL2 = SQL;
    const fresh = Db.create(SQL2);
    const r2 = new Repo(fresh);
    const e2 = buildFreshLedger(r2);
    checkInt('流水为空', r2.txns('L_DEFAULT').length, 0);
    check('净资产为 0', e2.assetsSnapshot('L_DEFAULT').netWorth, 0);
    check('总资产为 0', e2.assetsSnapshot('L_DEFAULT').totalAssets, 0);
    checkInt('账户数（现金/支付宝/微信/储蓄卡/信用卡/公交卡）', r2.accounts('L_DEFAULT').length, 6);
    const cats2 = r2.categories('L_DEFAULT');
    // 手算：一级 9 个（餐饮/交通/购物/住房/娱乐/医疗/学习/社交/其他）+ 二级 17 个（5+3+3+3+3）= 26
    checkInt('支出分类：9 个一级 + 17 个二级', cats2.filter((c) => c.direction === 'expense').length, 26);
    checkInt('收入分类 6 个', cats2.filter((c) => c.direction === 'income').length, 6);
    checkStr('不写入参考时点（跟随真实日期）', String(r2.preference('reference_now')), 'null');
    checkStr('当前账本已指向新账本', r2.preference('current_ledger') ?? '', 'L_DEFAULT');
    const today = Math.floor(Date.now() / 1000);
    const ms2 = e2.periodSummary('L_DEFAULT', e2.monthRange(today), 'elapsed', today);
    check('新账本当月支出为 0', ms2.expense, 0);
    fresh.close();
  }

  // —— AC-29 账户 CRUD 对净资产的影响（这就是"新增净资产"的入口）
  section('AC-29 新增/编辑/删除账户 → 净资产联动');
  {
    const nw0 = engine.assetsSnapshot(LEDGER_ID).netWorth;
    const accId = 'A_TEST_NEW';
    repo.insertAccount({
      id: accId, ledgerId: LEDGER_ID, name: '测试储蓄卡', group: 'fund', kind: 'debitCard',
      icon: '🏦', cardNoMask: null, currency: 'CNY', initialBalance: yuan(5000), creditLimit: 0,
      billDay: null, repayDay: null, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 90
    });
    check('新增资金账户 ¥5,000 → 净资产 +5,000', engine.assetsSnapshot(LEDGER_ID).netWorth - nw0, 5000);
    checkInt('资金账户数 4 → 5', engine.assetsSnapshot(LEDGER_ID).accountCount.fund ?? 0, 5);

    repo.updateAccountFull(accId, { initialBalance: yuan(8000), name: '测试储蓄卡-改' });
    check('改余额为 ¥8,000 → 净资产 +8,000', engine.assetsSnapshot(LEDGER_ID).netWorth - nw0, 8000);

    repo.updateAccountFull(accId, { hidden: true });
    check('隐藏后不计入净资产', engine.assetsSnapshot(LEDGER_ID).netWorth - nw0, 0);
    repo.updateAccountFull(accId, { hidden: false });

    const ccId = 'A_TEST_CC';
    repo.insertAccount({
      id: ccId, ledgerId: LEDGER_ID, name: '测试信用卡', group: 'credit', kind: 'creditCard',
      icon: '💳', cardNoMask: null, currency: 'CNY', initialBalance: 0, creditLimit: yuan(10000),
      billDay: 5, repayDay: 25, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 91
    });
    check('新增信用账户（无欠款）→ 净资产不变', engine.assetsSnapshot(LEDGER_ID).netWorth - nw0, 8000);
    checkInt('信用卡账户数 1 → 2', engine.assetsSnapshot(LEDGER_ID).accountCount.credit ?? 0, 2);

    repo.softDeleteAccount(ccId);
    repo.softDeleteAccount(accId);
    check('删除两个测试账户 → 净资产回到原值', engine.assetsSnapshot(LEDGER_ID).netWorth - nw0, 0);
  }

  // —— AC-30 账单编辑（此前只能删除，不能改）
  section('AC-30 账单详情编辑 → 统计联动');
  {
    const target = repo.txns(LEDGER_ID, { from: month.start, to: month.end })
      .find((t) => t.kind === 'expense' && t.discount === 0 && t.refund === 0 && t.categoryId === CAT.veg)!;
    const before = engine.periodSummary(LEDGER_ID, month, 'elapsed', now).expense;
    const nwB = engine.assetsSnapshot(LEDGER_ID).netWorth;

    const deltaYuan = 100 - target.original / 100;   // 动态算差额，不硬编码
    repo.updateTxnFull(target.id, { original: yuan(100) });
    check(`改金额 ${target.original / 100} → 100 后月度支出 +¥${deltaYuan}`,
      engine.periodSummary(LEDGER_ID, month, 'elapsed', now).expense - before, deltaYuan);
    check('改金额后净资产同额减少', nwB - engine.assetsSnapshot(LEDGER_ID).netWorth, deltaYuan);

    repo.updateTxnFull(target.id, { discount: yuan(20) });            // 优惠 20 → 实付 80
    check('加 ¥20 优惠后实付 = ¥80', repo.txns(LEDGER_ID, {}).find((t) => t.id === target.id)?.amount ?? 0, 80);
    // 注意金额单位是「分」：原有 1.00 元 + 新增 20 元 = 21.00 元
    check('优惠合计 = 原有 ¥1 + 新增 ¥20',
      engine.periodSummary(LEDGER_ID, month, 'elapsed', now).discount, 21);

    repo.updateTxnFull(target.id, { categoryId: CAT.social, note: '改到社交', reimbursement: 'pending' });
    const cntSocial = engine.categoryBreakdown(LEDGER_ID, month, 'expense').find((x) => x.name === '社交')?.count ?? 0;
    checkInt('改分类后「社交」笔数 +1', cntSocial, 2);
    checkStr('改备注已落库', repo.txns(LEDGER_ID, {}).find((t) => t.id === target.id)?.note ?? '', '改到社交');

    // 还原
    repo.updateTxnFull(target.id, {
      original: target.original, discount: 0, refund: 0,
      categoryId: target.categoryId, note: target.note, reimbursement: 'none'
    });
    check('还原后月度支出回到原值', engine.periodSummary(LEDGER_ID, month, 'elapsed', now).expense - before, 0);
    check('还原后净资产回到原值', engine.assetsSnapshot(LEDGER_ID).netWorth - nwB, 0);
  }

  // —— AC-31 新建存钱计划（含按频率生成存钱卡片）
  section('AC-31 新建计划 → 自动生成存钱卡片');
  {
    const pid = 'P_TEST';
    const startSec = dateOf(2026, 1, 1);
    const endSec = dateOf(2027, 1, 1);
    repo.insertSavePlan({
      id: pid, ledgerId: LEDGER_ID, name: '测试计划', emoji: '🧪', type: 'fixed',
      frequency: 'monthly', startDate: startSec, endDate: endSec,
      target: yuan(12000), fromAccountId: ACC.cmb, toAccountId: null, archived: false
    });
    // 与表单**共用** core/plan 的期数/金额算法（两边不再各写一份）
    const dues = planCardDueDates(startSec, endSec, 'monthly');
    const amounts = planCardAmounts(yuan(12000), dues.length);
    checkInt('12 个月 → 12 期', dues.length, 12);
    const per = amounts[0];
    dues.forEach((due, i) => {
      repo.insertSaveCard({
        id: `${pid}_C${i + 1}`, planId: pid, seq: i + 1,
        dueDate: due, amount: amounts[i], status: 'pending', txnId: null
      });
    });
    const prog = engine.savePlanProgress(pid)!;
    checkInt('卡片数 12', prog.cardTotal, 12);
    check('每期金额 ¥1,000', per, 1000);
    check('各期金额合计 = 目标金额（尾差已补齐）', amounts.reduce((a, b) => a + b, 0), 12000);
    check('已存初始为 0', prog.saved, 0);
    checkPct('进度 0%', prog.progress, 0);

    repo.updateSaveCardStatus(`${pid}_C1`, 'saved');
    check('勾选 1 期后已存 ¥1,000', engine.savePlanProgress(pid)!.saved, 1000);
    repo.deleteSavePlan(pid);
    checkInt('删除计划 → 卡片一并清理（无孤儿数据）',
      repo.saveCards(pid).length + repo.saveRecords(pid).length, 0);
    checkInt('计划总数回到 2', engine.allSavePlans().length, 2);
  }

  // —— 导出可用性（Q-10：只导出不导入）
  const bytes = db.export();
  console.log(`\n    数据库可导出为 .sqlite 文件：${(bytes.length / 1024).toFixed(1)} KB`);
  if (bytes.length > 10000) { pass++; console.log('  ✅ 导出字节有效'); } else { fail++; console.log('  ❌ 导出字节异常'); }

  console.log('\n══════════════════════════════════════════════════');
  console.log(` 结果：通过 ${pass} 项，失败 ${fail} 项`);
  console.log('══════════════════════════════════════════════════');
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
