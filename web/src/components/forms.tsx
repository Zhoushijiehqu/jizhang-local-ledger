import { useMemo, useState } from 'react';
import { useApp } from '../state/app';
import { money, yuan } from '../core/money';
import {
  ACCOUNT_GROUP_LABEL, ACCOUNT_KIND_LABEL, SAVE_FREQ_LABEL, SAVE_PLAN_LABEL,
  type AccountGroup, type AccountKind, type SaveFrequency, type SavePlanType
} from '../core/enums';
import type { Account, SavePlan } from '../core/types';
import { planCardAmounts, planCardDueDates, planPerPeriod } from '../core/plan';
import { AccountIcon, accountOptionLabel } from './AccountIcon';

const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const toDateTimeInput = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${toDateInput(sec)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromDateInput = (s: string) => Math.floor(new Date(s + 'T00:00:00').getTime() / 1000);
const fromDateTimeInput = (s: string) => Math.floor(new Date(s).getTime() / 1000);

/** 各分组允许的账户类型 */
const KINDS_OF_GROUP: Record<AccountGroup, AccountKind[]> = {
  fund: ['alipay', 'wechat', 'debitCard', 'cash', 'savings', 'current', 'housingFund', 'other'],
  credit: ['creditCard', 'familyCredit'],
  prepaid: ['transitCard', 'octopus'],
  receivable: ['other'],
  payable: ['loan', 'other'],
  investment: ['savings', 'current', 'other']
};

const GROUPS: AccountGroup[] = ['fund', 'credit', 'prepaid', 'receivable', 'payable', 'investment'];

function Modal({ title, onClose, onSave, saveLabel, children, extra }: {
  title: string; onClose: () => void; onSave: () => void; saveLabel?: string;
  children: React.ReactNode; extra?: React.ReactNode;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid',
      placeItems: 'center', zIndex: 75, padding: 20
    }} onClick={onClose}>
      <div className="card" style={{ width: 440, padding: 20, maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <button className="btn" onClick={onClose}>取消</button>
          <span className="card-title">{title}</span>
          <span className="row" style={{ gap: 6 }}>
            {extra}
            <button className="btn primary" onClick={onSave}>{saveLabel ?? '保存'}</button>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 新建 / 编辑账户 —— 这就是"新增净资产"的入口：净资产 = Σ账户余额 − 负债 */
export function AccountForm({ account = null, onClose }: { account?: Account | null; onClose: () => void }) {
  const { repo, ledgerId, commit, toast } = useApp();
  const editing = !!account;
  const [group, setGroup] = useState<AccountGroup>(account?.group ?? 'fund');
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'alipay');
  const [name, setName] = useState(account?.name ?? '');
  const [icon, setIcon] = useState(account?.icon ?? '💳');
  const [mask, setMask] = useState(account?.cardNoMask ?? '');
  const [balance, setBalance] = useState(account ? (account.initialBalance / 100).toFixed(2) : '0.00');
  const [limit, setLimit] = useState(account && account.creditLimit ? (account.creditLimit / 100).toFixed(0) : '20000');
  const [billDay, setBillDay] = useState(String(account?.billDay ?? 10));
  const [repayDay, setRepayDay] = useState(String(account?.repayDay ?? 28));
  const [hidden, setHidden] = useState(account?.hidden ?? false);

  const isCredit = group === 'credit';
  const kinds = KINDS_OF_GROUP[group];
  const valid = name.trim().length > 0 && kinds.includes(kind);

  const changeGroup = (g: AccountGroup) => {
    setGroup(g);
    if (!KINDS_OF_GROUP[g].includes(kind)) setKind(KINDS_OF_GROUP[g][0]);
  };

  const save = async () => {
    if (!valid) return;
    const base = {
      name: name.trim(),
      icon: icon || ACCOUNT_KIND_LABEL[kind].slice(0, 1),
      kind,
      group,
      cardNoMask: mask.trim() || null,
      initialBalance: yuan(Number(balance) || 0),
      creditLimit: isCredit ? yuan(Number(limit) || 0) : 0,
      billDay: isCredit ? Number(billDay) || null : null,
      repayDay: isCredit ? Number(repayDay) || null : null,
      hidden
    };
    if (!await commit(() => {
    if (editing && account) {
      repo.updateAccountFull(account.id, base);
    } else {
      repo.insertAccount({
        id: repo.nextId('A'), ledgerId, currency: 'CNY',
        groupName: null, isFamilyCredit: kind === 'familyCredit', sortOrder: 90,
        ...base,
        kind: kind as AccountKind,
        group: group as AccountGroup
      });
    }
    })) return;
    toast(editing ? "账户已更新" : `已新增「${base.name}」`);
    onClose();
  };

  const remove = async () => {
    if (!account) return;
    const n = repo.countTxnsOfAccount(account.id);
    const msg = n > 0
      ? `该账户有 ${n} 笔关联流水。删除后这些流水将显示不出账户名，建议改为「隐藏」。\n\n确定仍要删除吗？`
      : '确定删除这个账户吗？';
    if (!confirm(msg)) return;
    if (!await commit(() => repo.softDeleteAccount(account.id))) return;
    toast('账户已删除');
    onClose();
  };

  return (
    <Modal title={editing ? '编辑账户' : '新增账户'} onClose={onClose} onSave={save}
      saveLabel={editing ? '保存' : '创建'}
      extra={editing ? <button className="btn" onClick={remove}>删除</button> : undefined}>
      <div className="field-label">账户分组</div>
      <div className="seg" style={{ flexWrap: 'wrap' }}>
        {GROUPS.map((g) => (
          <button key={g} className={group === g ? 'on' : ''} onClick={() => changeGroup(g)}>
            {ACCOUNT_GROUP_LABEL[g]}
          </button>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        {isCredit ? '信用账户计入「总负债」，其余分组计入「总资产」——净资产 = 总资产 − 总负债'
                  : '该分组计入「总资产」，直接影响净资产'}
      </div>

      <div className="field-label">账户类型</div>
      <select className="btn" style={{ width: '100%', height: 34 }} value={kind}
        onChange={(e) => setKind(e.target.value as AccountKind)}>
        {kinds.map((k) => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}
      </select>

      <div className="field-label">名称与图标</div>
      <div className="row" style={{ gap: 8 }}>
        {kind === 'wechat' ? <span className="btn" title="微信官方图标" style={{ width: 56, height: 34, justifyContent: 'center' }}>
          <AccountIcon account={{ kind, icon }} size={30} />
        </span> : <input className="btn" style={{ width: 56, textAlign: 'center', height: 34 }} value={icon}
          onChange={(e) => setIcon(e.target.value)} />}
        <input className="btn" style={{ flex: 1, height: 34 }} placeholder="例如：招商银行 / 支付宝"
          value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="field-label">卡号（可选，会按掩码显示）</div>
      <input className="btn" style={{ width: '100%', height: 34 }} placeholder="622X XXXX XXXX XX88"
        value={mask} onChange={(e) => setMask(e.target.value)} />

      <div className="field-label">{isCredit ? '当前欠款 / 信用额度' : '当前余额'}</div>
      <div className="row" style={{ gap: 8 }}>
        <input className="btn" style={{ flex: 1, height: 34 }} value={balance}
          onChange={(e) => setBalance(e.target.value)} placeholder="0.00" />
        {isCredit && (
          <input className="btn" style={{ flex: 1, height: 34 }} value={limit}
            onChange={(e) => setLimit(e.target.value)} placeholder="额度" />
        )}
      </div>

      {isCredit && (
        <>
          <div className="field-label">账单日 / 还款日</div>
          <div className="row" style={{ gap: 8 }}>
            <input className="btn" style={{ width: 90, height: 34 }} value={billDay}
              onChange={(e) => setBillDay(e.target.value)} />
            <input className="btn" style={{ width: 90, height: 34 }} value={repayDay}
              onChange={(e) => setRepayDay(e.target.value)} />
            <span className="hint">每月几号</span>
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          <span className="hint">在资产页隐藏（保留数据，不计入统计）</span>
        </label>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        提示：已有流水后再改「当前余额」相当于修改期初余额，历史账单不会变动。
      </div>
    </Modal>
  );
}

/** 存钱计划：新建 / 编辑（定额计划会按期数自动生成存钱卡片） */
export function PlanForm({ initialType = 'fixed', plan = null, onClose }: {
  initialType?: SavePlanType;
  plan?: SavePlan | null;
  onClose: () => void;
}) {
  const { repo, ledgerId, nowSec, commit, toast } = useApp();
  const editing = !!plan;
  const accounts = repo.accounts(ledgerId);
  const fundAccounts = accounts.filter((a) => a.group === 'fund');

  const [emoji, setEmoji] = useState(plan?.emoji ?? (initialType === 'fixed' ? '📅' : '💧'));
  const [name, setName] = useState(plan?.name ?? '');
  const [type, setType] = useState<SavePlanType>(plan?.type ?? initialType);
  const [frequency, setFrequency] = useState<SaveFrequency>(plan?.frequency ?? 'monthly');
  const [start, setStart] = useState(toDateInput(plan?.startDate ?? nowSec));
  const [end, setEnd] = useState(toDateInput(plan?.endDate ?? (nowSec + 86400 * 365)));
  const [target, setTarget] = useState(plan ? (plan.target / 100).toFixed(0) : '10000');
  const [fromAccountId, setFromAccountId] = useState(plan?.fromAccountId ?? fundAccounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState(plan?.toAccountId ?? '');

  const startSec = useMemo(() => fromDateInput(start), [start]);
  const endSec = useMemo(() => fromDateInput(end), [end]);

  // 期数与各期到期时间：统一走 core/plan（表单与验收脚本共用同一实现，避免两份漂移）
  const dueDates = useMemo(
    () => (type === 'fixed' && endSec > startSec ? planCardDueDates(startSec, endSec, frequency) : []),
    [type, frequency, startSec, endSec]);
  const periods = dueDates.length;

  const targetCents = yuan(Number(target) || 0);
  const amounts = useMemo(() => planCardAmounts(targetCents, periods), [targetCents, periods]);
  const perPeriod = planPerPeriod(targetCents, periods);
  const valid = name.trim().length > 0 && targetCents > 0 && endSec > startSec;

  const save = async () => {
    if (!valid) return;
    const base = {
      name: name.trim(), emoji: emoji || '🎯', frequency,
      startDate: startSec, endDate: endSec, target: targetCents,
      fromAccountId: fromAccountId || null, toAccountId: toAccountId || null
    };
    if (!await commit(() => {
    let planId = plan?.id ?? '';
    if (editing && plan) {
      repo.updateSavePlanFull(plan.id, { ...base, type });
    } else {
      planId = repo.nextId('P');
      repo.insertSavePlan({
        id: planId, ledgerId, archived: false, ...base, type
      });
    }

    // 定额计划：按期数重建存钱卡片；已存状态按序号保留
    if (type === 'fixed') {
      const old = editing ? repo.saveCards(planId) : [];
      const savedSeq = new Set(old.filter((c) => c.status === 'saved').map((c) => c.seq));
      const savedTxn = new Map(old.map((c) => [c.seq, c.txnId]));
      repo.deleteSaveCards(planId);
      dueDates.forEach((due, idx) => {
        const seq = idx + 1;
        repo.insertSaveCard({
          id: `${planId}_C${seq}`, planId, seq, dueDate: due,
          amount: amounts[idx], status: savedSeq.has(seq) ? 'saved' : 'pending',
          txnId: savedTxn.get(seq) ?? null
        });
      });
    } else if (editing && plan && plan.type === 'fixed') {
      repo.deleteSaveCards(planId);   // 由定额改为灵活：清掉卡片
    }

    })) return;
    toast(editing ? '计划已更新' : `已创建计划「${base.name}」`);
    onClose();
  };

  const remove = async () => {
    if (!plan) return;
    const prog = repo.saveRecords(plan.id).length + repo.saveCards(plan.id).filter((c) => c.status === 'saved').length;
    if (!confirm(prog > 0
      ? '该计划已有存入记录，删除会一并清掉这些记录。确定删除吗？'
      : '确定删除这个计划吗？')) return;
    if (!await commit(() => repo.deleteSavePlan(plan.id))) return;
    toast('计划已删除');
    onClose();
  };

  return (
    <Modal title={editing ? '编辑计划' : (type === 'fixed' ? '新建定额存钱' : '新建灵活存钱')}
      onClose={onClose} onSave={save} saveLabel={editing ? '保存' : '创建'}
      extra={editing ? <button className="btn" onClick={remove}>删除</button> : undefined}>
      <div className="field-label">名称与图标</div>
      <div className="row" style={{ gap: 8 }}>
        <input className="btn" style={{ width: 56, textAlign: 'center', height: 34 }} value={emoji}
          onChange={(e) => setEmoji(e.target.value)} />
        <input className="btn" style={{ flex: 1, height: 34 }} placeholder="例如：深造基金 / 提前还房贷"
          value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="field-label">计划类型</div>
      <div className="seg seg-lg">
        <button className={type === 'fixed' ? 'on' : ''} onClick={() => setType('fixed')}>定额存钱</button>
        <button className={type === 'flexible' ? 'on' : ''} onClick={() => setType('flexible')}>灵活存钱</button>
      </div>

      {type === 'fixed' && (
        <>
          <div className="field-label">存入频率</div>
          <div className="seg">
            {(['daily', 'weekly', 'monthly'] as SaveFrequency[]).map((f) => (
              <button key={f} className={frequency === f ? 'on' : ''} onClick={() => setFrequency(f)}>
                {SAVE_FREQ_LABEL[f]}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="field-label">起止日期</div>
      <div className="row" style={{ gap: 8 }}>
        <input className="btn" type="date" style={{ flex: 1, height: 34 }} value={start}
          onChange={(e) => setStart(e.target.value)} />
        <span className="hint">至</span>
        <input className="btn" type="date" style={{ flex: 1, height: 34 }} value={end}
          onChange={(e) => setEnd(e.target.value)} />
      </div>

      <div className="field-label">目标金额</div>
      <input className="btn" style={{ width: '100%', height: 34 }} value={target}
        onChange={(e) => setTarget(e.target.value)} />

      {type === 'fixed' && (
        <div className="hint" style={{ marginTop: 8 }}>
          按当前设置将生成 <b>{periods}</b> 期，每期 <b>{money(perPeriod)}</b>
          {amounts.length > 0 && amounts[amounts.length - 1] !== perPeriod
            ? <>（最后一期 {money(amounts[amounts.length - 1])} 补足目标 {money(targetCents)}）</>
            : <>{amounts.length > 0 ? `（合计 ${money(perPeriod * periods)}）` : ''}</>}
        </div>
      )}

      <div className="field-label">关联账户（可选）</div>
      <div className="row" style={{ gap: 8 }}>
        <select className="btn" style={{ flex: 1, height: 34 }} value={fromAccountId}
          onChange={(e) => setFromAccountId(e.target.value)}>
          <option value="">从哪个账户存</option>
          {fundAccounts.map((a) => <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>)}
        </select>
        <select className="btn" style={{ flex: 1, height: 34 }} value={toAccountId}
          onChange={(e) => setToAccountId(e.target.value)}>
          <option value="">存到哪里（可选）</option>
          {accounts.filter((a) => a.id !== fromAccountId).map((a) => (
            <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>
          ))}
        </select>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        {SAVE_PLAN_LABEL[type]}：{type === 'fixed'
          ? '按频率生成「存钱卡片」，逐期勾选即记为已存'
          : '不设期数，随时手动存入一笔'}
      </div>
    </Modal>
  );
}

/** 信用卡还款：生成一笔 repay 流转（转出账户 → 信用卡，不计入收支统计） */
export function RepayForm({ account, onClose }: { account: Account; onClose: () => void }) {
  const { repo, engine, ledgerId, nowSec, commit, toast } = useApp();
  const snap = engine.creditCardSnapshot(account.id);
  const fundAccounts = repo.accounts(ledgerId).filter((a) => a.group === 'fund');
  const [amount, setAmount] = useState((snap.currentDebt / 100).toFixed(2));
  const [fromId, setFromId] = useState(fundAccounts[0]?.id ?? '');
  const [when, setWhen] = useState(toDateTimeInput(nowSec));
  const amt = yuan(Number(amount) || 0);
  const valid = amt > 0 && !!fromId;

  const save = async () => {
    if (!valid) return;
    if (!await commit(() => {
      repo.insertTxn({
        id: repo.nextId('T'), ledgerId,
        accountId: fromId, toAccountId: account.id,
        categoryId: null, kind: 'repay', flowType: 'repay',
        original: amt, discount: 0, fee: 0, refund: 0, amount: amt,
        occurredAt: fromDateTimeInput(when) || nowSec,
        note: `${account.name} 还款`, locationName: null,
        reimbursement: 'none', excludeFromStats: true,
        billCycleId: null, refundOfId: null
      });
    })) return;
    toast(`已还款 ${money(amt)}`);
    onClose();
  };

  return (
    <Modal title={`${account.name} · 还款`} onClose={onClose} onSave={save} saveLabel="确认还款">
      <div className="kv"><span className="k">当前欠款</span><span className="v">{money(snap.currentDebt)}</span></div>
      <div className="kv"><span className="k">可用额度</span><span className="v">{money(snap.availableCredit)}</span></div>
      <div className="field-label">还款金额</div>
      <div className="row" style={{ gap: 8 }}>
        <input className="btn" style={{ flex: 1, height: 34 }} value={amount}
          onChange={(e) => setAmount(e.target.value)} />
        <button className="btn" onClick={() => setAmount((snap.currentDebt / 100).toFixed(2))}>全额</button>
      </div>
      <div className="field-label">转出账户</div>
      <select className="btn" style={{ width: '100%', height: 34 }} value={fromId}
        onChange={(e) => setFromId(e.target.value)}>
        {fundAccounts.map((a) => <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>)}
      </select>
      <div className="field-label">还款时间</div>
      <input className="btn" type="datetime-local" style={{ width: '100%', height: 34 }}
        value={when} onChange={(e) => setWhen(e.target.value)} />
      <div className="hint" style={{ marginTop: 10 }}>
        还款属于「流转」，不计入收支统计；信用卡欠款按账单周期口径计算
      </div>
    </Modal>
  );
}
