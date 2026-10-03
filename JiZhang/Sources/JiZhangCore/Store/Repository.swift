import Foundation

/// 仓储层：所有写操作走白名单字段，禁止"整对象覆盖"（对应 FX-001 / FX-050 的历史教训）
public final class Repository {
    public let db: Database
    private var seq: Int = 0

    public init(db: Database) throws {
        self.db = db
        try Schema.migrate(db)
    }

    public func nextId(_ prefix: String) -> String {
        seq += 1
        return "\(prefix)_\(String(format: "%04d", seq))_\(Int(Date().timeIntervalSince1970))"
    }

    // MARK: - Ledger

    public func insert(_ l: Ledger) throws {
        try db.run("""
            INSERT INTO ledger(id,name,symbol,currency,is_default,archived,sort_order)
            VALUES(?,?,?,?,?,?,?);
            """, [.text(l.id), .text(l.name), .text(l.symbol), .text(l.currency),
                  .bool(l.isDefault), .bool(l.archived), .int(Int64(l.sortOrder))])
    }

    public func ledgers() throws -> [Ledger] {
        try db.query("SELECT * FROM ledger WHERE archived=0 ORDER BY sort_order, name;") { r in
            Ledger(id: r.text("id"), name: r.text("name"), symbol: r.text("symbol"),
                   currency: r.text("currency"), isDefault: r.bool("is_default"),
                   archived: r.bool("archived"), sortOrder: Int(r.int("sort_order")))
        }
    }

    public func defaultLedger() throws -> Ledger? {
        try db.query("SELECT * FROM ledger ORDER BY is_default DESC, sort_order LIMIT 1;") { r in
            Ledger(id: r.text("id"), name: r.text("name"), symbol: r.text("symbol"),
                   currency: r.text("currency"), isDefault: r.bool("is_default"),
                   archived: r.bool("archived"), sortOrder: Int(r.int("sort_order")))
        }.first
    }

    // MARK: - Account

    public func insert(_ a: Account) throws {
        let now = Date().timeIntervalSince1970
        try db.run("""
            INSERT INTO account(id,ledger_id,name,group_type,account_kind,icon,card_no_mask,currency,
                initial_balance_cents,credit_limit_cents,bill_day,repay_day,group_name,hidden,
                is_family_credit,sort_order,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);
            """, [.text(a.id), .text(a.ledgerId), .text(a.name), .text(a.group.rawValue),
                  .text(a.kind.rawValue), .text(a.icon), .textOpt(a.cardNoMask), .text(a.currency),
                  .money(a.initialBalance), .money(a.creditLimit),
                  .intOpt(a.billDay), .intOpt(a.repayDay), .textOpt(a.groupName),
                  .bool(a.hidden), .bool(a.isFamilyCredit), .int(Int64(a.sortOrder)),
                  .real(now), .real(now)])
    }

    public func updateInitialBalance(accountId: String, _ balance: Money) throws {
        try db.run("UPDATE account SET initial_balance_cents=?, updated_at=? WHERE id=?;",
                   [.money(balance), .real(Date().timeIntervalSince1970), .text(accountId)])
    }

    /// 只更新允许的字段（白名单），禁止整对象覆盖 —— FX-001 / FX-050
    public func updateAccountAllowedFields(accountId: String, name: String?, icon: String?,
                                          hidden: Bool?, sortOrder: Int?, groupName: String?) throws {
        if let v = name { try db.run("UPDATE account SET name=? WHERE id=?;", [.text(v), .text(accountId)]) }
        if let v = icon { try db.run("UPDATE account SET icon=? WHERE id=?;", [.text(v), .text(accountId)]) }
        if let v = hidden { try db.run("UPDATE account SET hidden=? WHERE id=?;", [.bool(v), .text(accountId)]) }
        if let v = sortOrder { try db.run("UPDATE account SET sort_order=? WHERE id=?;", [.int(Int64(v)), .text(accountId)]) }
        if let v = groupName { try db.run("UPDATE account SET group_name=? WHERE id=?;", [.text(v), .text(accountId)]) }
        try db.run("UPDATE account SET updated_at=? WHERE id=?;", [.real(Date().timeIntervalSince1970), .text(accountId)])
    }

