import type {
  AccountGroup, AccountKind, BillCycleStatus, BudgetPeriod, CategoryIconStyle,
  Direction, FlowType, ReimbursementStatus, SaveCardStatus, SaveFrequency, SavePlanType, TxnKind
} from './enums';
import type { Cents } from './money';

export interface Ledger {
  id: string;
  name: string;
  symbol: string;
  currency: string;
  isDefault: boolean;
  archived: boolean;
  sortOrder: number;
}

export interface Account {
  id: string;
  ledgerId: string;
  name: string;
  group: AccountGroup;
  kind: AccountKind;
  icon: string;
  cardNoMask: string | null;
  currency: string;
  initialBalance: Cents;
  creditLimit: Cents;
  billDay: number | null;
  repayDay: number | null;
  groupName: string | null;
  hidden: boolean;
  isFamilyCredit: boolean;
  sortOrder: number;
}

export interface Category {
  id: string;
  ledgerId: string;
  parentId: string | null;
  name: string;
  direction: Direction;
  icon: string;
  colorHex: string;
  iconStyle: CategoryIconStyle;
  isSystem: boolean;
  archived: boolean;
  hidden: boolean;
  sortOrder: number;
}

export interface Txn {
  id: string;
  ledgerId: string;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  kind: TxnKind;
  flowType: FlowType | null;
  original: Cents;
  discount: Cents;
  fee: Cents;
  refund: Cents;
  amount: Cents;          // 实付 = 原价 − 优惠 − 退款
  occurredAt: number;     // unix 秒
  note: string;
  locationName: string | null;
  reimbursement: ReimbursementStatus;
  excludeFromStats: boolean;
  billCycleId: string | null;
  refundOfId: string | null;
}

export interface BillCycle {
  id: string;
  accountId: string;
  periodStart: number;
  periodEnd: number;
  statementDate: number | null;
  dueDate: number | null;
  billAmount: Cents | null;
  paid: Cents;
  status: BillCycleStatus;
}

export interface Budget {
  id: string;
  ledgerId: string;
  categoryId: string | null;
  period: BudgetPeriod;
  amount: Cents;
  carryOver: boolean;
  startDate: number;
}

export interface SavePlan {
  id: string;
  ledgerId: string;
  name: string;
  emoji: string;
  type: SavePlanType;
  frequency: SaveFrequency;
  startDate: number;
  endDate: number;
  target: Cents;
  fromAccountId: string | null;
  toAccountId: string | null;
  archived: boolean;
}

export interface SaveCard {
  id: string;
  planId: string;
  seq: number;
  dueDate: number;
  amount: Cents;
  status: SaveCardStatus;
  txnId: string | null;
}

export interface SaveRecord {
  id: string;
  planId: string;
  amount: Cents;
  occurredAt: number;
  note: string;
}

export interface Template {
  id: string;
  ledgerId: string;
  name: string;
  emoji: string;
  direction: Direction;
  amount: Cents;
  categoryId: string | null;
  accountId: string | null;
  sortOrder: number;
}

// MARK: - 聚合结果

export interface AssetsSnapshot {
  totalAssets: Cents;
  totalLiabilities: Cents;
  netWorth: Cents;
  byGroup: Partial<Record<AccountGroup, Cents>>;
  accountCount: Partial<Record<AccountGroup, number>>;
}

export interface PeriodSummary {
  range: DateRange;
  expense: Cents;
  income: Cents;
  balance: Cents;
  refund: Cents;
  refundIncome: Cents;
  discount: Cents;
  fee: Cents;
  pendingReimbursement: Cents;
  doneReimbursement: Cents;
  reimbursementReceived: Cents;
  flows: Array<{ type: FlowType; amount: Cents }>;
  denominatorDays: number;
  dailyExpense: Cents;
  dailyIncome: Cents;
  dailyBalance: Cents;
  averageExpense: Cents;
}

export interface CategorySlice {
  categoryId: string;
  name: string;
  icon: string;
  colorHex: string;
  amount: Cents;
  count: number;
  parentId: string | null;
  percentOfTotal: number;       // 比值，用 pct() 格式化
  percentOfParent: number | null;
}

export interface DayStat {
  date: number;                 // 当日 00:00 的 unix 秒
  expense: Cents;
  income: Cents;
  balance: Cents;
  txnCount: number;
}

export interface RunningDebt {
  txnId: string;
  debtAfter: Cents;
}

export interface CreditCardSnapshot {
  accountId: string;
  currentDebt: Cents;
  creditLimit: Cents;
  availableCredit: Cents;
  cycleOutflow: Cents;
  cycleInflow: Cents;
  cycle: BillCycle | null;
  runningDebt: RunningDebt[];
}

export interface SavePlanProgress {
  plan: SavePlan;
  saved: Cents;
  remaining: Cents;
  progress: number;             // 比值
  cards: SaveCard[];
  cardSaved: number;
  cardTotal: number;
}

export interface BudgetSnapshot {
  base: Cents;
  carried: Cents;
  total: Cents;
  used: Cents;
  remaining: Cents;
  remainingDaily: Cents;
  daysLeft: number;
  carryOver: boolean;
}

export interface DateRange {
  start: number;   // unix 秒
  end: number;     // 不含
}
