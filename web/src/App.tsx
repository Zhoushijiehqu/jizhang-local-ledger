import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './state/app';
import { LedgerPage } from './pages/LedgerPage';
import { AssetsPage } from './pages/AssetsPage';
import { SavePage } from './pages/SavePage';
import { StatsPage } from './pages/StatsPage';
import { SettingsPage } from './pages/SettingsPage';
import { Recorder } from './components/Recorder';
import { SearchPanel } from './components/SearchPanel';
import { BatchRecorder } from './components/BatchRecorder';
import { SentenceRecorder } from './components/SentenceRecorder';
import type { TxnFilter } from './core/metrics';
import type { Template } from './core/types';

type PageKey = 'ledger' | 'assets' | 'save' | 'stats' | 'settings';

const NAV: Array<{ key: PageKey; label: string; icon: string }> = [
  { key: 'ledger', label: '账本', icon: '📒' },
  { key: 'assets', label: '资产', icon: '💳' },
  { key: 'save', label: '存钱', icon: '🌱' },
  { key: 'stats', label: '统计', icon: '📊' },
  { key: 'settings', label: '设置', icon: '⚙️' }
];

function Shell() {
  const { repo, nowSec, ledgerId, switchLedger, hideAmount, toggleHideAmount, toasts, toast, dismissToast, refresh, reloadFromStorage, exportSqlite, undoLast, hasUndo } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState<PageKey>('ledger');
  const [batchOpen, setBatchOpen] = useState(false);
  const [sentenceOpen, setSentenceOpen] = useState(false);
  const [quick, setQuick] = useState(false);
  const [simpleNav, setSimpleNav] = useState(() => localStorage.getItem('simple_nav') !== 'false');
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [template, setTemplate] = useState<Template | null>(null);
  const [recorderDate, setRecorderDate] = useState<string | null>(null);
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const [recorderKey, setRecorderKey] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchInit, setSearchInit] = useState<Partial<TxnFilter> | undefined>(undefined);
  const [ledgerMenu, setLedgerMenu] = useState(false);
  useEffect(() => setPinnedDate(localStorage.getItem(`backfill_date_${ledgerId}`)), [ledgerId]);

  const ledgers = repo.ledgers();
  const current = ledgers.find((l) => l.id === ledgerId);
  const anyOverlay = recorderOpen || batchOpen || sentenceOpen || searching || ledgerMenu;
  const today = (() => {
    const d = new Date(nowSec * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const openRecorder = (t: Template | null = null, date: string | null = null) => {
    setTemplate(t);
    setRecorderDate(date ?? pinnedDate);
    setRecorderOpen(true);
  };
  const closeRecorder = () => {
    if (quick) { setQuick(false); void window.ledgerDesktop?.endQuick(true); }
    setRecorderOpen(false);
    setRecorderDate(null);
  };
  const openSentence = () => {
    if (quick) { setQuick(false); void window.ledgerDesktop?.endQuick(false); }
    setRecorderOpen(false);
    setBatchOpen(false);
    setSearching(false);
    setLedgerMenu(false);
    setSentenceOpen(true);
  };

  // 键盘快捷键（全键盘可达）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        if (batchOpen) { setBatchOpen(false); return; }
        if (sentenceOpen) { setSentenceOpen(false); return; }
        if (recorderOpen) closeRecorder();
        else if (searching) setSearching(false);
        else setLedgerMenu(false);
        return;
      }
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'n') { e.preventDefault(); if (e.shiftKey) openSentence(); else openRecorder(); }
      if (meta && e.key.toLowerCase() === 'f') { e.preventDefault(); setSearchInit(undefined); setSearching(true); }
      if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); setLedgerMenu((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recorderOpen, batchOpen, sentenceOpen, searching, pinnedDate, quick]);

  useEffect(() => window.ledgerDesktop?.onAction((action) => {
    if (action === 'quick-record') { setQuick(true);setBatchOpen(false);setSentenceOpen(false);setSearching(false);setLedgerMenu(false);openRecorder(); }
    else if (action === 'quick-end') setQuick(false);
    else if (action === 'record') openRecorder();
    else if (action === 'sentence') openSentence();
    else if (action === 'search') { setSearchInit(undefined); setSearching(true); }
    else if (action === 'ledgers') setLedgerMenu((value) => !value);
    else if (action === 'export') exportSqlite();
    else if (NAV.some((item) => item.key === action)) {
      closeRecorder(); setSearching(false); setLedgerMenu(false); setPage(action as PageKey);
    }
  }), [pinnedDate, exportSqlite, quick]);

  const openSearch = (init?: Partial<TxnFilter>) => {
    setSearchInit(init);
    setSearching(true);
  };

  const monthLabel = (() => {
    const d = new Date(nowSec * 1000);
    return `${d.getFullYear()}年${d.getMonth() + 1}月`;
  })();

  return (
    <div className={`app ${window.ledgerDesktop ? 'desktop' : ''} ${hideAmount ? 'privacy' : ''} ${quick ? 'quick-mode' : ''}`}>
      <aside className="sidebar">
        <div className="avatar">记账</div>
        <div className="nickname">本地版</div>
        <div className="badge">数据仅存本机</div>
        <button className="sidebar-record" onClick={() => openRecorder()} title="记一笔 · ⌘N">
          <span>＋</span><small>记一笔</small>
        </button>
        <button className="sidebar-sentence" onClick={openSentence} title="对话记账 · ⌘⇧N">
          <span aria-hidden="true">✎</span><span>对话记账</span>
        </button>
        <nav className="nav">
          {NAV.filter(n => !simpleNav || !['assets','save'].includes(n.key)).map((n) => (
            <button key={n.key} className={`nav-item ${page === n.key ? 'active' : ''}`} onClick={() => setPage(n.key)}>
              <span className="ico">{n.icon}</span>
              <span className="lbl">{n.label}</span>
            </button>
          ))}
          <button className="nav-more" onClick={() => { setSimpleNav(value => { localStorage.setItem('simple_nav', String(!value)); return !value; }); }}>{simpleNav ? '更多功能 ›' : '收起功能 ⌃'}</button>
        </nav>
      </aside>

      <main className="main">
        <header className="topbar" style={{ position: 'relative' }}>
          <span className="traffic"><i /><i /><i /></span>

          <button className="ledger-switch" onClick={() => setLedgerMenu((v) => !v)} title="⌘K">
            {current?.symbol ?? '💡'} {current?.name ?? '账本'}{' '}
            <span style={{ color: 'var(--text-secondary)' }}>⇄</span>
          </button>

          {ledgerMenu && (
            <LedgerSwitcher
              onClose={() => setLedgerMenu(false)}
              onSwitched={(name) => { toast(`已切换到「${name}」`); refresh(); }}
            />
          )}

          <span className="title">{NAV.find((n) => n.key === page)?.label ?? '账本'}</span>

          <span className="actions">
            <button className="btn" disabled={refreshing} title="刷新数据（从本地数据库重新读取）"
              onClick={async () => {
                setRefreshing(true);
                try { await reloadFromStorage(); toast('数据已刷新'); } catch { toast('刷新失败，请重试'); } finally { setRefreshing(false); }
              }}>
              {refreshing ? '刷新中…' : '⟳ 刷新'}
            </button>
            <button className="btn" onClick={toggleHideAmount} title="隐私模式（模糊金额）">
              {hideAmount ? '🙈' : '👁'}
            </button>
            {page === 'ledger' && (
              <>
                <button className="btn" onClick={() => openSearch()} title="⌘F">🔍 搜索账单</button>
              </>
            )}
            {page !== 'ledger' && <button className="btn" onClick={() => setPage('ledger')}>账本</button>}
            {page !== 'ledger' && <button className="btn primary top-record" onClick={() => openRecorder()} title="⌘N">
              ＋ 记一笔
            </button>}
          </span>
        </header>

        <div className="content">
          {pinnedDate && <div className="backfill-banner">
            <span>正在补记 <strong>{pinnedDate}</strong>，新账单会沿用这个日期</span>
            <button onClick={() => {localStorage.removeItem(`backfill_date_${ledgerId}`);setPinnedDate(null);}}>回到今天</button>
          </div>}
          {page === 'ledger' && <LedgerPage onOpenRecorder={openRecorder} onOpenBatch={() => setBatchOpen(true)} onOpenSentence={openSentence} />}
          {page === 'assets' && <AssetsPage />}
          {page === 'save' && <SavePage />}
          {page === 'stats' && <StatsPage onDrill={(init) => openSearch(init)} />}
          {page === 'settings' && <SettingsPage />}
          <div className="hint" style={{ textAlign: 'center', margin: '16px 0 4px' }}>
            记账 · {window.ledgerDesktop ? 'Mac 桌面版' : '本地 Web 版'} · 当前视图 {monthLabel}
            {!anyOverlay && ' · 快捷键 ⌘N 记一笔 / ⌘F 搜索 / ⌘K 切账本 / Esc 关闭'}
          </div>
        </div>
      </main>

      {recorderOpen && <Recorder key={recorderKey} template={template} initialDate={recorderDate}
        onSentence={openSentence}
        onBatch={() => { if (quick) { setQuick(false); void window.ledgerDesktop?.endQuick(false); }setRecorderOpen(false);setBatchOpen(true); }} onClose={closeRecorder} onSaved={(date, again) => {
          if (date === today) localStorage.removeItem(`backfill_date_${ledgerId}`);
          else localStorage.setItem(`backfill_date_${ledgerId}`, date);
          setPinnedDate(date === today ? null : date);
          if (again) {
            setTemplate(null);
            setRecorderDate(date);
            setRecorderKey((k) => k + 1);
          } else closeRecorder();
        }} />}
      {batchOpen && <BatchRecorder initialDate={pinnedDate ?? today} onClose={() => setBatchOpen(false)} />}
      {sentenceOpen && <SentenceRecorder today={today} onClose={() => setSentenceOpen(false)} />}
      {hasUndo && <button className="last-undo btn" onClick={() => void undoLast()}>撤销上次操作</button>}
      {searching && <SearchPanel initial={searchInit} onClose={() => setSearching(false)} />}

      <div className="toast-host">
        {toasts.map((t) => <div key={t.id} className="toast">
          {t.text}
          {t.action && <button onClick={() => {
            dismissToast(t.id);
            void t.action?.onClick();
          }}>{t.action.label}</button>}
        </div>)}
      </div>
    </div>
  );
}

