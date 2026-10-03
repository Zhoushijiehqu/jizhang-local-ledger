import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Db, loadSqlJs } from '../core/db';
import { Repo } from '../core/repo';
import { MetricsEngine, toSec } from '../core/metrics';
import { buildFreshLedger, buildSampleData } from '../core/seed';
import { clearBytes, downloadFile, loadBytes, saveBytes, todayStamp } from '../core/storage';

import { inspectBackup } from '../core/backup';
import type { Row } from '../core/db';

type Appearance = 'light' | 'dark' | 'system';

export interface ToastAction { label: string; onClick: () => void | Promise<void> }
export interface ToastItem { id: number; text: string; action?: ToastAction }

export interface AppState {
  ready: boolean;
  engine: MetricsEngine;
  repo: Repo;
  /** 当前账本（可切换，见顶栏账本管理） */
  ledgerId: string;
  /** 参考时点（unix 秒）：优先取库内 reference_now */
  nowSec: number;
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  /** 隐私模式：金额全局模糊（记忆于 preference） */
  hideAmount: boolean;
  toggleHideAmount: () => void;
  refresh: () => void;
  commit: (action: () => void) => Promise<boolean>;
  changeTxns: (action: () => void, label: string) => Promise<boolean>;
  undoLast: () => Promise<void>;
  hasUndo: boolean;
  /** 手动刷新：从 IndexedDB 重新读取数据库并重建聚合（多标签页/多窗口时有用） */
  reloadFromStorage: () => Promise<void>;
  exportSqlite: () => void;
  restoreBackup: (bytes: Uint8Array) => Promise<boolean>;
  resetDemo: () => Promise<void>;
  /** 清空全部数据，建立空账本（开始真实记账） */
  startFresh: () => Promise<void>;
  seedMode: boolean;
  toasts: ToastItem[];
  toast: (text: string, action?: ToastAction) => void;
  dismissToast: (id: number) => void;
  switchLedger: (id: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  const [engine, setEngine] = useState<MetricsEngine | null>(null);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [hasUndo, setHasUndo] = useState(false);
  const undoRef = useRef<(() => Promise<void>) | null>(null);
  const writeQueue = useRef(Promise.resolve());
  const repoRef = useRef<Repo | null>(null);
  const restoring = useRef(false);
  const [tick, setTick] = useState(0);
  const [appearance, setAppearance] = useState<Appearance>(() => {
    const saved = localStorage.getItem('appearance');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
  const [seedMode, setSeedMode] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [ledgerId, setLedgerId] = useState<string>('');

  const toast = useCallback((text: string, action?: ToastAction) => {
    const id = Date.now() + Math.round(Math.random() * 1000);
    setToasts([{ id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 15000 : 3500);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const boot = useCallback(async (forceSeed = false) => {
    // Vite 会把 wasm 作为带 hash 的静态资源；忽略 sql.js 传入的文件名，一律返回打包后的地址。
    // （若按文件名拼接，会请求到不存在的 sql-wasm.wasm，服务器回退 index.html → wasm 报 magic word 错）
    const SQL = await loadSqlJs(() => wasmUrl);
    if (forceSeed) await clearBytes();
    const bytes = forceSeed ? null : await loadBytes();
    const db = Db.create(SQL, bytes ?? undefined);
    const r = new Repo(db);
    if (!bytes) {
      if (window.ledgerDesktop && !forceSeed) buildFreshLedger(r);
      else buildSampleData(r);
      setSeedMode(!window.ledgerDesktop || forceSeed);
      await saveBytes(db.export());
    } else {
      const first = r.ledgers()[0];
      setSeedMode(!!first && first.name === '默认账本' && !!r.preference('reference_now'));
    }
    const cur = r.preference('current_ledger');
    const fallback = r.defaultLedger()?.id ?? r.ledgers()[0]?.id ?? '';
    setLedgerId(cur && r.ledgers().some((l) => l.id === cur) ? cur : fallback);
    repoRef.current = r;
    setRepo(r);
    setEngine(new MetricsEngine(r));
    setReady(true);
  }, []);

  useEffect(() => {
    boot().catch((e) => { console.error('初始化失败', e); setStartupError(String(e.message ?? e)); });
  }, [boot]);

  useEffect(() => {
    localStorage.setItem('appearance', appearance);
    const root = document.documentElement;
    const apply = () => {
      const dark = appearance === 'dark'
        || (appearance === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [appearance]);

  const refresh = useCallback(() => {
    setEngine((current) => current ? new MetricsEngine(current.repo) : current);
    setTick((t) => t + 1);
  }, []);

  // All mutations run in one queue; failed file writes restore the same Repo object.
  const commit = useCallback((action: () => void): Promise<boolean> => {
    if (restoring.current) { toast('正在恢复账本，请稍后再保存'); return Promise.resolve(false); }
    const result = writeQueue.current.then(async () => {
      if (!repo || repoRef.current !== repo) { toast('账本已刷新，请重新打开后再保存'); return false; }
      const before = repo.db.export();
      try {
        repo.db.transaction(action);
        await saveBytes(repo.db.export());
        refresh();
        return true;
      } catch (error) {
        repo.db.restore(before);
        refresh();
        console.error('保存失败', error);
        toast('保存失败，账本未改变，请重试');
        return false;
      }
    });
    writeQueue.current = result.then(() => {});
    return result;
  }, [repo, refresh, toast]);

  const changeTxns = useCallback(async (action: () => void, label: string) => {
    if (!repo) return false;
    let before: Row[] = [], after: Row[] = [];
    const ok = await commit(() => {
      before = repo.db.rows('SELECT * FROM txn;');
      action();
      after = repo.db.rows('SELECT * FROM txn;');
    });
    if (!ok) return false;
    const old = new Map(before.map(row => [String(row.id), row]));
    const changed = after.filter(row => JSON.stringify(old.get(String(row.id))) !== JSON.stringify(row));
    const undo = async () => {
      const restored = await commit(() => {
        for (const row of changed) {
          const current = repo.db.rows('SELECT * FROM txn WHERE id=?;', [String(row.id)])[0];
          if (JSON.stringify(current) !== JSON.stringify(row)) throw new Error('账单已有后续修改，请从回收站恢复或编辑');
          const prior = old.get(String(row.id));
          if (!prior) repo.softDeleteTxn(String(row.id));
          else {
            const keys = Object.keys(prior).filter(key => key !== 'id');
            repo.db.run(`UPDATE txn SET ${keys.map(key => `${key}=?`).join(',')} WHERE id=?;`, [...keys.map(key => prior[key]), String(row.id)]);
          }
        }
      });
      if (restored) { undoRef.current = null; setHasUndo(false); toast('已撤销'); }
    };
    undoRef.current = undo;
    setHasUndo(true);
    toast(label, { label: '撤销', onClick: undo });
    return true;
  }, [repo, commit, toast]);
  const undoLast = useCallback(async () => { await undoRef.current?.(); }, []);

  useEffect(() => {
    const update = () => setTick(t => t + 1);
    const timer = window.setInterval(update, 30000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);

  const exportSqlite = useCallback(() => {
    if (!repo) return;
    downloadFile(repo.db.export(), `记账_${todayStamp()}.sqlite`);
  }, [repo]);

  const resetDemo = useCallback(async () => {
    await boot(true);
    setTick((t) => t + 1);
  }, [boot]);

  const startFresh = useCallback(async () => {
    const SQL = await loadSqlJs(() => wasmUrl);
    await clearBytes();                       // 清空浏览器本地数据库
    const db = Db.create(SQL);
    const r = new Repo(db);
    buildFreshLedger(r);                      // 空流水 + 常用分类 + 常见账户
    await saveBytes(db.export());
    const cur = r.preference('current_ledger');
    setLedgerId(cur ?? r.defaultLedger()?.id ?? '');
    repoRef.current = r;
    setRepo(r);
    setEngine(new MetricsEngine(r));
    setSeedMode(false);
    setTick((t) => t + 1);
  }, []);

  const nowSec = useMemo(() => {
    void tick;
    const refPref = repo?.preference('reference_now');
    return refPref ? Number(refPref) : toSec(new Date());
  }, [repo, tick]);

  const hideAmount = useMemo(() => {
    void tick;
    return repo?.preference('hide_amount') === 'true';
  }, [repo, tick]);

  const toggleHideAmount = useCallback(() => {
    if (!repo) return;
    void commit(() => repo.setPreference('hide_amount', hideAmount ? 'false' : 'true'));
  }, [repo, hideAmount, commit]);

  const reloadFromStorage = useCallback(async () => {
    try {
      const SQL = await loadSqlJs(() => wasmUrl);
      await writeQueue.current;
      for (const key of Object.keys(localStorage)) if (key.startsWith('search_filters_cache_')) localStorage.removeItem(key);
      const bytes = await loadBytes();
      if (!bytes) return;
      const db = Db.create(SQL, bytes);
      const r = new Repo(db);
      const cur = r.preference('current_ledger');
      setLedgerId(cur && r.ledgers().some((l) => l.id === cur) ? cur : (r.defaultLedger()?.id ?? ''));
      repoRef.current = r;
      undoRef.current = null; setHasUndo(false);
      setRepo(r);
      setEngine(new MetricsEngine(r));
      setTick((t) => t + 1);
    } catch (e) {
      console.error('刷新失败', e);
      throw e;
    }
  }, []);

  const restoreBackup = useCallback(async (bytes: Uint8Array) => {
    if (restoring.current) return false;
    restoring.current = true;
    try {
      await inspectBackup(bytes);
      await writeQueue.current;
      if (window.ledgerDesktop) await window.ledgerDesktop.restoreBytes(bytes);
      else {
        const previous = await loadBytes();
        if (previous) downloadFile(previous, `恢复前_${todayStamp()}.sqlite`);
        await saveBytes(bytes);
      }
      await reloadFromStorage();
      undoRef.current = null; setHasUndo(false);
      toast('账本已恢复，恢复前的数据已备份');
      return true;
    } catch (error) { console.error(error); toast(`恢复失败：${String((error as Error).message)}`); return false; }
    finally { restoring.current = false; }
  }, [reloadFromStorage, toast]);

  const switchLedger = useCallback((id: string) => {
    if (!repo) return;
    void commit(() => repo.setPreference('current_ledger', id)).then(ok => { if (ok) setLedgerId(id); });
  }, [repo, commit]);

  // 一次性清空：启动器可带 ?fresh=1 打开（仅在识别为演示数据时执行，避免误删真实数据）
  const freshHandled = useRef(false);
  useEffect(() => {
    if (!ready || freshHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('fresh') !== '1') return;
    freshHandled.current = true;
    window.history.replaceState({}, '', window.location.pathname);
    if (seedMode) void startFresh();
  }, [ready, seedMode, startFresh]);

  const value = useMemo<AppState | null>(() => {
    if (!engine || !repo || !ledgerId) return null;
    return {
      ready, engine, repo, ledgerId, nowSec, appearance, setAppearance,
      hideAmount, toggleHideAmount, refresh, commit, changeTxns, undoLast, hasUndo, reloadFromStorage, exportSqlite, restoreBackup, resetDemo, startFresh, seedMode,
      toasts, toast, dismissToast, switchLedger
    };
  }, [engine, repo, ready, ledgerId, nowSec, appearance, hideAmount, toggleHideAmount,
      refresh, commit, changeTxns, undoLast, hasUndo, reloadFromStorage, exportSqlite, restoreBackup, resetDemo, startFresh, seedMode, toasts, toast, dismissToast, switchLedger]);

  if (!value) {
    return (
      <div className="wip">
        <div>
          <div className="big">{startupError ? '账本暂时无法打开' : '正在准备本地数据库…'}</div>
          <div className="hint">{startupError || (window.ledgerDesktop ? '数据仅保存在这台 Mac 上' : '首次运行会写入一份演示账本（数据只保存在本机浏览器内）')}</div>
          {startupError && <button className="btn" onClick={() => window.location.reload()}>重新打开</button>}
        </div>
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider 未挂载');
  return v;
}
