import { useMemo, useState } from 'react';
import { useApp } from '../state/app';
import { money, pct } from '../core/money';
import { DENOMINATOR_LABEL, FLOW_LABEL, type DayDenominator, type Direction } from '../core/enums';
import type { TxnFilter } from '../core/metrics';
import { AreaTrend, Donut } from '../components/charts';
import { ExpenseDistribution, ExpenseDumbbell, ExpenseHeatmap, ExpenseHistogram, ExpenseStack, IncomeExpenseChart } from '../components/SpendingCharts';

const pad = (n: number) => String(n).padStart(2, '0');
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const fmtShort = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
};
const fmtRange = (a: number, b: number) => {
  const s = new Date(a * 1000); const e = new Date((b - 1) * 1000);
  return `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日 ~ ${s.getFullYear() !== e.getFullYear() ? `${e.getFullYear()}年` : ''}${e.getMonth() + 1}月${e.getDate()}日`;
};

export function StatsPage({ onDrill }: { onDrill?: (init: Partial<TxnFilter>) => void } = {}) {
  const { engine, ledgerId, nowSec, repo } = useApp();
  const denom = (repo.preference('day_denominator') as DayDenominator) ?? 'elapsed';
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [offset, setOffset] = useState(0);
  const range = useMemo(() => {
    if (mode === 'week') {
      const base = engine.weekRange(nowSec);
      const shift = offset * 7 * 86400;
      return { start: base.start + shift, end: base.end + shift };
    }
    const base = engine.monthRange(nowSec);
    return { start: monthShift(base.start, offset), end: monthShift(base.start, offset + 1) };
  }, [engine, mode, offset, nowSec]);
  const previousRange = useMemo(() => mode === 'week'
    ? { start: range.start - 7 * 86400, end: range.start }
    : { start: monthShift(range.start, -1), end: range.start }, [range, mode]);
  const chartData = useMemo(() => engine.expenseChartData(ledgerId, range, previousRange), [engine, ledgerId, range, previousRange]);
  const s = useMemo(() => engine.periodSummary(ledgerId, range, denom, nowSec), [engine, ledgerId, range, denom, nowSec]);
  const series = useMemo(() => engine.dailySeries(ledgerId, range), [engine, ledgerId, range]);
  const netSeries = useMemo(() => engine.netWorthSeries(ledgerId, range), [engine, ledgerId, range]);
  const expenseSlices = useMemo(() => engine.categoryBreakdown(ledgerId, range, 'expense'), [engine, ledgerId, range]);
  const incomeSlices = useMemo(() => engine.categoryBreakdown(ledgerId, range, 'income'), [engine, ledgerId, range]);
  const expenses = useMemo(() => engine.filterTxns(ledgerId, {
    from: range.start, to: range.end, kinds: ['expense'], excludeFromStats: false, sort: 'amountDesc'
  }), [engine, ledgerId, range]);
  const incomes = useMemo(() => engine.filterTxns(ledgerId, {
    from: range.start, to: range.end, kinds: ['income'], excludeFromStats: false
  }), [engine, ledgerId, range]);
  const cats = repo.categories(ledgerId);
  const drill = (filter: Partial<TxnFilter>) => onDrill?.({ from: range.start, to: range.end, excludeFromStats: false, ...filter });
  const dayRange = (date: number) => {
    const d = new Date(date * 1000);
    return { from: date, to: Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() / 1000) };
  };
  const drillCategory = (categoryId: string) => drill({ kinds: ['expense'], categoryId });
  const statOf = (label: string, value: number, color?: string, filter?: Partial<TxnFilter>) => (
    <button className="kv stats-kv" key={label} disabled={!filter || !onDrill} onClick={() => filter && drill(filter)}>
      <span className="k">{label}</span>
      <span className="v" style={{ color }}>{money(value)}{filter && <span className="chev">›</span>}</span>
    </button>
  );

  const categoryPanel = (dir: Direction) => {
    const isExpense = dir === 'expense';
    const label = isExpense ? '支出' : '收入';
    const slices = isExpense ? expenseSlices : incomeSlices;
    const parents = slices.filter(x => x.parentId === null);
    return (
      <section className="card stats-category" aria-label={`${label}分类详情`}>
        <div className="card-head">
          <span className="card-title">{label}分类详情</span>
          <span className="card-dim">全部分类 · 金额从高到低</span>
        </div>
        {parents.length === 0 ? <div className="empty">这个时段还没有{label}记录</div> : <>
          <div className="stats-category-overview">
            <div className="stats-chart"><Donut size={150} thickness={18}
              slices={parents.map(x => ({ name: x.name, amount: x.amount, color: x.colorHex }))}
              total={isExpense ? s.expense : s.income} centerTitle={`总${label}`} /></div>
            <div>
              <div className="hint">{label}最多的分类</div>
              <strong className="stats-leading-category">{parents[0].icon} {parents[0].name}</strong>
              <div className="amt">{money(parents[0].amount)} <span className="hint">占 {pct(parents[0].percentOfTotal)}</span></div>
              <p className="hint">点击任意分类查看对应账单</p>
            </div>
          </div>
          <div className="stats-category-list">
            {parents.map(parent => <div className="stats-category-group" key={parent.categoryId}>
              <button className="cat-row parent stats-category-row" disabled={!onDrill}
                onClick={() => drill({ kinds: [dir], categoryId: parent.categoryId })}>
                <span className="ico">{parent.icon}</span>
                <span>
                  <span className="name">{parent.name}</span>
                  <span className="meta">{parent.count} 笔 · 占总{label} {pct(parent.percentOfTotal)}</span>
                  <span className="bar"><i style={{ width: pct(parent.percentOfTotal), background: parent.colorHex }} /></span>
                </span>
                <span className="amt">{money(parent.amount)} <span className="chev">›</span></span>
              </button>
              {slices.filter(child => child.parentId === parent.categoryId).map(child => (
                <button className="cat-row stats-category-row stats-category-child" key={child.categoryId} disabled={!onDrill}
                  onClick={() => drill({ kinds: [dir], categoryId: child.categoryId })}>
                  <span className="ico">{child.icon}</span>
                  <span><span className="name">{child.name}</span>
                    <span className="meta">{child.count} 笔 · 占该类 {pct(child.percentOfParent ?? 0)}</span></span>
                  <span className="amt">{money(child.amount)} <span className="chev">›</span></span>
                </button>
              ))}
            </div>)}
          </div>
        </>}
      </section>
    );
  };

  return (
    <div className="col stats-page">
      <div className="card stats-toolbar">
        <div className="seg" aria-label="统计周期">
          <button className={mode === 'week' ? 'on' : ''} onClick={() => { setMode('week'); setOffset(0); }}>按周统计</button>
          <button className={mode === 'month' ? 'on' : ''} onClick={() => { setMode('month'); setOffset(0); }}>按月统计</button>
        </div>
        <div className="row stats-period">
          <button className="btn" aria-label={mode === 'week' ? '上一周' : '上一月'} onClick={() => setOffset(o => o - 1)}>‹</button>
          <span>{fmtRange(range.start, range.end)}</span>
          <button className="btn" aria-label={mode === 'week' ? '下一周' : '下一月'} onClick={() => setOffset(o => o + 1)}>›</button>
          <button className="btn" disabled={offset === 0} onClick={() => setOffset(0)}>回到{mode === 'week' ? '本周' : '本月'}</button>
        </div>
      </div>

      <div className="stats-summary">
        <button className="card stats-summary-card stats-summary-expense" disabled={!onDrill} onClick={() => drill({ kinds: ['expense'] })}>
          <span className="hint">总支出</span><strong className="metric-value">{money(s.expense)}</strong>
          <span className="hint">{expenses.length} 笔支出 · 查看明细 ›</span>
        </button>
        <button className="card stats-summary-card" disabled={!onDrill} onClick={() => drill({ kinds: ['income'] })}>
          <span className="hint">总收入</span><strong className="metric-value" style={{ color: 'var(--income)' }}>{money(s.income)}</strong>
          <span className="hint">{incomes.length} 笔收入 · 查看明细 ›</span>
        </button>
        <div className="card stats-summary-card">
          <span className="hint">本期结余</span><strong className="metric-value">{money(s.balance)}</strong><span className="hint">收入减去支出</span>
        </div>
        <div className="card stats-summary-card">
          <span className="hint">日均支出</span><strong className="metric-value">{money(s.dailyExpense)}</strong>
          <span className="hint">{DENOMINATOR_LABEL[denom]} · {s.denominatorDays} 天</span>
        </div>
      </div>

      <div className="stats-grid">
        <section className="card stats-wide" aria-label="收支趋势">
          <div className="card-head"><span className="card-title">收支趋势 · 柱线组合</span><span className="card-dim">点击日期查看当天收支</span></div>
          <div className="stats-chart"><IncomeExpenseChart days={series} onDay={date => drill(dayRange(date))} /></div>
          {expenses.length === 0 && incomes.length === 0 && <div className="hint">这个时段还没有收支记录</div>}
        </section>
        <section className="card" aria-label="支出构成趋势">
          <div className="card-head"><span className="card-title">每天的钱花在哪 · 堆叠面积</span></div>
          <div className="stats-chart"><ExpenseStack data={chartData} onCategory={drillCategory} /></div>
        </section>
        <section className="card" aria-label="消费热力图">
          <div className="card-head"><span className="card-title">消费热力图 · 分类 × 日期</span></div>
          <div className="stats-chart"><ExpenseHeatmap data={chartData}
            onCell={(categoryId, date) => drill({ ...dayRange(date), kinds: ['expense'], categoryId })} /></div>
        </section>
        {categoryPanel('expense')}
        {categoryPanel('income')}
        <section className="card" aria-label="消费金额分布">
          <div className="card-head"><span className="card-title">单笔消费金额 · 直方图</span><span className="card-dim">点击区间查看账单</span></div>
          <div className="stats-chart"><ExpenseHistogram bins={chartData.bins}
            onBin={(min, max) => drill({ kinds: ['expense'], minAmount: min, maxAmount: max === null ? null : max - 1 })} /></div>
          <div className="hint">各区间包含下限、不包含上限；最后一档包含 500 元及以上消费。</div>
        </section>
        <section className="card" aria-label="分类单笔消费分布">
          <div className="card-head"><span className="card-title">各类消费的高低 · 箱线与散点</span></div>
          <div className="stats-chart"><ExpenseDistribution groups={chartData.groups} onCategory={drillCategory} /></div>
        </section>
        <section className="card stats-wide" aria-label="上期支出对比">
          <div className="card-head"><span className="card-title">和上一{mode === 'week' ? '周' : '月'}相比 · 哑铃图</span>
            <span className="card-dim">{fmtRange(previousRange.start, previousRange.end)} → 本期</span></div>
          <div className="stats-chart"><ExpenseDumbbell data={chartData.comparison} currentLabel="本期" previousLabel="上期" onCategory={drillCategory} /></div>
          <div className="hint">对比两个完整周期中的已记账支出。{nowSec < range.end && '本期尚未结束，后续记账会继续增加；比较时请留意天数差异。'}点击分类查看本期账单。</div>
          {chartData.previousCount === 0 && <p className="hint">上期没有已记账支出，灰点表示暂无记录。</p>}
        </section>
        <section className="card" aria-label="大额支出">
          <div className="card-head"><span className="card-title">大额支出 · 前 5 笔</span>
            <button className="btn" onClick={() => drill({ kinds: ['expense'], sort: 'amountDesc' })} disabled={!onDrill}>全部支出 ›</button></div>
          {expenses.length === 0 ? <div className="empty">这个时段还没有支出记录</div> : expenses.slice(0, 5).map((t, i) => {
            const cat = cats.find(c => c.id === t.categoryId);
            const date = new Date(t.occurredAt * 1000);
            const start = Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000);
            const end = Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() / 1000);
            return <button className="stats-large-row" key={t.id} disabled={!onDrill}
              onClick={() => drill({ from: start, to: end, kinds: ['expense'], minAmount: t.amount, maxAmount: t.amount, sort: 'amountDesc' })}>
              <span className="stats-rank">{i + 1}</span><span className="stats-large-label">
                <strong>{t.note || cat?.name || '未分类'}</strong><span className="hint">{fmtShort(t.occurredAt)} · {cat?.name || '未分类'}</span>
              </span><span className="amt">{money(t.amount)} <span className="chev">›</span></span>
            </button>;
          })}
        </section>
        <section className="card">
          <div className="card-head"><span className="card-title">净资产趋势</span>
            <span className="card-dim money">{money(netSeries[netSeries.length - 1]?.value ?? 0)}</span></div>
          <div className="stats-chart"><AreaTrend points={netSeries.map(p => p.value)} color="var(--warn)" width={600} height={180}
            labels={[fmtShort(range.start), fmtShort((range.start + range.end) / 2), fmtShort(range.end - 1)]} /></div>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><span className="card-title">每日收支明细</span><span className="card-dim">点击支出或收入查看当天账单</span></div>
        <div className="stats-table-wrap"><table className="stats-table">
          <thead><tr><th>日期</th><th>支出</th><th>收入</th><th>结余</th></tr></thead>
          <tbody>
            <tr className="stats-table-total"><td>总计</td><td className="money">{money(s.expense)}</td><td className="money">{money(s.income)}</td><td className="money">{money(s.balance)}</td></tr>
            {series.map(d => {
              const dt = new Date(d.date * 1000);
              const end = Math.floor(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1).getTime() / 1000);
              return <tr key={d.date}><td>{fmtShort(d.date)} {WD[dt.getDay()]}</td>
                {(['expense', 'income'] as const).map(dir => <td key={dir}>
                  <button className="stats-day-amount money" style={{ color: d[dir] ? `var(--${dir})` : 'var(--text-tertiary)' }}
                    disabled={!onDrill || d[dir] === 0} aria-label={`${fmtShort(d.date)}${dir === 'expense' ? '支出' : '收入'}明细`}
                    onClick={() => drill({ from: d.date, to: end, kinds: [dir] })}>{money(d[dir])}</button>
                </td>)}<td className="money">{money(d.balance)}</td></tr>;
            })}
          </tbody>
        </table></div>
        <p className="hint">支出按实付金额统计；不计入统计的账单和账户间转账不计入收支。</p>
      </section>

      <details className="card stats-extra">
        <summary>其他统计 <span className="hint">退款、优惠、手续费、报销与资金流转</span></summary>
        <div className="stats-extra-grid">
          <div><div className="card-title">退款与优惠</div>
            {statOf('退款', s.refund, undefined, { hasRefund: true, excludeFromStats: undefined })}
            {statOf('退款收入', s.refundIncome)}
            {statOf('优惠', s.discount, undefined, { hasDiscount: true, excludeFromStats: undefined })}
            {statOf('手续费', s.fee, undefined, { hasFee: true, excludeFromStats: undefined })}
          </div>
          <div><div className="card-title">报销统计</div>
            {statOf('待报销', s.pendingReimbursement, undefined, { reimbOnly: 'pending', excludeFromStats: undefined })}
            {statOf('已报销', s.doneReimbursement, undefined, { reimbOnly: 'done', excludeFromStats: undefined })}
            {statOf('报销入账', s.reimbursementReceived, undefined, { reimbOnly: 'received', excludeFromStats: undefined })}
          </div>
          <div><div className="card-title">资金流转</div>
            {s.flows.map(f => statOf(FLOW_LABEL[f.type], f.amount, undefined, { flowTypes: [f.type], excludeFromStats: undefined }))}
          </div>
        </div>
      </details>
    </div>
  );
}

function monthShift(baseStart: number, offset: number): number {
  const d = new Date(baseStart * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime() / 1000);
}
