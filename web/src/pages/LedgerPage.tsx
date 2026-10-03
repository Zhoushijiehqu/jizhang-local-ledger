import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { money, pct, type Cents } from '../core/money';
import { FLOW_LABEL } from '../core/enums';
import { AreaTrend, BarChart, DonutWithLabels } from '../components/charts';
import type { Template, Txn } from '../core/types';
import { Recorder } from '../components/Recorder';
import { AccountIcon } from '../components/AccountIcon';
import type { Direction } from '../core/enums';

type ChartDir = 'expense' | 'income' | 'balance';

const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pad = (n: number) => String(n).padStart(2, '0');
const fmtDate = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
};
const fmtMD = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

export function LedgerPage({ onOpenRecorder, onOpenBatch, onOpenSentence }: { onOpenRecorder: (t?: Template | null, date?: string | null) => void; onOpenBatch: () => void; onOpenSentence: () => void }) {
  const { engine, ledgerId, nowSec, repo, seedMode, startFresh, toast } = useApp();
  const [hideBanner, setHideBanner] = useState(false);
  const denom = (repo.preference('day_denominator') as 'natural' | 'elapsed' | 'spending') ?? 'elapsed';

  const [chartDir, setChartDir] = useState<ChartDir>('expense');
  const [chartMode, setChartMode] = useState<'bar' | 'line'>('bar');
  const [catDir, setCatDir] = useState<Direction>('expense');
  const [level, setLevel] = useState<'top' | 'all'>('all');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [calMonth, setCalMonth] = useState(nowSec);
  const [selectedDay, setSelectedDay] = useState(nowSec);
  const [limit, setLimit] = useState(20);
  const previousToday = useRef(nowSec);
  useEffect(() => {
    const previous = previousToday.current;
    if (new Date(previous * 1000).toDateString() !== new Date(nowSec * 1000).toDateString()) {
      setSelectedDay(day => new Date(day * 1000).toDateString() === new Date(previous * 1000).toDateString() ? nowSec : day);
      setCalMonth(month => engine.monthRange(month).start === engine.monthRange(previous).start ? nowSec : month);
    }
    previousToday.current = nowSec;
  }, [nowSec, engine]);
  const templates = repo.templates(ledgerId);
  const [editTxn, setEditTxn] = useState<Txn | null>(null);
  const selectedDate = (() => {
    const d = new Date(selectedDay * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();

  const month = useMemo(() => engine.monthRange(nowSec), [engine, nowSec]);
  const ms = useMemo(() => engine.periodSummary(ledgerId, month, denom, nowSec), [engine, ledgerId, month, denom, nowSec]);
  const budget = useMemo(() => engine.budgetSnapshot(ledgerId, nowSec, nowSec), [engine, ledgerId, nowSec]);
  const budgetPeriod = repo.totalBudget(ledgerId)?.period === 'weekly' ? '本周' : '本月';
  const assets = useMemo(() => engine.assetsSnapshot(ledgerId), [engine, ledgerId]);
  const daily = useMemo(() => engine.dailySeries(ledgerId, month), [engine, ledgerId, month]);
  const slices = useMemo(() => engine.categoryBreakdown(ledgerId, month, catDir), [engine, ledgerId, month, catDir]);
  const netSeries = useMemo(() => engine.netWorthSeries(ledgerId, month), [engine, ledgerId, month]);
  const calendar = useMemo(() => engine.monthCalendar(ledgerId, calMonth), [engine, ledgerId, calMonth]);
  const dayTxns = useMemo(() => {
    const r = engine.dayRange(selectedDay);
    return repo.txns(ledgerId, { from: r.start, to: r.end }).sort((a, b) => b.occurredAt - a.occurredAt);
  }, [engine, repo, ledgerId, selectedDay]);
  const dayStat = useMemo(() => engine.dayStat(ledgerId, selectedDay), [engine, ledgerId, selectedDay]);
  const recentTxns = useMemo(() => repo.txns(ledgerId).slice(-limit).reverse(), [repo, ledgerId, engine, limit]);

  const accounts = repo.accounts(ledgerId);
  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? '';
  const catById = useMemo(() => new Map(repo.categories(ledgerId).map((c) => [c.id, c])), [repo, ledgerId]);

  const topSlices = slices.filter((s) => s.parentId === null);
  const donutSlices = topSlices.map((s) => ({
    name: s.name, amount: s.amount, color: catById.get(s.categoryId)?.colorHex ?? 'var(--c9)'
  }));
  const focusedParent = activeCat ?? topSlices[0]?.categoryId ?? null;
  const childRows = slices.filter((s) => s.parentId === focusedParent);
  const focusedParentSlice = topSlices.find((s) => s.categoryId === focusedParent);

  const chartData = daily.map((d) => ({
    label: fmtDate(d.date),
    value: chartDir === 'expense' ? d.expense : chartDir === 'income' ? d.income : d.balance,
    tip: `${fmtDate(d.date)} ${money(chartDir === 'expense' ? d.expense : chartDir === 'income' ? d.income : d.balance)}`
  }));
  // 图表「平均值」走"自然日"口径（月度 ÷ 自然天数）
  const chartAverage = useMemo(
    () => chartDir === 'balance' ? Math.round(ms.balance / daily.length) : engine.average(ledgerId, month, chartDir, 'natural', nowSec),
    [engine, ledgerId, month, chartDir, nowSec, ms.balance, daily.length]
  );
  const chartColor = chartDir === 'expense' ? 'var(--expense)' : chartDir === 'income' ? 'var(--income)' : 'var(--accent)';

  return (
    <div className="ledger-columns">
      <div className="col">
        {seedMode && !hideBanner && (
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, borderColor: 'rgba(245,166,35,.55)' }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>当前是演示账本（2024-05 示例数据）</div>
              <div className="hint">要开始记自己的账，建议清空后重建：会保留常用分类与账户，但不再有示例流水，日期也会跟随今天。</div>
            </div>
            <button className="btn" onClick={() => setHideBanner(true)}>先看看</button>
            <button className="btn primary" onClick={async () => {
              if (!confirm('清空当前全部数据并建立空账本？\n\n（演示数据将被删除，此操作不可撤销）')) return;
              await startFresh();
              toast('已清空，开始记你的账吧');
            }}>清空并开始记账</button>
          </div>
        )}

        <div className="record-hero">
          <div>
            <div className="record-hero-kicker">日常记账</div>
            <h1>随手记一笔</h1>
            <p>本月支出 <span className="money">{money(ms.expense)}</span> · 已记 {daily.reduce((n, d) => n + d.txnCount, 0)} 笔</p>
          </div>
          <button onClick={() => onOpenRecorder(null)} title="打开记账">
            <span>＋</span> 记一笔
          </button>
        </div>

        <div className="record-secondary"><button className="btn" onClick={onOpenBatch}>批量补记</button><button className="btn" onClick={onOpenSentence}>对话记账</button><span className="hint">也可以用 Mac 的语音输入</span></div>
        <div className="card recent-card">
          <div className="recent-layout">
            <div className="recent-list">
              <div className="card-head">
                <span className="card-title">最近账单</span>
                <span className="card-dim">点击修改 · 再记可复用</span>
              </div>
              {recentTxns.length === 0 ? <div className="empty">还没有账单，记下第一笔吧</div> : recentTxns.map((t, index) => {
                const c = t.categoryId ? catById.get(t.categoryId) : null;
                const parent = c?.parentId ? catById.get(c.parentId) : null;
                const title = t.flowType ? FLOW_LABEL[t.flowType] : t.kind === 'refund_credit' ? '退款入账'
                  : parent ? `${parent.name} · ${c?.name}` : c?.name ?? '未分类';
                const isIncome = t.kind === 'income' || t.kind === 'refund_credit' || t.kind === 'borrow_in' || t.kind === 'collect';
                const groupStart = index === 0 || new Date(recentTxns[index-1].occurredAt * 1000).toDateString() !== new Date(t.occurredAt * 1000).toDateString();
                const stat = groupStart ? engine.dayStat(ledgerId, t.occurredAt) : null;
                return <div key={t.id}>
                  {stat && <div className="ledger-day-label"><strong>{new Date(t.occurredAt * 1000).toLocaleDateString('zh-CN', {month: 'long', day: 'numeric', weekday: 'short'})}</strong><span>支出 {money(stat.expense)}{stat.income > 0 ? ` · 收入 ${money(stat.income)}` : ''}</span></div>}
                  <div className="recent-row">
                  <button className="recent-row-main" onClick={() => setEditTxn(t)} title="编辑这笔账单">
                    <span className="recent-icon" style={{ background: (c?.colorHex ?? '#2f7cf6') + '18' }}>{c?.icon ?? '↗'}</span>
                    <span className="recent-copy">
                      <strong>{title}{t.note ? ` · ${t.note}` : ''}</strong>
                      <small>{fmtMD(t.occurredAt)} · {accountName(t.accountId)}</small>
                    </span>
                    <b className={isIncome ? 'money income' : 'money'}>{isIncome ? '+' : '-'}{money(t.amount)}</b>
                  </button>
                  {(t.kind === 'expense' || t.kind === 'income') && t.categoryId && <button className="recent-repeat"
                    onClick={() => onOpenRecorder({
                      id: '', ledgerId, name: t.note, emoji: c?.icon ?? '📝',
                      direction: t.kind === 'expense' ? 'expense' : 'income',
                      amount: t.amount, categoryId: t.categoryId,
                      accountId: t.accountId, sortOrder: 0
                    })}>再记</button>}
                </div></div>;
              })}
              {repo.txnCount(ledgerId) > limit && <button className="btn load-more" onClick={() => setLimit(n => n + 20)}>加载更多账单</button>}
            </div>

          </div>
        </div>

        <details className="ledger-analysis">
          <summary>查看本月分析 <span>预算、分类和趋势</span></summary>
          <div className="col">
        {/* 四指标卡 */}
        <div className="metric-row">
          <MetricCard
            label="总支出" value={ms.expense} color="var(--expense)" icon="￥"
            subs={[['总收入', ms.income], ['结余', ms.balance]]}
          />
          <MetricCard
            label="剩余预算" value={budget.remaining} color="var(--income)" icon="◎"
            subs={[['总预算', budget.total], ['剩余日均', budget.remainingDaily]]}
          />
          <MetricCard
            label="待报销" value={ms.pendingReimbursement} color="var(--accent)" icon="⇄"
            subs={[['已报销', ms.doneReimbursement], ['报销入账', ms.reimbursementReceived]]}
          />
          <MetricCard
            label="净资产" value={assets.netWorth} color="var(--warn)" icon="★"
            subs={[['总资产', assets.totalAssets], ['总负债', assets.totalLiabilities]]}
          />
        </div>

        {/* 支出统计图 */}
        <div className="card">
          <div className="card-head">
            <div className="row">
              <span className="card-title">{chartDir === 'expense' ? '支出统计图' : chartDir === 'income' ? '收入统计图' : '结余统计图'}</span>
              <span className="card-dim">平均值: {money(chartAverage)}</span>
            </div>
            <div className="row">
              <button className="btn" title="切换图表形态"
                onClick={() => setChartMode((m) => (m === 'bar' ? 'line' : 'bar'))}>
                {chartMode === 'bar' ? '▮▮' : '〜'}
              </button>
              <div className="seg">
                <button className={chartDir === 'expense' ? 'on' : ''} onClick={() => setChartDir('expense')}>支出</button>
                <button className={chartDir === 'income' ? 'on' : ''} onClick={() => setChartDir('income')}>收入</button>
                <button className={chartDir === 'balance' ? 'on' : ''} onClick={() => setChartDir('balance')}>结余</button>
              </div>
            </div>
          </div>
          {chartMode === 'bar' ? (
            <BarChart data={chartData} average={chartAverage} color={chartColor} />
          ) : (
            <AreaTrend
              points={chartData.map((d) => d.value)}
              color={chartColor}
              labels={[chartData[0]?.label ?? '', chartData[Math.floor(chartData.length / 2)]?.label ?? '', chartData[chartData.length - 1]?.label ?? '']}
            />
          )}
        </div>

        {/* 分类详情 */}
        <div className="card">
          <div className="card-head">
            <span className="card-title">{catDir === 'expense' ? '支出分类详情' : '收入分类详情'}</span>
            <div className="row">
              <div className="seg">
                <button className={level === 'top' ? 'on' : ''} onClick={() => setLevel('top')}>一级分类 ⇄</button>
                <button className={level === 'all' ? 'on' : ''} onClick={() => setLevel('all')}>全部分类 ⇄</button>
              </div>
            </div>
          </div>
          <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
            <div style={{ flex: '0 0 280px' }}>
              <DonutWithLabels slices={donutSlices} size={280} thickness={20}
                total={ms[catDir === 'expense' ? 'expense' : 'income']}
                centerTitle={catDir === 'expense' ? '总支出' : '总收入'} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="cat-list">
                {topSlices.map((s) => {
                  const focused = s.categoryId === focusedParent;
                  const c = catById.get(s.categoryId);
                  return (
                    <button key={s.categoryId} className={`cat-row ${focused && level === 'all' ? 'parent' : ''}`}
                      style={{ background: 'none', border: 'none', padding: level === 'all' && focused ? undefined : '2px 0', textAlign: 'left' }}
                      onClick={() => { setActiveCat(s.categoryId); setLevel('all'); }}>
                      <span className="ico" style={{ background: (c?.colorHex ?? '#999') + '22' }}>{s.icon}</span>
                      <span>
                        <div className="name">
                          {s.name} <span className="meta">{pct(s.percentOfTotal)}</span>
                        </div>
                        <div className="bar"><i style={{ width: `${Math.min(s.percentOfTotal * 100, 100)}%`, background: c?.colorHex ?? 'var(--c9)' }} /></div>
                      </span>
                      <span className="amt">
                        {money(s.amount)}
                        <div className="meta">{s.count} 笔</div>
                      </span>
                    </button>
                  );
                })}
              </div>
              {level === 'all' && focusedParentSlice && childRows.length > 0 && (
                <div className="cat-list" style={{ marginTop: 12, borderTop: 'var(--border-hair)', paddingTop: 10 }}>
                  {childRows.map((s) => (
                    <div key={s.categoryId} className="cat-row">
                      <span className="ico">{s.icon}</span>
                      <span>
                        <div className="name">{s.name}</div>
                        <div className="meta">{s.count} 笔 / {pct(s.percentOfParent ?? 0)}</div>
                      </span>
                      <span className="amt">{money(s.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 净资产趋势 */}
        <div className="card">
          <div className="card-head">
            <span className="card-title">净资产趋势图</span>
            <span className="card-dim">
              {netSeries.length > 0 ? `${fmtMD(netSeries[netSeries.length - 1].date)} ` : ''}
              <b style={{ color: 'var(--text-primary)' }}>{money(assets.netWorth)}</b>
            </span>
          </div>
          <AreaTrend
            points={netSeries.map((p) => p.value)}
            color="var(--warn)"
            labels={netSeries.length ? [fmtDate(netSeries[0].date), fmtDate(netSeries[Math.floor(netSeries.length / 2)].date), fmtDate(netSeries[netSeries.length - 1].date)] : ['', '', '']}
          />
        </div>
          </div>
        </details>
      </div>

      {editTxn && <Recorder editTxn={editTxn} onClose={() => setEditTxn(null)} />}

      {/* 右栏 */}
      <div className="col ledger-right">
            <aside className="card recent-insights" aria-label="资金概览">
              <div className="recent-insights-title">资金概览</div>
              <div className="recent-insight-primary">
                <span>总资产</span>
                <strong className="money">{money(assets.totalAssets)}</strong>
                <small>扣除负债后的净资产 <span className="money">{money(assets.netWorth)}</span></small>
              </div>
              <div className="recent-insight-row">
                <span>{budget.base > 0 ? `${budgetPeriod}预算剩余` : '预算剩余'}</span>
                {budget.base > 0 ? <strong className={budget.remaining < 0 ? 'money over-budget' : 'money'}>{money(budget.remaining)}</strong> : <strong>未设置</strong>}
                <small>{budget.base > 0 ? <>基础预算 <span className="money">{money(budget.base)}</span></> : '可在设置 → 预算中设置'}</small>
              </div>
              {budget.carryOver && <div className="kv"><span className="hint">上期结转</span><b className="money">{money(budget.carried)}</b></div>}
              <div className="recent-insight-row">
                <span>本月结余</span>
                <strong className="money">{money(ms.balance)}</strong>
                <small>收入 <span className="money">{money(ms.income)}</span> · 支出 <span className="money">{money(ms.expense)}</span></small>
              </div>
            </aside>
        <details className="card calendar-card" open>
          <summary>记账日历</summary>
          <div className="cal-head">
            <button className="btn" onClick={() => setCalMonth((m) => engine.monthRange(m).start - 86400 * 15)}>‹</button>
            <span className="m">{(() => { const d = new Date(calMonth * 1000); return `${d.getFullYear()}年${d.getMonth() + 1}月`; })()}</span>
            <button className="btn" onClick={() => setCalMonth((m) => engine.monthRange(m).end + 86400 * 15)}>›</button>
          </div>
          <div className="cal-grid">
            {WD.map((w) => <div key={w} className="cal-wd">{w}</div>)}
            {(() => {
              const first = calendar[0];
              if (!first) return null;
              const fd = new Date(first.date * 1000);
              const lead = fd.getDay();
              const todayStr = new Date(nowSec * 1000).toDateString();
              const cells = [];
              for (let i = 0; i < lead; i++) cells.push(<div key={`lead${i}`} />);
              for (const d of calendar) {
                const dt = new Date(d.date * 1000);
                const isToday = dt.toDateString() === todayStr;
                const isSel = dt.toDateString() === new Date(selectedDay * 1000).toDateString();
                const cls = ['cal-cell'];
                if (d.expense > 0 && d.expense >= d.income) cls.push('has-exp');
                else if (d.income > 0) cls.push('has-inc');
                if (isToday) cls.push('today');
                if (isSel) cls.push('sel');
                cells.push(
                  <button key={d.date} className={cls.join(' ')} onClick={() => setSelectedDay(d.date)}>
                    <span className="d">{dt.getDate()}</span>
                    {d.expense > 0 && <span className="e">-{Math.round(d.expense / 100)}</span>}
                    {d.income > 0 && <span className="i">+{Math.round(d.income / 100)}</span>}
                  </button>
                );
              }
              return cells;
            })()}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            此月 {calendar.reduce((a, d) => a + d.txnCount, 0)} 笔账单　·　点击日期查看当日明细
          </div>
        </details>

        <div className="card">
          <div className="day-head">
            <span className="card-title">
              {fmtDate(selectedDay)} {WD[new Date(selectedDay * 1000).getDay()]}
            </span>
            <span className="sub">
              支出: <b style={{ color: 'var(--expense)' }}>{money(dayStat.expense)}</b>　
              收入: <b style={{ color: 'var(--income)' }}>{money(dayStat.income)}</b>
            </span>
          </div>
          <div className="row" style={{ marginBottom: 8 }}>
            <button className="btn primary" style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => onOpenRecorder(null, selectedDate)}>
              ＋ 记到 {fmtMD(selectedDay)}
            </button>
          </div>
          {templates.length > 0 && (
            <div className="tpl-row" style={{ marginBottom: 10 }}>
              <span className="hint" style={{ alignSelf: 'center' }}>模板</span>
              {templates.map((t) => (
                <button key={t.id} className="tpl-chip" title="一键套用模板"
                  onClick={() => onOpenRecorder(t, selectedDate)}>
                  <span>{t.emoji}</span>
                  <span>{t.name}</span>
                  <b className="num" style={{ color: t.direction === 'expense' ? 'var(--expense)' : 'var(--income)' }}>
                    {t.direction === 'expense' ? '-' : '+'}{money(t.amount)}
                  </b>
                </button>
              ))}
            </div>
          )}
          {dayTxns.length === 0 ? (
            <div className="empty">这一天还没有账单</div>
          ) : (
            dayTxns.map((t) => {
              const c = t.categoryId ? catById.get(t.categoryId) : null;
              const parent = c?.parentId ? catById.get(c.parentId) : null;
              const title = parent ? `${parent.name}-${c?.name}` : c?.name ?? '未分类';
              const dt = new Date(t.occurredAt * 1000);
              const isIncome = t.kind === 'income' || t.kind === 'refund_credit';
              return (
                <div key={t.id} className="txn-row" role="button" tabIndex={0}
                  title="点击编辑这笔账单"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setEditTxn(t)}>
                  <span className="ico" style={{ background: (c?.colorHex ?? '#999') + '22' }}>{c?.icon ?? '📦'}</span>
                  <span style={{ minWidth: 0 }}>
                    <div className="t1">
                      {title}
                      {t.discount > 0 && <span className="tag disc">优惠 {money(t.discount)}</span>}
                      {t.refund > 0 && <span className="tag refund">退款 {money(t.refund)}</span>}
                      {t.reimbursement === 'pending' && <span className="tag">待报销</span>}
                    </div>
                    <div className="t2">
                      {pad(dt.getHours())}:{pad(dt.getMinutes())}
                      {t.locationName ? ` · ${t.locationName}` : t.note ? ` · ${t.note}` : ''}
                    </div>
                  </span>
                  <span>
                    <div className="amt" style={{ color: isIncome ? 'var(--income)' : 'var(--text-primary)' }}>
                      {isIncome ? '+' : '-'}{money(t.amount)}
                    </div>
                    <div className="acc"><AccountIcon account={accounts.find((a) => a.id === t.accountId)} /> {accountName(t.accountId)}</div>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label, value, subs, color, icon, onDrill
}: {
  label: string; value: Cents; subs: Array<[string, Cents]>; color: string; icon: string; onDrill?: () => void;
}) {
  return (
    <div className="metric">
      {onDrill && <span className="arrow" onClick={onDrill}>›</span>}
      <div className="head">
        <span className="dot" style={{ background: color + '22', color }}>{icon}</span>
        <span className="label">{label}</span>
      </div>
      <div className="metric-value">{money(value)}</div>
      <div className="subs">
        {subs.map(([k, v]) => (
          <span key={k} className="sub">
            <div className="k">{k}</div>
            <div className="v">{money(v)}</div>
          </span>
        ))}
      </div>
    </div>
  );
}
