import Foundation

/// 唯一聚合层（Single Source of Truth）
///
/// 需求 12.2 的共性结论：历史缺陷三成以上源于"同一指标被多处重复实现"。
/// 因此 App、搜索面板、批量选择、小组件**必须**共用本类的实现，禁止各自相减。
public final class MetricsEngine {
    public let repo: Repository
    private let db: Database
    public var calendar: Calendar

    public init(repo: Repository, calendar: Calendar = .current) {
        self.repo = repo
        self.db = repo.db
        self.calendar = calendar
    }

    // MARK: - 账户余额

    /// 账户显示余额（唯一实现）
    /// - 资金/充值/应收类：初始余额 + Σ 流水影响
    /// - 信用/应付类：显示为负（−当前欠款），欠款口径见 7.5
    public func accountBalance(_ account: Account) throws -> Money {
        if account.group == .credit {
            let snap = try creditCardSnapshot(accountId: account.id)
            return -snap.currentDebt
        }
        if account.group == .payable {
            return -runningBalance(accountId: account.id, initial: account.initialBalance).abs
        }
        return runningBalance(accountId: account.id, initial: account.initialBalance)
    }

    /// 流水对账户余额的净影响（不含初始余额），供种子数据反推初始值
    public func runningBalanceExcludingInitial(accountId: String) -> Money {
        runningBalance(accountId: accountId, initial: .zero)
    }

    private func runningBalance(accountId: String, initial: Money) -> Money {
        // 流入信用/应付账户的还款与转入不改变"欠款展示"，故不计入其现金余额口径
        let sql = """
            SELECT COALESCE(SUM(CASE
                WHEN account_id = ? THEN
                    CASE kind WHEN 'expense' THEN -amount_cents
                              WHEN 'transfer' THEN -amount_cents
                              WHEN 'recharge' THEN -amount_cents
                              WHEN 'repay' THEN -amount_cents
                              WHEN 'collect' THEN -amount_cents
                              WHEN 'borrow_out' THEN -amount_cents
                              ELSE amount_cents END
                ELSE 0 END), 0) AS v
            FROM txn WHERE deleted_at IS NULL AND account_id = ?;
            """
        let out = (try? db.scalarMoney(sql, [.text(accountId), .text(accountId)])) ?? .zero
        let sqlIn = """
            SELECT COALESCE(SUM(CASE WHEN kind IN ('transfer','recharge','collect') THEN amount_cents ELSE 0 END),0) AS v
            FROM txn WHERE deleted_at IS NULL AND to_account_id = ?;
            """
        let inflow = (try? db.scalarMoney(sqlIn, [.text(accountId)])) ?? .zero
        return initial + out + inflow
    }

    // MARK: - 资产总览（7.2）

    public func assetsSnapshot(ledgerId: String) throws -> AssetsSnapshot {
        let accounts = try repo.accounts(ledgerId: ledgerId)
        var assets = Money.zero
        var liabilities = Money.zero
        var byGroup: [AccountGroup: Money] = [:]
        var counts: [AccountGroup: Int] = [:]

        for a in accounts where !a.hidden {
            let bal = try accountBalance(a)
            if a.group.isLiability {
                liabilities = liabilities + bal.abs
                byGroup[a.group] = (byGroup[a.group] ?? .zero) + bal.abs
            } else {
                assets = assets + bal
                byGroup[a.group] = (byGroup[a.group] ?? .zero) + bal
            }
            counts[a.group, default: 0] += 1
        }
        return AssetsSnapshot(totalAssets: assets, totalLiabilities: liabilities,
                              netWorth: assets - liabilities, byGroup: byGroup, accountCount: counts)
    }