    private func account(from r: Row) -> Account {
        Account(id: r.text("id"), ledgerId: r.text("ledger_id"), name: r.text("name"),
                group: AccountGroup(rawValue: r.text("group_type")) ?? .fund,
                kind: AccountKind(rawValue: r.text("account_kind")) ?? .other,
                icon: r.text("icon"), cardNoMask: r.textOpt("card_no_mask"),
                currency: r.text("currency"), initialBalance: r.money("initial_balance_cents"),
                creditLimit: r.money("credit_limit_cents"),
                billDay: r.intOpt("bill_day").map(Int.init), repayDay: r.intOpt("repay_day").map(Int.init),
                groupName: r.textOpt("group_name"), hidden: r.bool("hidden"),
                isFamilyCredit: r.bool("is_family_credit"), sortOrder: Int(r.int("sort_order")))
    }

    public func accounts(ledgerId: String? = nil) throws -> [Account] {
        if let lid = ledgerId {
            return try db.query("SELECT * FROM account WHERE deleted_at IS NULL AND ledger_id=? ORDER BY sort_order, name;",
                                [.text(lid)], account(from:))
        }
        return try db.query("SELECT * FROM account WHERE deleted_at IS NULL ORDER BY sort_order, name;", [], account(from:))
    }

    // MARK: - Category

    public func insert(_ c: Category) throws {
        let now = Date().timeIntervalSince1970
        try db.run("""
            INSERT INTO category(id,ledger_id,parent_id,name,direction,icon,color_hex,icon_style,
                is_system,archived,hidden,sort_order,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?);
            """, [.text(c.id), .text(c.ledgerId), .textOpt(c.parentId), .text(c.name),
                  .text(c.direction.rawValue), .text(c.icon), .text(c.colorHex),
                  .text(c.iconStyle.rawValue), .bool(c.isSystem), .bool(c.archived),
                  .bool(c.hidden), .int(Int64(c.sortOrder)), .real(now), .real(now)])
    }

    private func category(from r: Row) -> Category {
        Category(id: r.text("id"), ledgerId: r.text("ledger_id"), parentId: r.textOpt("parent_id"),
                 name: r.text("name"), direction: Direction(rawValue: r.text("direction")) ?? .expense,
                 icon: r.text("icon"), colorHex: r.text("color_hex"),
                 iconStyle: CategoryIconStyle(rawValue: r.text("icon_style")) ?? .mono,
                 isSystem: r.bool("is_system"), archived: r.bool("archived"),
                 hidden: r.bool("hidden"), sortOrder: Int(r.int("sort_order")))
    }

    public func categories(ledgerId: String, direction: Direction? = nil) throws -> [Category] {
        if let d = direction {
            return try db.query("""
                SELECT * FROM category WHERE deleted_at IS NULL AND ledger_id=? AND direction=?
                ORDER BY sort_order, name;
                """, [.text(ledgerId), .text(d.rawValue)], category(from:))
        }
        return try db.query("SELECT * FROM category WHERE deleted_at IS NULL AND ledger_id=? ORDER BY sort_order, name;",
                            [.text(ledgerId)], category(from:))
    }

    // MARK: - Txn

    public func insert(_ t: Txn) throws {
        let now = Date().timeIntervalSince1970
        try db.run("""
            INSERT INTO txn(id,ledger_id,account_id,to_account_id,category_id,kind,flow_type,
                original_cents,discount_cents,fee_cents,refund_cents,amount_cents,occurred_at,note,
                location_name,reimbursement_status,exclude_from_stats,bill_cycle_id,refund_of_id,
                created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);
            """, [.text(t.id), .text(t.ledgerId), .text(t.accountId), .textOpt(t.toAccountId),
                  .textOpt(t.categoryId), .text(t.kind.rawValue), .textOpt(t.flowType?.rawValue),
                  .money(t.original), .money(t.discount), .money(t.fee), .money(t.refund),
                  .money(t.amount), .real(t.occurredAt.timeIntervalSince1970), .text(t.note),
                  .textOpt(t.locationName), .text(t.reimbursement.rawValue),
                  .bool(t.excludeFromStats), .textOpt(t.billCycleId), .textOpt(t.refundOfId),
                  .real(now), .real(now)])
    }

