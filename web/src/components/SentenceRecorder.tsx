import { useMemo, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { parseSentence, type SuggestedTxn } from '../core/sentence';
import { money, yuan } from '../core/money';
import { readDraft, useDraft } from './useDraft';
import { accountOptionLabel } from './AccountIcon';

export function SentenceRecorder({onClose, today}: {onClose: () => void; today: string}) {
  const {repo, ledgerId, changeTxns} = useApp();
  const key=`sentence_draft_${ledgerId}`;
  const draft=useMemo(() => readDraft<{text:string;rows:SuggestedTxn[];warnings:string[];submitted:string}>(key),[key]);
  const [text,setText]=useState(draft?.text ?? '');
  const [submitted,setSubmitted]=useState(draft?.submitted ?? '');
  const [rows,setRows]=useState<SuggestedTxn[]>(draft?.rows ?? []);
  const [warnings,setWarnings]=useState<string[]>(draft?.warnings ?? []);
  const [saving,setSaving]=useState(false);
  const busy=useRef(false);
  const cats=repo.categories(ledgerId).filter(c => !c.archived && !c.hidden);
  const accounts=repo.accounts(ledgerId).filter(a => a.group==='fund');
  const value=useMemo(() => ({text,rows,warnings,submitted}),[text,rows,warnings,submitted]);
  const {clear}=useDraft(key,value,!saving && !!(text || rows.length));
  const valid=rows.length>0 && rows.every(row => /^\d{1,8}(\.\d{1,2})?$/.test(row.amount) && Number(row.amount)>0 && Number.isFinite(new Date(row.date+'T12:00:00').getTime()) && cats.some(c => c.id===row.category && c.direction===row.direction) && accounts.some(a => a.id===row.account));
  const duplicates = rows.map((row, index) => {
    const matches = repo.txns(ledgerId).some(txn => {
      const d = new Date(txn.occurredAt * 1000);
      const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return date === row.date && txn.amount === yuan(Number(row.amount) || 0) && txn.kind === row.direction && txn.accountId === row.account && txn.categoryId === row.category && txn.note.trim() === row.note.trim();
    });
    return matches ? index + 1 : null;
  }).filter((index): index is number => index !== null);
  const update=(index:number, patch:Partial<SuggestedTxn>) => setRows(rows => rows.map((row,i) => i===index ? {...row,...patch} : row));
  const submit=() => {if(!text.trim() || saving) return;const result=parseSentence(text,today,cats,accounts);setSubmitted(text.trim());setRows(result.rows);setWarnings(result.warnings);setText('');};
  const save=async () => {
    if (!valid || busy.current) return;
    if (duplicates.length && !confirm(`第 ${duplicates.join('、')} 笔与现有账单的日期、金额、分类、账户和备注相同，可能重复。确认仍要记入？`)) return;
    busy.current=true;setSaving(true);
    const ok=await changeTxns(() => {for(const row of rows) {
      const amount=yuan(Number(row.amount));
      repo.insertTxn({id:repo.nextId('T'),ledgerId,accountId:row.account,toAccountId:null,categoryId:row.category,kind:row.direction,flowType:null,
        original:amount,amount,discount:0,fee:0,refund:0,occurredAt:Math.floor(new Date(row.date+'T12:00:00').getTime()/1000),note:row.note,
        locationName:null,reimbursement:'none',excludeFromStats:false,billCycleId:null,refundOfId:null});
    }},`已记 ${rows.length} 笔，整批可撤销`);
    busy.current=false;if(ok){clear();onClose();}else setSaving(false);
  };
  return <div className="recorder-backdrop" onClick={() => {if(!saving)onClose();}}><section className="card sentence-recorder" role="dialog" aria-modal="true" aria-label="对话记账" onClick={event => event.stopPropagation()}>
    <header className="recorder-head"><div><div className="recorder-eyebrow">说出来，核对一下，记好了</div><h2>对话记账</h2></div><button className="btn" disabled={saving} onClick={onClose}>✕</button></header>
    <div className="chat-history"><div className="chat-bubble assistant">把消费写在下面，也可以用 Mac 的语音输入。<br/>例如：昨天午饭 20，洗衣 0.9；今天收到生活费 1500。<br/><small>没说日期时默认今天；后续分项沿用最近提到的日期。付款默认微信。</small></div>
      {submitted && <div className="chat-bubble user">{submitted}</div>}
      {submitted && <div className="chat-bubble assistant">{rows.length ? `整理出 ${rows.length} 笔，请核对后确认。空白分类需要你选一下。` : '这段还没整理出账单，可以补充金额后再试。'}{warnings.map(w => <p className="parse-warning" key={w}>{w}</p>)}</div>}
      {rows.map((row,i) => <div className="suggested-txn" key={i}><div className="row"><input aria-label={`对话第${i+1}笔日期`} type="date" value={row.date} onChange={e=>update(i,{date:e.target.value})}/><select aria-label={`对话第${i+1}笔方向`} value={row.direction} onChange={e=>update(i,{direction:e.target.value as SuggestedTxn['direction'],category:''})}><option value="expense">支出</option><option value="income">收入</option></select><input aria-label={`对话第${i+1}笔金额`} inputMode="decimal" value={row.amount} onChange={e=>update(i,{amount:e.target.value})}/><button className="btn" aria-label={`移除对话第${i+1}笔`} onClick={()=>setRows(list=>list.filter((_,index)=>index!==i))}>−</button></div>
        <div className="row"><select aria-label={`对话第${i+1}笔分类`} value={row.category} onChange={e=>update(i,{category:e.target.value})}><option value="">选择分类</option>{cats.filter(c=>c.direction===row.direction).map(c=><option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select><select aria-label={`对话第${i+1}笔账户`} value={row.account} onChange={e=>update(i,{account:e.target.value})}><option value="">选择账户</option>{accounts.map(a=><option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>)}</select><input aria-label={`对话第${i+1}笔备注`} value={row.note} onChange={e=>update(i,{note:e.target.value})}/></div>
      </div>)}
    </div>
    {duplicates.length > 0 && <p className="parse-warning">第 {duplicates.join("、")} 笔可能已记过，请核对；软件不会自动丢弃。</p>}
    <div className="chat-compose"><textarea autoFocus aria-label="描述消费" value={text} placeholder="点这里，用键盘或 Mac 自带语音输入…" onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(!e.nativeEvent.isComposing && (e.metaKey||e.ctrlKey) && e.key==='Enter'){e.preventDefault();submit();}}}/><button className="btn primary" disabled={!text.trim()||saving} onClick={submit}>{rows.length ? '重新整理' : '整理账单'}</button></div>
    <footer className="recorder-actions"><span className="hint">{rows.length ? `${rows.length} 笔 · 金额合计 ${money(rows.reduce((s,r)=>s+yuan(Number(r.amount)||0),0))}` : '尚未写入账本'}</span><button className="btn" disabled={saving} onClick={()=>{clear();onClose();}}>丢弃草稿</button><button className="btn primary" disabled={!valid||saving} onClick={()=>void save()}>{saving?'保存中…':'确认记入账本'}</button></footer>
  </section></div>;
}
