/** 枚举与字典（单币种 CNY） */
import type { Cents } from './money';

export type AccountGroup = 'fund' | 'credit' | 'prepaid' | 'receivable' | 'payable' | 'investment';

export const ACCOUNT_GROUP_LABEL: Record<AccountGroup, string> = {
  fund: '资金账户',
  credit: '信用账户',
  prepaid: '充值账户',
  receivable: '应收账户',
  payable: '应付账户',
  investment: '投资账户'
};

/** 资产页展示顺序：资金 → 信用 → 充值；应收由总资产差额反推 */
export const ACCOUNT_GROUP_ORDER: AccountGroup[] = [
  'fund', 'credit', 'prepaid', 'receivable', 'payable', 'investment'
];

export const IS_LIABILITY: Record<AccountGroup, boolean> = {
  fund: false, credit: true, prepaid: false,
  receivable: false, payable: true, investment: false
};

export type AccountKind =
  | 'alipay' | 'wechat' | 'debitCard' | 'creditCard' | 'housingFund' | 'transitCard'
  | 'octopus' | 'cash' | 'savings' | 'current' | 'loan' | 'familyCredit' | 'other';

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  alipay: '支付宝', wechat: '微信', debitCard: '储蓄卡', creditCard: '信用卡',
  housingFund: '公积金', transitCard: '公交卡', octopus: '八达通', cash: '现金',
  savings: '存钱', current: '活期', loan: '贷款', familyCredit: '亲情账户', other: '其他'
};

/**
 * 交易大类。存库值必须与 SQL 中的字面量严格一致，
 * 否则退款入账会漏算。
 */
export type TxnKind =
  | 'expense' | 'income' | 'refund_credit'
  | 'transfer' | 'recharge' | 'repay' | 'collect'
  | 'borrow_in' | 'borrow_out';

export type TxnDirection = 'expense' | 'income';

export type FlowType = 'repay' | 'collect' | 'transfer' | 'recharge' | 'borrowIn' | 'borrowOut';

export const FLOW_ORDER: FlowType[] = ['repay', 'collect', 'transfer', 'recharge', 'borrowIn', 'borrowOut'];

export const FLOW_LABEL: Record<FlowType, string> = {
  repay: '还款', collect: '收款', transfer: '转账',
  recharge: '充值', borrowIn: '借入', borrowOut: '借出'
};

export type ReimbursementStatus = 'none' | 'pending' | 'done' | 'received';

export const REIMBURSEMENT_LABEL: Record<ReimbursementStatus, string> = {
  none: '无需报销', pending: '待报销', done: '已报销', received: '报销入账'
};

export type Direction = 'expense' | 'income';
export const DIRECTION_LABEL: Record<Direction, string> = { expense: '支出', income: '收入' };

export type SavePlanType = 'fixed' | 'flexible';
export const SAVE_PLAN_LABEL: Record<SavePlanType, string> = { fixed: '定额存钱', flexible: '灵活存钱' };

export type SaveFrequency = 'daily' | 'weekly' | 'monthly';
export const SAVE_FREQ_LABEL: Record<SaveFrequency, string> = { daily: '每日', weekly: '每周', monthly: '每月' };

export type SaveCardStatus = 'pending' | 'saved';
export type BillCycleStatus = 'open' | 'issued' | 'settled';
export const BILL_STATUS_LABEL: Record<BillCycleStatus, string> = {
  open: '未出账', issued: '已出账', settled: '已结清'
};

export type BudgetPeriod = 'monthly' | 'weekly';
export type CategoryIconStyle = 'mono' | 'colored' | 'followPie' | 'custom';

/** 日均分母口径（默认 elapsed） */
export type DayDenominator = 'natural' | 'elapsed' | 'spending' | 'active';

export const DENOMINATOR_LABEL: Record<DayDenominator, string> = {
  natural: '自然日', elapsed: '已过天数', spending: '有消费天数', active: '有数据天数'
};

/** 判断一笔交易是否计入收支统计（退款入账与流转不计） */
export function isStatistic(kind: TxnKind): boolean {
  return kind === 'expense' || kind === 'income';
}

/**
 * 该交易对账户**余额**的影响（分）。
 *
 * 关键：余额口径 ≠ 统计口径
 *  - 统计口径用「实付」= 原价 − 优惠 − 退款
 *  - 余额口径必须用「原价 − 优惠 + 手续费」：因为退款是**单独一笔 refund_credit** 回流，
 *    若这里再扣一次退款，钱会被扣两遍。
 *  验算（地铁）：余额 −(3.00 − 0) = −3.00，退款入账 +2.00 ⇒ 净 −1.00 ＝ 实付 ✔
 */
export function balanceDeltaOf(t: {
  kind: TxnKind; original: Cents; discount: Cents; fee: Cents; amount: Cents;
}): Cents {
  switch (t.kind) {
    case 'expense':
      return -(t.original - t.discount + t.fee);
    case 'transfer':
    case 'recharge':
    case 'repay':
    case 'collect':
    case 'borrow_out':
      return -t.amount;
    default:
      return t.amount;
  }
}
