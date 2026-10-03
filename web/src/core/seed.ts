/**
 * 演示账本样本数据（基准时点 2024-05-30）。
 * 把基准账本的每笔数字还原为可入库交易，供演示与核对。
 */
import { dateOf, MetricsEngine, toSec } from './metrics';
import { Repo } from './repo';
import { yuan, type Cents } from './money';
import type { Account, Category, Txn } from './types';
import type { Direction, FlowType, ReimbursementStatus, TxnKind } from './enums';

export const LEDGER_ID = 'L_DEFAULT';
export const ACC = {
  alipay: 'A_ALIPAY', cmb: 'A_CMB', fund1: 'A_FUND1', fund2: 'A_FUND2',
  citic: 'A_CITIC', buscard: 'A_BUSCARD', octopus: 'A_OCTOPUS', lendout: 'A_LENDOUT'
};
export const CAT = {
  meal: 'C_MEAL', meal3: 'C_MEAL_3', fruit: 'C_MEAL_FRUIT', coffee: 'C_MEAL_COFFEE',
  veg: 'C_MEAL_VEG', dessert: 'C_MEAL_DESSERT', house: 'C_HOUSE', beauty: 'C_BEAUTY',
  digital: 'C_DIGITAL', sport: 'C_SPORT', traffic: 'C_TRAFFIC', clothes: 'C_CLOTHES',
  social: 'C_SOCIAL', other: 'C_OTHER', sideJob: 'C_SIDEJOB', fundInc: 'C_FUNDINC',
  bonus: 'C_BONUS', redPacket: 'C_REDPACKET', otherInc: 'C_OTHERINC', salary: 'C_SALARY',
  refundIn: 'C_REFUNDIN'
};

/** 基准时点：2024-05-30 20:30 */
export const NOW = dateOf(2024, 5, 30, 20, 30);

/** 截图资产页的目标余额 */
const TARGET_BALANCES: Record<string, Cents> = {
  [ACC.alipay]: yuan(8483.06),
  [ACC.cmb]: yuan(34384.0),
  [ACC.fund1]: yuan(1200.0),
  [ACC.fund2]: yuan(1750.0),
  [ACC.buscard]: yuan(150.0),
  [ACC.octopus]: yuan(30.0),
  [ACC.lendout]: yuan(1000.0)
};

