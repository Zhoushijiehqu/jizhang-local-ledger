import Foundation

/// 金额类型：内部一律以「分」为单位用 Int64 存储，避免浮点误差（对应需求 7.1 与 FX-059）。
/// 单币种（CNY），但保留 currency 字段与统一格式化入口（Q-04 决策）。
public struct Money: Hashable, Comparable, CustomStringConvertible {
    public var cents: Int64

    public init(cents: Int64) { self.cents = cents }
    public init(_ yuan: Double) { self.cents = Int64((yuan * 100).rounded()) }
    public init(_ yuan: Int) { self.cents = Int64(yuan) * 100 }

    public static let zero = Money(cents: 0)

    public var yuan: Double { Double(cents) / 100.0 }
    public var isZero: Bool { cents == 0 }
    public var isNegative: Bool { cents < 0 }

    public static func + (l: Money, r: Money) -> Money { Money(cents: l.cents + r.cents) }
    public static func - (l: Money, r: Money) -> Money { Money(cents: l.cents - r.cents) }
    public static func * (l: Money, r: Int64) -> Money { Money(cents: l.cents * r) }
    public static func < (l: Money, r: Money) -> Bool { l.cents < r.cents }
    public static prefix func - (v: Money) -> Money { Money(cents: -v.cents) }
    public var abs: Money { Money(cents: Swift.abs(cents)) }

    public static func sum(_ items: [Money]) -> Money { Money(cents: items.reduce(0) { $0 + $1.cents }) }

    /// 千分位 + 两位小数（¥1,234.56）
    public var formatted: String { Self.format(cents: cents, symbol: "¥") }
    /// 不带符号（1,234.56）
    public var plain: String { Self.format(cents: cents, symbol: "") }
    /// 带符号（+1,234.56 / -1,234.56）
    public var signed: String {
        let body = Self.format(cents: Swift.abs(cents), symbol: "¥")
        return (cents < 0 ? "-" : "+") + body
    }

    public var description: String { formatted }

    private static let formatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.groupingSeparator = ","
        f.usesGroupingSeparator = true
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f
    }()

    public static func format(cents: Int64, symbol: String) -> String {
        let value = Double(Swift.abs(cents)) / 100.0
        let num = formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
        return (cents < 0 ? "-" : "") + symbol + num
    }

    /// 万位缩写，用于图表 Y 轴（2.80w / 4.80w）
    public var wan: String { String(format: "%.2fw", yuan / 10000.0) }
}

/// 百分比（保留两位小数，如 25.00% / 62.50%）
public struct Percent: Hashable, Comparable, CustomStringConvertible {
    public var ratio: Double
    public init(_ ratio: Double) { self.ratio = ratio }
    public static func ratio(part: Money, total: Money) -> Percent {
        guard total.cents != 0 else { return Percent(0) }
        return Percent(Double(part.cents) / Double(total.cents))
    }
    public var display: String { String(format: "%.2f%%", ratio * 100) }
    /// 一位小数（环形图引线用的 33.8%）
    public var shortDisplay: String { String(format: "%.2f%%", ratio * 100) }
    public var description: String { display }
    public static func < (l: Percent, r: Percent) -> Bool { l.ratio < r.ratio }
}
