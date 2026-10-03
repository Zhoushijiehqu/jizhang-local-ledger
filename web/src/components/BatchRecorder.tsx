import { useMemo, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { money, yuan } from '../core/money';
import { dateRange, shiftDate } from '../core/backfill';
import { readDraft, useDraft } from './useDraft';
import { accountOptionLabel } from './AccountIcon';

type Line = { key: string; date: string; amount: string; category: string; note: string; direction: 'expense' | 'income' };
export function BatchRecorder({ onClose, initialDate }: { onClose: () => void; initialDate: string }) {
  const { repo, ledgerId, changeTxns, toast } = useApp();
  const key = `batch_draft_${ledgerId}`;
  const draft = useMemo(() => readDraft<{ date: string; lines: Line[]; account: string }>(key), [key]);
  const accounts = repo.accounts(ledgerId).filter(a => a.group === 'fund');
  const cats = repo.categories(ledgerId).filter(c => !c.archived && !c.hidden);
  const [date, setDate] = useState(draft?.date ?? initialDate);
  const [account, setAccount] = useState(draft?.account ?? accounts.find(a => a.kind === 'wechat')?.id ?? accounts[0]?.id ?? '');
  const blank = (day: string): Line => ({key: crypto.randomUUID(), date: day, amount: '', category: '', note: '', direction: 'expense'});
  const [lines, setLines] = useState<Line[]>(draft?.lines ?? [blank(date)]);
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [repeat, setRepeat] = useState('wash');
  const [skip, setSkip] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const value = useMemo(() => ({date, lines, account}), [date, lines, account]);
  const {clear} = useDraft(key, value, !saving);
  const days = dateRange(from, to);
  const used = lines.filter(line => line.amount || line.category || line.note);
  const valid = used.length > 0 && used.length <= 200 && accounts.some(a => a.id === account) && used.every(line => /^\d{1,8}(\.\d{0,2})?$/.test(line.amount) && Number(line.amount) > 0 && Number.isFinite(new Date(line.date + 'T12:00:00').getTime()) && cats.some(c => c.id === line.category && c.direction === line.direction));
  const total = used.reduce((sum, line) => sum + yuan(Number(line.amount) || 0), 0);
  const update = (key: string, patch: Partial<Line>) => { setPreview(false); setLines(rows => rows.map(row => row.key === key ? {...row, ...patch} : row)); };
  const move = (target: string) => {
    if (!target) return;
    setLines(rows => rows.map(row => row.date === date ? {...row, date: target} : row));
    setDate(target); setPreview(false);
  };
  const generate = () => {
    const chosen = days.filter(day => !skip.includes(day));
    const categoryName = repeat === 'wash' ? '洗衣' : '吹风机';
    const category = cats.find(c => c.direction === 'expense' && c.name === categoryName)?.id ?? (repeat === 'dryer' ? cats.find(c => c.direction === 'expense' && c.name === '水电')?.id : '') ?? '';
    if (chosen.length + used.length > 200) { toast('一次最多补记 200 笔'); return; }
    setLines([...used, ...chosen.map(day => ({...blank(day), amount: repeat === 'wash' ? '0.90' : '0.08', category, note: repeat === 'wash' ? '洗衣' : '吹风机'}))]);
    setPreview(false);
  };
  const save = async () => {
    if (!valid || busy.current) return;
    busy.current = true; setSaving(true);
    const ok = await changeTxns(() => {
      for (const line of used) {
        const amount = yuan(Number(line.amount));
        repo.insertTxn({id: repo.nextId('T'), ledgerId, accountId: account, toAccountId: null, categoryId: line.category,
          kind: line.direction, flowType: null, original: amount, amount, discount: 0, fee: 0, refund: 0,
          occurredAt: Math.floor(new Date(line.date + 'T12:00:00').getTime()/1000), note: line.note.trim(),
          locationName: null, reimbursement: 'none', excludeFromStats: false, billCycleId: null, refundOfId: null});
      }
    }, `已保存 ${used.length} 笔补记，可整批撤销`);
    busy.current = false;
    if (ok) { clear(); onClose(); } else setSaving(false);
  };
  return <div className="recorder-backdrop" onClick={() => { if (!saving) onClose(); }}>
    <section className="card batch-recorder" role="dialog" aria-modal="true" aria-label="批量补记" onClick={event => event.stopPropagation()}>
      <header className="recorder-head"><div><div className="recorder-eyebrow">一次补完，逐笔入账</div><h2>批量补记</h2></div><button className="btn" disabled={saving} onClick={onClose}>✕</button></header>
      <div className="row batch-date"><button className="btn" onClick={() => move(shiftDate(date, -1))}>前一天</button><input aria-label="补记日期" type="date" value={date} onChange={event => move(event.target.value)} /><button className="btn" onClick={() => move(shiftDate(date, 1))}>后一天</button><select aria-label="批量账户" value={account} onChange={event => {setAccount(event.target.value);setPreview(false);}}>{accounts.map(a => <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>)}</select></div>
      <div className="draft-status">草稿自动保留，确认保存后才计入账本。</div>
      {!preview ? <>
        <div className="batch-lines">{lines.map((line, i) => <div className="batch-line" key={line.key}>
          <input aria-label={`第${i+1}笔日期`} type="date" value={line.date} onChange={event => update(line.key, {date: event.target.value})} />
          <select aria-label={`第${i+1}笔方向`} value={line.direction} onChange={event => update(line.key, {direction: event.target.value as Line['direction'], category: ''})}><option value="expense">支出</option><option value="income">收入</option></select>
          <input inputMode="decimal" aria-label={`第${i+1}笔金额`} placeholder="金额" value={line.amount} onChange={event => update(line.key, {amount: event.target.value})} />
          <select aria-label={`第${i+1}笔分类`} value={line.category} onChange={event => update(line.key, {category: event.target.value})}><option value="">分类</option>{cats.filter(c => c.direction === line.direction).map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select>
          <input aria-label={`第${i+1}笔备注`} placeholder="备注" value={line.note} onChange={event => update(line.key, {note: event.target.value})} />
          <button className="btn" aria-label={`移除第${i+1}笔`} onClick={() => setLines(rows => rows.filter(row => row.key !== line.key))}>−</button>
        </div>)}</div>
        <button className="btn" disabled={lines.length >= 200} onClick={() => setLines(rows => [...rows, blank(date)])}>＋ 再添一笔</button>
        <details className="batch-repeat"><summary>连续几天的洗衣 / 吹风机</summary><div className="row">
          <select aria-label="重复项目" value={repeat} onChange={event => setRepeat(event.target.value)}><option value="wash">洗衣 · ¥0.90 / 天</option><option value="dryer">吹风机 · ¥0.08 / 天</option></select>
          <input aria-label="重复开始日期" type="date" value={from} onChange={event => {setFrom(event.target.value);setSkip([]);}} /><span>至</span><input aria-label="重复结束日期" type="date" value={to} onChange={event => {setTo(event.target.value);setSkip([]);}} />
        </div><div className="repeat-days">{days.map(day => <label key={day}><input type="checkbox" checked={!skip.includes(day)} onChange={event => setSkip(list => event.target.checked ? list.filter(d => d !== day) : [...list, day])} />{day.slice(5)}</label>)}</div>
          <button className="btn" disabled={!days.some(day => !skip.includes(day))} onClick={generate}>生成 {days.filter(day => !skip.includes(day)).length} 笔独立账单</button>
          <p className="hint">可以取消某些日期；金额和分类生成后仍可逐笔修改。</p>
        </details>
      </> : <div className="batch-preview"><h3>确认这些账单</h3>{used.map(line => <div className="kv" key={line.key}><span>{line.date} · {line.note || cats.find(c => c.id === line.category)?.name}</span><b>{line.direction === 'expense' ? '−' : '+'}{money(yuan(Number(line.amount)))}</b></div>)}</div>}
      <footer className="recorder-actions"><span className="hint">共 {used.length} 笔 · 金额合计 {money(total)}</span><button className="btn" disabled={saving} onClick={() => {clear();onClose();}}>丢弃草稿</button>{preview && <button className="btn" disabled={saving} onClick={() => setPreview(false)}>返回修改</button>}<button className="btn primary" disabled={!valid || saving} onClick={() => preview ? void save() : setPreview(true)}>{saving ? '保存中…' : preview ? '确认全部保存' : '预览账单'}</button></footer>
    </section>
  </div>;
}
