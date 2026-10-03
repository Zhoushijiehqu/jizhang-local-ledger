import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { money } from '../core/money';
import type { ExpenseChartData } from '../core/metrics';
import type { DayStat } from '../core/types';
import { axisLabel } from './charts';

const W = 700, L = 62, R = 20, T = 24, B = 40, H = 240;
const shortDate = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
function useTip(data: unknown) {
  const [tip, setTip] = useState('');
  useEffect(() => { setTip(''); }, [data]);
  const hit = (text: string, action?: () => void) => ({
    tabIndex: 0, role: action ? 'button' : 'img', 'aria-label': text, className: 'chart-hit',
    onMouseEnter: () => setTip(text), onFocus: () => setTip(text), onClick: action,
    onKeyDown: (e: KeyboardEvent<SVGElement>) => {
      if (action && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); action(); }
    }
  });
  return { tip, hit };
}
function Plot({ label, height = H, tip, children }: { label: string; height?: number; tip: string; children: ReactNode }) {
  return <><svg viewBox={`0 0 ${W} ${height}`} aria-label={label}><title>{label}</title>{children}</svg>
    <div className="stats-chart-tip">{tip || '悬停或用 Tab 选择图中数据，查看具体数值'}</div></>;
}
function Legend({ entries }: { entries: Array<{ name: string; color: string }> }) {
  return <div className="stats-chart-legend">{entries.map(e => <span key={e.name}><i style={{ background: e.color }} />{e.name}</span>)}</div>;
}
function MoneyAxis({ max, height = H }: { max: number; height?: number }) {
  return <>{[0, .5, 1].map(p => <g key={p}>
    <line className="stats-chart-grid" x1={L} x2={W - R} y1={T + (height - T - B) * (1 - p)} y2={T + (height - T - B) * (1 - p)} />
    <text className="stats-chart-axis" x={L - 8} y={T + (height - T - B) * (1 - p) + 4} textAnchor="end">{axisLabel(max * p)}</text>
  </g>)}<text className="stats-chart-axis" x={8} y={12}>金额 / 元</text></>;
}
function DateAxis({ dates, height = H }: { dates: number[]; height?: number }) {
  const indexes = [...new Set([0, Math.floor(dates.length / 2), dates.length - 1])].filter(i => i >= 0);
  return <>{indexes.map(i => <text key={i} className="stats-chart-axis" x={L + (i + .5) * (W - L - R) / dates.length}
    y={height - 12} textAnchor="middle">{shortDate(dates[i])}</text>)}</>;
}

/** 柱线组合：支出柱与收入线共享金额坐标，不使用误导性的双轴。 */
export function IncomeExpenseChart({ days, onDay }: { days: DayStat[]; onDay: (date: number) => void }) {
  const { tip, hit } = useTip(days);
  const max = Math.max(1, ...days.flatMap(d => [d.expense, d.income]));
  const step = (W - L - R) / Math.max(days.length, 1);
  const x = (i: number) => L + (i + .5) * step;
  const y = (v: number) => H - B - v / max * (H - T - B);
  return <><Legend entries={[{ name: '支出 · 柱', color: 'var(--expense)' }, { name: '收入 · 线', color: 'var(--income)' }]} />
    <Plot label="每日收支柱线组合图" tip={tip}><MoneyAxis max={max} />
      {days.map((d, i) => <rect key={d.date} x={x(i) - step * .27} y={y(d.expense)} width={step * .54}
        height={H - B - y(d.expense)} rx={2} fill="var(--expense)" opacity=".75" />)}
      <polyline points={days.map((d, i) => `${x(i)},${y(d.income)}`).join(' ')} fill="none" stroke="var(--income)" strokeWidth="2" />
      {days.map((d, i) => <g key={d.date} {...hit(`${shortDate(d.date)} · 支出 ${money(d.expense)} · 收入 ${money(d.income)} · 结余 ${money(d.balance)}`, () => onDay(d.date))}>
        <circle cx={x(i)} cy={y(d.income)} r={3} fill="var(--income)" />
        <rect x={L + i * step} y={T} width={step} height={H - B - T} fill="transparent" />
      </g>)}<DateAxis dates={days.map(d => d.date)} />
    </Plot></>;
}

