import Foundation
import JiZhangCore

// 内核验收：以 6 张截图的数值为基准，逐项校验聚合层输出
// 运行： swift run jizhang-verify

var pass = 0
var fail = 0

func check(_ label: String, _ actual: Money, _ expected: Double) {
    let exp = Money(expected)
    if actual == exp { pass += 1; print("  ✅ \(label)：\(actual.formatted)") }
    else { fail += 1; print("  ❌ \(label)：实际 \(actual.formatted) ≠ 期望 \(Money(expected).formatted)") }
}

func checkInt(_ label: String, _ actual: Int, _ expected: Int) {
    if actual == expected { pass += 1; print("  ✅ \(label)：\(actual)") }
    else { fail += 1; print("  ❌ \(label)：实际 \(actual) ≠ 期望 \(expected)") }
}

func checkPercent(_ label: String, _ actual: Percent, _ expectedPercent: Double, tolerance: Double = 0.005) {
    if abs(actual.ratio * 100 - expectedPercent) <= tolerance {
        pass += 1; print("  ✅ \(label)：\(actual.display)")
    } else {
        fail += 1
        print("  ❌ \(label)：实际 \(actual.display) ≠ 期望 \(String(format: "%.2f%%", expectedPercent))")
    }
}

func checkString(_ label: String, _ actual: String, _ expected: String) {
    if actual == expected { pass += 1; print("  ✅ \(label)：\(actual)") }
    else { fail += 1; print("  ❌ \(label)：实际 \(actual) ≠ 期望 \(expected)") }
}

func section(_ t: String) { print("\n【\(t)】") }

// MARK: - 建库

print("══════════════════════════════════════════════════")
print(" 记账 · 内核验收（基准时点 2024-05-30，数据源：6 张参考截图）")
print("══════════════════════════════════════════════════")

let db = try Database(memory: true)
let repo = try Repository(db: db)
let engine = try SampleData.build(into: repo)
let now = SampleData.now
let ledgerId = SampleData.ledgerId

// MARK: - AC-01 账本页四指标

section("AC-01 账本页 · 总支出 / 总收入 / 结余")
let month = engine.monthRange(containing: now)
let monthSummary = try engine.periodSummary(ledgerId: ledgerId, range: month,
                                            denominator: .elapsed, now: now)
check("总支出", monthSummary.expense, 2915.90)
check("总收入", monthSummary.income, 9985.06)
check("结余", monthSummary.balance, 7069.16)

section("AC-02 账本页 · 预算卡")
let budget = try engine.budgetSnapshot(ledgerId: ledgerId, month: now, now: now)
check("总预算", budget.total, 3000.00)
check("剩余预算", budget.remaining, 84.10)
check("剩余日均（剩余天数不含今天：仅 5/31）", budget.remainingDaily, 84.10)

section("AC-03 / AC-04 资产页 · 净资产与分组")
let assets = try engine.assetsSnapshot(ledgerId: ledgerId)
check("总资产", assets.totalAssets, 46997.06)
check("总负债", assets.totalLiabilities, 70.90)
check("净资产", assets.netWorth, 46926.16)
check("资金账户余额合计", assets.byGroup[.fund] ?? .zero, 45817.06)
checkInt("资金账户数量", assets.accountCount[.fund] ?? 0, 4)
check("信用账户欠款", assets.byGroup[.credit] ?? .zero, 70.90)
checkInt("信用账户数量", assets.accountCount[.credit] ?? 0, 1)
check("充值账户余额合计", assets.byGroup[.prepaid] ?? .zero, 180.00)
checkInt("充值账户数量", assets.accountCount[.prepaid] ?? 0, 2)
check("应收账户余额（截图未拍到，由总资产差额反推）", assets.byGroup[.receivable] ?? .zero, 1000.00)

