/**
 * 存钱计划的期数计算（唯一实现）
 *
 * 为什么单独抽出来：首版把这段逻辑写在表单里，验收脚本里又抄了一份，
 * 结果两边的"起始小时"不同（一个从 12:00 起、一个从 00:00 起），
 * 期数一个算 12、一个算 13 —— 典型的"同一逻辑两处实现"事故。
 * 现在表单与测试共用本文件，从根上杜绝这类漂移。
 */
import type { SaveFrequency } from './enums';

/** 归一到本地当天 00:00（避免小时/夏令时造成期数漂移） */
function startOfLocalDay(sec: number): Date {
  const d = new Date(sec * 1000);
  d.setHours(0, 0, 0, 0);
  return d;
}

function step(d: Date, freq: SaveFrequency): void {
  if (freq === 'daily') d.setDate(d.getDate() + 1);
  else if (freq === 'weekly') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
}

/** 各期到期时间（不含结束当天；上限 1000 期保护） */
export function planCardDueDates(startSec: number, endSec: number, freq: SaveFrequency): number[] {
  const out: number[] = [];
  const end = startOfLocalDay(endSec).getTime();
  const d = startOfLocalDay(startSec);
  while (d.getTime() < end && out.length < 1000) {
    out.push(Math.floor(d.getTime() / 1000));
    step(d, freq);
  }
  return out;
}

/** 期数 */
export function planPeriods(startSec: number, endSec: number, freq: SaveFrequency): number {
  return planCardDueDates(startSec, endSec, freq).length;
}

/** 每期金额：目标金额按期数均分（向下取整到分，尾差通过最后一期补齐） */
export function planPerPeriod(targetCents: number, periods: number): number {
  if (periods <= 0) return 0;
  return Math.floor(targetCents / periods);
}

/** 各期金额数组（最后一期吸收取整尾差，保证合计正好等于目标金额） */
export function planCardAmounts(targetCents: number, periods: number): number[] {
  if (periods <= 0) return [];
  const per = planPerPeriod(targetCents, periods);
  const amounts = new Array(periods).fill(per);
  const diff = targetCents - per * periods;
  if (diff !== 0) amounts[periods - 1] += diff;
  return amounts;
}