export function ExpenseStack({ data, onCategory }: { data: ExpenseChartData; onCategory: (id: string) => void }) {
  const { tip, hit } = useTip(data);
  if (!data.categories.length) return <div className="empty">这个时段还没有支出记录</div>;
  const totals = data.days.map(d => d.total);
  const max = Math.max(1, ...totals);
  const step = (W - L - R) / Math.max(data.days.length, 1);
  const x = (i: number) => L + (i + .5) * step;
  const y = (v: number) => H - B - v / max * (H - T - B);
  const cumulative = data.days.map(() => 0);
  return <><Legend entries={data.categories} /><Plot label="分类支出堆叠面积图" tip={tip}>
    <MoneyAxis max={max} />
    {data.categories.map((cat, c) => {
      const lower = [...cumulative];
      data.days.forEach((d, i) => { cumulative[i] += d.values[c]; });
      const upper = [...cumulative];
      const path = [...upper.map((v, i) => `${x(i)},${y(v)}`), ...lower.map((v, i) => `${x(i)},${y(v)}`).reverse()].join(' ');
      return <polygon key={cat.id} points={path} fill={cat.color} opacity=".82" stroke="var(--surface-card)" strokeWidth=".6"
        {...hit(`${cat.name} · 本期合计 ${money(cat.amount)} · ${cat.count} 笔`, () => onCategory(cat.id))} />;
    })}
    {data.days.map((d, i) => <rect key={d.date} x={x(i) - 5} y={T} width={10} height={H - B - T} fill="transparent"
      {...hit(`${shortDate(d.date)} · ${data.categories.map((c, j) => `${c.name} ${money(d.values[j])}`).join('，')}`)} />)}
    <DateAxis dates={data.days.map(d => d.date)} />
  </Plot><div className="hint">每一层代表一个分类；顶部轮廓为每天总支出，点击色块查看该类账单。</div></>;
}

export function ExpenseHeatmap({ data, onCell }: { data: ExpenseChartData; onCell: (id: string, date: number) => void }) {
  const { tip, hit } = useTip(data);
  if (!data.categories.length) return <div className="empty">这个时段还没有支出记录</div>;
  const left = 85, step = (W - left - R) / data.days.length, row = 28;
  const height = T + data.categories.length * row + B;
  const max = Math.max(1, ...data.days.flatMap(d => d.values));
  return <><div className="stats-chart-legend"><span>颜色越深，当天该类支出越高</span><span className="money">最高 {money(max)}</span></div>
    <div className="stats-chart-scroll"><Plot label="分类与日期消费热力图" height={height} tip={tip}>
      {data.categories.map((cat, c) => <g key={cat.id}>
        <text className="stats-chart-axis" x={left - 10} y={T + c * row + 17} textAnchor="end">{cat.name}</text>
        {data.days.map((d, i) => <rect key={d.date} x={left + i * step + 1} y={T + c * row} width={step - 2} height={row - 3} rx={3}
          fill={d.values[c] > 0 ? 'var(--accent)' : 'var(--surface-chip)'} fillOpacity={d.values[c] > 0 ? .12 + .88 * d.values[c] / max : 1}
          {...hit(`${shortDate(d.date)} · ${cat.name} ${money(d.values[c])}`, () => onCell(cat.id, d.date))} />)}
      </g>)}
      {data.days.map((d, i) => (data.days.length <= 7 || i % 3 === 0 || i === data.days.length - 1) &&
        <text className="stats-chart-axis" key={d.date} x={left + (i + .5) * step} y={height - 14} textAnchor="middle">{new Date(d.date * 1000).getDate()}</text>)}
      <text className="stats-chart-axis" x={left} y={12}>横轴：日期（日）</text>
    </Plot></div></>;
}

export function ExpenseHistogram({ bins, onBin }: { bins: ExpenseChartData['bins']; onBin: (min: number, max: number | null) => void }) {
  const { tip, hit } = useTip(bins);
  if (!bins.some(b => b.count > 0)) return <div className="empty">这个时段还没有支出记录</div>;
  const max = Math.max(2, Math.ceil(Math.max(...bins.map(b => b.count)) / 2) * 2);
  const step = (W - L - R) / bins.length;
  return <Plot label="消费金额区间直方图" tip={tip}>
    {[0, .5, 1].map(p => <g key={p}>
      <line className="stats-chart-grid" x1={L} x2={W - R} y1={H - B - p * (H - T - B)} y2={H - B - p * (H - T - B)} />
      <text className="stats-chart-axis" x={L - 9} y={H - B - p * (H - T - B) + 4} textAnchor="end">{Math.round(max * p)}</text>
    </g>)}<text className="stats-chart-axis" x={8} y={12}>消费笔数</text>
    {bins.map((b, i) => {
      const h = b.count / max * (H - T - B);
      return <g key={b.label} {...hit(`${b.label} 元 · ${b.count} 笔${b.max === null ? '' : '（不含区间上限）'}`, () => onBin(b.min, b.max))}>
        <rect x={L + i * step} y={T} width={step} height={H - T} fill="transparent" />
        <rect x={L + i * step + 8} y={H - B - h} width={step - 16} height={h} rx={4} fill="var(--accent)" opacity=".72" />
        <text className="stats-chart-axis" x={L + (i + .5) * step} y={H - B - h - 7} textAnchor="middle">{b.count}</text>
        <text className="stats-chart-axis" x={L + (i + .5) * step} y={H - 14} textAnchor="middle">{b.label}</text>
      </g>;
    })}<text className="stats-chart-axis" x={W - R} y={12} textAnchor="end">横轴：单笔金额 / 元</text>
  </Plot>;
}

