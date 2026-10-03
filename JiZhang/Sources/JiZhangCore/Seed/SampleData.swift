import Foundation

/// 截图基准样本数据
///
/// 本文件把 6 张参考截图里的每一个数字**反向还原为可入库的交易**，
/// 使得聚合层算出来的结果与截图逐项一致（同时充当验收基准 AC-01 ~ AC-12 的数据源）。
///
/// 基准时点：**2024-05-30**（截图日历高亮 30 日、"05/30 星期四"当日明细为当日视图）
/// 关键验算链见需求文档 7.1 / 7.2 / 7.3 / 7.5 / 7.6。
public enum SampleData {

    // MARK: - 基准时点与账户/分类 ID

    public static let now = date(2024, 5, 30, 20, 30)

    public static let ledgerId = "L_DEFAULT"
    public static let accAlipay = "A_ALIPAY"
    public static let accCMB = "A_CMB"
    public static let accFund1 = "A_FUND1"
    public static let accFund2 = "A_FUND2"
    public static let accCITIC = "A_CITIC"
    public static let accBusCard = "A_BUSCARD"
    public static let accOctopus = "A_OCTOPUS"
    public static let accLendOut = "A_LENDOUT"

    public static let catMeal = "C_MEAL"
    public static let catMeal3 = "C_MEAL_3"
    public static let catFruit = "C_MEAL_FRUIT"
    public static let catCoffee = "C_MEAL_COFFEE"
    public static let catVeg = "C_MEAL_VEG"
    public static let catDessert = "C_MEAL_DESSERT"
    public static let catHouse = "C_HOUSE"
    public static let catBeauty = "C_BEAUTY"
    public static let catDigital = "C_DIGITAL"
    public static let catSport = "C_SPORT"
    public static let catTraffic = "C_TRAFFIC"
    public static let catClothes = "C_CLOTHES"
    public static let catSocial = "C_SOCIAL"
    public static let catOther = "C_OTHER"
    public static let catSideJob = "C_SIDEJOB"
    public static let catFundIncome = "C_FUNDINC"
    public static let catBonus = "C_BONUS"
    public static let catRedPacket = "C_REDPACKET"
    public static let catOtherIncome = "C_OTHERINC"
    public static let catSalary = "C_SALARY"
    public static let catRefundIn = "C_REFUNDIN"

    // MARK: - 工具

    static func date(_ y: Int, _ mo: Int, _ d: Int, _ h: Int = 12, _ mi: Int = 0) -> Date {
        var c = DateComponents()
        c.year = y; c.month = mo; c.day = d; c.hour = h; c.minute = mi
        return Calendar.current.date(from: c)!
    }

    private static func addMonths(_ date: Date, _ n: Int) -> Date {
        Calendar.current.date(byAdding: .month, value: n, to: date)!
    }

    // MARK: - 构建

    /// 目标余额（截图资产页）
    private static let targetBalances: [String: Money] = [
        accAlipay: Money(8483.06),
        accCMB: Money(34384.00),
        accFund1: Money(1200.00),
        accFund2: Money(1750.00),
        accBusCard: Money(150.00),
        accOctopus: Money(30.00),
        accLendOut: Money(1000.00)
    ]