    private func txn(from r: Row) -> Txn {
        Txn(id: r.text("id"), ledgerId: r.text("ledger_id"), accountId: r.text("account_id"),
            toAccountId: r.textOpt("to_account_id"), categoryId: r.textOpt("category_id"),
            kind: TxnKind(rawValue: r.text("kind")) ?? .expense,
            flowType: r.textOpt("flow_type").flatMap { FlowType(rawValue: $0) },
            original: r.money("original_cents"), discount: r.money("discount_cents"),
            fee: r.money("fee_cents"), refund: r.money("refund_cents"),
            amount: r.money("amount_cents"), occurredAt: r.date("occurred_at"),
            note: r.text("note"), locationName: r.textOpt("location_name"),
            reimbursement: ReimbursementStatus(rawValue: r.text("reimbursement_status")) ?? .none,
            excludeFromStats: r.bool("exclude_from_stats"),
            billCycleId: r.textOpt("bill_cycle_id"), refundOfId: r.textOpt("refund_of_id"),
            tags: [])
    }

    public func txns(ledgerId: String, from: Date? = nil, to: Date? = nil,
                     accountId: String? = nil, kinds: [TxnKind]? = nil) throws -> [Txn] {
        var sql = "SELECT * FROM txn WHERE deleted_at IS NULL AND ledger_id=?"
        var params: [SQLValue] = [.text(ledgerId)]
        if let f = from { sql += " AND occurred_at>=?"; params.append(.real(f.timeIntervalSince1970)) }
        if let t = to { sql += " AND occurred_at<?"; params.append(.real(t.timeIntervalSince1970)) }
        if let a = accountId { sql += " AND (account_id=? OR to_account_id=?)"; params.append(.text(a)); params.append(.text(a)) }
        if let k = kinds, !k.isEmpty {
            sql += " AND kind IN (" + Array(repeating: "?", count: k.count).joined(separator: ",") + ")"
            params.append(contentsOf: k.map { .text($0.rawValue) })
        }
        sql += " ORDER BY occurred_at ASC;"
        return try db.query(sql, params, txn(from:))
    }

    // MARK: - Bill cycle

    public func insert(_ c: BillCycle) throws {
        let now = Date().timeIntervalSince1970
        try db.run("""
            INSERT INTO bill_cycle(id,account_id,period_start,period_end,statement_date,due_date,
                bill_amount_cents,paid_cents,status,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?);
            """, [.text(c.id), .text(c.accountId), .real(c.periodStart.timeIntervalSince1970),
                  .real(c.periodEnd.timeIntervalSince1970), .dateOpt(c.statementDate), .dateOpt(c.dueDate),
                  c.billAmount.map { SQLValue.money($0) } ?? .null, .money(c.paid),
                  .text(c.status.rawValue), .real(now), .real(now)])
    }

    public func billCycles(accountId: String? = nil) throws -> [BillCycle] {
        let sql = accountId == nil
            ? "SELECT * FROM bill_cycle ORDER BY period_start DESC;"
            : "SELECT * FROM bill_cycle WHERE account_id=? ORDER BY period_start DESC;"
        let params: [SQLValue] = accountId.map { [.text($0)] } ?? []
        return try db.query(sql, params) { r in
            BillCycle(id: r.text("id"), accountId: r.text("account_id"),
                      periodStart: r.date("period_start"), periodEnd: r.date("period_end"),
                      statementDate: r.dateOpt("statement_date"), dueDate: r.dateOpt("due_date"),
                      billAmount: r.intOpt("bill_amount_cents").map { Money(cents: $0) },
                      paid: r.money("paid_cents"),
                      status: BillCycleStatus(rawValue: r.text("status")) ?? .open)
        }
    }

    // MARK: - Budget

    public func insert(_ b: Budget) throws {
        let now = Date().timeIntervalSince1970
        try db.run("""
            INSERT INTO budget(id,ledger_id,category_id,period,amount_cents,carry_over,start_date,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?);
            """, [.text(b.id), .text(b.ledgerId), .textOpt(b.categoryId), .text(b.period.rawValue),
                  .money(b.amount), .bool(b.carryOver), .real(b.startDate.timeIntervalSince1970),
                  .real(now), .real(now)])
    }

    public func totalBudget(ledgerId: String) throws -> Budget? {
        try db.query("SELECT * FROM budget WHERE ledger_id=? AND category_id IS NULL ORDER BY start_date DESC LIMIT 1;",
                     [.text(ledgerId)]) { r in
            Budget(id: r.text("id"), ledgerId: r.text("ledger_id"), categoryId: r.textOpt("category_id"),
                   period: BudgetPeriod(rawValue: r.text("period")) ?? .monthly,
                   amount: r.money("amount_cents"), carryOver: r.bool("carry_over"),
                   startDate: r.date("start_date"))
        }.first
    }

    // MARK: - Save plan