section("AC-05 / AC-06 信用卡详情与账单周期")
let card = try engine.creditCardSnapshot(accountId: SampleData.accCITIC)
check("当前欠款", card.currentDebt, 70.90)
check("可用额度", card.availableCredit, 19929.10)
check("账单周期流出（按原价）", card.cycleOutflow, 72.90)
check("账单周期流入（退款入账 2.00 + 还款 60.00）", card.cycleInflow, 62.00)
checkString("账单状态", card.cycle?.status.displayName ?? "-", "未出账")
let running = card.runningDebt.map { $0.debtAfter }
print("    逐笔欠款序列：\(running.map { $0.formatted }.joined(separator: " → "))")
if running.count == 4, running[0] == Money(60.00), running[1] == Money(63.00),
   running[2] == Money(61.00), running[3] == Money(70.90) {
    pass += 1; print("  ✅ 逐笔欠款 60.00 → 63.00 → 61.00 → 70.90")
} else { fail += 1; print("  ❌ 逐笔欠款序列不符") }

// MARK: - AC-07 统计页按周

section("AC-07 统计页 · 按周统计（2024-05-26 ~ 06-01，周日为起点）")
let week = engine.weekRange(containing: now)
let weekSummary = try engine.periodSummary(ledgerId: ledgerId, range: week,
                                           denominator: .elapsed, now: now)
check("周期支出", weekSummary.expense, 335.90)
check("周期收入", weekSummary.income, 2367.00)
check("周期结余", weekSummary.balance, 2031.10)
checkInt("日均分母天数（已过天数口径）", weekSummary.denominatorDays, 5)
check("日均支出", weekSummary.dailyExpense, 67.18)
check("日均收入", weekSummary.dailyIncome, 473.40)
check("日均结余", weekSummary.dailyBalance, 406.22)
check("退款", weekSummary.refund, 2.00)
check("优惠", weekSummary.discount, 1.00)
check("手续费", weekSummary.fee, 0.00)
var flowMap: [FlowType: Money] = [:]
for f in weekSummary.flows { flowMap[f.0] = f.1 }
check("流转·转账", flowMap[.transfer] ?? .zero, 0.00)
check("流转·借出", flowMap[.borrowOut] ?? .zero, 1000.00)

section("AC-08 统计页 · 收入分类详情（周期内）")
let incomeSlices = try engine.categoryBreakdown(ledgerId: ledgerId, range: week, direction: .income)
let incomeTotal = Money.sum(incomeSlices.map { $0.amount })
check("总收入", incomeTotal, 2367.00)
for s in incomeSlices {
    print("    \(s.name)：\(s.amount.formatted)　\(s.percentOfTotal.display)　\(s.count) 笔")
}
if let sideJob = incomeSlices.first(where: { $0.name == "副业" }) {
    checkPercent("副业占比", sideJob.percentOfTotal, 33.80)
}
if let fund = incomeSlices.first(where: { $0.name == "公积金" }) {
    checkPercent("公积金占比", fund.percentOfTotal, 30.42)
}
if let bonus = incomeSlices.first(where: { $0.name == "奖金" }) {
    checkPercent("奖金占比", bonus.percentOfTotal, 21.12)
}
if let red = incomeSlices.first(where: { $0.name == "红包" }) {
    checkPercent("红包占比", red.percentOfTotal, 14.15)
}

// MARK: - AC-09 周账单汇总表

section("AC-09 周账单汇总表（日期 / 支出 / 收入 / 结余）")
let series = try engine.dailySeries(ledgerId: ledgerId, range: week)
checkInt("汇总表行数（周日~周六）", series.count, 7)
let fmt = DateFormatter(); fmt.dateFormat = "MM/dd EEE"
for d in series {
    print("    \(fmt.string(from: d.date))　支出 \(d.expense.formatted)　收入 \(d.income.formatted)　结余 \(d.balance.formatted)")
}
if let thursday = series.first(where: { Calendar.current.component(.weekday, from: $0.date) == 5 }) {
    check("周四支出（05/30）", thursday.expense, 54.90)
    check("周四收入（05/30）", thursday.income, 200.00)
    check("周四结余", thursday.balance, 145.10)
}
check("逐日支出合计", Money.sum(series.map { $0.expense }), 335.90)
check("逐日收入合计", Money.sum(series.map { $0.income }), 2367.00)

// MARK: - AC-11 当日明细

