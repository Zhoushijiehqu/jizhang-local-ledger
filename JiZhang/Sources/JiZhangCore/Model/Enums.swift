import Foundation

/// 账户分组（对应截图资产页的「资金账户 / 信用账户 / 充值账户」+ 由总资产差额反推的「应收账户」）
public enum AccountGroup: String, Codable, CaseIterable {
    case fund          // 资金账户：支付宝、储蓄卡、公积金
    case credit        // 信用账户：信用卡
    case prepaid       // 充值账户：公交卡、八达通
    case receivable    // 应收账户：借出（截图未显示，由总资产差额 ¥1,000.00 与「借出 ¥1,000.00 小王」反推）
    case payable       // 应付账户：借入
    case investment    // 投资账户（预留）

    public var displayName: String {
        switch self {
        case .fund: return "资金账户"
        case .credit: return "信用账户"
        case .prepaid: return "充值账户"
        case .receivable: return "应收账户"
        case .payable: return "应付账户"
        case .investment: return "投资账户"
        }
    }

    /// 汇总口径：余额 or 欠款
    public var isLiability: Bool { self == .credit || self == .payable }

    /// 默认展示顺序（截图顺序：资金 → 信用 → 充值）
    public var sortIndex: Int {
        switch self {
        case .fund: return 0
        case .credit: return 1
        case .prepaid: return 2
        case .receivable: return 3
        case .payable: return 4
        case .investment: return 5
        }
    }
}

/// 账户类型（决定图标与副标题）
public enum AccountKind: String, Codable {
    case alipay, wechat, debitCard, creditCard, housingFund, transitCard, octopus
    case cash, savings, current, loan, familyCredit, other

    public var displayName: String {
        switch self {
        case .alipay: return "支付宝"
        case .wechat: return "微信"
        case .debitCard: return "储蓄卡"
        case .creditCard: return "信用卡"
        case .housingFund: return "公积金"
        case .transitCard: return "公交卡"
        case .octopus: return "八达通"
        case .cash: return "现金"
        case .savings: return "存钱"
        case .current: return "活期"
        case .loan: return "贷款"
        case .familyCredit: return "亲情账户"
        case .other: return "其他"
        }
    }
}

/// 交易大类
public enum TxnKind: String, Codable {
    // 存库值必须与 SQL 中的字面量一致，禁止依赖 Swift 的 camelCase 默认值
    case expense = "expense"                  // 支出：账户 −实付
    case income = "income"                    // 收入：账户 +金额
    case refundCredit = "refund_credit"       // 退款入账：账户 +金额，且【不计入收支统计】（见需求 7.1 / 7.5）
    case transfer = "transfer"                // 转账：from → to
    case recharge = "recharge"                 // 充值：from → to（充值账户）
    case repay = "repay"                      // 还款：from → to（信用账户）
    case collect = "collect"                  // 收款：from → to
    case borrowIn = "borrow_in"               // 借入：账户 +金额（同时形成应付）
    case borrowOut = "borrow_out"             // 借出：账户 −金额（同时形成应收）

    public var isStatistic: Bool {
        switch self {
        case .expense, .income: return true
        default: return false
        }
    }
    public var isFlow: Bool {
        switch self {
        case .transfer, .recharge, .repay, .collect, .borrowIn, .borrowOut: return true
        default: return false
        }
    }
    public var direction: TxnDirection {
        switch self {
        case .expense, .borrowOut: return .expense
        case .income, .refundCredit, .borrowIn: return .income
        default: return .expense
        }
    }
}

public enum TxnDirection: String, Codable {
    case expense, income
}

/// 流转六项（对应统计页「流转统计」）
public enum FlowType: String, Codable, CaseIterable {
    case repay      // 还款
    case collect    // 收款
    case transfer   // 转账
    case recharge   // 充值
    case borrowIn   // 借入
    case borrowOut  // 借出

    public var displayName: String {
        switch self {
        case .repay: return "还款"
        case .collect: return "收款"
        case .transfer: return "转账"
        case .recharge: return "充值"
        case .borrowIn: return "借入"
        case .borrowOut: return "借出"
        }
    }
}

public enum ReimbursementStatus: String, Codable {
    case none, pending, done, received

    public var displayName: String {
        switch self {
        case .none: return "无需报销"
        case .pending: return "待报销"
        case .done: return "已报销"
        case .received: return "报销入账"
        }
    }
}

public enum SavePlanType: String, Codable {
    case fixed      // 定额存钱
    case flexible   // 灵活存钱
    public var displayName: String { self == .fixed ? "定额存钱" : "灵活存钱" }
}

public enum SaveFrequency: String, Codable {
    case daily, weekly, monthly
    public var displayName: String {
        switch self {
        case .daily: return "每日"
        case .weekly: return "每周"
        case .monthly: return "每月"
        }
    }
}

public enum SaveCardStatus: String, Codable {
    case pending, saved
}

public enum BillCycleStatus: String, Codable {
    case open       // 未出账
    case issued     // 已出账
    case settled    // 已结清
    public var displayName: String {
        switch self {
        case .open: return "未出账"
        case .issued: return "已出账"
        case .settled: return "已结清"
        }
    }
}

public enum LedgerScope: String, Codable {
    case ledger, category, account
}

public enum BudgetPeriod: String, Codable {
    case monthly, weekly
}

public enum Direction: String, Codable, CaseIterable {
    case expense, income
    public var displayName: String { self == .expense ? "支出" : "收入" }
}

/// 日均分母口径（Q-03 决策：分口径，默认「已过天数」）
public enum DayDenominator: String, Codable, CaseIterable {
    case natural    // 自然日：全周期天数
    case elapsed    // 已过天数：周期起始至今天（含今天）—— 默认，截图验算成立
    case spending   // 有消费天数

    public var displayName: String {
        switch self {
        case .natural: return "自然日"
        case .elapsed: return "已过天数"
        case .spending: return "有消费天数"
        }
    }
}

/// 分类图标样式（FR-EXT-07 / FR-EXT-25）
public enum CategoryIconStyle: String, Codable {
    case mono       // 单色
    case colored    // 彩色图标
    case followPie  // 跟随饼图配色
    case custom     // 自定义配色
}

/// 报表周期
public struct DateRange: Hashable {
    public var start: Date
    public var end: Date
    public init(start: Date, end: Date) { self.start = start; self.end = end }
}