    /// 按组列出账户（含余额），顺序同截图：资金 → 信用 → 充值 → 应收
    public func accountsByGroup(ledgerId: String) throws -> [(AccountGroup, [Account])] {
        let accounts = try repo.accounts(ledgerId: ledgerId).filter { !$0.hidden }
        let grouped = Dictionary(grouping: accounts, by: { $0.group })
        return grouped.keys.sorted { $0.sortIndex < $1.sortIndex }
            .map { ($0, grouped[$0]!.sorted { $0.sortOrder < $1.sortOrder }) }
    }

    // MARK: - 周期汇总（7.3）

    public func periodSummary(ledgerId: String, range: DateRange,
                              denominator: DayDenominator = .elapsed,
                              now: Date = Date()) throws -> PeriodSummary {
        let s = range.start.timeIntervalSince1970
        let e = range.end.timeIntervalSince1970
        let p: [SQLValue] = [.text(ledgerId), .real(s), .real(e)]

        let expense = try db.scalarMoney("""
            SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
            WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense'
              AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;
            """, p)
        let income = try db.scalarMoney("""
            SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
            WHERE deleted_at IS NULL AND ledger_id=? AND kind='income'
              AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;
            """, p)
        let discount = try db.scalarMoney("""
            SELECT COALESCE(SUM(discount_cents),0) AS v FROM txn
            WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense' AND occurred_at>=? AND occurred_at<?;
            """, p)
        let refund = try db.scalarMoney("""
            SELECT COALESCE(SUM(refund_cents),0) AS v FROM txn
            WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense' AND occurred_at>=? AND occurred_at<?;
            """, p)
        let fee = try db.scalarMoney("""
            SELECT COALESCE(SUM(fee_cents),0) AS v FROM txn
            WHERE deleted_at IS NULL AND ledger_id=? AND kind IN ('expense','income') AND occurred_at>=? AND occurred_at<?;
            """, p)
        let refundIncome = try db.scalarMoney("""
            SELECT COALESCE(SUM(t.amount_cents),0) AS v FROM txn t
            JOIN category c ON c.id = t.category_id
            WHERE t.deleted_at IS NULL AND t.ledger_id=? AND t.kind='refund_credit'
              AND c.direction='income' AND t.occurred_at>=? AND t.occurred_at<?;
            """, p)

        let pending = try db.scalarMoney("""
            SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
            WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense'
              AND reimbursement_status='pending' AND occurred_at>=? AND occurred_at<?;
            """, p)
        let done = try db.scalarMoney("""
            SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
            WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense'
              AND reimbursement_status='done' AND occurred_at>=? AND occurred_at<?;
            """, p)
        let received = try db.scalarMoney("""
            SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
            WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense'
              AND reimbursement_status='received' AND occurred_at>=? AND occurred_at<?;
            """, p)

        var flows: [(FlowType, Money)] = []
        for f in FlowType.allCases {
            let m = try db.scalarMoney("""
                SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
                WHERE deleted_at IS NULL AND ledger_id=? AND flow_type=? AND occurred_at>=? AND occurred_at<?;
                """, [.text(ledgerId), .text(f.rawValue), .real(s), .real(e)])
            flows.append((f, m))
        }

        let days = try denominatorDays(ledgerId: ledgerId, range: range, denominator: denominator, now: now)
        let d = Int64(max(days, 1))
        let dailyExpense = Money(cents: expense.cents / d)
        let dailyIncome = Money(cents: income.cents / d)
        let bal = income - expense

        return PeriodSummary(
            range: range,
            expense: expense, income: income, balance: bal,
            refund: refund, refundIncome: refundIncome, discount: discount, fee: fee,
            pendingReimbursement: pending, doneReimbursement: done,
            reimbursementReceived: received, reimbursementIncome: .zero,
            flows: flows,
            denominatorDays: days,
            dailyExpense: dailyExpense, dailyIncome: dailyIncome,
            dailyBalance: Money(cents: bal.cents / d),
            averageExpense: dailyExpense
        )
    }