export function buildSampleData(repo: Repo): MetricsEngine {
  const engine = new MetricsEngine(repo);

  // 1) 账本
  repo.insertLedger({
    id: LEDGER_ID, name: '默认账本', symbol: '💡', currency: 'CNY',
    isDefault: true, archived: false, sortOrder: 0
  });

  // 2) 账户（资金 4 / 信用 1 / 充值 2 / 应收 1）
  const accounts: Account[] = [
    { id: ACC.alipay, ledgerId: LEDGER_ID, name: '支付宝', group: 'fund', kind: 'alipay', icon: '🅰️', cardNoMask: null, currency: 'CNY', initialBalance: 0, creditLimit: 0, billDay: null, repayDay: null, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 0 },
    { id: ACC.cmb, ledgerId: LEDGER_ID, name: '招商银行', group: 'fund', kind: 'debitCard', icon: '🏦', cardNoMask: '622X XXXX XXXX XX88', currency: 'CNY', initialBalance: 0, creditLimit: 0, billDay: null, repayDay: null, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 1 },
    { id: ACC.fund1, ledgerId: LEDGER_ID, name: '公积金', group: 'fund', kind: 'housingFund', icon: '🐣', cardNoMask: null, currency: 'CNY', initialBalance: 0, creditLimit: 0, billDay: null, repayDay: null, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 2 },
    { id: ACC.fund2, ledgerId: LEDGER_ID, name: '公积金', group: 'fund', kind: 'housingFund', icon: '🐥', cardNoMask: null, currency: 'CNY', initialBalance: 0, creditLimit: 0, billDay: null, repayDay: null, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 3 },
    { id: ACC.citic, ledgerId: LEDGER_ID, name: '中信银行', group: 'credit', kind: 'creditCard', icon: '💳', cardNoMask: '625X XXXX XXXX XX78', currency: 'CNY', initialBalance: 0, creditLimit: yuan(20000), billDay: 10, repayDay: 28, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 4 },
    { id: ACC.buscard, ledgerId: LEDGER_ID, name: '北京公交卡', group: 'prepaid', kind: 'transitCard', icon: '🚌', cardNoMask: null, currency: 'CNY', initialBalance: 0, creditLimit: 0, billDay: null, repayDay: null, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 5 },
    { id: ACC.octopus, ledgerId: LEDGER_ID, name: '八达通', group: 'prepaid', kind: 'octopus', icon: '🚇', cardNoMask: null, currency: 'CNY', initialBalance: 0, creditLimit: 0, billDay: null, repayDay: null, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 6 },
    // 截图未拍到，由「总资产 46,997.06 −（资金 45,817.06 + 充值 180.00）= 1,000.00」反推
    { id: ACC.lendout, ledgerId: LEDGER_ID, name: '借出-小王', group: 'receivable', kind: 'other', icon: '🐑', cardNoMask: null, currency: 'CNY', initialBalance: 0, creditLimit: 0, billDay: null, repayDay: null, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 7 }
  ];
  for (const a of accounts) repo.insertAccount(a);

  // 3) 分类
  const cat = (
    id: string, name: string, direction: Direction, parentId: string | null,
    color: string, icon: string, sortOrder: number
  ): Category => ({
    id, ledgerId: LEDGER_ID, parentId, name, direction, icon, colorHex: color,
    iconStyle: 'mono', isSystem: true, archived: false, hidden: false, sortOrder
  });

  const categories: Category[] = [
    cat(CAT.meal, '餐饮', 'expense', null, '#F4736A', '🍚', 0),
    cat(CAT.meal3, '三餐', 'expense', CAT.meal, '#F4736A', '🍜', 0),
    cat(CAT.fruit, '水果', 'expense', CAT.meal, '#F5A623', '🍎', 1),
    cat(CAT.coffee, '咖啡', 'expense', CAT.meal, '#8B5E3C', '☕', 2),
    cat(CAT.veg, '蔬菜', 'expense', CAT.meal, '#34C759', '🥬', 3),
    cat(CAT.dessert, '甜品', 'expense', CAT.meal, '#D4537E', '🍰', 4),
    cat(CAT.house, '住房', 'expense', null, '#378ADD', '🏠', 1),
    cat(CAT.beauty, '美妆', 'expense', null, '#ED93B1', '💄', 2),
    cat(CAT.digital, '数码', 'expense', null, '#7F77DD', '📱', 3),
    cat(CAT.sport, '运动', 'expense', null, '#5DCAA5', '🏸', 4),
    cat(CAT.traffic, '交通', 'expense', null, '#85B7EB', '🚇', 5),
    cat(CAT.clothes, '服饰', 'expense', null, '#F0997B', '👕', 6),
    cat(CAT.social, '社交', 'expense', null, '#EF9F27', '🍻', 7),
    cat(CAT.other, '其他', 'expense', null, '#B4B2A9', '📦', 8),
    cat(CAT.sideJob, '副业', 'income', null, '#639922', '💼', 0),
    cat(CAT.fundInc, '公积金', 'income', null, '#1D9E75', '🏛', 1),
    cat(CAT.bonus, '奖金', 'income', null, '#BA7517', '🎁', 2),
    cat(CAT.redPacket, '红包', 'income', null, '#E24B4A', '🧧', 3),
    cat(CAT.otherInc, '其他收入', 'income', null, '#888780', '💰', 4),
    cat(CAT.salary, '工资', 'income', null, '#2F7CF6', '💵', 5),
    cat(CAT.refundIn, '退款入账', 'income', null, '#8E8E93', '↩️', 6)
  ];
  for (const c of categories) repo.insertCategory(c);

  // 4) 交易
  let nth = 0;
  const tx = (o: {
    at: number; account: string; to?: string | null; category: string;
    original: number; discount?: number; refund?: number; fee?: number;
    kind?: TxnKind; flow?: FlowType; note?: string; place?: string | null;
    reimb?: ReimbursementStatus; exclude?: boolean; refundOf?: string | null;
  }): string => {
    nth += 1;
    const id = 'T' + String(nth).padStart(3, '0');
    const original = yuan(o.original);
    const discount = yuan(o.discount ?? 0);
    const refund = yuan(o.refund ?? 0);
    const t: Txn = {
      id, ledgerId: LEDGER_ID, accountId: o.account, toAccountId: o.to ?? null,
      categoryId: o.category, kind: o.kind ?? 'expense', flowType: o.flow ?? null,
      original, discount, fee: yuan(o.fee ?? 0), refund,
      amount: original - discount - refund,
      occurredAt: o.at, note: o.note ?? '', locationName: o.place ?? null,
      reimbursement: o.reimb ?? 'none', excludeFromStats: o.exclude ?? false,
      billCycleId: null, refundOfId: o.refundOf ?? null
    };
    repo.insertTxn(t);
    return id;
  };

  // —— 餐饮：三餐 8 笔 = 441.00（含 5/30 的 45.00 − 优惠 1.00 = 44.00）
  tx({ at: dateOf(2024, 5, 3), account: ACC.alipay, category: CAT.meal3, original: 62.0, note: '午餐' });
  tx({ at: dateOf(2024, 5, 7), account: ACC.alipay, category: CAT.meal3, original: 58.0, note: '午餐' });
  tx({ at: dateOf(2024, 5, 10), account: ACC.alipay, category: CAT.meal3, original: 55.0, note: '晚餐' });
  tx({ at: dateOf(2024, 5, 12), account: ACC.alipay, category: CAT.meal3, original: 61.0, note: '午餐' });
  tx({ at: dateOf(2024, 5, 15), account: ACC.alipay, category: CAT.meal3, original: 54.0, note: '午餐' });
  tx({ at: dateOf(2024, 5, 18), account: ACC.alipay, category: CAT.meal3, original: 53.0, note: '午餐' });
  tx({ at: dateOf(2024, 5, 22), account: ACC.alipay, category: CAT.meal3, original: 54.0, note: '午餐', reimb: 'pending' });
  tx({ at: dateOf(2024, 5, 30, 16, 3), account: ACC.alipay, category: CAT.meal3, original: 45.0, discount: 1.0, note: '午餐' });
  // —— 水果 4 笔 = 101.00（其中 32.00 待报销）
  tx({ at: dateOf(2024, 5, 2), account: ACC.alipay, category: CAT.fruit, original: 32.0, reimb: 'pending' });
  tx({ at: dateOf(2024, 5, 9), account: ACC.alipay, category: CAT.fruit, original: 23.0 });
  tx({ at: dateOf(2024, 5, 16), account: ACC.alipay, category: CAT.fruit, original: 28.0 });
  tx({ at: dateOf(2024, 5, 20), account: ACC.alipay, category: CAT.fruit, original: 18.0 });
  // —— 咖啡 4 笔 = 80.90（5/30 的 9.90 走中信信用卡）
  tx({ at: dateOf(2024, 5, 4), account: ACC.alipay, category: CAT.coffee, original: 27.0, note: '咖啡豆' });
  tx({ at: dateOf(2024, 5, 11), account: ACC.alipay, category: CAT.coffee, original: 22.0, reimb: 'pending' });
  tx({ at: dateOf(2024, 5, 19), account: ACC.alipay, category: CAT.coffee, original: 22.0 });
  tx({ at: dateOf(2024, 5, 30, 20, 9), account: ACC.citic, category: CAT.coffee, original: 9.9, note: '咖啡' });
  // —— 蔬菜 3 笔 = 79.00
  tx({ at: dateOf(2024, 5, 6), account: ACC.alipay, category: CAT.veg, original: 29.0 });
  tx({ at: dateOf(2024, 5, 14), account: ACC.alipay, category: CAT.veg, original: 27.0 });
  tx({ at: dateOf(2024, 5, 24), account: ACC.alipay, category: CAT.veg, original: 23.0 });
  // —— 甜品 2 笔 = 27.00
  tx({ at: dateOf(2024, 5, 8), account: ACC.alipay, category: CAT.dessert, original: 15.0 });
  tx({ at: dateOf(2024, 5, 21), account: ACC.alipay, category: CAT.dessert, original: 12.0 });

  // —— 住房 667.94（含 5/27 的 150.00，落在统计周内）
  tx({ at: dateOf(2024, 5, 6), account: ACC.cmb, category: CAT.house, original: 517.94, note: '房租' });
  tx({ at: dateOf(2024, 5, 27), account: ACC.cmb, category: CAT.house, original: 150.0, note: '物业费' });
  // —— 美妆 349.91（含 5/29 的 42.00）
  tx({ at: dateOf(2024, 5, 12), account: ACC.alipay, category: CAT.beauty, original: 307.91 });
  tx({ at: dateOf(2024, 5, 29), account: ACC.alipay, category: CAT.beauty, original: 42.0, note: '口红' });
  // —— 数码 319.87（含 5/28 的 89.00）
  tx({ at: dateOf(2024, 5, 9), account: ACC.alipay, category: CAT.digital, original: 230.87, note: '键盘' });
  tx({ at: dateOf(2024, 5, 28), account: ACC.alipay, category: CAT.digital, original: 89.0, note: '数据线' });
  // —— 运动 179.91（5/21 羽毛球 60.00 走中信信用卡）
  tx({ at: dateOf(2024, 5, 14), account: ACC.alipay, category: CAT.sport, original: 119.91, note: '健身私教' });
  tx({ at: dateOf(2024, 5, 21, 14, 0), account: ACC.citic, category: CAT.sport, original: 60.0, note: '打羽毛球 🏸', place: '广东奥林匹克体育中心' });
  // —— 交通 146.09：5/30 地铁 原价 3.00、退款 2.00 → 实付 1.00
  tx({ at: dateOf(2024, 5, 13), account: ACC.alipay, category: CAT.traffic, original: 145.09, note: '打车' });
  const metroId = tx({ at: dateOf(2024, 5, 30, 9, 16), account: ACC.citic, category: CAT.traffic, original: 3.0, refund: 2.0, note: '地铁' });
  // —— 服饰 / 社交 / 其他
  tx({ at: dateOf(2024, 5, 17), account: ACC.alipay, category: CAT.clothes, original: 105.0 });
  tx({ at: dateOf(2024, 5, 19), account: ACC.alipay, category: CAT.social, original: 105.0, note: '聚餐' });
  tx({ at: dateOf(2024, 5, 20), account: ACC.alipay, category: CAT.other, original: 313.28 });

  // —— 收入（月合计 9,985.06；统计周 5/26–5/31 合计 2,367.00）
  tx({ at: dateOf(2024, 5, 10, 9, 0), account: ACC.cmb, category: CAT.salary, original: 5000.0, kind: 'income', note: '5 月工资' });
  tx({ at: dateOf(2024, 5, 5), account: ACC.alipay, category: CAT.redPacket, original: 258.06, kind: 'income', note: '红包' });
  tx({ at: dateOf(2024, 5, 8), account: ACC.alipay, category: CAT.sideJob, original: 400.0, kind: 'income', note: '副业收入' });
  tx({ at: dateOf(2024, 5, 10, 10, 0), account: ACC.cmb, category: CAT.fundInc, original: 960.0, kind: 'income', note: '公积金' });
  tx({ at: dateOf(2024, 5, 15), account: ACC.cmb, category: CAT.bonus, original: 1000.0, kind: 'income', note: '季度奖金' });
  tx({ at: dateOf(2024, 5, 26), account: ACC.alipay, category: CAT.redPacket, original: 200.0, kind: 'income', note: '红包' });
  tx({ at: dateOf(2024, 5, 27), account: ACC.alipay, category: CAT.sideJob, original: 300.0, kind: 'income', note: '副业' });
  tx({ at: dateOf(2024, 5, 28, 10, 0), account: ACC.cmb, category: CAT.fundInc, original: 720.0, kind: 'income', note: '公积金' });
  tx({ at: dateOf(2024, 5, 28, 15, 0), account: ACC.cmb, category: CAT.bonus, original: 500.0, kind: 'income', note: '项目奖金' });
  tx({ at: dateOf(2024, 5, 29), account: ACC.alipay, category: CAT.sideJob, original: 300.0, kind: 'income', note: '副业' });
  tx({ at: dateOf(2024, 5, 29, 18, 0), account: ACC.alipay, category: CAT.otherInc, original: 12.0, kind: 'income', note: '其他' });
  tx({ at: dateOf(2024, 5, 30, 16, 41), account: ACC.alipay, category: CAT.sideJob, original: 200.0, kind: 'income', note: '副业' });
  tx({ at: dateOf(2024, 5, 31), account: ACC.alipay, category: CAT.redPacket, original: 135.0, kind: 'income', note: '红包' });

  // —— 退款入账（中信）：不计入收支统计，仅影响账户与账单「流入」
  tx({ at: dateOf(2024, 5, 30, 19, 16), account: ACC.citic, category: CAT.refundIn, original: 2.0, kind: 'refund_credit', note: '地铁', refundOf: metroId });
  // —— 流转：中信上期账单还款 60.00（计入账单「流入」，不冲减本期欠款）
  tx({ at: dateOf(2024, 5, 12, 11, 0), account: ACC.alipay, to: ACC.citic, category: CAT.refundIn, original: 60.0, kind: 'repay', flow: 'repay', note: '上期账单还款', exclude: true });
  // —— 流转：借出给小王 1,000.00（形成应收账户）
  tx({ at: dateOf(2024, 5, 31, 17, 4), account: ACC.alipay, to: ACC.lendout, category: CAT.other, original: 1000.0, kind: 'borrow_out', flow: 'borrowOut', note: '小王', exclude: true });

  // 5) 让账户余额精确落到截图数值（初始余额 = 目标余额 − 流水净影响）
  for (const acc of repo.accounts(LEDGER_ID)) {
    if (acc.group === 'credit') continue;
    const target = TARGET_BALANCES[acc.id];
    if (target === undefined) continue;
    const raw = engine.runningBalanceExcludingInitial(acc.id);
    repo.updateInitialBalance(acc.id, target - raw);
  }

  // 6) 预算（总预算 3,000.00，开启结转）
  repo.insertBudget({
    id: 'B1', ledgerId: LEDGER_ID, categoryId: null, period: 'monthly',
    amount: yuan(3000), carryOver: true, startDate: dateOf(2024, 5, 1, 0, 0)
  });

  // 7) 信用卡账单周期：2024 年 06 月账单（05/10 - 06/09，未出账）
  repo.insertBillCycle({
    id: 'BC1', accountId: ACC.citic,
    periodStart: dateOf(2024, 5, 10, 0, 0), periodEnd: dateOf(2024, 6, 10, 0, 0),
    statementDate: dateOf(2024, 6, 10, 0, 0), dueDate: dateOf(2024, 6, 28, 0, 0),
    billAmount: null, paid: 0, status: 'open'
  });

  // 8) 存钱计划
  repo.insertSavePlan({
    id: 'P1', ledgerId: LEDGER_ID, name: '提前还房贷', emoji: '💪', type: 'flexible',
    frequency: 'monthly', startDate: dateOf(2022, 10, 3), endDate: dateOf(2024, 10, 3),
    target: yuan(500000), fromAccountId: ACC.cmb, toAccountId: null, archived: false
  });
  repo.insertSaveRecord({ id: 'SR1', planId: 'P1', amount: yuan(60000), occurredAt: dateOf(2023, 10, 3), note: '首笔' });
  repo.insertSaveRecord({ id: 'SR2', planId: 'P1', amount: yuan(40000), occurredAt: dateOf(2024, 5, 1), note: '年终奖结转' });

  repo.insertSavePlan({
    id: 'P2', ledgerId: LEDGER_ID, name: '深造基金', emoji: '🌻', type: 'fixed',
    frequency: 'monthly', startDate: dateOf(2023, 3, 1), endDate: dateOf(2025, 3, 1),
    target: yuan(24000), fromAccountId: ACC.cmb, toAccountId: null, archived: false
  });
  for (let i = 0; i < 24; i++) {
    const d = new Date(2023, 2 + i, 1, 12, 0, 0, 0); // 2023-03-01 起逐月
    repo.insertSaveCard({
      id: `SC${i + 1}`, planId: 'P2', seq: i + 1, dueDate: toSec(d),
      amount: yuan(1000), status: i < 15 ? 'saved' : 'pending', txnId: null
    });
  }

  // 9) 记账模板（对应小组件「模板记账」4 宫格）
  repo.insertTemplate({ id: 'TP1', ledgerId: LEDGER_ID, name: '每日咖啡', emoji: '☕', direction: 'expense', amount: yuan(9.9), categoryId: CAT.coffee, accountId: ACC.alipay, sortOrder: 0 });
  repo.insertTemplate({ id: 'TP2', ledgerId: LEDGER_ID, name: '公积金', emoji: '🏛', direction: 'income', amount: yuan(720), categoryId: CAT.fundInc, accountId: ACC.cmb, sortOrder: 1 });
  repo.insertTemplate({ id: 'TP3', ledgerId: LEDGER_ID, name: '充值公交卡', emoji: '🚌', direction: 'expense', amount: yuan(50), categoryId: CAT.traffic, accountId: ACC.buscard, sortOrder: 2 });
  repo.insertTemplate({ id: 'TP4', ledgerId: LEDGER_ID, name: '蓝莓', emoji: '🫐', direction: 'expense', amount: yuan(15.8), categoryId: CAT.fruit, accountId: ACC.alipay, sortOrder: 3 });

  // 10) 配置
  repo.setPreference('day_denominator', 'elapsed');
  // 基准时点：2024-05-30，用于「已过天数」等口径
  repo.setPreference('reference_now', String(NOW));
  repo.setPreference('hide_amount', 'false');
  repo.setPreference('appearance', 'system');

  return engine;
}