    public func insert(_ p: SavePlan) throws {
        let now = Date().timeIntervalSince1970
        try db.run("""
            INSERT INTO save_plan(id,ledger_id,name,emoji,plan_type,frequency,start_date,end_date,
                target_cents,from_account_id,to_account_id,archived,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?);
            """, [.text(p.id), .text(p.ledgerId), .text(p.name), .text(p.emoji),
                  .text(p.type.rawValue), .text(p.frequency.rawValue),
                  .real(p.startDate.timeIntervalSince1970), .real(p.endDate.timeIntervalSince1970),
                  .money(p.target), .textOpt(p.fromAccountId), .textOpt(p.toAccountId),
                  .bool(p.archived), .real(now), .real(now)])
    }

    public func savePlans(ledgerId: String) throws -> [SavePlan] {
        try db.query("SELECT * FROM save_plan WHERE ledger_id=? AND archived=0 ORDER BY start_date;",
                     [.text(ledgerId)]) { r in
            SavePlan(id: r.text("id"), ledgerId: r.text("ledger_id"), name: r.text("name"),
                     emoji: r.text("emoji"),
                     type: SavePlanType(rawValue: r.text("plan_type")) ?? .flexible,
                     frequency: SaveFrequency(rawValue: r.text("frequency")) ?? .monthly,
                     startDate: r.date("start_date"), endDate: r.date("end_date"),
                     target: r.money("target_cents"), fromAccountId: r.textOpt("from_account_id"),
                     toAccountId: r.textOpt("to_account_id"), archived: r.bool("archived"))
        }
    }

    public func insert(_ c: SaveCard) throws {
        let now = Date().timeIntervalSince1970
        try db.run("""
            INSERT INTO save_card(id,plan_id,seq,due_date,amount_cents,status,txn_id,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?);
            """, [.text(c.id), .text(c.planId), .int(Int64(c.seq)),
                  .real(c.dueDate.timeIntervalSince1970), .money(c.amount),
                  .text(c.status.rawValue), .textOpt(c.txnId), .real(now), .real(now)])
    }

    public func saveCards(planId: String) throws -> [SaveCard] {
        try db.query("SELECT * FROM save_card WHERE plan_id=? ORDER BY seq;", [.text(planId)]) { r in
            SaveCard(id: r.text("id"), planId: r.text("plan_id"), seq: Int(r.int("seq")),
                     dueDate: r.date("due_date"), amount: r.money("amount_cents"),
                     status: SaveCardStatus(rawValue: r.text("status")) ?? .pending,
                     txnId: r.textOpt("txn_id"))
        }
    }

    public func insert(_ r: SaveRecord) throws {
        try db.run("INSERT INTO save_record(id,plan_id,amount_cents,occurred_at,note,created_at) VALUES(?,?,?,?,?,?);",
                   [.text(r.id), .text(r.planId), .money(r.amount),
                    .real(r.occurredAt.timeIntervalSince1970), .text(r.note),
                    .real(Date().timeIntervalSince1970)])
    }

    public func saveRecords(planId: String) throws -> [SaveRecord] {
        try db.query("SELECT * FROM save_record WHERE plan_id=? ORDER BY occurred_at;", [.text(planId)]) { r in
            SaveRecord(id: r.text("id"), planId: r.text("plan_id"), amount: r.money("amount_cents"),
                       occurredAt: r.date("occurred_at"), note: r.text("note"))
        }
    }

    // MARK: - Template

    public func insertTemplate(id: String, ledgerId: String, name: String, emoji: String,
                               direction: Direction, amount: Money, categoryId: String?,
                               accountId: String?, sortOrder: Int) throws {
        try db.run("""
            INSERT INTO template(id,ledger_id,name,emoji,direction,amount_cents,category_id,account_id,sort_order,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?);
            """, [.text(id), .text(ledgerId), .text(name), .text(emoji), .text(direction.rawValue),
                  .money(amount), .textOpt(categoryId), .textOpt(accountId),
                  .int(Int64(sortOrder)), .real(Date().timeIntervalSince1970)])
    }

    // MARK: - Preference

    public func setPreference(_ key: String, _ value: String) throws {
        try db.run("INSERT OR REPLACE INTO preference(key,value) VALUES(?,?);", [.text(key), .text(value)])
    }
    public func preference(_ key: String) throws -> String? {
        try db.query("SELECT value FROM preference WHERE key=?;", [.text(key)]) { $0.text("value") }.first
    }
}
