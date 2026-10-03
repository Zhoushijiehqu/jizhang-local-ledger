import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/app';
import { money, yuan, type Cents } from '../core/money';
import type { TxnFilter } from '../core/metrics';
import { FLOW_LABEL } from '../core/enums';
import { Recorder } from './Recorder';
import type { Txn } from '../core/types';
import { AccountIcon, accountOptionLabel } from './AccountIcon';

type ReimbFilter = 'pending' | 'done' | 'received';

const pad = (n: number) => String(n).padStart(2, '0');
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const dayKey = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${WD[d.getDay()]}`;
};
const toInput = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

type TimePreset = 'all' | 'today' | 'week' | 'month' | 'lastMonth' | 'custom';
type SortKey = NonNullable<TxnFilter['sort']>;
type MoreState = {
  accountId: string | null;
  categoryId: string | null;
  reimb: ReimbFilter | null;
  hasRefund: boolean;
  hasDiscount: boolean;
  hasFee: boolean;
  onlyFlow: boolean;
};

export function SearchPanel({ onClose, initial }: { onClose: () => void; initial?: Partial<TxnFilter> }) {
  const { engine, repo, ledgerId, nowSec, commit, changeTxns } = useApp();
  const remember = repo.preference('remember_search_filters') === 'true';
  const cacheKey = `search_filters_cache_${ledgerId}`;
  const saved = useMemo(() => {
    if (!remember || initial) return null;
    try { return JSON.parse(localStorage.getItem(cacheKey) ?? repo.preference('search_filters') ?? 'null'); } catch { return null; }
  }, [remember, initial, repo, cacheKey]);
  const [kw, setKw] = useState('');
  const [openMenu, setOpenMenu] = useState<null | 'time' | 'amount' | 'more' | 'sort'>(null);
  const [preset, setPreset] = useState<TimePreset>(saved?.preset ?? 'all');
  const [customFrom, setCustomFrom] = useState(saved?.customFrom ?? toInput(nowSec));
  const [customTo, setCustomTo] = useState(saved?.customTo ?? toInput(nowSec));
  const [minStr, setMinStr] = useState(initial?.minAmount != null ? String(initial.minAmount / 100) : saved?.minStr ?? '');
  const [maxStr, setMaxStr] = useState(initial?.maxAmount != null ? String(initial.maxAmount / 100) : saved?.maxStr ?? '');
  const [sort, setSort] = useState<SortKey>(saved?.sort ?? initial?.sort ?? 'timeDesc');
  const [more, setMore] = useState<MoreState>(saved?.more ?? {
    accountId: null, categoryId: null, reimb: null,
    hasRefund: false, hasDiscount: false, hasFee: false, onlyFlow: false
  });
  const [basisPaid, setBasisPaid] = useState(true); // ⇄ 实付 / 原价
  const [editTxn, setEditTxn] = useState<Txn | null>(null);

  const accounts = repo.accounts(ledgerId);
  const cats = repo.categories(ledgerId);
  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const range = useMemo<{ from?: number; to?: number }>(() => {
    const day = (s: number) => Math.floor(new Date(s * 1000).setHours(0, 0, 0, 0) / 1000);
    switch (preset) {
      case 'today': return { from: day(nowSec), to: day(nowSec) + 86400 };
      case 'week': { const r = engine.weekRange(nowSec); return { from: r.start, to: r.end }; }
      case 'month': { const r = engine.monthRange(nowSec); return { from: r.start, to: r.end }; }
      case 'lastMonth': {
        const r = engine.monthRange(nowSec);
        const prev = r.start - 86400;
        const pr = engine.monthRange(prev);
        return { from: pr.start, to: pr.end };
      }
      case 'custom': {
        const f = new Date(customFrom + 'T00:00:00');
        const t = new Date(customTo + 'T00:00:00');
        return { from: Math.floor(f.getTime() / 1000), to: Math.floor(t.getTime() / 1000) + 86400 };
      }
      default:
        return initial?.from != null && initial?.to != null
          ? { from: initial.from, to: initial.to }
          : {};
    }
  }, [preset, customFrom, customTo, engine, nowSec, initial]);

  const filter: TxnFilter = useMemo(() => ({
    keyword: kw,
    from: range.from,
    to: range.to,
    minAmount: minStr ? yuan(Number(minStr)) : null,
    maxAmount: maxStr ? yuan(Number(maxStr)) : null,
    accountId: more.accountId ?? initial?.accountId ?? null,
    categoryId: more.categoryId ?? initial?.categoryId ?? null,
    flowTypes: more.onlyFlow
      ? ['repay', 'collect', 'transfer', 'recharge', 'borrowIn', 'borrowOut'] : initial?.flowTypes,
    kinds: initial?.kinds,
    excludeFromStats: initial?.excludeFromStats,
    // 由统计页钻取传入的初始条件（点击「退款 / 优惠 / 手续费 / 待报销」等）
    hasRefund: more.hasRefund || !!initial?.hasRefund,
    hasDiscount: more.hasDiscount || !!initial?.hasDiscount,
    hasFee: more.hasFee || !!initial?.hasFee,
    reimbOnly: more.reimb ?? initial?.reimbOnly ?? null,
    sort
  }), [kw, range, minStr, maxStr, more, sort, initial]);

  // 筛选条件记忆
  useEffect(() => {
    if (!remember || initial) return;
    const value = JSON.stringify({ preset, sort, minStr, maxStr, more, customFrom, customTo });
    localStorage.setItem(cacheKey, value);
    if (repo.preference('search_filters') === value) return;
    void commit(() => repo.setPreference('search_filters', value));
  }, [remember, initial, commit, repo, cacheKey, preset, sort, minStr, maxStr, more, customFrom, customTo]);

  void saved;
  const results = useMemo(() => engine.filterTxns(ledgerId, filter), [engine, ledgerId, filter]);
  const sum = useMemo(() => engine.summarize(results), [engine, results]);
  const groups = useMemo(() => engine.groupByDay(results), [engine, results]);

  // 「原价」口径下的支出合计（对应 PRD 7.1：统计口径可切换 按原价 / 按实付）
  const expenseOriginal = useMemo(
    () => results.filter((t) => t.kind === 'expense').reduce((a, t) => a + t.original, 0),
    [results]
  );

  const activeFilters = [
    preset !== 'all',
    !!minStr || !!maxStr,
    !!(more.accountId || more.categoryId || more.reimb || more.hasRefund || more.hasDiscount || more.hasFee || more.onlyFlow),
    sort !== 'timeDesc'
  ].filter(Boolean).length;

  const del = (id: string) => {
    if (!confirm('删除这笔账单？可在设置中的回收站恢复')) return;
    void changeTxns(() => repo.softDeleteTxn(id), '已移入回收站');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-window)', zIndex: 60, display: 'flex', flexDirection: 'column' }}>
      <div className="topbar">
        <button className="btn" onClick={onClose}>取消</button>
        <span className="title">搜索账单</span>
        <span className="actions">
          <span className="hint">{sum.count} 笔</span>
        </span>
      </div>

      <div className="content" style={{ maxWidth: 920, width: '100%', margin: '0 auto' }}>
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <span>🔍</span>
            <input
              autoFocus
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="搜索备注、分类、账户、地点或金额"
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                fontSize: 14, padding: '4px 0'
              }}
            />
            {kw && <button className="btn" onClick={() => setKw('')}>清除</button>}
          </div>
        </div>

        {/* 筛选器 */}
        <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <FilterBtn label="时间" active={preset !== 'all'} open={openMenu === 'time'}
            onClick={() => setOpenMenu(openMenu === 'time' ? null : 'time')} />
          <FilterBtn label="金额" active={!!minStr || !!maxStr} open={openMenu === 'amount'}
            onClick={() => setOpenMenu(openMenu === 'amount' ? null : 'amount')} />
          <FilterBtn label="更多" active={activeFilters > 1 || !!more.accountId || !!more.categoryId || !!more.reimb}
            open={openMenu === 'more'} onClick={() => setOpenMenu(openMenu === 'more' ? null : 'more')} />
          <FilterBtn label="排序" active={sort !== 'timeDesc'} open={openMenu === 'sort'}
            onClick={() => setOpenMenu(openMenu === 'sort' ? null : 'sort')} />
        </div>

        {openMenu === 'time' && (
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="seg" style={{ flexWrap: 'wrap' }}>
              {([['all', '全部'], ['today', '今天'], ['week', '本周'], ['month', '本月'], ['lastMonth', '上月'], ['custom', '自定义']] as Array<[TimePreset, string]>).map(([k, l]) => (
                <button key={k} className={preset === k ? 'on' : ''} onClick={() => setPreset(k)}>{l}</button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="row" style={{ marginTop: 10, gap: 8 }}>
                <input className="btn" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                <span className="hint">至</span>
                <input className="btn" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            )}
          </div>
        )}

        {openMenu === 'amount' && (
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <input className="btn" placeholder="最小金额" value={minStr} onChange={(e) => setMinStr(e.target.value)} style={{ width: 120 }} />
              <span className="hint">—</span>
              <input className="btn" placeholder="最大金额" value={maxStr} onChange={(e) => setMaxStr(e.target.value)} style={{ width: 120 }} />
              {[['100', '>100'], ['500', '>500']].map(([v, l]) => (
                <button key={v} className="btn" onClick={() => setMinStr(v)}>{l}</button>
              ))}
              <button className="btn" onClick={() => { setMinStr(''); setMaxStr(''); }}>清空</button>
            </div>
          </div>
        )}

        {openMenu === 'more' && (
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <select className="btn" value={more.accountId ?? ''} onChange={(e) => setMore({ ...more, accountId: e.target.value || null })}>
                <option value="">全部账户</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>)}
              </select>
              <select className="btn" value={more.categoryId ?? ''} onChange={(e) => setMore({ ...more, categoryId: e.target.value || null })}>
                <option value="">全部分类</option>
                {cats.filter((c) => c.parentId === null).map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}（含子类）</option>
                ))}
              </select>
              <select className="btn" value={more.reimb ?? ''} onChange={(e) => setMore({ ...more, reimb: (e.target.value || null) as ReimbFilter | null })}>
                <option value="">报销状态不限</option>
                <option value="pending">待报销</option>
                <option value="done">已报销</option>
                <option value="received">报销入账</option>
              </select>
            </div>
            <div className="row" style={{ gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
              <Check label="含退款" v={more.hasRefund} on={(v) => setMore({ ...more, hasRefund: v })} />
              <Check label="含优惠" v={more.hasDiscount} on={(v) => setMore({ ...more, hasDiscount: v })} />
              <Check label="含手续费" v={more.hasFee} on={(v) => setMore({ ...more, hasFee: v })} />
              <Check label="只看流转" v={more.onlyFlow} on={(v) => setMore({ ...more, onlyFlow: v })} />
              <button className="btn" onClick={() => setMore({ accountId: null, categoryId: null, reimb: null, hasRefund: false, hasDiscount: false, hasFee: false, onlyFlow: false })}>重置</button>
            </div>
          </div>
        )}

        {openMenu === 'sort' && (
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="seg" style={{ flexWrap: 'wrap' }}>
              {([['timeDesc', '时间倒序'], ['timeAsc', '时间正序'], ['amountDesc', '金额从大到小'], ['amountAsc', '金额从小到大']] as Array<[SortKey, string]>).map(([k, l]) => (
                <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{l}</button>
              ))}
            </div>
          </div>
        )}

        {/* 汇总条 */}
        <div className="row" style={{ gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 8 }}>
          <Chip label="支出" value={basisPaid ? sum.expense : expenseOriginal} tone="expense"
            toggle onToggle={() => setBasisPaid((v) => !v)} basis={basisPaid ? '实付' : '原价'} />
          <Chip label="收入" value={sum.income} tone="income" />
          <Chip label="结余" value={sum.balance} />
          <Chip label="手续费" value={sum.fee} />
          <Chip label="优惠" value={sum.discount} />
          <Chip label="退款" value={sum.refund} />
          <Chip label="退款收入" value={sum.refundIncome} />
          <Chip label="待报销" value={sum.pending} />
        </div>

        {results.length === 0 && (
          <div className="card empty">没有匹配的账单，试试放宽时间范围或清空关键词</div>
        )}

        {groups.map((g) => (
          <div key={g.date} style={{ marginBottom: 10 }}>
            <div className="day-head" style={{ padding: '6px 4px 2px' }}>
              <span className="card-title">{dayKey(g.date)}</span>
              <span className="sub">
                支出 <b style={{ color: 'var(--expense)' }}>{money(g.expense)}</b>　
                收入 <b style={{ color: 'var(--income)' }}>{money(g.income)}</b>
              </span>
            </div>
            <div className="card" style={{ padding: '4px 12px' }}>
              {g.txns.map((t) => {
                const c = t.categoryId ? catById.get(t.categoryId) : null;
                const parent = c?.parentId ? catById.get(c.parentId) : null;
                const title = parent ? `${parent.name}-${c?.name}` : c?.name ?? '未分类';
                const dt = new Date(t.occurredAt * 1000);
                const isIn = t.kind === 'income' || t.kind === 'refund_credit';
                return (
                  <div key={t.id} className="txn-row" role="button" tabIndex={0}
                    title="点击编辑这笔账单" style={{ cursor: 'pointer' }}
                    onClick={() => setEditTxn(t)}>
                    <span className="ico" style={{ background: (c?.colorHex ?? '#999') + '22' }}>{c?.icon ?? '📦'}</span>
                    <span style={{ minWidth: 0 }}>
                      <div className="t1">
                        <Hl text={title} kw={kw} />
                        {t.discount > 0 && <span className="tag disc">优惠 {money(t.discount)}</span>}
                        {t.refund > 0 && <span className="tag refund">退款 {money(t.refund)}</span>}
                        {t.reimbursement === 'pending' && <span className="tag">待报销</span>}
                        {t.flowType && <span className="tag">{FLOW_LABEL[t.flowType]}</span>}
                      </div>
                      <div className="t2">
                        {pad(dt.getHours())}:{pad(dt.getMinutes())}
                        {t.locationName ? ` · ${t.locationName}` : t.note ? <> · <Hl text={t.note} kw={kw} /></> : ''}
                      </div>
                    </span>
                    <span className="row" style={{ gap: 8 }}>
                      <span>
                        <div className="amt" style={{ color: isIn ? 'var(--income)' : 'var(--text-primary)' }}>
                          {isIn ? '+' : '-'}{money(t.amount)}
                        </div>
                        <div className="acc"><AccountIcon account={accById.get(t.accountId)} /> {accById.get(t.accountId)?.name}</div>
                      </span>
                      <button className="btn" title="删除" onClick={(e) => { e.stopPropagation(); del(t.id); }}>×</button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {editTxn && <Recorder editTxn={editTxn} onClose={() => setEditTxn(null)} />}
    </div>
  );
}

function FilterBtn({ label, active, open, onClick }: { label: string; active: boolean; open: boolean; onClick: () => void }) {
  return (
    <button className="btn" onClick={onClick}
      style={{
        border: open ? '1px solid var(--accent)' : '1px solid transparent',
        position: 'relative'
      }}>
      {label} ▾
      {active && <span style={{
        position: 'absolute', top: 3, right: 3, width: 5, height: 5,
        borderRadius: '50%', background: 'var(--accent)'
      }} />}
    </button>
  );
}

function Chip({ label, value, tone, toggle, onToggle, basis }: {
  label: string; value: Cents; tone?: 'expense' | 'income';
  toggle?: boolean; onToggle?: () => void; basis?: string;
}) {
  const color = tone === 'expense' ? 'var(--expense)' : tone === 'income' ? 'var(--income)' : 'var(--text-primary)';
  return (
    <div className="pill" style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
      background: 'var(--surface-card)', border: 'var(--border-hair)', whiteSpace: 'nowrap'
    }}>
      <span className="hint">{label}</span>
      <b className="num" style={{ color }}>{money(value)}</b>
      {toggle && (
        <button className="btn" style={{ padding: '1px 6px', fontSize: 10 }} onClick={onToggle}>⇄ {basis}</button>
      )}
    </div>
  );
}

function Check({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <label className="row" style={{ gap: 5, cursor: 'pointer' }}>
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} />
      <span className="hint">{label}</span>
    </label>
  );
}

function Hl({ text, kw }: { text: string; kw: string }) {
  const k = kw.trim();
  if (!k) return <>{text}</>;
  const i = text.toLowerCase().indexOf(k.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark style={{ background: 'rgba(245,166,35,.32)', color: 'inherit', borderRadius: 3, padding: '0 2px' }}>
        {text.slice(i, i + k.length)}
      </mark>
      {text.slice(i + k.length)}
    </>
  );
}
