import type { Account, Category } from './types';
import { shiftDate } from './backfill';

export type SuggestedTxn = {date: string; amount: string; direction: 'expense' | 'income'; category: string; account: string; note: string};
const cnNumber = (text: string): number => {
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const colloquial = /^([一二两三四五六七八九])(百|千|万)([一二两三四五六七八九])$/.exec(text);
  if (colloquial) return cnNumber(colloquial[1]) * ({百:100,千:1000,万:10000}[colloquial[2]] ?? 0) + cnNumber(colloquial[3]) * ({百:10,千:100,万:1000}[colloquial[2]] ?? 0);
  const digits: Record<string, number> = {零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  let total=0, section=0, digit=0;
  for (const c of text) {
    if (c in digits) digit=digits[c];
    else if (c==='万') {total+=(section+digit)*10000;section=0;digit=0;}
    else {section+=(digit || 1)*({十:10,百:100,千:1000}[c] ?? 0);digit=0;}
  }
  return total+section+digit;
};
const datePattern = /(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})(?:日|号)?|(\d{1,2})(?:月|\/)(\d{1,2})(?:日|号)?|大前天|前天|昨天|今天|昨日|今日|明天|后天/g;
const categoryRules: Array<[RegExp, string[]]> = [
  [/洗衣/, ['洗衣']], [/吹风|水费|电费|饮水/, ['水电']],
  [/早饭|早餐|午饭|午餐|晚饭|晚餐|吃饭|包子|食堂|三餐/, ['三餐','餐饮']],
  [/咖啡|奶茶/, ['咖啡','饮料','餐饮']], [/饮料|可乐|矿泉水/, ['饮料','餐饮']], [/水果|苹果|香蕉|葡萄/, ['水果','餐饮']], [/零食|饼干|薯片/, ['零食','餐饮']],
  [/地铁/, ['地铁','交通']], [/公交/, ['公交','交通']], [/打车|滴滴|出租/, ['打车','交通']], [/车费/, ['交通']],
  [/红包|礼物|爷爷|奶奶|外公|外婆/, ['人情','社交','红包','其他']],
  [/健身|羽毛球|球场|运动/, ['运动','娱乐']], [/工资|薪水/, ['工资']], [/生活费/, ['生活费','其他']],
  [/房租|住宿/, ['房租','住房']], [/淘宝|京东|拼多多|买衣|购物/, ['购物']],
];

/** Conservative local parsing; no network, model, microphone, or ledger mutation. */
export function parseSentence(text: string, today: string, cats: Category[], accounts: Account[]) {
  const rows: SuggestedTxn[] = [], warnings: string[] = [];
  if (/每[天日周月]|[×x*]\s*\d|\d\s*[至到~～]\s*\d|优惠|折扣|原价|手续费|退款|还款|借入|借出|转账/.test(text)) {
    return {rows, warnings: ['这段包含重复日期、优惠或资金流转。请拆成普通收支，或使用批量补记 / 其他选项。']};
  }
  const wx = accounts.find(a => a.kind === 'wechat' && a.group === 'fund')?.id ?? accounts.find(a => a.group === 'fund')?.id ?? '';
  let currentDay=today;
  const parts = text.replace(/(\d),(?=\d{3}(?:\D|$))/g,'$1').replace(datePattern, '\n$&').split(/[，,；;。\n]+/).filter(s => s.trim());
  for (const part of parts) {
    let badDate=false;
    const clean = part.replace(datePattern, (match, y, m, d, mm, dd) => {
      const offset: Record<string, number> = {大前天:-3,前天:-2,昨天:-1,昨日:-1,今天:0,今日:0,明天:1,后天:2};
      if (match in offset) currentDay=shiftDate(today,offset[match]);
      else {
        const year=Number(y ?? today.slice(0,4)), month=Number(m ?? mm), date=Number(d ?? dd);
        const candidate=`${year}-${String(month).padStart(2,'0')}-${String(date).padStart(2,'0')}`;
        const test=new Date(candidate+'T12:00:00');
        if (!Number.isFinite(test.getTime()) || test.getFullYear()!==year || test.getMonth()+1!==month || test.getDate()!==date) {badDate=true;warnings.push(`日期无法识别：${match}`);}
        else currentDay=candidate;
      }
      return ' ';
    });
    if (badDate) continue;
    if (/合计|总共|一共/.test(clean)) {warnings.push('合计金额未单独记账，请核对分项。');continue;}
    const expression=/[¥￥]?\s*(\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千万]+)\s*(元|块钱?|毛钱?|角|分钱?)?\s*(?:([零〇一二两三四五六七八九]|\d)(毛|角|分)?)?/g;
    const matches=[...clean.matchAll(expression)].filter(match => {
      if (!match[2] && !/^\d/.test(match[1])) return false;
      if (match[3] && !match[2]) {warnings.push('金额小数超过两位，请核对');return false;}
      const start=match.index ?? 0, end=start+match[0].length;
      if (/[瓶杯次个笔件天人号点分钟斤份倍张]/.test(clean.slice(end,end+1))) return false;
      if (clean.slice(start-1,start)==='-' || clean.slice(end,end+1)==='.') {warnings.push('金额包含负数或精度不明，请手动核对。');return false;}
      return true;
    });
    if (!matches.length) {if (/^\s*(我|我记一下|记一下|帮我记|帮我记一下)?\s*$/.test(clean)) continue; warnings.push(`未找到金额：${part.trim()}`);continue;}
    let previous=0;
    matches.forEach((match,i) => {
      const start=match.index ?? 0, end=start+match[0].length;
      let amount=cnNumber(match[1]);
      const unit=match[2] ?? '';
      if (/毛|角/.test(unit)) {amount/=10;if(match[3]) amount+=cnNumber(match[3])/100;}
      else if (/分/.test(unit)) amount/=100;
      else if (match[3]) amount+=cnNumber(match[3])/(match[4]==='分' ? 100 : 10);
      if (!Number.isFinite(amount) || amount<=0 || amount>99999999) {warnings.push('金额应大于零且小于一亿元');return;}
      const note=(clean.slice(previous,start)+(i===matches.length-1 ? clean.slice(end) : '')).replace(/^[\s、和又还]+/,'').replace(/(?:花了|花费|付了|支付|用了|微信|现金|支付宝|人民币)/g,'').trim();
      previous=end;
      const direction: SuggestedTxn['direction'] = /收入|收到|收到了|给了我|给我|转给我|转我|收款|到账|入账|工资|薪水|报销到账/.test(note) ? 'income' : 'expense';
      const eligible=cats.filter(c => c.direction===direction && !c.archived && !c.hidden);
      let category=eligible.find(c => c.name.length>1 && note.includes(c.name))?.id ?? '';
      if (!category) {
        const names=categoryRules.find(([pattern]) => pattern.test(note))?.[1] ?? [];
        category=names.map(name => eligible.find(c => c.name===name)?.id).find(Boolean) ?? '';
      }
      const explicit = /支付宝/.test(part) ? 'alipay' : /现金/.test(part) ? 'cash' : null;
      const account=explicit ? accounts.find(a => a.kind===explicit && a.group==='fund')?.id ?? '' : wx;
      if (!account) warnings.push('指定的付款账户不存在，请在预览中选择。');
      rows.push({date:currentDay, amount:amount.toFixed(2), direction, category, account, note:note || (direction==='income'?'收入':'消费')});
    });
  }
  return {rows:rows.slice(0,200), warnings:[...new Set(warnings)]};
}