// ══════════════════════════════════════════════════════════════════
// 全新账本（清空演示数据后使用）：空流水 + 常用分类 + 常见账户
// 注意：**不写入 reference_now**，这样页面会跟随真实当前日期
// ══════════════════════════════════════════════════════════════════

/** 常用支出分类（一级 → 二级），按国内记账习惯取默认值 */
const FRESH_EXPENSE: Array<[string, string, string[], string]> = [
  ['餐饮', '🍚', ['三餐', '水果', '咖啡', '蔬菜', '零食'], '#F4736A'],
  ['交通', '🚇', ['地铁', '公交', '打车'], '#85B7EB'],
  ['购物', '🛍', ['服饰', '日用', '数码'], '#F0997B'],
  ['住房', '🏠', ['房租', '水电', '物业'], '#378ADD'],
  ['娱乐', '🎬', ['电影', '游戏', '旅行'], '#5DCAA5'],
  ['医疗', '💊', [], '#E24B4A'],
  ['学习', '📚', [], '#7F77DD'],
  ['社交', '🍻', [], '#EF9F27'],
  ['其他', '📦', [], '#B4B2A9']
];

/** 常用收入分类 */
const FRESH_INCOME: Array<[string, string, string]> = [
  ['工资', '💵', '#2F7CF6'],
  ['生活费', '🏠', '#639922'],
  ['奖金', '🎁', '#BA7517'],
  ['副业', '💼', '#1D9E75'],
  ['红包', '🧧', '#E24B4A'],
  ['其他收入', '💰', '#888780']
];