export function ExpenseDistribution({ groups, onCategory }: { groups: ExpenseChartData['groups']; onCategory: (id: string) => void }) {
  const { tip, hit } = useTip(groups);
  const [log, setLog] = useState(true);
  const shown = groups.slice(0, 6);
  if (!shown.length) return <div className="empty">这个时段还没有支出记录</div>;
  const left = 90, row = 46, height = T + shown.length * row + B;
  const max = Math.max(1, ...shown.map(g => g.max));
  const transform = (v: number) => log ? Math.log10(1 + v / 100) : v;
  const x = (v: number) => left + transform(v) / transform(max) * (W - left - R);
  const ticks = log ? [0, 100, 1000, 10000, 100000, 1000000].filter(v => v <= max) : [0, max / 2, max];
  return <><label className="hint"><input type="checkbox" checked={log} onChange={e => setLog(e.target.checked)} /> 对数金额轴（方便同时看小额与大额）</label>
    <Plot label="分类单笔消费箱线与散点图" height={height} tip={tip}>
      {ticks.map(v => <g key={v}><line className="stats-chart-grid" x1={x(v)} x2={x(v)} y1={T} y2={height - B} />
        <text className="stats-chart-axis" x={x(v)} y={height - 12} textAnchor="middle">{axisLabel(v)}</text></g>)}
      {shown.map((g, i) => {
        const y = T + (i + .5) * row;
        return <g key={g.id}>
          <text className="stats-chart-axis" x={left - 10} y={y + 4} textAnchor="end">{g.name}</text>
          <g {...hit(`${g.name} · ${g.points.length} 笔 · 最小 ${money(g.min)} · 下四分位 ${money(g.q1)} · 中位 ${money(g.median)} · 上四分位 ${money(g.q3)} · 最大 ${money(g.max)}`, () => onCategory(g.id))}>
            <line x1={x(g.min)} x2={x(g.max)} y1={y} y2={y} stroke={g.color} strokeWidth={1.5} />
            <line x1={x(g.min)} x2={x(g.min)} y1={y - 6} y2={y + 6} stroke={g.color} />
            <line x1={x(g.max)} x2={x(g.max)} y1={y - 6} y2={y + 6} stroke={g.color} />
            <rect x={x(g.q1)} y={y - 9} width={Math.max(1, x(g.q3) - x(g.q1))} height={18} fill={g.color} fillOpacity=".2" stroke={g.color} />
            <line x1={x(g.median)} x2={x(g.median)} y1={y - 9} y2={y + 9} stroke={g.color} strokeWidth={2} />
          </g>
          {g.points.map((p, j) => <circle key={p.id} cx={x(p.amount)} cy={y + ((j % 5) - 2) * 4} r={3} fill={g.color} opacity=".6"
            {...hit(`${g.name} · ${p.note || '无备注'} · ${money(p.amount)}`)} />)}
        </g>;
      })}<text className="stats-chart-axis" x={left} y={12}>横轴：单笔金额 / 元{log ? '（对数刻度）' : ''}</text>
    </Plot><div className="hint">前 6 个支出大类；每个点是一笔消费，箱体为中间 50% 的金额，竖线为中位数，两端为最小与最大值。</div></>;
}

export function ExpenseDumbbell({ data, currentLabel, previousLabel, onCategory }: {
  data: ExpenseChartData['comparison']; currentLabel: string; previousLabel: string; onCategory: (id: string) => void;
}) {
  const { tip, hit } = useTip(data);
  if (!data.length) return <div className="empty">这两个时段还没有支出记录</div>;
  const max = Math.max(1, ...data.flatMap(d => [d.current, d.previous]));
  const left = 90, row = 33, height = T + data.length * row + B;
  const x = (v: number) => left + v / max * (W - left - R);
  return <><Legend entries={[{ name: previousLabel, color: '#97a4b5' }, { name: currentLabel, color: 'var(--expense)' }]} />
    <Plot label="本期与上期分类支出哑铃对比图" height={height} tip={tip}>
      {[0, .5, 1].map(p => <g key={p}><line className="stats-chart-grid" x1={x(max * p)} x2={x(max * p)} y1={T} y2={height - B} />
        <text className="stats-chart-axis" x={x(max * p)} y={height - 12} textAnchor="middle">{axisLabel(max * p)}</text></g>)}
      {data.map((d, i) => <g key={d.id} {...hit(`${d.name} · ${previousLabel} ${money(d.previous)} · ${currentLabel} ${money(d.current)}`, () => onCategory(d.id))}>
        <text className="stats-chart-axis" x={left - 10} y={T + (i + .5) * row + 4} textAnchor="end">{d.name}</text>
        <line x1={x(d.previous)} x2={x(d.current)} y1={T + (i + .5) * row} y2={T + (i + .5) * row} stroke="var(--text-tertiary)" strokeWidth={2} />
        <circle cx={x(d.previous)} cy={T + (i + .5) * row} r={5} fill="#97a4b5" />
        <circle cx={x(d.current)} cy={T + (i + .5) * row} r={5} fill="var(--expense)" />
      </g>)}<text className="stats-chart-axis" x={left} y={12}>横轴：分类总金额 / 元</text>
    </Plot></>;
}
