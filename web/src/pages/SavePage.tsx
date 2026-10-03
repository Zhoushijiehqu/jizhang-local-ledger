import { useMemo, useState } from 'react';
import { useApp } from '../state/app';
import { money, pct, yuan } from '../core/money';
import { SAVE_FREQ_LABEL, SAVE_PLAN_LABEL, type SavePlanType } from '../core/enums';
import { PlanForm } from '../components/forms';
import type { SavePlan } from '../core/types';

const pad = (n: number) => String(n).padStart(2, '0');
const fmtYMD = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

export function SavePage() {
  const { engine, nowSec, repo, commit, toast } = useApp();
  const [deposit, setDeposit] = useState('1000');
  const [planForm, setPlanForm] = useState<{ open: boolean; type: SavePlanType; plan: SavePlan | null }>({ open: false, type: 'fixed', plan: null });
  const plans = useMemo(() => engine.allSavePlans(), [engine]);
  const [selected, setSelected] = useState<string | null>(null);
  const planId = selected ?? plans[0]?.id ?? null;
  const prog = planId ? engine.savePlanProgress(planId) : null;

  return (
    <div className="grid-2col">
      <div className="col">
        <div className="plan-grid">
          <button className="plan-entry" onClick={() => setPlanForm({ open: true, type: 'fixed', plan: null })}>
            <span className="ico">📅</span>定额存钱
          </button>
          <button className="plan-entry" onClick={() => setPlanForm({ open: true, type: 'flexible', plan: null })}>
            <span className="ico">💧</span>灵活存钱
          </button>
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title">我的计划</span></div>
          {plans.length === 0 && <div className="empty">还没有存钱计划</div>}
          {plans.map((p) => {
            const gp = engine.savePlanProgress(p.id)!;
            return (
              <div key={p.id} className="plan-card" onClick={() => setSelected(p.id)}
                style={{ cursor: 'pointer', borderColor: p.id === planId ? 'rgba(47,124,246,.5)' : undefined }}>
                <div className="row">
                  <span className="ico" style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--surface-sub)', display: 'grid', placeItems: 'center', fontSize: 15 }}>{p.emoji}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name} {p.emoji}</span>
                  <span className="spacer" />
                  <button className="btn" onClick={(e) => {
                    e.stopPropagation();
                    setPlanForm({ open: true, type: p.type, plan: p });
                  }}>编辑</button>
                  <span className="hint">›</span>
                </div>
                <div className="dot-row">
                  <span className="pill type">{SAVE_PLAN_LABEL[p.type]}</span>
                  {p.type === 'fixed' && <span className="pill">{SAVE_FREQ_LABEL[p.frequency]}</span>}
                </div>
                <div className="hint">{fmtYMD(p.startDate)} - {fmtYMD(p.endDate)}</div>
                <div className="kv"><span className="k">目标金额</span><span className="v">{money(p.target)}</span></div>
                <div className="two-box">
                  <div className="mini-box"><div className="k">● 已存金额</div><div className="v">{money(gp.saved)}</div></div>
                  <div className="mini-box"><div className="k">● 剩余未存</div><div className="v">{money(gp.remaining)}</div></div>
                </div>
                <div className="progress-row">
                  <div className="progress" style={{ flex: 1 }}><i style={{ width: `${Math.min(gp.progress * 100, 100)}%` }} /></div>
                  <span className="pc">{pct(gp.progress)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="col">
        {prog ? (
          <>
            <div className="card">
              <div className="card-head">
                <span className="card-title">计划详情</span>
                <button className="btn" onClick={() => setPlanForm({ open: true, type: prog.plan.type, plan: prog.plan })}>
                  编辑 / 删除
                </button>
              </div>
              <div className="row">
                <span className="ico" style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface-sub)', display: 'grid', placeItems: 'center', fontSize: 17 }}>{prog.plan.emoji}</span>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{prog.plan.name}</div>
                  <div className="dot-row">
                    <span className="pill type">{SAVE_PLAN_LABEL[prog.plan.type]}</span>
                    {prog.plan.type === 'fixed' && <span className="pill">{SAVE_FREQ_LABEL[prog.plan.frequency]}</span>}
                  </div>
                </div>
              </div>
              <div className="hint">{fmtYMD(prog.plan.startDate)} - {fmtYMD(prog.plan.endDate)}</div>
              <div className="kv"><span className="k">目标金额</span><span className="v">{money(prog.plan.target)}</span></div>
              <div className="two-box">
                <div className="mini-box"><div className="k">● 已存金额</div><div className="v">{money(prog.saved)}</div></div>
                <div className="mini-box"><div className="k">● 剩余未存</div><div className="v">{money(prog.remaining)}</div></div>
              </div>
              <div className="progress-row">
                <div className="progress" style={{ flex: 1 }}><i style={{ width: `${Math.min(prog.progress * 100, 100)}%` }} /></div>
                <span className="pc">{pct(prog.progress)}</span>
              </div>
            </div>

            {prog.plan.type === 'fixed' && (
              <div className="card">
                <div className="card-head">
                  <span className="card-title">存钱卡片</span>
                  <span className="card-dim">已存 {prog.cardSaved} / {prog.cardTotal} 期</span>
                </div>
                <div className="card-grid">
                  {prog.cards.map((c) => {
                    const d = new Date(c.dueDate * 1000);
                    return (
                      <button key={c.id} className={`save-card ${c.status === 'saved' ? 'done' : ''}`}
                        style={{ border: 'none', width: '100%', textAlign: 'left', background: c.status === 'saved' ? undefined : 'var(--surface-sub)' }}
                        onClick={async () => {
                          const next = c.status === 'saved' ? 'pending' : 'saved';
                          if (!await commit(() => repo.updateSaveCardStatus(c.id, next))) return;
                          toast(next === 'saved' ? `已存 ${money(c.amount)}` : `已撤销 ${money(c.amount)}`);
                        }}>
                        <span>
                          <div className="v">{money(c.amount)}</div>
                          <div className="d">{d.getFullYear()}年{d.getMonth() + 1}月{d.getDate()}日</div>
                        </span>
                        <span className="check">✓</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {prog.plan.type === 'flexible' && (
              <div className="card">
                <div className="card-head"><span className="card-title">存入记录</span></div>
                <div className="cat-list">
                  <div className="kv"><span className="k">累计存入</span><span className="v">{money(prog.saved)}</span></div>
                  <div className="kv"><span className="k">起始日期</span><span className="v">{fmtYMD(prog.plan.startDate)}</span></div>
                  <div className="kv"><span className="k">当前日期</span><span className="v">{fmtYMD(nowSec)}</span></div>
                  <div className="row" style={{ gap: 6, marginTop: 8 }}>
                    <input className="btn" style={{ flex: 1 }} value={deposit}
                      onChange={(e) => setDeposit(e.target.value)} placeholder="存入金额" />
                    <button className="btn primary" onClick={async () => {
                      const amt = yuan(Number(deposit) || 0);
                      if (amt <= 0) { toast('请输入大于 0 的金额'); return; }
                      if (!await commit(() => repo.insertSaveRecord({
                        id: repo.nextId('SR'), planId: prog.plan.id, amount: amt,
                        occurredAt: nowSec, note: '手动存入'
                      }))) return;
                      toast(`已存入 ${money(amt)}`);
                    }}>＋ 存入一笔</button>
                  </div>
                  <div className="hint" style={{ marginTop: 6 }}>存入记录会立即计入「已存金额 / 剩余未存 / 进度」</div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="card empty">选择左侧计划查看详情，或点上方「定额存钱 / 灵活存钱」新建</div>
        )}
      </div>

      {planForm.open && (
        <PlanForm initialType={planForm.type} plan={planForm.plan}
          onClose={() => setPlanForm({ open: false, type: planForm.type, plan: null })} />
      )}
    </div>
  );
}