    /// 日均分母（Q-03：分口径，默认 elapsed）
    public func denominatorDays(ledgerId: String, range: DateRange,
                                denominator: DayDenominator, now: Date) throws -> Int {
        switch denominator {
        case .natural:
            return calendar.dateComponents([.day], from: calendar.startOfDay(for: range.start),
                                           to: calendar.startOfDay(for: range.end)).day ?? 1
        case .elapsed:
            let end = min(now, range.end)
            if end < range.start { return 1 }
            let days = (calendar.dateComponents([.day],
                                                from: calendar.startOfDay(for: range.start),
                                                to: calendar.startOfDay(for: end)).day ?? 0) + 1
            return max(days, 1)
        case .spending:
            let sql = """
                SELECT COUNT(DISTINCT date(occurred_at,'unixepoch','localtime')) AS v FROM txn
                WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense'
                  AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;
                """
            let n = try db.scalarInt(sql, [.text(ledgerId), .real(range.start.timeIntervalSince1970),
                                           .real(range.end.timeIntervalSince1970)])
            return max(Int(n), 1)
        }
    }

    // MARK: - 分类占比（7.2 / FR-LED-03）

    /// 分类占比：返回"一级分类（含子级汇总）+ 二级分类"两个层级
    /// - 一级：percentOfTotal = 该一级 ÷ 全部分类合计（环形图引线，如「餐饮 25.00%」）
    /// - 二级：percentOfParent = 该二级 ÷ 其父类（如「三餐 60.50%」）
    public func categoryBreakdown(ledgerId: String, range: DateRange, direction: Direction) throws -> [CategorySlice] {
        let kind = (direction == .expense) ? "expense" : "income"
        let sql = """
            SELECT COALESCE(c.id,'uncategorized') AS cid,
                   SUM(t.amount_cents) AS amt, COUNT(*) AS cnt
            FROM txn t LEFT JOIN category c ON c.id = t.category_id
            WHERE t.deleted_at IS NULL AND t.ledger_id=? AND t.kind=?
              AND t.exclude_from_stats=0 AND t.occurred_at>=? AND t.occurred_at<?
            GROUP BY cid;
            """
        let raw = try db.query(sql, [.text(ledgerId), .text(kind),
                                     .real(range.start.timeIntervalSince1970),
                                     .real(range.end.timeIntervalSince1970)]) { r -> (String, Money, Int) in
            (r.text("cid"), r.money("amt"), Int(r.int("cnt")))
        }
        let cats = try repo.categories(ledgerId: ledgerId, direction: direction)
        let byId = Dictionary(uniqueKeysWithValues: cats.map { ($0.id, $0) })
        let topLevel = cats.filter { $0.isTopLevel }

        var own: [String: (Money, Int)] = [:]
        for r in raw { own[r.0] = (r.1, r.2) }

        // 一级分类：自身 + 全部子级汇总
        var topSlices: [CategorySlice] = []
        for c in topLevel {
            let children = cats.filter { $0.parentId == c.id }
            var amount = own[c.id]?.0 ?? .zero
            var count = own[c.id]?.1 ?? 0
            for ch in children {
                amount = amount + (own[ch.id]?.0 ?? .zero)
                count += own[ch.id]?.1 ?? 0
            }
            guard amount != .zero || count > 0 else { continue }
            topSlices.append(CategorySlice(categoryId: c.id, name: c.name, icon: c.icon,
                                           colorHex: c.colorHex, amount: amount, count: count,
                                           parentId: nil, percentOfTotal: Percent(0), percentOfParent: nil))
        }
        topSlices.sort { $0.amount > $1.amount }
        let total = Money.sum(topSlices.map { $0.amount })

        // 二级分类：仅返回有数据的
        var childSlices: [CategorySlice] = []
        for parent in topSlices {
            let children = cats.filter { $0.parentId == parent.categoryId }
            var subs: [CategorySlice] = []
            for ch in children {
                guard let o = own[ch.id], o.1 > 0 else { continue }
                subs.append(CategorySlice(categoryId: ch.id, name: ch.name, icon: ch.icon,
                                          colorHex: ch.colorHex, amount: o.0, count: o.1,
                                          parentId: parent.categoryId, percentOfTotal: Percent(0),
                                          percentOfParent: Percent.ratio(part: o.0, total: parent.amount)))
            }
            subs.sort { $0.amount > $1.amount }
            childSlices.append(contentsOf: subs)
        }

        let parentAmountById = Dictionary(uniqueKeysWithValues: topSlices.map { ($0.categoryId, $0.amount) })
        return topSlices.map { s in
            var s = s
            s.percentOfTotal = Percent.ratio(part: s.amount, total: total)
            return s
        } + childSlices.map { s in
            var s = s
            if let pa = parentAmountById[s.parentId ?? ""] {
                s.percentOfParent = Percent.ratio(part: s.amount, total: pa)
            }
            s.percentOfTotal = Percent.ratio(part: s.amount, total: total)
            return s
        }
    }

