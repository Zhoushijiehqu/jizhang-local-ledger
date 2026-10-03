import wechatIcon from '../assets/wechat.png';
import type { Account } from '../core/types';

export function AccountIcon({ account, size = 18 }: {
  account?: Pick<Account, 'kind' | 'icon'> | null;
  size?: number;
}) {
  return account?.kind === 'wechat'
    ? <img className="account-brand-icon" src={wechatIcon} alt="微信" width={size} height={size} />
    : <span aria-hidden="true">{account?.icon || '💳'}</span>;
}

// 原生下拉选项不支持图片；品牌图标显示在选择框旁，选项只保留账户名称。
export const accountOptionLabel = (a: Pick<Account, 'kind' | 'icon' | 'name'>) =>
  a.kind === 'wechat' ? a.name : `${a.icon} ${a.name}`;