/** 账本切换与账本管理（新建 / 重命名 / 排序 / 归档 / 默认） */
function LedgerSwitcher({ onClose, onSwitched }: { onClose: () => void; onSwitched: (name: string) => void }) {
  const { repo, ledgerId, switchLedger, toast, commit } = useApp();
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null);
  const [name, setName] = useState('');
  const ledgers = repo.ledgers();


  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 70 }} onClick={onClose} />
      <div className="popover" style={{ zIndex: 80 }}>
        {ledgers.map((l) => (
          <button key={l.id} className={`item ${l.id === ledgerId ? 'on' : ''}`}
            onClick={() => { switchLedger(l.id); onSwitched(l.name); onClose(); }}>
            <span>{l.symbol}</span>
            <span style={{ flex: 1 }}>{l.name}</span>
            <span className="hint">{repo.txnCount(l.id)} 笔</span>
            {l.isDefault && <span className="hint">默认</span>}
          </button>
        ))}
        <div className="sep" />
        <button className="item" onClick={() => { setNaming('new'); setName('新账本'); }}>＋ 新建账本</button>
        <button className="item" onClick={() => { setNaming('rename'); setName(ledgers.find((l) => l.id === ledgerId)?.name ?? ''); }}>✎ 重命名当前账本</button>
        {naming && <form style={{ padding: 12 }} onSubmit={async (event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          if (naming === 'new') {
            const id = repo.nextId('L');
            if (!await commit(() => repo.insertLedger({ id, name: trimmed, symbol: '📗', currency: 'CNY', isDefault: false, archived: false, sortOrder: ledgers.length }))) return;
            switchLedger(id); toast(`已创建「${trimmed}」`);
          } else {
            if (!await commit(() => repo.updateLedgerAllowedFields(ledgerId, { name: trimmed }))) return; toast('已重命名'); onSwitched(trimmed);
          }
          onClose();
        }}>
          <label>{naming === 'new' ? '新账本名称' : '账本名称'}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={40} style={{ width: '100%', margin: '8px 0' }} /></label>
          <div className="row"><button className="btn primary" type="submit">保存</button><button className="btn" type="button" onClick={() => setNaming(null)}>取消</button></div>
        </form>}
        <button className="item" onClick={async () => {
          if (!await commit(() => repo.setDefaultLedger(ledgerId))) return; toast('已设为默认账本'); onClose();
        }}>★ 设为默认账本</button>
        <button className="item" onClick={async () => {
          if (ledgers.length <= 1) { toast('至少保留一个账本'); return; }
          if (!confirm('归档当前账本？归档后不在切换列表显示')) return;
          const first = ledgers.find((l) => l.id !== ledgerId);
          if (!await commit(() => repo.updateLedgerAllowedFields(ledgerId, { archived: true }))) return;
          if (first) switchLedger(first.id);
          toast('已归档'); onClose();
        }}>📦 归档当前账本</button>
      </div>
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