    // MARK: - 日历（FR-LED-05 / FR-EXT-19）

    public func dayStat(ledgerId: String, day: Date) throws -> DayStat {
        let start = calendar.startOfDay(for: day)
        let end = calendar.date(byAdding: .day, value: 1, to: start)!
        let p: [SQLValue] = [.text(ledgerId), .real(start.timeIntervalSince1970), .real(end.timeIntervalSince1970)]
        let exp = try db.scalarMoney("SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense' AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;", p)
        let inc = try db.scalarMoney("SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn WHERE deleted_at IS NULL AND ledger_id=? AND kind='income' AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;", p)
        let cnt = try db.scalarInt("SELECT COUNT(*) AS v FROM txn WHERE deleted_at IS NULL AND ledger_id=? AND kind IN ('expense','income') AND occurred_at>=? AND occurred_at<?;", p)
        return DayStat(date: start, expense: exp, income: inc, txnCount: Int(cnt))
    }

    /// 整月日历（一次性聚合，禁止逐日 N+1 查询 —— FX-032）
    public func monthCalendar(ledgerId: String, month: Date) throws -> [DayStat] {
        let comps = calendar.dateComponents([.year, .month], from: month)
        let first = calendar.date(from: comps)!
        let next = calendar.date(byAdding: .month, value: 1, to: first)!
        let sql = """
            SELECT date(occurred_at,'unixepoch','localtime') AS d,
                   SUM(CASE WHEN kind='expense' AND exclude_from_stats=0 THEN amount_cents ELSE 0 END) AS exp,
                   SUM(CASE WHEN kind='income' AND exclude_from_stats=0 THEN amount_cents ELSE 0 END) AS inc,
                   COUNT(*) AS cnt
            FROM txn WHERE deleted_at IS NULL AND ledger_id=? AND kind IN ('expense','income')
              AND occurred_at>=? AND occurred_at<?
            GROUP BY d;
            """
        let rows = try db.query(sql, [.text(ledgerId),
                                      .real(first.timeIntervalSince1970),
                                      .real(next.timeIntervalSince1970)]) { r -> (String, DayStat) in
            (r.text("d"), DayStat(date: first, expense: r.money("exp"), income: r.money("inc"), txnCount: Int(r.int("cnt"))))
        }
        let map = Dictionary(uniqueKeysWithValues: rows.map { ($0.0, $0.1) })
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        fmt.timeZone = calendar.timeZone
        var out: [DayStat] = []
        var cur = first
        while cur < next {
            let key = fmt.string(from: cur)
            if let s = map[key] {
                out.append(DayStat(date: calendar.startOfDay(for: cur), expense: s.expense, income: s.income, txnCount: s.txnCount))
            } else {
                out.append(DayStat(date: calendar.startOfDay(for: cur), expense: .zero, income: .zero, txnCount: 0))
            }
            cur = calendar.date(byAdding: .day, value: 1, to: cur)!
        }
        return out
    }