section("AC-11 账本页 · 05/30 当日明细")
let day = try engine.dayStat(ledgerId: ledgerId, day: now)
check("当日支出", day.expense, 54.90)
check("当日收入", day.income, 200.00)
let dayTxns = try repo.txns(ledgerId: ledgerId,
                            from: engine.dayRange(now).start, to: engine.dayRange(now).end)
    .sorted { $0.occurredAt > $1.occurredAt }
for t in dayTxns where t.kind == .expense {
    print("    \(t.occurredAt.formatted(date: .omitted, time: .shortened))　原价 \(t.original.formatted)" +
          "　优惠 \(t.discount.formatted)　退款 \(t.refund.formatted)　实付 \(t.amount.formatted)")
}
check("当日 3 笔实付合计", Money.sum(dayTxns.filter { $0.kind == .expense }.map { $0.amount }), 54.90)

// MARK: - AC-12 分类占比

section("AC-12 账本页 · 分类占比（月度）")
let slices = try engine.categoryBreakdown(ledgerId: ledgerId, range: month, direction: .expense)
for s in slices {
    print("    \(s.name)：\(s.amount.formatted)　占全部 \(s.percentOfTotal.display)　\(s.count) 笔")
}
let meal = slices.first { $0.name == "餐饮" }
check("餐饮金额", meal?.amount ?? .zero, 728.90)
checkInt("餐饮笔数", meal?.count ?? 0, 21)
if let m = meal { checkPercent("餐饮占全部", m.percentOfTotal, 25.00) }
let meal3 = slices.first { $0.name == "三餐" }
check("三餐金额", meal3?.amount ?? .zero, 441.00)
checkInt("三餐笔数", meal3?.count ?? 0, 8)
if let m3 = meal3, let p = m3.percentOfParent { checkPercent("三餐占父类（餐饮）", p, 60.50) }
check("分类金额合计", Money.sum(slices.filter { $0.parentId == nil }.map { $0.amount }), 2915.90)

// MARK: - AC-10 存钱计划

section("AC-10 存钱页 · 计划进度")
let plans = engine.allSavePlans().sorted { $0.name < $1.name }
for p in plans {
    let prog = try engine.savePlanProgress(planId: p.id)
    print("    \(p.name)\(p.emoji) [\(p.type.displayName)] 目标 \(p.target.formatted)　已存 \(prog.saved.formatted)　剩余未存 \(prog.remaining.formatted)　\(prog.progress.display)")
    if p.id == "P1" {
        check("提前还房贷 已存", prog.saved, 100000.00)
        check("提前还房贷 剩余未存", prog.remaining, 400000.00)
        checkPercent("提前还房贷 进度", prog.progress, 20.00)
    }
    if p.id == "P2" {
        check("深造基金 已存", prog.saved, 15000.00)
        check("深造基金 剩余未存", prog.remaining, 9000.00)
        checkPercent("深造基金 进度", prog.progress, 62.50)
        checkInt("存钱卡片总数（24 期）", prog.cardTotal, 24)
        checkInt("已存卡片数", prog.cardSaved, 15)
    }
}

// MARK: - 额外口径校验

section("补充校验 · 口径一致性（对应 AC-13 / AC-19）")
let cardTxns = try repo.txns(ledgerId: ledgerId, accountId: SampleData.accCITIC)
checkInt("中信卡流水笔数（含退款入账与还款）", cardTxns.count, 5)
check("账本页月度支出与分类合计一致", Money.sum(slices.filter { $0.parentId == nil }.map { $0.amount }), monthSummary.expense.yuan)
let mayDaily = try engine.monthCalendar(ledgerId: ledgerId, month: now)
checkInt("5 月日历天数", mayDaily.count, 31)
check("日历逐日支出合计 = 月度总支出", Money.sum(mayDaily.map { $0.expense }), 2915.90)
check("日历逐日收入合计 = 月度总收入", Money.sum(mayDaily.map { $0.income }), 9985.06)
let day30 = mayDaily.first { Calendar.current.component(.day, from: $0.date) == 30 }
check("日历 5/30 支出", day30?.expense ?? .zero, 54.90)

print("\n══════════════════════════════════════════════════")
print(" 结果：通过 \(pass) 项，失败 \(fail) 项")
print("══════════════════════════════════════════════════")
if fail > 0 { exit(1) }
