import Foundation
import SQLite3

/// SQLite 访问错误
public enum DBError: Error, CustomStringConvertible {
    case openFailed(String)
    case prepareFailed(String)
    case stepFailed(String)
    case execFailed(String)

    public var description: String {
        switch self {
        case .openFailed(let m): return "打开数据库失败：\(m)"
        case .prepareFailed(let m): return "编译 SQL 失败：\(m)"
        case .stepFailed(let m): return "执行失败：\(m)"
        case .execFailed(let m): return "执行语句失败：\(m)"
        }
    }
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

public enum SQLValue {
    case null
    case int(Int64)
    case real(Double)
    case text(String)

    public static func money(_ m: Money) -> SQLValue { .int(m.cents) }
    public static func bool(_ b: Bool) -> SQLValue { .int(b ? 1 : 0) }
    public static func date(_ d: Date) -> SQLValue { .real(d.timeIntervalSince1970) }
    public static func dateOpt(_ d: Date?) -> SQLValue { d.map { .real($0.timeIntervalSince1970) } ?? .null }
    public static func textOpt(_ s: String?) -> SQLValue { s.map { .text($0) } ?? .null }
    public static func intOpt(_ i: Int?) -> SQLValue { i.map { .int(Int64($0)) } ?? .null }
}

/// 结果行（按列名取值）
public struct Row {
    private let stmt: OpaquePointer
    private let index: [String: Int32]

    init(_ stmt: OpaquePointer) {
        self.stmt = stmt
        var m: [String: Int32] = [:]
        let n = sqlite3_column_count(stmt)
        for i in 0..<n {
            if let c = sqlite3_column_name(stmt, i) { m[String(cString: c)] = i }
        }
        index = m
    }

    private func idx(_ col: String) -> Int32? { index[col] }
    private func isNull(_ i: Int32) -> Bool { sqlite3_column_type(stmt, i) == SQLITE_NULL }

    public func int(_ col: String) -> Int64 {
        guard let i = idx(col), !isNull(i) else { return 0 }
        return sqlite3_column_int64(stmt, i)
    }
    public func intOpt(_ col: String) -> Int64? {
        guard let i = idx(col), !isNull(i) else { return nil }
        return sqlite3_column_int64(stmt, i)
    }
    public func money(_ col: String) -> Money { Money(cents: int(col)) }
    public func bool(_ col: String) -> Bool { int(col) != 0 }
    public func real(_ col: String) -> Double {
        guard let i = idx(col), !isNull(i) else { return 0 }
        return sqlite3_column_double(stmt, i)
    }
    public func text(_ col: String) -> String {
        guard let i = idx(col), !isNull(i), let c = sqlite3_column_text(stmt, i) else { return "" }
        return String(cString: c)
    }
    public func textOpt(_ col: String) -> String? {
        guard let i = idx(col), !isNull(i), let c = sqlite3_column_text(stmt, i) else { return nil }
        return String(cString: c)
    }
    public func date(_ col: String) -> Date { Date(timeIntervalSince1970: real(col)) }
    public func dateOpt(_ col: String) -> Date? {
        guard let i = idx(col), !isNull(i) else { return nil }
        return Date(timeIntervalSince1970: sqlite3_column_double(stmt, i))
    }

    public func enumValue<T: RawRepresentable>(_ col: String, _ type: T.Type) -> T? where T.RawValue == String {
        T(rawValue: text(col))
    }
}

/// libsqlite3 的薄封装：零第三方依赖，随 macOS SDK 提供（需求 3.1「不引入网络/外部依赖」）
public final class Database {
    private var handle: OpaquePointer?

    public init(path: String) throws {
        if sqlite3_open(path, &handle) != SQLITE_OK {
            let msg = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            throw DBError.openFailed(msg)
        }
        try exec("PRAGMA foreign_keys = ON;")
        try exec("PRAGMA journal_mode = WAL;")      // 崩溃安全（需求 9 可靠性）
        try exec("PRAGMA synchronous = NORMAL;")
    }

    /// 内存库（测试用）
    public init(memory: Bool = true) throws {
        if sqlite3_open(":memory:", &handle) != SQLITE_OK {
            throw DBError.openFailed("in-memory open failed")
        }
        try exec("PRAGMA foreign_keys = ON;")
    }

    deinit { if let h = handle { sqlite3_close(h) } }

    public func exec(_ sql: String) throws {
        var err: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(handle, sql, nil, nil, &err) != SQLITE_OK {
            let msg = err.map { String(cString: $0) } ?? "unknown"
            if let e = err { sqlite3_free(e) }
            throw DBError.execFailed(msg)
        }
    }

    private func prepare(_ sql: String, _ params: [SQLValue]) throws -> OpaquePointer {
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) != SQLITE_OK {
            throw DBError.prepareFailed(handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown")
        }
        guard let s = stmt else { throw DBError.prepareFailed("nil statement") }
        for (i, p) in params.enumerated() {
            let pos = Int32(i + 1)
            switch p {
            case .null: sqlite3_bind_null(s, pos)
            case .int(let v): sqlite3_bind_int64(s, pos, v)
            case .real(let v): sqlite3_bind_double(s, pos, v)
            case .text(let v): sqlite3_bind_text(s, pos, v, -1, SQLITE_TRANSIENT)
            }
        }
        return s
    }

    public func run(_ sql: String, _ params: [SQLValue] = []) throws {
        let s = try prepare(sql, params)
        defer { sqlite3_finalize(s) }
        let rc = sqlite3_step(s)
        guard rc == SQLITE_DONE || rc == SQLITE_ROW else {
            throw DBError.stepFailed(handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown")
        }
    }

    @discardableResult
    public func insert(_ sql: String, _ params: [SQLValue] = []) throws -> Int64 {
        try run(sql, params)
        return sqlite3_last_insert_rowid(handle)
    }

    public func query<T>(_ sql: String, _ params: [SQLValue] = [], _ map: (Row) -> T) throws -> [T] {
        let s = try prepare(sql, params)
        defer { sqlite3_finalize(s) }
        var out: [T] = []
        while true {
            let rc = sqlite3_step(s)
            if rc == SQLITE_ROW { out.append(map(Row(s))) }
            else if rc == SQLITE_DONE { break }
            else { throw DBError.stepFailed(handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown") }
        }
        return out
    }

    public func scalarInt(_ sql: String, _ params: [SQLValue] = []) throws -> Int64 {
        try query(sql, params) { $0.int("v") }.first ?? 0
    }
    public func scalarMoney(_ sql: String, _ params: [SQLValue] = []) throws -> Money {
        Money(cents: try scalarInt(sql, params))
    }

    public func transaction(_ body: () throws -> Void) throws {
        try exec("BEGIN IMMEDIATE;")
        do {
            try body()
            try exec("COMMIT;")
        } catch {
            try? exec("ROLLBACK;")
            throw error
        }
    }
}