    /// 周期内逐日（用于统计页图表与汇总表）
    public func dailySeries(ledgerId: String, range: DateRange) throws -> [DayStat] {
        var out: [DayStat] = []
        var cur = calendar.startOfDay(for: range.start)
        while cur < range.end {
            out.append(try dayStat(ledgerId: ledgerId, day: cur))
            cur = calendar.date(byAdding: .day, value: 1, to: cur)!
        }
        return out
    }

    // MARK: - 信用卡（7.5）

    public func creditCardSnapshot(accountId: String, requireCycle: Bool = false) throws -> CreditCardSnapshot {
        let account = try repo.accounts().first { $0.id == accountId }
        guard let account = account else {
            return CreditCardSnapshot(accountId: accountId, currentDebt: .zero, creditLimit: .zero,
                                      availableCredit: .zero, cycleOutflow: .zero, cycleInflow: .zero,
                                      cycle: nil, runningDebt: [])
        }
        let cycles = try repo.billCycles(accountId: accountId)
        let cycle = cycles.first { $0.status == .open } ?? cycles.first

        guard let c = cycle else {
            let allTxns = try db.query("SELECT * FROM txn WHERE deleted_at IS NULL AND account_id=? ORDER BY occurred_at;",
                                       [.text(accountId)]) { r in
                (r.text("id"), r.text("kind"), r.money("original_cents"), r.money("amount_cents"), r.money("refund_cents"))
            }
            return CreditCardSnapshot(accountId: accountId, currentDebt: .zero, creditLimit: account.creditLimit,
                                      availableCredit: account.creditLimit, cycleOutflow: .zero,
                                      cycleInflow: .zero, cycle: nil,
                                      runningDebt: allTxns.map { RunningDebt(txnId: $0.0, debtAfter: .zero) })
        }

        let p: [SQLValue] = [.text(accountId), .real(c.periodStart.timeIntervalSince1970),
                             .real(c.periodEnd.timeIntervalSince1970)]
        // 流出按【原价】计算（截图验算：9.90 + 3.00 + 60.00 = 72.90）
        let outflow = try db.scalarMoney("""
            SELECT COALESCE(SUM(original_cents),0) AS v FROM txn
            WHERE deleted_at IS NULL AND account_id=? AND kind='expense' AND occurred_at>=? AND occurred_at<?;
            """, p)
        let refundIn = try db.scalarMoney("""
            SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
            WHERE deleted_at IS NULL AND account_id=? AND kind='refund_credit' AND occurred_at>=? AND occurred_at<?;
            """, p)
        let repayIn = try db.scalarMoney("""
            SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
            WHERE deleted_at IS NULL AND to_account_id=? AND kind IN ('repay','transfer','recharge') AND occurred_at>=? AND occurred_at<?;
            """, p)
        let debt = outflow - refundIn

        // 逐笔欠款：支出按原价累计，退款入账冲减，还款不计入（对应截图 60.00 → 63.00 → 61.00 → 70.90）
        let items = try db.query("""
            SELECT id, kind, original_cents, amount_cents FROM txn
            WHERE deleted_at IS NULL AND account_id=? AND occurred_at>=? AND occurred_at<?
            ORDER BY occurred_at;
            """, p) { r -> (String, String, Money, Money) in
            (r.text("id"), r.text("kind"), r.money("original_cents"), r.money("amount_cents"))
        }
        var run = Money.zero
        var running: [RunningDebt] = []
        for it in items {
            if it.1 == "expense" { run = run + it.2 }
            else if it.1 == "refund_credit" { run = run - it.3 }
            running.append(RunningDebt(txnId: it.0, debtAfter: run))
        }

        return CreditCardSnapshot(accountId: accountId, currentDebt: debt,
                                  creditLimit: account.creditLimit,
                                  availableCredit: account.creditLimit - debt,
                                  cycleOutflow: outflow, cycleInflow: refundIn + repayIn,
                                  cycle: c, runningDebt: running)
    }

