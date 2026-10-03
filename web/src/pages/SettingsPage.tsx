import { useEffect, useState } from 'react';
import { downloadFile } from '../core/storage';
import { useApp } from '../state/app';
import { money } from '../core/money';
import { DENOMINATOR_LABEL, type DayDenominator } from '../core/enums';
import { DataManager } from '../components/DataManager';
import { MacShortcuts } from '../components/MacShortcuts';
import { BudgetManager, CategoryManager, TemplateManager } from '../components/managers';

type Tab = 'general' | 'category' | 'budget' | 'template' | 'data';

const TABS: Array<[Tab, string]> = [
  ['general', '通用'], ['category', '分类'], ['budget', '预算'], ['template', '模板'], ['data', '数据']
];

export function SettingsPage() {
  const { engine, ledgerId, repo, appearance, setAppearance, exportSqlite, resetDemo, startFresh, commit, seedMode, toast } = useApp();
  const [tab, setTab] = useState<Tab>('general');
  const [denom, setDenom] = useState<DayDenominator>(
    (repo.preference('day_denominator') as DayDenominator) ?? 'elapsed'
  );
  const [busy, setBusy] = useState(false);
  const [rememberFilters, setRememberFilters] = useState(repo.preference('remember_search_filters') === 'true');
  useEffect(() => {setRememberFilters(repo.preference('remember_search_filters') === 'true');setDenom((repo.preference('day_denominator') as DayDenominator) ?? 'elapsed');}, [repo]);
  const accounts = repo.accounts(ledgerId);
  const cats = repo.categories(ledgerId);
  const txns = repo.txns(ledgerId);
  const templates = repo.templates(ledgerId);

  return (
    <div className="col">
      <div className="card" style={{ padding: 10 }}>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {TABS.map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      {tab === 'general' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
          <div className="col">
            <MacShortcuts />
            <div className="card">
              <div className="card-head"><span className="card-title">外观</span></div>
              <div className="seg">
                {(['light', 'dark', 'system'] as const).map((a) => (
                  <button key={a} className={appearance === a ? 'on' : ''} onClick={() => setAppearance(a)}>
                    {a === 'light' ? '浅色' : a === 'dark' ? '深色' : '跟随系统'}
                  </button>
                ))}
              </div>
              <div className="hint" style={{ marginTop: 8 }}>
                浅色 / 深色两套主题均已适配。
              </div>
            </div>

            <div className="card">
              <div className="card-head"><span className="card-title">搜索</span></div>
              <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={rememberFilters} onChange={async (e) => {
                  const next = e.target.checked;
                  if (await commit(() => repo.setPreference('remember_search_filters', String(next)))) setRememberFilters(next);
                }} />
                <span className="hint">保留搜索筛选条件（下次打开沿用上次的时间/排序/更多条件）</span>
              </label>
            </div>

            <div className="card">
              <div className="card-head"><span className="card-title">统计口径</span></div>
              <div className="hint" style={{ marginBottom: 8 }}>
                日均支出的计算分母：可选「已过天数」或「自然月天数」。
              </div>
              <div className="seg" style={{ flexWrap: 'wrap' }}>
                {(['natural', 'elapsed', 'spending', 'active'] as DayDenominator[]).map((d) => (
                  <button key={d} className={denom === d ? 'on' : ''} onClick={async () => {
                    if (await commit(() => repo.setPreference('day_denominator', d))) setDenom(d);
                  }}>{DENOMINATOR_LABEL[d]}</button>
                ))}
              </div>
              <div className="hint" style={{ marginTop: 8 }}>
                当前：{DENOMINATOR_LABEL[denom]}；统计页趋势图使用相同日均口径，账本页月图平均值按自然日计算。
              </div>
            </div>
          </div>

          <div className="col">
            <div className="card">
              <div className="card-head"><span className="card-title">本地数据</span></div>
              <div className="kv"><span className="k">账本</span><span className="v">{repo.ledgers().length}</span></div>
              <div className="kv"><span className="k">账户</span><span className="v">{accounts.length}</span></div>
              <div className="kv"><span className="k">分类</span><span className="v">{cats.length}</span></div>
              <div className="kv"><span className="k">账单</span><span className="v">{txns.length}</span></div>
              <div className="kv"><span className="k">记账模板</span><span className="v">{templates.length}</span></div>
              <div className="kv"><span className="k">存储位置</span><span className="v">{window.ledgerDesktop ? '本机账本文件 · 自动备份' : '本机浏览器 IndexedDB'}</span></div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={exportSqlite}>导出 .sqlite</button>
                <button className="btn" onClick={() => {
                  const json = JSON.stringify({
                    ledger: repo.ledgers(), account: repo.accounts(ledgerId),
                    category: repo.categories(ledgerId), txn: repo.txns(ledgerId),
                    template: repo.templates(ledgerId)
                  }, null, 2);
                  downloadFile(new TextEncoder().encode(json), '记账_导出.json', 'application/json');
                }}>导出 JSON（部分数据）</button>
                {window.ledgerDesktop && <button className="btn" onClick={() => void window.ledgerDesktop?.showDataFolder()}>打开数据文件夹</button>}
              </div>
              <div className="hint" style={{ marginTop: 8 }}>.sqlite 可在「数据」页预览并恢复；JSON 是当前账本的部分数据。</div>
            </div>

            {seedMode && <div className="card">
              <div className="card-head"><span className="card-title">演示数据</span></div>
              <div className="hint" style={{ marginBottom: 8 }}>
                {seedMode
                  ? '当前为演示账本（数据截至 2024-05）。'
                  : '当前为你的真实账本数据。'}
              </div>
              <button className="btn" disabled={busy} onClick={async () => {
                if (!confirm('将清空当前数据并重建演示账本，确定继续？')) return;
                setBusy(true);
                await resetDemo();
                setBusy(false);
              }}>{busy ? '重建中…' : '重建演示账本（会清空当前数据）'}</button>
            </div>}
          </div>
        </div>
      )}

      {tab === 'category' && <CategoryManager />}
      {tab === 'budget' && <BudgetManager />}
      {tab === 'template' && <TemplateManager />}

      {tab === 'data' && <DataManager />}
    </div>
  );
}
