import { useEffect, useState } from 'react';
import { useApp } from '../state/app';
import { inspectBackup } from '../core/backup';
import { money } from '../core/money';

type Preview = Awaited<ReturnType<typeof inspectBackup>>;
type Entry = {name: string; modified: number; size: number; summary?: Preview; error?: string};
const day = (sec: number | null) => sec ? new Date(sec * 1000).toLocaleDateString('zh-CN') : '无记录';
export function DataManager() {
  const {repo, engine, ledgerId, restoreBackup, changeTxns, toast, exportSqlite} = useApp();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<{name: string; bytes: Uint8Array; summary: Preview} | null>(null);
  const [busy, setBusy] = useState(false);
  const [binOpen, setBinOpen] = useState(false);
  const deleted = repo.db.rows('SELECT * FROM txn WHERE ledger_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC;', [ledgerId]);
  const list = async () => {
    if (!window.ledgerDesktop) return;
    setLoading(true);
    try {
      const backups = await window.ledgerDesktop.listBackups();
      setEntries(await Promise.all(backups.map(async entry => {
        try { const bytes = await window.ledgerDesktop!.readBackup(entry.name); return {...entry, summary: await inspectBackup(bytes)}; }
        catch (error) { return {...entry, error: (error as Error).message}; }
      })));
    } catch (error) { toast(`备份读取失败：${(error as Error).message}`); }
    finally { setLoading(false); }
  };
  useEffect(() => { void list(); }, []);
  const preview = async (name: string, bytes: Uint8Array) => {
    try { setSelected({name, bytes, summary: await inspectBackup(bytes)}); }
    catch (error) { toast(`无法使用这个备份：${(error as Error).message}`); }
  };
  return <div className="col">
    <section className="card"><div className="card-head"><span className="card-title">数据与备份</span><span className="card-dim">全部保存在本机</span></div>
      <div className="kv"><span>当前账单</span><b>{repo.txnCount(ledgerId)} 笔</b></div><div className="kv"><span>当前净资产</span><b className="money">{money(engine.assetsSnapshot(ledgerId).netWorth)}</b></div>
      <div className="row"><button className="btn primary" onClick={exportSqlite}>导出完整账本 .sqlite</button>
        <label className="btn">选择 .sqlite 备份<input type="file" accept=".sqlite,.db" hidden disabled={busy} onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (!file) return;
          if (file.size > 50 * 1024 * 1024) { toast('备份文件太大，请选择 50 MB 以内的账本'); return; }
          await preview(file.name, new Uint8Array(await file.arrayBuffer()));
        }} /></label>
        {window.ledgerDesktop && <button className="btn" onClick={() => void window.ledgerDesktop!.showDataFolder()}>打开数据文件夹</button>}
      </div><p className="hint">.sqlite 包含所有账本、账户、流水、预算、模板和存钱记录。JSON 仅供阅读，不能用于完整恢复。</p>
    </section>
    {window.ledgerDesktop && <section className="card"><div className="card-head"><span className="card-title">自动备份</span><button className="btn" disabled={loading || busy} onClick={() => void list()}>{loading ? '读取中…' : '刷新列表'}</button></div>
      <p className="hint">每天首次保存会保留当天修改前的账本；“上次保存”保留上一版。恢复前另外保存一份完整快照。</p>
      {!entries.length && !loading && <div className="empty">尚无自动备份，首次记账后会生成</div>}
      {entries.map(entry => <div className="backup-entry" key={entry.name}><div><b>{entry.name}</b><small>{new Date(entry.modified).toLocaleString('zh-CN')} · {Math.ceil(entry.size/1024)} KB</small><small>{entry.summary ? `${entry.summary.count} 笔 · ${day(entry.summary.first)} — ${day(entry.summary.last)}` : entry.error}</small></div><button className="btn" disabled={busy || !!entry.error} onClick={async () => {
        try { await preview(entry.name, await window.ledgerDesktop!.readBackup(entry.name)); } catch (error) {toast(String(error));}
      }}>预览恢复</button></div>)}
    </section>}
    {selected && <section className="card restore-preview"><div className="card-head"><span className="card-title">恢复预览</span><button className="btn" disabled={busy} onClick={() => setSelected(null)}>取消</button></div>
      <h3>{selected.name}</h3><p>{selected.summary.ledgers.join('、')} · {selected.summary.count} 笔账单 · 回收站 {selected.summary.deleted} 笔</p><p>{day(selected.summary.first)} — {day(selected.summary.last)}</p>
      <p className="hint">恢复会将整个账本切换到这个版本，覆盖后的数据可从“恢复前”备份找回。</p>
      <button className="btn primary" disabled={busy} onClick={async () => {
        if (!confirm(`确认恢复 ${selected.name}？\n现有 ${repo.txnCount(ledgerId)} 笔将切换为备份中的 ${selected.summary.count} 笔；现有账本先保存为恢复前备份。`)) return;
        setBusy(true); const ok = await restoreBackup(selected.bytes); setBusy(false);
        if (ok) {setSelected(null); await list();}
      }}>{busy ? '恢复中…' : '备份当前数据并恢复'}</button>
    </section>}
    <section className="card"><div className="card-head"><span className="card-title">账单回收站 · {deleted.length} 笔</span><button className="btn" onClick={() => setBinOpen(v => !v)}>{binOpen ? '收起' : '展开'}</button></div>
      <p className="hint">删除后的账单保留在这里，恢复会保留原日期、金额、分类和备注。</p>
      {binOpen && (deleted.length ? deleted.map(row => <div className="backup-entry" key={String(row.id)}><div><b>{String(row.note) || '未填写备注'}</b><small>{day(Number(row.occurred_at))} · {money(Number(row.amount_cents))}</small></div><button className="btn" onClick={() => void changeTxns(() => repo.restoreTxn(String(row.id)), '账单已恢复')}>恢复账单</button></div>) : <div className="empty">回收站是空的</div>)}
    </section>
  </div>;
}
