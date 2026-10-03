/**
 * 金额工具
 * 口径铁律：金额一律以「分」为单位的整数运算，禁止用浮点直接累加。
 */
export type Cents = number;

export const ZERO: Cents = 0;

/** 元 → 分（构造种子数据 / 解析输入用） */
export function yuan(v: number): Cents {
  return Math.round(v * 100);
}

/** 分 → 元 */
export function toYuan(c: Cents): number {
  return c / 100;
}

const nf = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/** ¥1,234.56（统一格式化入口） */
export function money(c: Cents, symbol = '¥'): string {
  const sign = c < 0 ? '-' : '';
  return sign + symbol + nf.format(Math.abs(c) / 100);
}

/** +1,234.56 / -1,234.56 */
export function signedMoney(c: Cents): string {
  return (c < 0 ? '-' : '+') + '¥' + nf.format(Math.abs(c) / 100);
}

/** 无符号 1,234.56 */
export function plain(c: Cents): string {
  return money(c, '');
}

export function sumCents(list: Cents[]): Cents {
  let s = 0;
  for (const c of list) s += c;
  return s;
}

/** 图表 Y 轴：2.80w */
export function wan(c: Cents): string {
  return (c / 10000 / 100).toFixed(2) + 'w';
}

/** 百分比比值（part / total） */
export function ratio(part: Cents, total: Cents): number {
  if (total === 0) return 0;
  return part / total;
}

/** 25.00% */
export function pct(r: number, digits = 2): string {
  return (r * 100).toFixed(digits) + '%';
}

/** 整数除法（日均用，向零取整） */
export function divCents(c: Cents, n: number): Cents {
  if (n === 0) return 0;
  return Math.trunc(c / n);
}