/** 清空后建立的全新账本：没有任何流水，净资产为 0 */
export function buildFreshLedger(repo: Repo): MetricsEngine {
  const engine = new MetricsEngine(repo);
  const L = 'L_DEFAULT';

  repo.insertLedger({
    id: L, name: '默认账本', symbol: '💡', currency: 'CNY',
    isDefault: true, archived: false, sortOrder: 0
  });

  // 账户：全部 0 余额，可自行改名 / 改余额
  const accounts: Account[] = [
    { id: 'A_CASH', ledgerId: L, name: '现金', group: 'fund', kind: 'cash', icon: '💵', cardNoMask: null, currency: 'CNY', initialBalance: 0, creditLimit: 0, billDay: null, repayDay: null, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 0 },
    { id: 'A_ALIPAY', ledgerId: L, name: '支付宝', group: 'fund', kind: 'alipay', icon: '🅰️', cardNoMask: null, currency: 'CNY', initialBalance: 0, creditLimit: 0, billDay: null, repayDay: null, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 1 },
    { id: 'A_WECHAT', ledgerId: L, name: '微信', group: 'fund', kind: 'wechat', icon: '💬', cardNoMask: null, currency: 'CNY', initialBalance: 0, creditLimit: 0, billDay: null, repayDay: null, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 2 },
    { id: 'A_DEBIT', ledgerId: L, name: '储蓄卡', group: 'fund', kind: 'debitCard', icon: '🏦', cardNoMask: null, currency: 'CNY', initialBalance: 0, creditLimit: 0, billDay: null, repayDay: null, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 3 },
    { id: 'A_CREDIT', ledgerId: L, name: '信用卡', group: 'credit', kind: 'creditCard', icon: '💳', cardNoMask: null, currency: 'CNY', initialBalance: 0, creditLimit: yuan(20000), billDay: 10, repayDay: 28, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 4 },
    { id: 'A_PREPAID', ledgerId: L, name: '公交卡', group: 'prepaid', kind: 'transitCard', icon: '🚌', cardNoMask: null, currency: 'CNY', initialBalance: 0, creditLimit: 0, billDay: null, repayDay: null, groupName: null, hidden: false, isFamilyCredit: false, sortOrder: 5 }
  ];
  for (const a of accounts) repo.insertAccount(a);

  // 分类
  let order = 0;
  for (const [name, icon, subs, color] of FRESH_EXPENSE) {
    const pid = `C_F${order}`;
    repo.insertCategory({
      id: pid, ledgerId: L, parentId: null, name, direction: 'expense', icon,
      colorHex: color, iconStyle: 'mono', isSystem: true, archived: false,
      hidden: false, sortOrder: order
    });
    let so = 0;
    for (const sub of subs) {
      repo.insertCategory({
        id: `${pid}_${so}`, ledgerId: L, parentId: pid, name: sub, direction: 'expense',
        icon, colorHex: color, iconStyle: 'mono', isSystem: true, archived: false,
        hidden: false, sortOrder: so
      });
      so += 1;
    }
    order += 1;
  }
  order = 0;
  for (const [name, icon, color] of FRESH_INCOME) {
    repo.insertCategory({
      id: `C_I${order}`, ledgerId: L, parentId: null, name, direction: 'income', icon,
      colorHex: color, iconStyle: 'mono', isSystem: true, archived: false,
      hidden: false, sortOrder: order
    });
    order += 1;
  }

  // 偏好：保留统计口径设置；**刻意不写 reference_now**（跟随真实日期）
  repo.setPreference('day_denominator', 'elapsed');
  repo.setPreference('hide_amount', 'false');
  repo.setPreference('appearance', 'system');
  repo.setPreference('current_ledger', L);
  repo.setPreference('fresh_started_at', String(Math.floor(Date.now() / 1000)));

  return engine;
}
