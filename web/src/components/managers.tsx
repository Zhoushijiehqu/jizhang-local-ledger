import { useState } from 'react';
import { useApp } from '../state/app';
import { money, yuan } from '../core/money';
import { DIRECTION_LABEL, SAVE_PLAN_LABEL, type BudgetPeriod, type Direction } from '../core/enums';
import { accountOptionLabel } from './AccountIcon';

/** 分类管理 */
export function CategoryManager() {
  const { repo, ledgerId, commit, engine, nowSec } = useApp();
  const [dir, setDir] = useState<Direction>('expense');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', icon: '', color: '#8E8E93', cascade: true });
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('');
  const [newParent, setNewParent] = useState<string>('');

  const cats = repo.categories(ledgerId, dir);
  const top = cats.filter((c) => c.parentId === null);

  // 分类金额：以当前月份为准
  const month = engine.monthRange(nowSec);
  const slices = engine.categoryBreakdown(ledgerId, month, dir);
  const amountOf = (id: string) => slices.find((s) => s.categoryId === id)?.amount ?? 0;

  const startEdit = (id: string) => {
    const c = cats.find((x) => x.id === id);
    if (!c) return;
    setEditing(id);
    setDraft({ name: c.name, icon: c.icon, color: c.colorHex, cascade: true });
  };

  const commitEdit = async () => {
    if (!editing) return;
    if (!await commit(() => repo.updateCategoryAllowedFields(editing, {
      name: draft.name, icon: draft.icon, colorHex: draft.color
    }, draft.cascade))) return;
    setEditing(null);
  };

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">分类管理</span>
        <div className="seg">
          {(['expense', 'income'] as Direction[]).map((d) => (
            <button key={d} className={dir === d ? 'on' : ''} onClick={() => setDir(d)}>{DIRECTION_LABEL[d]}</button>
          ))}
        </div>
      </div>

      <div className="cat-list">
        {top.map((c) => {
          const children = cats.filter((x) => x.parentId === c.id);
          return (
            <div key={c.id}>
              <div className="cat-row">
                <span className="ico" style={{ background: c.colorHex + '22' }}>{c.icon}</span>
                {editing === c.id ? (
                  <EditRow draft={draft} setDraft={setDraft} onCommit={commitEdit} onCancel={() => setEditing(null)}
                    isParent={children.length > 0} showCascade />
                ) : (
                  <>
                    <span>
                      <div className="name">{c.name} <span className="hint">{children.length} 个子类</span></div>
                      <div className="meta">{c.archived ? '已归档' : '使用中'}　本月 {money(amountOf(c.id))}</div>
                    </span>
                    <span className="row" style={{ gap: 5 }}>
                      <button className="btn" onClick={() => startEdit(c.id)}>编辑</button>
                      <button className="btn" onClick={() => {
                        void commit(() => repo.updateCategoryAllowedFields(c.id, { archived: !c.archived }));
                                          }}>{c.archived ? '恢复' : '归档'}</button>
                      <button className="btn" onClick={() => {
                        if (confirm(`删除「${c.name}」及其全部二级分类？`)) {
                          void commit(() => repo.softDeleteCategory(c.id));
                                              }
                      }}>删除</button>
                    </span>
                  </>
                )}
              </div>
              {children.map((s) => (
                <div key={s.id} className="cat-row" style={{ paddingLeft: 22 }}>
                  <span className="ico" style={{ background: s.colorHex + '22' }}>{s.icon}</span>
                  {editing === s.id ? (
                    <EditRow draft={draft} setDraft={setDraft} onCommit={commitEdit} onCancel={() => setEditing(null)} />
                  ) : (
                    <>
                      <span>
                        <div className="name">{s.name}</div>
                        <div className="meta">{s.archived ? '已归档' : '使用中'}　本月 {money(amountOf(s.id))}</div>
                      </span>
                      <span className="row" style={{ gap: 5 }}>
                        <button className="btn" onClick={() => startEdit(s.id)}>编辑</button>
                        <button className="btn" onClick={() => {
                          void commit(() => repo.updateCategoryAllowedFields(s.id, { archived: !s.archived }));
                                              }}>{s.archived ? '恢复' : '归档'}</button>
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <input className="btn" style={{ width: 44, textAlign: 'center' }} placeholder="图标" value={newIcon}
          onChange={(e) => setNewIcon(e.target.value)} />
        <input className="btn" style={{ flex: 1 }} placeholder="新分类名称" value={newName}
          onChange={(e) => setNewName(e.target.value)} />
        <select className="btn" value={newParent} onChange={(e) => setNewParent(e.target.value)}>
          <option value="">作为一级分类</option>
          {top.map((c) => <option key={c.id} value={c.id}>挂在「{c.name}」下</option>)}
        </select>
        <button className="btn primary" disabled={!newName.trim()} onClick={async () => {
          if (!await commit(() => repo.insertCategory({
            id: repo.nextId('C'), ledgerId, parentId: newParent || null, name: newName.trim(),
            direction: dir, icon: newIcon || '🏷', colorHex: '#8E8E93', iconStyle: 'mono',
            isSystem: false, archived: false, hidden: false, sortOrder: 99
          }))) return;
          setNewName(''); setNewIcon(''); setNewParent('');
              }}>新增</button>
      </div>
    </div>
  );
}

function EditRow({ draft, setDraft, onCommit, onCancel, isParent, showCascade }: {
  draft: { name: string; icon: string; color: string; cascade: boolean };
  setDraft: (d: { name: string; icon: string; color: string; cascade: boolean }) => void;
  onCommit: () => void; onCancel: () => void; isParent?: boolean; showCascade?: boolean;
}) {
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <input className="btn" style={{ width: 44, textAlign: 'center' }} value={draft.icon}
        onChange={(e) => setDraft({ ...draft, icon: e.target.value })} />
      <input className="btn" style={{ width: 110 }} value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })}
        style={{ width: 34, height: 26, border: 'none', background: 'transparent', padding: 0 }} />
      {showCascade && isParent && (
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={draft.cascade}
            onChange={(e) => setDraft({ ...draft, cascade: e.target.checked })} />
          <span className="hint">同步二级</span>
        </label>
      )}
      <button className="btn primary" onClick={onCommit}>保存</button>
      <button className="btn" onClick={onCancel}>取消</button>
    </span>
  );
}

/** 预算设置 */
export function BudgetManager() {
  const { repo, ledgerId, commit, engine, nowSec, toast } = useApp();
  const stored = repo.totalBudget(ledgerId);
  const budget = engine.budgetSnapshot(ledgerId, nowSec, nowSec);
  // 初始值读取数据库里已存的预算（此前 period 写死为 monthly，保存后重开又变回按月）；
  // 用户偏好：新预算默认「按周」
  const [amountStr, setAmountStr] = useState(String((stored?.amount ?? 0) / 100));
  const [period, setPeriod] = useState<BudgetPeriod>(stored?.period ?? 'weekly');
  const [carry, setCarry] = useState(stored?.carryOver ?? false);

  return (
    <div className="card">
      <div className="card-head"><span className="card-title">预算设置</span></div>
      <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input className="btn" style={{ width: 140 }} value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
        <div className="seg">
          <button className={period === 'monthly' ? 'on' : ''} onClick={() => setPeriod('monthly')}>按月</button>
          <button className={period === 'weekly' ? 'on' : ''} onClick={() => setPeriod('weekly')}>按周</button>
        </div>
        <label className="row" style={{ gap: 5 }}>
          <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
          <span className="hint">开启预算结转</span>
        </label>
        <button className="btn primary" onClick={async () => {
          if (!Number.isFinite(Number(amountStr)) || Number(amountStr) < 0) { toast("请输入有效预算金额"); return; }
          if (!await commit(() => repo.updateBudget(ledgerId, yuan(Number(amountStr) || 0), carry, period))) return;
          toast(`已保存预算：${period === 'weekly' ? '按周' : '按月'} ${money(yuan(Number(amountStr) || 0))}`);
        }}>保存</button>
      </div>
      <div className="kv"><span className="k">基础预算</span><span className="v">{money(budget.base)}</span></div>
      {budget.carryOver && <div className="kv"><span className="k">上期结转</span><span className="v">{money(budget.carried)}</span></div>}
      <div className="kv"><span className="k">总预算</span><span className="v">{money(budget.total)}</span></div>
      <div className="kv"><span className="k">已用</span><span className="v">{money(budget.used)}</span></div>
      <div className="kv"><span className="k">剩余</span><span className="v">{money(budget.remaining)}</span></div>
      <div className="kv"><span className="k">剩余天数（不含今天）</span><span className="v">{budget.daysLeft} 天</span></div>
      <div className="kv"><span className="k">剩余日均</span><span className="v">{money(budget.remainingDaily)}</span></div>
      <div className="hint" style={{ marginTop: 8 }}>
        开启结转后，按预算生效日起的当前基础预算计算累计结余，超支也顺延；补记旧账会重新计算结转。
      </div>
    </div>
  );
}

/** 记账模板管理 */
export function TemplateManager() {
  const { repo, ledgerId, commit } = useApp();
  const templates = repo.templates(ledgerId);
  const cats = repo.categories(ledgerId);
  const accounts = repo.accounts(ledgerId);
  const [form, setForm] = useState({
    name: '', emoji: '☕', direction: 'expense' as Direction,
    amount: '9.90', categoryId: cats[0]?.id ?? '', accountId: accounts[0]?.id ?? ''
  });

  return (
    <div className="card">
      <div className="card-head"><span className="card-title">记账模板</span>
        <span className="card-dim">{templates.length} 个</span></div>
      <div className="cat-list">
        {templates.map((t) => (
          <div key={t.id} className="cat-row">
            <span className="ico">{t.emoji}</span>
            <span>
              <div className="name">{t.name}</div>
              <div className="meta">{DIRECTION_LABEL[t.direction]} · {money(t.amount)}</div>
            </span>
            <span className="row" style={{ gap: 6 }}>
              <span className="amt">{money(t.amount)}</span>
              <button className="btn" onClick={() => { void commit(() => repo.deleteTemplate(t.id)); }}>删除</button>
            </span>
          </div>
        ))}
        {templates.length === 0 && <div className="empty">还没有模板</div>}
      </div>
      <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <input className="btn" style={{ width: 44, textAlign: 'center' }} value={form.emoji}
          onChange={(e) => setForm({ ...form, emoji: e.target.value })} />
        <input className="btn" style={{ width: 120 }} placeholder="模板名" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="btn" style={{ width: 80 }} value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <select className="btn" value={form.direction}
          onChange={(e) => setForm({ ...form, direction: e.target.value as Direction })}>
          <option value="expense">支出</option>
          <option value="income">收入</option>
        </select>
        <select className="btn" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
          {cats.filter((c) => c.direction === form.direction).map((c) => (
            <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
          ))}
        </select>
        <select className="btn" value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>)}
        </select>
        <button className="btn primary" disabled={!form.name.trim()} onClick={async () => {
          if (!await commit(() => repo.insertTemplate({
            id: repo.nextId('TP'), ledgerId, name: form.name.trim(), emoji: form.emoji,
            direction: form.direction, amount: yuan(Number(form.amount) || 0),
            categoryId: form.categoryId || null, accountId: form.accountId || null,
            sortOrder: templates.length
          }))) return;
          setForm({ ...form, name: '' });
        }}>新增模板</button>
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        模板在账本页「记一笔」旁可一键套用（下一程接入）；{SAVE_PLAN_LABEL.fixed} 计划同理
      </div>
    </div>
  );
}
