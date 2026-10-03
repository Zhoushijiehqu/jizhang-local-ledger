import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { money, yuan, type Cents } from '../core/money';
import { readDraft, useDraft } from './useDraft';
import { FLOW_LABEL, type Direction, type FlowType, type TxnKind } from '../core/enums';
import type { Template, Txn } from '../core/types';
import { AccountIcon, accountOptionLabel } from './AccountIcon';

const pad = (n: number) => String(n).padStart(2, '0');

/** 流转六项 + 一句方向说明（"借入/借出"等最容易看反，这里直接写清钱往哪走） */
const FLOW_HINTS: Array<[FlowType, string]> = [
  ['transfer', '账户间互转'],
  ['recharge', '转到充值卡'],
  ['repay', '还信用卡'],
  ['collect', '收回欠款'],
  ['borrowIn', '我向人借'],
  ['borrowOut', '我借给人']
];

const toLocalInput = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const dateOffset = (sec: number, days: number) => {
  const d = new Date(sec * 1000);
  d.setDate(d.getDate() + days);
  return toLocalInput(d.getTime() / 1000).slice(0, 10);
};

/**
 * 记账面板：支持普通收支与流转六项；可带模板预填；也用于"编辑已有账单"。
 * 编辑模式下：用途（kind/flow）不可改 —— 它决定资金语义，改了会让余额口径错乱。
 */
