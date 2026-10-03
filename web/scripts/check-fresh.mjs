/**
 * 端到端验证「清空数据」流程
 * 用法：node scripts/check-fresh.mjs [url]
 *
 * 步骤：以全新浏览器 profile 打开 ?fresh=1 → 应用应先建演示数据、再按参数清空
 * 断言：净资产归 0、无演示横幅、账单笔数为 0
 */
import puppeteer from 'puppeteer-core';

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu']
});

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? '：' + extra : ''}`);
  if (!ok) failed += 1;
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  const url = BASE + '/?fresh=1';
  console.log('打开', url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.metric', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1200)); // 等清空 + 重渲染

  const state = await page.evaluate(() => {
    const metricValues = Array.from(document.querySelectorAll('.metric .metric-value'))
      .map((e) => (e.textContent || '').trim());
    const banner = document.body.innerText.includes('当前是演示账本');
    const accRows = Array.from(document.querySelectorAll('.acc-row')).length;
    const kvText = document.body.innerText;
    return { metricValues, banner, accRows, hasAssets: kvText.includes('净资产') };
  });

  console.log('  指标卡：', state.metricValues.join(' | '));
  check('净资产为 ¥0.00', state.metricValues[3] === '¥0.00', state.metricValues[3]);
  check('总支出为 ¥0.00', state.metricValues[0] === '¥0.00', state.metricValues[0]);
  check('演示数据横幅已消失', !state.banner);
  check('URL 已去掉 ?fresh=1', !page.url().includes('fresh=1'), page.url());

  // 切到资产页看账户是否已重建
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => (x.textContent || '').includes('资产'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const assets = await page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('.acc-row')).map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()),
    net: (document.querySelector('.big-value')?.textContent || '').trim()
  }));
  console.log('  资产页净资产：', assets.net);
  assets.rows.slice(0, 6).forEach((r) => console.log('    ·', r));
  check('净资产为 ¥0.00', assets.net === '¥0.00', assets.net);
  check('账户已重建（≥6 个）', assets.rows.length >= 6, String(assets.rows.length));

  // AC-32：全新账本下「记一笔」的默认账户应为微信（用户偏好）
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => (x.textContent || '').includes('账本'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => {
    const b = document.querySelector('.record-hero button');
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  const sel = await page.evaluate(() =>
    Array.from(document.querySelectorAll('select'))
      .map((s) => s.options[s.selectedIndex]?.textContent?.trim() ?? '')
  );
  console.log('  记一笔默认选中：', sel.join(' | '));
  check('默认账户为微信', sel.some((t) => t.includes('微信')), sel.join(' | '));

  // AC-33：预算保存持久化 + 默认「按周」
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => (x.textContent || '').includes('设置'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '预算');
    if (t) t.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  const initWeekly = await page.evaluate(() => {
    const wk = Array.from(document.querySelectorAll('.seg button')).find((b) => (b.textContent || '').includes('按周'));
    return wk ? wk.className.includes('on') : false;
  });
  check('初始默认周期为「按周」', initWeekly);

  await page.evaluate(() => {
    const inp = document.querySelector('input.btn');
    if (inp) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, '777');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '保存');
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  // 重载页面（重新从 IndexedDB 读取）验证持久化
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.metric', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => (x.textContent || '').includes('设置'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '预算');
    if (t) t.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const after = await page.evaluate(() => {
    const inp = document.querySelector('input.btn');
    const wk = Array.from(document.querySelectorAll('.seg button')).find((b) => (b.textContent || '').includes('按周'));
    return { amount: inp ? inp.value : '', weeklyOn: wk ? wk.className.includes('on') : false };
  });
  check('保存后金额持久化（重载后仍为 777）', after.amount === '777', after.amount);
  check('保存后周期持久化（重载后仍为按周）', after.weeklyOn);
} finally {
  await browser.close();
}

console.log(failed === 0 ? '\n结果：全部通过 ✔' : `\n结果：${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
