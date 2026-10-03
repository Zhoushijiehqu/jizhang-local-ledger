/** Local dates use calendar arithmetic, so DST and month boundaries stay correct. */
export function shiftDate(value: string, days: number): string {
  const date = new Date(value + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function dateRange(from: string, to: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return [];
  const out: string[] = [];
  let date = from;
  while (date <= to && out.length <= 366) { out.push(date); date = shiftDate(date, 1); }
  return out.length > 366 ? [] : out;
}