export function Recorder({ onClose, onSaved, template = null, editTxn = null, initialDate = null, onBatch, onSentence }: {
  onBatch?: () => void;
  onSentence?: () => void;
  onClose: () => void;
  onSaved?: (date: string, again: boolean) => void;
  template?: Template | null;
  editTxn?: Txn | null;
  initialDate?: string | null;
}) {
  const editing = !!editTxn;
  const { repo, ledgerId, nowSec, changeTxns, toast } = useApp();
  const draftKey = `record_draft_${ledgerId}_${editTxn?.id ?? 'new'}`;
  const draft = useMemo(() => template ? null : readDraft<Record<string, any>>(draftKey), [draftKey, template]);
  const automaticDate = useRef(!editTxn && !initialDate && !draft);
  const busy = useRef(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [showAccounts, setShowAccounts] = useState(false);
  const accounts = repo.accounts(ledgerId);
  const cats = repo.categories(ledgerId);
  const defaultAccountFor = (dir: Direction) => {
    const preferred = repo.preference(`record_account_${ledgerId}_${dir}`);
    const eligible = (a: typeof accounts[number]) => dir === 'income' ? a.group === 'fund' : a.group !== 'receivable';
    return accounts.find((a) => a.kind === 'wechat' && eligible(a))?.id
      ?? accounts.find((a) => a.id === preferred && eligible(a))?.id
      ?? accounts.find(eligible)?.id ?? '';
  };

  const [direction, setDirection] = useState<Direction>(
    draft?.direction ?? (editTxn ? (editTxn.kind === 'income' || editTxn.kind === 'refund_credit' ? 'income' : 'expense')
            : (template?.direction ?? 'expense')));
  const [flow, setFlow] = useState<FlowType | 'normal'>(draft?.flow ?? editTxn?.flowType ?? 'normal');
  const [amountStr, setAmountStr] = useState(
    draft?.amountStr ?? (editTxn ? ((editTxn.original - editTxn.discount) / 100).toFixed(2)
            : template && template.amount > 0 ? (template.amount / 100).toFixed(2) : ''));
  const [accountId, setAccountId] = useState(
    draft?.accountId ?? editTxn?.accountId ?? template?.accountId ?? defaultAccountFor(direction));
  const [toAccountId, setToAccountId] = useState(draft?.toAccountId ?? editTxn?.toAccountId ?? accounts.find((a) => a.group === 'credit')?.id ?? '');
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const [catId, setCatId] = useState(draft?.catId ?? editTxn?.categoryId ?? template?.categoryId ?? '');
  const [note, setNote] = useState(draft?.note ?? editTxn?.note ?? template?.name ?? '');
  const [place, setPlace] = useState(draft?.place ?? editTxn?.locationName ?? '');
  const [discountStr, setDiscountStr] = useState(draft?.discountStr ?? (editTxn && editTxn.discount ? (editTxn.discount / 100).toFixed(2) : ''));
  const [feeStr, setFeeStr] = useState(draft?.feeStr ?? (editTxn && editTxn.fee ? (editTxn.fee / 100).toFixed(2) : ''));
  const [whenStr, setWhenStr] = useState(() => {
    if (draft?.whenStr) return draft.whenStr as string;
    const base = toLocalInput(editTxn?.occurredAt ?? nowSec);
    return initialDate && !editTxn ? `${initialDate}${base.slice(10)}` : base;
  });
  const [reimb, setReimb] = useState(draft?.reimb ?? (editTxn?.reimbursement === 'pending'));
  const [excludeStats, setExcludeStats] = useState(draft?.excludeStats ?? editTxn?.excludeFromStats ?? false);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);

  const draftValue = useMemo(() => ({direction, flow, amountStr, accountId, toAccountId, catId, note, place, discountStr, feeStr, whenStr, reimb, excludeStats}), [direction, flow, amountStr, accountId, toAccountId, catId, note, place, discountStr, feeStr, whenStr, reimb, excludeStats]);
  const { clear: clearDraft } = useDraft(draftKey, draftValue, !saving && !!(amountStr || note || catId));
  useEffect(() => {
    if (automaticDate.current) setWhenStr(toLocalInput(nowSec));
  }, [nowSec]);
  const chooseDate = (value: string) => { automaticDate.current = false; setWhenStr(`${value}${whenStr.slice(10)}`); };
  const quickTemplate = (name: string, value: string, category: string) => {
    const c = cats.find(c => c.name === name && c.direction === 'expense') ?? cats.find(c => c.name === category && c.direction === 'expense');
    setDirection('expense'); setFlow('normal'); setAmountStr(value); setNote(name); setCatId(c?.id ?? '');
  };

  const isFlow = flow !== 'normal';

  const candAccounts = useMemo(
    () => accounts.filter((a) => isFlow || (direction === 'expense' ? a.group !== 'receivable' : a.group === 'fund')),
    [accounts, direction, isFlow]
  );
  const topCats = cats.filter((c) => c.direction === direction && c.parentId === null);
  const commonCats = useMemo(() => {
    const history = repo.txns(ledgerId).slice(-100).reverse();
    const counts = new Map<string, { count: number; recency: number }>();
    history.forEach((t, index) => {
      if (!t.categoryId || t.kind !== direction) return;
      const prior = counts.get(t.categoryId);
      counts.set(t.categoryId, { count: (prior?.count ?? 0) + 1, recency: prior?.recency ?? index });
    });
    return cats
      .filter((c) => c.direction === direction && !c.archived && !c.hidden
        && (counts.has(c.id) || !cats.some((child) => child.parentId === c.id)))
      .sort((a, b) => (counts.get(b.id)?.count ?? 0) - (counts.get(a.id)?.count ?? 0)
        || (counts.get(a.id)?.recency ?? 999) - (counts.get(b.id)?.recency ?? 999))
      .slice(0, 6);
  }, [repo, ledgerId, direction]);

  const parseNum = (s: string) => {
    const n = Number(s || '0');
    return Number.isFinite(n) ? yuan(n) : 0;
  };
  const amount = parseNum(amountStr);
  const discount = isFlow ? 0 : parseNum(discountStr);
  const fee = parseNum(feeStr);
  const validOptionalMoney = (s: string) => s === '' || /^\d{1,8}(\.\d{0,2})?$/.test(s);

  const date = whenStr.slice(0, 10);
  const parsedAt = Math.floor(new Date(whenStr).getTime() / 1000);
  const canSave = !saving && amount > 0 && Number.isFinite(parsedAt)
    && (isFlow || validOptionalMoney(discountStr)) && validOptionalMoney(feeStr)
    && candAccounts.some((a) => a.id === accountId)
    && (isFlow ? !!toAccountId && toAccountId !== accountId
      : cats.some((c) => c.id === catId && c.direction === direction));

  const save = async (again = false) => {
    if (!canSave || busy.current) return;
    busy.current = true;
    setSaving(true);
    const original = amount + discount;
    const kind: TxnKind = isFlow
      ? (flow as FlowType) === 'transfer' ? 'transfer'
        : (flow as FlowType) === 'recharge' ? 'recharge'
        : (flow as FlowType) === 'repay' ? 'repay'
        : (flow as FlowType) === 'collect' ? 'collect'
        : (flow as FlowType) === 'borrowIn' ? 'borrow_in' : 'borrow_out'
      : (direction === 'expense' ? 'expense' : 'income');

    const ok = await changeTxns(() => {
      if (editing && editTxn) {
        repo.updateTxnFull(editTxn.id, {
          original, discount, fee, categoryId: isFlow ? null : catId, accountId,
          occurredAt: parsedAt, note: note.trim(), locationName: place.trim() || null,
          reimbursement: editTxn.kind === 'expense' ? (reimb ? 'pending' : 'none') : editTxn.reimbursement,
          excludeFromStats: isFlow ? true : excludeStats
        });
      } else {
        repo.insertTxn({
          id: repo.nextId('T'), ledgerId, accountId, toAccountId: isFlow ? toAccountId : null,
          categoryId: isFlow ? null : catId, kind, flowType: isFlow ? flow as FlowType : null,
          original, discount, fee, refund: 0, amount: original - discount, occurredAt: parsedAt,
          note: note.trim(), locationName: place.trim() || null,
          reimbursement: !isFlow && direction === 'expense' && reimb ? 'pending' : 'none',
          excludeFromStats: isFlow ? true : excludeStats, billCycleId: null, refundOfId: null
        });
        if (!isFlow) repo.setPreference(`record_account_${ledgerId}_${direction}`, accountId);
      }
    }, editing ? '账单已更新' : again ? '已记一笔，继续记这一天' : '已记一笔');
    busy.current = false;
    if (!ok) { setSaving(false); return; }
    clearDraft();
    if (editing) onClose();
    else if (onSaved) onSaved(date, again);
    else onClose();
  };

  const removeTxn = async () => {
    if (!editTxn || busy.current || !confirm('删除这笔账单？可在回收站恢复。')) return;
    busy.current = true; setSaving(true);
    const ok = await changeTxns(() => repo.softDeleteTxn(editTxn.id), '已移入回收站');
    busy.current = false;
    if (ok) { clearDraft(); onClose(); } else setSaving(false);
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if ([...document.querySelectorAll('.recorder')].at(-1) !== sectionRef.current) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!busy.current) onClose(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault(); void save(event.shiftKey && !editing);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });

  return (
    <div className="recorder-backdrop" onClick={() => { if (!saving) onClose(); }}>
      <section ref={sectionRef} className="card recorder" role="dialog" aria-modal="true" aria-label={editing ? '编辑账单' : '记一笔'}
        onClick={(e) => e.stopPropagation()}>
        <header className="recorder-head">
          <div>
            <div className="recorder-eyebrow">{editing ? '调整这笔记录' : '快速记录'}</div>
            <h2>{editing ? '编辑账单' : isFlow ? FLOW_LABEL[flow as FlowType] : '记一笔'}</h2>
          </div>
          <button className="btn" disabled={saving} onClick={onClose} aria-label="关闭记账窗口">✕</button>
        </header>

        {draft && <div className="draft-status">已恢复未保存草稿 · 尚未计入账本</div>}
        {!editing && <div className="quick-templates" aria-label="快捷模板">
          <button onClick={() => quickTemplate('洗衣', '0.90', '洗衣')}>洗衣 ¥0.90</button>
          <button onClick={() => quickTemplate('吹风机', '0.08', '水电')}>吹风机 ¥0.08</button>
          <button onClick={() => quickTemplate('午饭', '', '三餐')}>午饭</button>
          {onBatch && <button onClick={onBatch}>批量补记 ›</button>}
          {onSentence && <button onClick={onSentence}>对话记账 ›</button>}
        </div>}
        {!editing ? <div className="seg seg-lg recorder-direction" aria-label="收支方向">
          <button className={direction === 'expense' ? 'on' : ''} onClick={() => {
            setDirection('expense'); setCatId(''); setAccountId(defaultAccountFor('expense'));
          }}>支出</button>
          <button className={direction === 'income' ? 'on' : ''} onClick={() => {
            setDirection('income'); setCatId(''); setAccountId(defaultAccountFor('income'));
          }}>收入</button>
        </div> : <div className="hint">{isFlow ? FLOW_LABEL[flow as FlowType] : direction === 'expense' ? '支出' : '收入'} · 类型不可修改</div>}

        <label className="recorder-amount">
          <span>{isFlow ? '流转金额' : direction === 'expense' ? '实付金额' : '收入金额'}</span>
          <span className="amount-input"><i>¥</i><input autoFocus inputMode="decimal" aria-label="金额"
            placeholder="0.00" value={amountStr}
            onChange={(e) => { if (/^\d{0,8}(\.\d{0,2})?$/.test(e.target.value)) setAmountStr(e.target.value); }} /></span>
        </label>

        <div className="recorder-date-head"><label htmlFor="record-date">记账日期</label><span>补记可直接选日期</span></div>
        <div className="recorder-date-row">
          <input id="record-date" type="date" value={date} onChange={(e) => chooseDate(e.target.value)} />
          {([['今天', 0], ['昨天', -1], ['前天', -2]] as const).map(([label, offset]) => {
            const target = dateOffset(nowSec, offset);
            return <button key={label} className={`date-chip ${date === target ? 'active' : ''}`}
              onClick={() => chooseDate(target)}>{label}</button>;
          })}
        </div>

        {!isFlow && commonCats.length > 0 && <div className="recorder-common">
          <span>常用分类</span>
          <div>{commonCats.map((c) => <button key={c.id}
            className={catId === c.id ? 'active' : ''}
            onClick={() => setCatId(c.id)}>{c.icon} {c.name}</button>)}</div>
        </div>}

        <div className="recorder-fields">
          {!isFlow && !showAccounts ? <button className="account-chip" onClick={() => setShowAccounts(true)} title="点击更换账户"><AccountIcon account={selectedAccount} size={22} /> {selectedAccount?.name ?? '选择账户'} ⌄</button> : <label>{isFlow ? '转出账户' : '账户'}
          <span className={`account-select${selectedAccount?.kind === 'wechat' ? ' has-brand' : ''}`}>
            {selectedAccount?.kind === 'wechat' && <AccountIcon account={selectedAccount} size={24} />}
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {candAccounts.map((a) => <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>)}
            </select>
          </span></label>}
          {isFlow && (
            <label>转入账户<select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              <option value="">选择转入账户</option>
              {accounts.filter((a) => a.id !== accountId).map((a) => (
                <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>
              ))}
            </select></label>
          )}
          {!isFlow && (
            <label>分类<select value={catId} onChange={(e) => setCatId(e.target.value)}>
              <option value="">选择分类</option>
              {topCats.map((c) => {
                const subs = cats.filter((x) => x.parentId === c.id);
                if (subs.length === 0) return <option key={c.id} value={c.id}>{c.icon} {c.name}</option>;
                return (
                  <optgroup key={c.id} label={`${c.icon} ${c.name}`}>
                    <option value={c.id}>{c.name}（一级）</option>
                    {subs.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
                  </optgroup>
                );
              })}
            </select></label>
          )}
        </div>

        <input className="recorder-note" placeholder="备注（可选）" aria-label="备注"
          value={note} onChange={(e) => setNote(e.target.value)} />

        <button className="recorder-more" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>
          {showMore ? '收起其他选项 ⌃' : '其他选项：转账、优惠、报销等 ⌄'}
        </button>
        {showMore && <div className="recorder-extra">
            {!editing && <label>记录类型<select value={flow} onChange={(e) => setFlow(e.target.value as FlowType | 'normal')}>
              <option value="normal">普通收支</option>
              {FLOW_HINTS.map(([f, hint]) => <option key={f} value={f}>{FLOW_LABEL[f]} · {hint}</option>)}
            </select></label>}
            <div className="recorder-fields">
              <label>时间<input type="time" value={whenStr.slice(11)}
                onChange={(e) => setWhenStr(`${date}T${e.target.value}`)} /></label>
              <label>地点<input placeholder="可选" value={place} onChange={(e) => setPlace(e.target.value)} /></label>
            </div>
            <div className="recorder-fields">
              {!isFlow && <label>优惠金额<input inputMode="decimal" placeholder="0.00"
                value={discountStr} onChange={(e) => setDiscountStr(e.target.value)} /></label>}
              <label>手续费<input inputMode="decimal" placeholder="0.00"
                value={feeStr} onChange={(e) => setFeeStr(e.target.value)} /></label>
            </div>
            {discount > 0 && <div className="hint">原价 {money(amount + discount)} · 实付 {money(amount)}</div>}
            <div className="recorder-checks">
              {!isFlow && direction === 'expense' && (
                <label>
                  <input type="checkbox" checked={reimb} onChange={(e) => setReimb(e.target.checked)} />
                  待报销
                </label>
              )}
              {!isFlow && (
                <label>
                  <input type="checkbox" checked={excludeStats} onChange={(e) => setExcludeStats(e.target.checked)} />
                  不计入统计
                </label>
              )}
              {isFlow && <span className="hint">流转默认不计入收支统计</span>}
            </div>
          </div>}

        <div className="draft-footer"><span>填写内容自动留作草稿 · ⌘↵ 保存 / ⇧⌘↵ 连续记</span><button disabled={saving} onClick={() => { clearDraft(); onClose(); }}>丢弃草稿</button></div>
        <footer className="recorder-actions">
          {editing && <button className="btn" onClick={removeTxn}>删除</button>}
          {!editing && <button className="btn" disabled={!canSave} onClick={() => void save(true)}>保存并继续记</button>}
          <button className="btn primary" disabled={!canSave} onClick={() => void save(false)}>
            {saving ? '保存中…' : editing ? '保存修改' : '保存这笔'}
          </button>
        </footer>
      </section>
    </div>
  );
}