    // MARK: - 存钱计划（7.6）

    public func savePlanProgress(planId: String) throws -> SavePlanProgress {
        guard let plan = allSavePlans().first(where: { $0.id == planId }) else {
            fatalError("plan not found: \(planId)")
        }
        let cards = try repo.saveCards(planId: planId)
        let records = try repo.saveRecords(planId: planId)
        let saved = Money.sum(cards.filter { $0.status == .saved }.map { $0.amount })
            + Money.sum(records.map { $0.amount })
        return SavePlanProgress(plan: plan, saved: saved, remaining: plan.target - saved,
                                progress: Percent.ratio(part: saved, total: plan.target),
                                cards: cards, cardSaved: cards.filter { $0.status == .saved }.count,
                                cardTotal: cards.count)
    }

    public func allSavePlans() -> [SavePlan] {
        (try? db.query("SELECT * FROM save_plan WHERE archived=0 ORDER BY start_date;", []) { r in
            SavePlan(id: r.text("id"), ledgerId: r.text("ledger_id"), name: r.text("name"),
                     emoji: r.text("emoji"),
                     type: SavePlanType(rawValue: r.text("plan_type")) ?? .flexible,
                     frequency: SaveFrequency(rawValue: r.text("frequency")) ?? .monthly,
                     startDate: r.date("start_date"), endDate: r.date("end_date"),
                     target: r.money("target_cents"), fromAccountId: r.textOpt("from_account_id"),
                     toAccountId: r.textOpt("to_account_id"), archived: r.bool("archived"))
        }) ?? []
    }

    // MARK: - 预算（FR-LED-01 / FR-EXT-02）

    public func budgetSnapshot(ledgerId: String, month: Date, now: Date = Date()) throws -> (total: Money, used: Money, remaining: Money, remainingDaily: Money, carryOver: Money) {
        let budget = try repo.totalBudget(ledgerId: ledgerId)
        let total = budget?.amount ?? .zero
        let range = monthRange(containing: month)
        let used = try db.scalarMoney("""
            SELECT COALESCE(SUM(amount_cents),0) AS v FROM txn
            WHERE deleted_at IS NULL AND ledger_id=? AND kind='expense'
              AND exclude_from_stats=0 AND occurred_at>=? AND occurred_at<?;
            """, [.text(ledgerId), .real(range.start.timeIntervalSince1970), .real(range.end.timeIntervalSince1970)])
        let remaining = total - used
        // 剩余日均 = 剩余预算 ÷ 剩余天数（不含今天）—— 截图验算：84.10 ÷ 1（仅剩 5/31）= 84.10 ✔
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))!
        let daysLeft = max(calendar.dateComponents([.day], from: tomorrow,
                                                   to: calendar.startOfDay(for: range.end)).day ?? 1, 1)
        return (total, used, remaining, Money(cents: remaining.cents / Int64(daysLeft)),
                Money(cents: 0))
    }

    // MARK: - 日期工具

    public func monthRange(containing date: Date) -> DateRange {
        let comps = calendar.dateComponents([.year, .month], from: date)
        let start = calendar.date(from: comps)!
        return DateRange(start: start, end: calendar.date(byAdding: .month, value: 1, to: start)!)
    }

    /// 周日至周六的周区间（统计页「按周统计」）
    public func weekRange(containing date: Date) -> DateRange {
        var cal = calendar
        cal.firstWeekday = 1
        let start = cal.dateInterval(of: .weekOfYear, for: date)!.start
        return DateRange(start: start, end: cal.date(byAdding: .day, value: 7, to: start)!)
    }

    public func dayRange(_ date: Date) -> DateRange {
        let start = calendar.startOfDay(for: date)
        return DateRange(start: start, end: calendar.date(byAdding: .day, value: 1, to: start)!)
    }
}