    @discardableResult
    public static func build(into repo: Repository) throws -> MetricsEngine {
        let engine = MetricsEngine(repo: repo)

        // 1) 账本
        try repo.insert(Ledger(id: ledgerId, name: "默认账本", symbol: "💡",
                               currency: "CNY", isDefault: true, archived: false, sortOrder: 0))

        // 2) 账户（分组顺序与截图一致：资金 → 信用 → 充值 → 应收）
        let accounts: [Account] = [
            Account(id: accAlipay, ledgerId: ledgerId, name: "支付宝", group: .fund, kind: .alipay,
                    icon: "🅰️", cardNoMask: nil, currency: "CNY", initialBalance: .zero, creditLimit: .zero,
                    billDay: nil, repayDay: nil, groupName: nil, hidden: false, isFamilyCredit: false, sortOrder: 0),
            Account(id: accCMB, ledgerId: ledgerId, name: "招商银行", group: .fund, kind: .debitCard,
                    icon: "🏦", cardNoMask: "622X XXXX XXXX XX88", currency: "CNY", initialBalance: .zero,
                    creditLimit: .zero, billDay: nil, repayDay: nil, groupName: nil, hidden: false,
                    isFamilyCredit: false, sortOrder: 1),
            Account(id: accFund1, ledgerId: ledgerId, name: "公积金", group: .fund, kind: .housingFund,
                    icon: "🐣", cardNoMask: nil, currency: "CNY", initialBalance: .zero, creditLimit: .zero,
                    billDay: nil, repayDay: nil, groupName: nil, hidden: false, isFamilyCredit: false, sortOrder: 2),
            Account(id: accFund2, ledgerId: ledgerId, name: "公积金", group: .fund, kind: .housingFund,
                    icon: "🐥", cardNoMask: nil, currency: "CNY", initialBalance: .zero, creditLimit: .zero,
                    billDay: nil, repayDay: nil, groupName: nil, hidden: false, isFamilyCredit: false, sortOrder: 3),
            Account(id: accCITIC, ledgerId: ledgerId, name: "中信银行", group: .credit, kind: .creditCard,
                    icon: "💳", cardNoMask: "625X XXXX XXXX XX78", currency: "CNY", initialBalance: .zero,
                    creditLimit: Money(20000.00), billDay: 10, repayDay: 28, groupName: nil,
                    hidden: false, isFamilyCredit: false, sortOrder: 4),
            Account(id: accBusCard, ledgerId: ledgerId, name: "北京公交卡", group: .prepaid, kind: .transitCard,
                    icon: "🚌", cardNoMask: nil, currency: "CNY", initialBalance: .zero, creditLimit: .zero,
                    billDay: nil, repayDay: nil, groupName: nil, hidden: false, isFamilyCredit: false, sortOrder: 5),
            Account(id: accOctopus, ledgerId: ledgerId, name: "八达通", group: .prepaid, kind: .octopus,
                    icon: "🚇", cardNoMask: nil, currency: "CNY", initialBalance: .zero, creditLimit: .zero,
                    billDay: nil, repayDay: nil, groupName: nil, hidden: false, isFamilyCredit: false, sortOrder: 6),
            // 截图未显示、由「总资产 46,997.06 − (资金 45,817.06 + 充值 180.00) = 1,000.00」反推
            Account(id: accLendOut, ledgerId: ledgerId, name: "借出-小王", group: .receivable, kind: .other,
                    icon: "🐑", cardNoMask: nil, currency: "CNY", initialBalance: .zero, creditLimit: .zero,
                    billDay: nil, repayDay: nil, groupName: nil, hidden: false, isFamilyCredit: false, sortOrder: 7)
        ]
        for a in accounts { try repo.insert(a) }

        // 3) 分类
        func cat(_ id: String, _ name: String, _ dir: Direction, _ parent: String?, _ color: String,
                 _ icon: String, _ order: Int) -> Category {
            Category(id: id, ledgerId: ledgerId, parentId: parent, name: name, direction: dir,
                     icon: icon, colorHex: color, iconStyle: .mono, isSystem: true, archived: false,
                     hidden: false, sortOrder: order)
        }
        let categories: [Category] = [
            cat(catMeal, "餐饮", .expense, nil, "#F4736A", "🍚", 0),
            cat(catMeal3, "三餐", .expense, catMeal, "#F4736A", "🍜", 0),
            cat(catFruit, "水果", .expense, catMeal, "#F5A623", "🍎", 1),
            cat(catCoffee, "咖啡", .expense, catMeal, "#8B5E3C", "☕", 2),
            cat(catVeg, "蔬菜", .expense, catMeal, "#34C759", "🥬", 3),
            cat(catDessert, "甜品", .expense, catMeal, "#D4537E", "🍰", 4),
            cat(catHouse, "住房", .expense, nil, "#378ADD", "🏠", 1),
            cat(catBeauty, "美妆", .expense, nil, "#ED93B1", "💄", 2),
            cat(catDigital, "数码", .expense, nil, "#7F77DD", "📱", 3),
            cat(catSport, "运动", .expense, nil, "#5DCAA5", "🏸", 4),
            cat(catTraffic, "交通", .expense, nil, "#85B7EB", "🚇", 5),
            cat(catClothes, "服饰", .expense, nil, "#F0997B", "👕", 6),
            cat(catSocial, "社交", .expense, nil, "#EF9F27", "🍻", 7),
            cat(catOther, "其他", .expense, nil, "#B4B2A9", "📦", 8),
            cat(catSideJob, "副业", .income, nil, "#639922", "💼", 0),
            cat(catFundIncome, "公积金", .income, nil, "#1D9E75", "🏛", 1),
            cat(catBonus, "奖金", .income, nil, "#BA7517", "🎁", 2),
            cat(catRedPacket, "红包", .income, nil, "#E24B4A", "🧧", 3),
            cat(catOtherIncome, "其他收入", .income, nil, "#888780", "💰", 4),
            cat(catSalary, "工资", .income, nil, "#2F7CF6", "💵", 5),
            cat(catRefundIn, "退款入账", .income, nil, "#8E8E93", "↩️", 6)
        ]
        for c in categories { try repo.insert(c) }

        // 4) 交易
        var nth = 0
        func tx(_ day: Date, _ account: String, _ to: String?, _ category: String,
                original: Double, discount: Double = 0, refund: Double = 0, fee: Double = 0,
                kind: TxnKind = .expense, flow: FlowType? = nil, note: String = "",
                place: String? = nil, reimb: ReimbursementStatus = .none, exclude: Bool = false,
                refundOf: String? = nil) throws -> String {
            nth += 1
            let id = "T\(String(format: "%03d", nth))"
            let amount = Money(original - discount - refund)
            let t = Txn(id: id, ledgerId: ledgerId, accountId: account, toAccountId: to,
                        categoryId: category, kind: kind, flowType: flow,
                        original: Money(original), discount: Money(discount), fee: Money(fee),
                        refund: Money(refund), amount: amount, occurredAt: day, note: note,
                        locationName: place, reimbursement: reimb, excludeFromStats: exclude,
                        billCycleId: nil, refundOfId: refundOf, tags: [])
            try repo.insert(t)
            return id
        }

        // —— 餐饮：三餐 8 笔 = 441.00（含 5/30 的 45.00 − 优惠 1.00 = 44.00）
        _ = try tx(date(2024, 5, 3), accAlipay, nil, catMeal3, original: 62.00, note: "午餐")
        _ = try tx(date(2024, 5, 7), accAlipay, nil, catMeal3, original: 58.00, note: "午餐")
        _ = try tx(date(2024, 5, 10), accAlipay, nil, catMeal3, original: 55.00, note: "晚餐")
        _ = try tx(date(2024, 5, 12), accAlipay, nil, catMeal3, original: 61.00, note: "午餐")
        _ = try tx(date(2024, 5, 15), accAlipay, nil, catMeal3, original: 54.00, note: "午餐")
        _ = try tx(date(2024, 5, 18), accAlipay, nil, catMeal3, original: 53.00, note: "午餐")
        _ = try tx(date(2024, 5, 22), accAlipay, nil, catMeal3, original: 54.00, note: "午餐", reimb: .pending)
        _ = try tx(date(2024, 5, 30, 16, 3), accAlipay, nil, catMeal3, original: 45.00,
                   discount: 1.00, note: "午餐")
        // —— 水果 4 笔 = 101.00（其中 32.00 待报销）
        _ = try tx(date(2024, 5, 2), accAlipay, nil, catFruit, original: 32.00, reimb: .pending)
        _ = try tx(date(2024, 5, 9), accAlipay, nil, catFruit, original: 23.00)
        _ = try tx(date(2024, 5, 16), accAlipay, nil, catFruit, original: 28.00)
        _ = try tx(date(2024, 5, 20), accAlipay, nil, catFruit, original: 18.00)
        // —— 咖啡 4 笔 = 80.90（5/30 的 9.90 走中信信用卡）
        _ = try tx(date(2024, 5, 4), accAlipay, nil, catCoffee, original: 27.00, note: "咖啡豆")
        _ = try tx(date(2024, 5, 11), accAlipay, nil, catCoffee, original: 22.00, reimb: .pending)
        _ = try tx(date(2024, 5, 19), accAlipay, nil, catCoffee, original: 22.00)
        _ = try tx(date(2024, 5, 30, 20, 9), accCITIC, nil, catCoffee, original: 9.90, note: "咖啡")
        // —— 蔬菜 3 笔 = 79.00
        _ = try tx(date(2024, 5, 6), accAlipay, nil, catVeg, original: 29.00)
        _ = try tx(date(2024, 5, 14), accAlipay, nil, catVeg, original: 27.00)
        _ = try tx(date(2024, 5, 24), accAlipay, nil, catVeg, original: 23.00)
        // —— 甜品 2 笔 = 27.00
        _ = try tx(date(2024, 5, 8), accAlipay, nil, catDessert, original: 15.00)
        _ = try tx(date(2024, 5, 21), accAlipay, nil, catDessert, original: 12.00)

        // —— 住房 667.94（含 5/27 的 150.00，落在统计周内）
        _ = try tx(date(2024, 5, 6), accCMB, nil, catHouse, original: 517.94, note: "房租")
        _ = try tx(date(2024, 5, 27), accCMB, nil, catHouse, original: 150.00, note: "物业费")
        // —— 美妆 349.91（含 5/29 的 42.00）
        _ = try tx(date(2024, 5, 12), accAlipay, nil, catBeauty, original: 307.91)
        _ = try tx(date(2024, 5, 29), accAlipay, nil, catBeauty, original: 42.00, note: "口红")
        // —— 数码 319.87（含 5/28 的 89.00）
        _ = try tx(date(2024, 5, 9), accAlipay, nil, catDigital, original: 230.87, note: "键盘")
        _ = try tx(date(2024, 5, 28), accAlipay, nil, catDigital, original: 89.00, note: "数据线")
        // —— 运动 179.91（5/21 羽毛球 60.00 走中信信用卡）
        _ = try tx(date(2024, 5, 14), accAlipay, nil, catSport, original: 119.91, note: "健身私教")
        _ = try tx(date(2024, 5, 21, 14, 0), accCITIC, nil, catSport, original: 60.00,
                   note: "打羽毛球 🏸", place: "广东奥林匹克体育中心")
        // —— 交通 146.09：5/30 地铁 3.00，优惠 0，退款 2.00 → 实付 1.00
        _ = try tx(date(2024, 5, 13), accAlipay, nil, catTraffic, original: 145.09, note: "打车")
        let metroId = try tx(date(2024, 5, 30, 9, 16), accCITIC, nil, catTraffic, original: 3.00,
                             refund: 2.00, note: "地铁")
        // —— 服饰 / 社交 / 其他
        _ = try tx(date(2024, 5, 17), accAlipay, nil, catClothes, original: 105.00)
        _ = try tx(date(2024, 5, 19), accAlipay, nil, catSocial, original: 105.00, note: "聚餐")
        _ = try tx(date(2024, 5, 20), accAlipay, nil, catOther, original: 313.28)

        // —— 收入（月合计 9,985.06；统计周 5/26–5/31 合计 2,367.00）
        _ = try tx(date(2024, 5, 10, 9, 0), accCMB, nil, catSalary, original: 5000.00,
                   kind: .income, note: "5 月工资")
        _ = try tx(date(2024, 5, 5), accAlipay, nil, catRedPacket, original: 258.06,
                   kind: .income, note: "红包")
        _ = try tx(date(2024, 5, 8), accAlipay, nil, catSideJob, original: 400.00,
                   kind: .income, note: "副业收入")
        _ = try tx(date(2024, 5, 10, 10, 0), accCMB, nil, catFundIncome, original: 960.00,
                   kind: .income, note: "公积金")
        _ = try tx(date(2024, 5, 15), accCMB, nil, catBonus, original: 1000.00,
                   kind: .income, note: "季度奖金")
        _ = try tx(date(2024, 5, 26), accAlipay, nil, catRedPacket, original: 200.00,
                   kind: .income, note: "红包")
        _ = try tx(date(2024, 5, 27), accAlipay, nil, catSideJob, original: 300.00,
                   kind: .income, note: "副业")
        _ = try tx(date(2024, 5, 28, 10, 0), accCMB, nil, catFundIncome, original: 720.00,
                   kind: .income, note: "公积金")
        _ = try tx(date(2024, 5, 28, 15, 0), accCMB, nil, catBonus, original: 500.00,
                   kind: .income, note: "项目奖金")
        _ = try tx(date(2024, 5, 29), accAlipay, nil, catSideJob, original: 300.00,
                   kind: .income, note: "副业")
        _ = try tx(date(2024, 5, 29, 18, 0), accAlipay, nil, catOtherIncome, original: 12.00,
                   kind: .income, note: "其他")
        _ = try tx(date(2024, 5, 30, 16, 41), accAlipay, nil, catSideJob, original: 200.00,
                   kind: .income, note: "副业")
        _ = try tx(date(2024, 5, 31), accAlipay, nil, catRedPacket, original: 135.00,
                   kind: .income, note: "红包")

        // —— 退款入账（中信）：不计入收支统计，仅影响账户与账单「流入」
        _ = try tx(date(2024, 5, 30, 19, 16), accCITIC, nil, catRefundIn, original: 2.00,
                   kind: .refundCredit, note: "地铁", refundOf: metroId)

        // —— 流转：中信上期账单还款 60.00（计入账单「流入」，不冲减本期欠款）
        _ = try tx(date(2024, 5, 12, 11, 0), accAlipay, accCITIC, catRefundIn, original: 60.00,
                   kind: .repay, flow: .repay, note: "上期账单还款", exclude: true)
        // —— 流转：借出给小王 1,000.00（形成应收账户）
        _ = try tx(date(2024, 5, 31, 17, 4), accAlipay, accLendOut, catOther, original: 1000.00,
                   kind: .borrowOut, flow: .borrowOut, note: "小王", exclude: true)

        // 5) 让账户余额精确落到截图数值（初始余额 = 目标余额 − 流水净影响）
        for acc in try repo.accounts(ledgerId: ledgerId) where acc.group != .credit {
            guard let target = targetBalances[acc.id] else { continue }
            let raw = engine.runningBalanceExcludingInitial(accountId: acc.id)
            try repo.updateInitialBalance(accountId: acc.id, target - raw)
        }

        // 6) 预算（总预算 3,000.00，开启结转）
        try repo.insert(Budget(id: "B1", ledgerId: ledgerId, categoryId: nil, period: .monthly,
                               amount: Money(3000.00), carryOver: true,
                               startDate: date(2024, 5, 1, 0, 0)))

        // 7) 信用卡账单周期：2024 年 06 月账单（05/10 - 06/09，未出账）
        try repo.insert(BillCycle(id: "BC1", accountId: accCITIC,
                                  periodStart: date(2024, 5, 10, 0, 0),
                                  periodEnd: date(2024, 6, 10, 0, 0),
                                  statementDate: date(2024, 6, 10, 0, 0),
                                  dueDate: date(2024, 6, 28, 0, 0),
                                  billAmount: nil, paid: .zero, status: .open))

        // 8) 存钱计划
        try repo.insert(SavePlan(id: "P1", ledgerId: ledgerId, name: "提前还房贷", emoji: "💪",
                                 type: .flexible, frequency: .monthly,
                                 startDate: date(2022, 10, 3), endDate: date(2024, 10, 3),
                                 target: Money(500000.00), fromAccountId: accCMB,
                                 toAccountId: nil, archived: false))
        try repo.insert(SaveRecord(id: "SR1", planId: "P1", amount: Money(60000.00),
                                   occurredAt: date(2023, 10, 3), note: "首笔"))
        try repo.insert(SaveRecord(id: "SR2", planId: "P1", amount: Money(40000.00),
                                   occurredAt: date(2024, 5, 1), note: "年终奖结转"))

        try repo.insert(SavePlan(id: "P2", ledgerId: ledgerId, name: "深造基金", emoji: "🌻",
                                 type: .fixed, frequency: .monthly,
                                 startDate: date(2023, 3, 1), endDate: date(2025, 3, 1),
                                 target: Money(24000.00), fromAccountId: accCMB,
                                 toAccountId: nil, archived: false))
        for i in 0..<24 {
            let due = addMonths(date(2023, 3, 1), i)
            try repo.insert(SaveCard(id: "SC\(i + 1)", planId: "P2", seq: i + 1, dueDate: due,
                                     amount: Money(1000.00),
                                     status: i < 15 ? .saved : .pending, txnId: nil))
        }

        // 9) 记账模板（对应小组件「模板记账」4 宫格）
        try repo.insertTemplate(id: "TP1", ledgerId: ledgerId, name: "每日咖啡", emoji: "☕",
                                direction: .expense, amount: Money(9.90), categoryId: catCoffee,
                                accountId: accAlipay, sortOrder: 0)
        try repo.insertTemplate(id: "TP2", ledgerId: ledgerId, name: "公积金", emoji: "🏛",
                                direction: .income, amount: Money(720.00), categoryId: catFundIncome,
                                accountId: accCMB, sortOrder: 1)
        try repo.insertTemplate(id: "TP3", ledgerId: ledgerId, name: "充值公交卡", emoji: "🚌",
                                direction: .expense, amount: Money(50.00), categoryId: catTraffic,
                                accountId: accBusCard, sortOrder: 2)
        try repo.insertTemplate(id: "TP4", ledgerId: ledgerId, name: "蓝莓", emoji: "🫐",
                                direction: .expense, amount: Money(15.80), categoryId: catFruit,
                                accountId: accAlipay, sortOrder: 3)

        // 10) 配置
        try repo.setPreference("day_denominator", DayDenominator.elapsed.rawValue)
        try repo.setPreference("hide_amount", "false")
        try repo.setPreference("appearance", "system")

        return engine
    }
}
