import { useMemo, useState } from 'react';
import { useApp } from '../state/app';
import { money, pct } from '../core/money';
import { ACCOUNT_GROUP_LABEL, ACCOUNT_KIND_LABEL, IS_LIABILITY } from '../core/enums';
import { ProgressRing } from '../components/charts';
import { AccountForm, RepayForm } from '../components/forms';
import type { Account } from '../core/types';
import { AccountIcon } from '../components/AccountIcon';

const pad = (n: number) => String(n).padStart(2, '0');
const fmtFull = (sec: number | null) => {
  if (!sec) return '—';
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`;
};

export function AssetsPage() {
  const { engine, ledgerId, nowSec, repo, toast, hideAmount, toggleHideAmount } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState<{ open: boolean; account: Account | null }>({ open: false, account: null });
  const [repayTarget, setRepayTarget] = useState<Account | null>(null);

  const assets = useMemo(() => engine.assetsSnapshot(ledgerId), [engine, ledgerId]);
  const groups = useMemo(() => engine.accountsByGroup(ledgerId), [engine, ledgerId]);
  const accountId = selected ?? groups[0]?.accounts[0]?.id ?? null;
  const account = repo.accounts(ledgerId).find((a) => a.id === accountId) ?? null;

  const card = useMemo(
    () => (account && account.group === 'credit' ? engine.creditCardSnapshot(account.id) : null),
    [engine, account]
  );
  const accountTxns = useMemo(
    () => (account ? repo.txns(ledgerId, { accountId: account.id }).sort((a, b) => b.occurredAt - a.occurredAt) : []),
    [repo, ledgerId, account]
  );

  const show = (c: number) => (hideAmount ? '¥••••••' : money(c));

  return (
    <div className="grid-2col">
      <div className="col">
        <div className="card">
          <div className="card-head">
            <span className="card-title">净资产</span>
            <span className="row" style={{ gap: 6 }}>
              <button className="btn" onClick={toggleHideAmount}>{hideAmount ? '显示' : '隐藏'}</button>
              <button className="btn primary" onClick={() => setAccountForm({ open: true, account: null })}>
                ＋ 新增账户
              </button>
            </span>
          </div>
          <div className="big-value">{show(assets.netWorth)}</div>
          <div className="subs" style={{ display: 'flex', gap: 26, marginTop: 8 }}>
            <div><div className="k hint">总资产</div><div className="v">{show(assets.totalAssets)}</div></div>
            <div><div className="k hint">总负债</div><div className="v">{show(assets.totalLiabilities)}</div></div>
          </div>
        </div>

        {groups.map(({ group, accounts }) => {
          const total = engine.groupTotal(ledgerId, group);
          return (
            <div className="acc-group" key={group}>
              <div className="acc-group-head">
                <span className="t">{ACCOUNT_GROUP_LABEL[group]} ({accounts.length})</span>
                <span className="s">{IS_LIABILITY[group] ? '欠款' : '余额'}: {show(total)}</span>
              </div>
              {accounts.map((a) => {
                const bal = engine.accountBalance(a);
                const cc = a.group === 'credit' ? engine.creditCardSnapshot(a.id) : null;
                return (
                  <button key={a.id} className={`acc-row ${a.id === accountId ? 'sel' : ''}`}
                    style={{ width: '100%', textAlign: 'left', background: 'var(--surface-card)' }}
                    onClick={() => setSelected(a.id)}>
                    <span className="ico"><AccountIcon account={a} size={36} /></span>
                    <span style={{ minWidth: 0 }}>
                      <div className="n">{a.name}</div>
                      <div className="s">
                        {a.cardNoMask ? `${a.cardNoMask} ` : ''}
                        {a.kind === 'creditCard'
                          ? `${ACCOUNT_KIND_LABEL[a.kind]}　${cc?.cycle?.status === 'open' ? '10天后出账' : ''}`
                          : ACCOUNT_KIND_LABEL[a.kind]}
                      </div>
                      {cc && (
                        <div className="s">可用额度: {show(cc.availableCredit)}</div>
                      )}
                    </span>
                    <span className={`amt ${bal < 0 ? 'neg' : ''}`}>{show(bal)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="col">
        {!account && <div className="card empty">选择左侧账户查看详情</div>}
        {account && (
          <>
            <div className="card">
              <div className="card-head">
                <span className="row">
                  <span className="ico" style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--surface-sub)', display: 'grid', placeItems: 'center' }}><AccountIcon account={account} size={30} /></span>
                  <span className="card-title">{account.name}</span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  {card && (
                    <button className="btn primary" onClick={() => setRepayTarget(account)}>还款</button>
                  )}
                  <button className="btn" onClick={() => setAccountForm({ open: true, account })}>编辑</button>
                </span>
              </div>

              {card ? (
                <>
                  <div className="hint">当前欠款 (CNY)</div>
                  <div className="big-value">{money(card.currentDebt)} <span className="hint">✎</span></div>
                  <div className="kv"><span className="k">可用额度</span><span className="v">{money(card.availableCredit)}</span></div>
                  <div className="kv"><span className="k">信用额度</span><span className="v">{money(card.creditLimit)}</span></div>
                  <div className="kv"><span className="k">出账日</span><span className="v">{card.cycle ? `${fmtFull(card.cycle.periodEnd)} 出账` : '—'}</span></div>

                  <div className="card" style={{ background: 'var(--surface-sub)', boxShadow: 'none', marginTop: 10 }}>
                    <div className="row">
                      <div style={{ flex: 1 }}>
                        <div className="hint">📄 {card.cycle ? `${new Date(card.cycle.periodStart * 1000).getFullYear()}年${pad(new Date(card.cycle.periodStart * 1000).getMonth() + 1)}月账单` : '账单'}</div>
                        <div style={{ fontSize: 17, fontWeight: 600, marginTop: 3 }}>
                          {card.cycle?.billAmount == null ? '未出账' : money(card.cycle.billAmount)}
                        </div>
                        <div className="hint">
                          账单周期 {fmtFull(card.cycle?.periodStart ?? null)} – {fmtFull(card.cycle ? card.cycle.periodEnd - 86400 : null)}
                        </div>
                      </div>
                      <button className="btn primary" disabled>本期还款</button>
                    </div>
                    <div className="row" style={{ marginTop: 10, gap: 18 }}>
                      <div><div className="hint">流出</div><div className="v" style={{ fontWeight: 600 }}>{money(card.cycleOutflow)}</div></div>
                      <div><div className="hint">流入</div><div className="v" style={{ fontWeight: 600 }}>{money(card.cycleInflow)}</div></div>
                    </div>
                  </div>

                  <div className="cat-list" style={{ marginTop: 12 }}>
                    {accountTxns.map((t) => {
                      const debt = card.runningDebt.find((r) => r.txnId === t.id)?.debtAfter;
                      const dt = new Date(t.occurredAt * 1000);
                      const isIn = t.kind === 'income' || t.kind === 'refund_credit';
                      return (
                        <div key={t.id} className="txn-row">
                          <span className="ico">{t.kind === 'refund_credit' ? '↩️' : '💳'}</span>
                          <span>
                            <div className="t1">
                              {t.kind === 'refund_credit' ? '退款入账' : t.note || '消费'}
                              {t.refund > 0 && <span className="tag refund">退款 {money(t.refund)}</span>}
                            </div>
                            <div className="t2">
                              {pad(dt.getMonth() + 1)}-{pad(dt.getDate())} {pad(dt.getHours())}:{pad(dt.getMinutes())}
                              {t.locationName ? ` · ${t.locationName}` : ''}
                            </div>
                          </span>
                          <span>
                            <div className="amt" style={{ color: isIn ? 'var(--income)' : undefined }}>
                              {isIn ? '+' : '-'}{money(t.amount)}
                            </div>
                            {debt != null && <div className="acc">欠款: {money(debt)}</div>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div className="hint">当前余额</div>
                  <div className="big-value">{money(engine.accountBalance(account))}</div>
                  <div className="kv"><span className="k">账户类型</span><span className="v">{ACCOUNT_KIND_LABEL[account.kind]}</span></div>
                  <div className="kv"><span className="k">初始余额</span><span className="v">{money(account.initialBalance)}</span></div>
                  <div className="kv"><span className="k">账单笔数</span><span className="v">{accountTxns.length}</span></div>
                  <div className="cat-list" style={{ marginTop: 10 }}>
                    {accountTxns.slice(0, 12).map((t) => {
                      const dt = new Date(t.occurredAt * 1000);
                      const isIn = t.kind === 'income' || t.kind === 'refund_credit';
                      return (
                        <div key={t.id} className="txn-row">
                          <span className="ico">{isIn ? '↓' : '↑'}</span>
                          <span>
                            <div className="t1">{t.note || (isIn ? '收入' : '支出')}</div>
                            <div className="t2">{pad(dt.getMonth() + 1)}-{pad(dt.getDate())} {pad(dt.getHours())}:{pad(dt.getMinutes())}</div>
                          </span>
                          <span className="amt" style={{ color: isIn ? 'var(--income)' : undefined }}>
                            {isIn ? '+' : '-'}{money(t.amount)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {card && (
              <div className="card">
                <div className="card-head"><span className="card-title">本期进度</span></div>
                <div className="row" style={{ gap: 16 }}>
                  <ProgressRing ratio={card.creditLimit ? card.currentDebt / card.creditLimit : 0}
                    center={pct(card.creditLimit ? card.currentDebt / card.creditLimit : 0, 1)} />
                  <div>
                    <div className="hint">额度占用</div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{money(card.currentDebt)} / {money(card.creditLimit)}</div>
                    <div className="hint" style={{ marginTop: 6 }}>账单状态：{card.cycle?.status === 'open' ? '未出账' : '已出账'}</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {accountForm.open && (
        <AccountForm account={accountForm.account} onClose={() => {
          setAccountForm({ open: false, account: null });
          toast('账户已保存');
        }} />
      )}
      {repayTarget && <RepayForm account={repayTarget} onClose={() => setRepayTarget(null)} />}
    </div>
  );
}
