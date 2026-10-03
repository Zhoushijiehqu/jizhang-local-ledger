import Foundation

public struct Ledger: Identifiable, Hashable {
    public var id: String
    public var name: String
    public var symbol: String            // 顶栏 emoji（截图 💡）
    public var currency: String          // 单币种：CNY（Q-04）
    public var isDefault: Bool
    public var archived: Bool
    public var sortOrder: Int
}

public struct Account: Identifiable, Hashable {
    public var id: String
    public var ledgerId: String
    public var name: String
    public var group: AccountGroup
    public var kind: AccountKind
    public var icon: String              // emoji / SF Symbol 名
    public var cardNoMask: String?
    public var currency: String
    public var initialBalance: Money
    public var creditLimit: Money        // 信用卡额度（截图反推 20,000.00）
    public var billDay: Int?             // 账单日
    public var repayDay: Int?            // 还款日
    public var groupName: String?        // 自定义分组名（FR-EXT-17）
    public var hidden: Bool
    public var isFamilyCredit: Bool      // 亲情账户（FR-EXT-37）
    public var sortOrder: Int
}

public struct Category: Identifiable, Hashable {
    public var id: String
    public var ledgerId: String
    public var parentId: String?
    public var name: String
    public var direction: Direction
    public var icon: String
    public var colorHex: String
    public var iconStyle: CategoryIconStyle
    public var isSystem: Bool
    public var archived: Bool            // 分类归档（FR-EXT-03）
    public var hidden: Bool
    public var sortOrder: Int

    public var isTopLevel: Bool { parentId == nil }
}

public struct Txn: Identifiable, Hashable {
    public var id: String
    public var ledgerId: String
    public var accountId: String
    public var toAccountId: String?
    public var categoryId: String?
    public var kind: TxnKind
    public var flowType: FlowType?
    public var original: Money           // 原价
    public var discount: Money           // 优惠
    public var fee: Money                // 手续费
    public var refund: Money             // 退款（冲减实付）
    public var amount: Money             // 实付 = 原价 − 优惠 − 退款
    public var occurredAt: Date
    public var note: String
    public var locationName: String?
    public var reimbursement: ReimbursementStatus
    public var excludeFromStats: Bool
    public var billCycleId: String?
    public var refundOfId: String?       // refundCredit 指向原支出
    public var tags: [String]

    /// 对账户余额的影响（支出/流转为负，收入/退款入账为正）
    public var balanceDelta: Money {
        switch kind {
        case .expense, .transfer, .recharge, .repay, .collect, .borrowOut: return -amount
        case .income, .refundCredit, .borrowIn: return amount
        }
    }
}

public struct BillCycle: Identifiable, Hashable {
    public var id: String
    public var accountId: String
    public var periodStart: Date
    public var periodEnd: Date
    public var statementDate: Date?
    public var dueDate: Date?
    public var billAmount: Money?        // nil = 未出账
    public var paid: Money
    public var status: BillCycleStatus
}

public struct Budget: Identifiable, Hashable {
    public var id: String
    public var ledgerId: String
    public var categoryId: String?       // nil = 总预算
    public var period: BudgetPeriod
    public var amount: Money
    public var carryOver: Bool           // 预算结转（FR-EXT-02）
    public var startDate: Date
}

public struct SavePlan: Identifiable, Hashable {
    public var id: String
    public var ledgerId: String
    public var name: String
    public var emoji: String
    public var type: SavePlanType
    public var frequency: SaveFrequency
    public var startDate: Date
    public var endDate: Date
    public var target: Money
    public var fromAccountId: String?
    public var toAccountId: String?
    public var archived: Bool
}

public struct SaveCard: Identifiable, Hashable {
    public var id: String
    public var planId: String
    public var seq: Int
    public var dueDate: Date
    public var amount: Money
    public var status: SaveCardStatus
    public var txnId: String?
}

public struct SaveRecord: Identifiable, Hashable {
    public var id: String
    public var planId: String
    public var amount: Money
    public var occurredAt: Date
    public var note: String
}

// MARK: - 聚合结果

public struct AssetsSnapshot: Hashable {
    public var totalAssets: Money
    public var totalLiabilities: Money
    public var netWorth: Money
    public var byGroup: [AccountGroup: Money]     // 负债组为负值呈现
    public var accountCount: [AccountGroup: Int]
}

public struct PeriodSummary: Hashable {
    public var range: DateRange
    public var expense: Money
    public var income: Money
    public var balance: Money                     // 收入 − 支出
    public var refund: Money
    public var refundIncome: Money
    public var discount: Money
    public var fee: Money
    public var pendingReimbursement: Money
    public var doneReimbursement: Money
    public var reimbursementReceived: Money
    public var reimbursementIncome: Money
    public var flows: [(FlowType, Money)]
    public var denominatorDays: Int
    public var dailyExpense: Money                // 支出 ÷ 分母天数
    public var dailyIncome: Money
    public var dailyBalance: Money
    public var averageExpense: Money              // 图表「平均值」标签

    public static func == (l: PeriodSummary, r: PeriodSummary) -> Bool {
        l.range == r.range && l.expense == r.expense && l.income == r.income && l.denominatorDays == r.denominatorDays
    }
    public func hash(into hasher: inout Hasher) { hasher.combine(expense); hasher.combine(income) }
}

public struct CategorySlice: Hashable {
    public var categoryId: String
    public var name: String
    public var icon: String
    public var colorHex: String
    public var amount: Money
    public var count: Int
    public var parentId: String?
    public var percentOfTotal: Percent           // 占全部（环形图引线）
    public var percentOfParent: Percent?         // 占父类（如「三餐 60.50%」）
}

public struct DayStat: Hashable {
    public var date: Date
    public var expense: Money
    public var income: Money
    public var balance: Money { income - expense }
    public var txnCount: Int
}

public struct CreditCardSnapshot: Hashable {
    public var accountId: String
    public var currentDebt: Money                 // 当前欠款（周期消费原价 − 退款入账）
    public var creditLimit: Money
    public var availableCredit: Money             // 额度 − 欠款
    public var cycleOutflow: Money                // 周期流出（按原价）
    public var cycleInflow: Money                 // 周期流入（退款入账 + 还款/转入）
    public var cycle: BillCycle?
    /// 逐笔欠款（按原价累计、退款入账冲减、还款不计入），用于明细行右下角「欠款: ¥xx」
    public var runningDebt: [RunningDebt]
}

/// 逐笔欠款快照
public struct RunningDebt: Hashable {
    public var txnId: String
    public var debtAfter: Money
    public init(txnId: String, debtAfter: Money) { self.txnId = txnId; self.debtAfter = debtAfter }
}

public struct SavePlanProgress: Hashable {
    public var plan: SavePlan
    public var saved: Money
    public var remaining: Money
    public var progress: Percent
    public var cards: [SaveCard]
    public var cardSaved: Int
    public var cardTotal: Int
}
