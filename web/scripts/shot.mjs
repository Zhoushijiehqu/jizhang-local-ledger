/**
 * UI 验证工具：用本机 Edge（Chromium）驱动 Web 应用，逐页截图
 *
 * 用法：
 *   node scripts/shot.mjs                 # 截全部页面
 *   node scripts/shot.mjs ledger assets   # 只截指定页面
 *
 * 产出：shots/*.png（light / dark 各一套）
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const BASE = process.env.JZ_URL ?? 'http://localhost:4173/';
const OUT = path.resolve('shots');
mkdirSync(OUT, { recursive: true });

const PAGES = [
  { key: 'ledger', label: '账本', wait: '.metric' },
  { key: 'assets', label: '资产', wait: '.acc-row' },
  { key: 'save', label: '存钱', wait: '.plan-card' },
  { key: 'stats', label: '统计', wait: 'table' },
  { key: 'settings', label: '设置', wait: '.card' }
];

const want = process.argv.slice(2).filter((a) => PAGES.some((p) => p.key === a));
const targets = want.length ? PAGES.filter((p) => want.includes(p.key)) : PAGES;

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1050, deviceScaleFactor: 2 });

  page.on('console', (m) => {
    if (m.type() === 'error') console.log('  [页面错误]', m.text());
  });
  page.on('pageerror', (e) => console.log('  [运行时异常]', e.message));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  console.log('已打开', BASE);

  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => localStorage.setItem('jz-theme', t), theme);
    await page.reload({ waitUntil: 'networkidle2' });
    // 主题通过设置页切换（应用内状态），这里直接用系统偏好模拟
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await page.reload({ waitUntil: 'networkidle2' });

    for (const p of targets) {
      // 通过侧栏按钮切页
      const clicked = await page.evaluate((label) => {
        const btns = Array.from(document.querySelectorAll('.nav-item'));
        const b = btns.find((x) => (x.textContent || '').includes(label));
        if (b) { b.click(); return true; }
        return false;
      }, p.label);
      if (!clicked) { console.log(`  ⚠️ 未找到导航项：${p.label}`); continue; }

      try {
        await page.waitForSelector(p.wait, { timeout: 15000 });
      } catch {
        console.log(`  ⚠️ ${p.label} 页未出现预期元素 ${p.wait}`);
      }
      await new Promise((r) => setTimeout(r, 450));
      const file = path.join(OUT, `${theme}_${p.key}.png`);
      await page.screenshot({ path: file });
      console.log(`  ✅ ${theme} / ${p.label} → ${path.relative(process.cwd(), file)}`);
    }
  }

  // 回到账本页（「搜索账单」按钮只在该页顶栏出现）
  await page.evaluate(() => {
    const nav = Array.from(document.querySelectorAll('.nav-item')).find((x) => (x.textContent || '').includes('账本'));
    if (nav) nav.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  // 搜索面板
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('搜索账单'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUT, 'search_panel.png') });
  console.log('  ✅ 搜索面板 → shots/search_panel.png');

  // 搜索面板：关键词 + 筛选器展开
  await page.evaluate(() => {
    const i = document.querySelector('input[placeholder^="搜索备注"]');
    if (i) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, '地铁');
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, 'search_keyword.png') });
  console.log('  ✅ 搜索关键词命中 → shots/search_keyword.png');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('取消'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 300));

  // 设置页各标签
  await page.evaluate(() => {
    const nav = Array.from(document.querySelectorAll('.nav-item')).find((x) => (x.textContent || '').includes('设置'));
    if (nav) nav.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  for (const [label, file] of [['分类', 'settings_category'], ['预算', 'settings_budget'], ['模板', 'settings_template']]) {
    await page.evaluate((l) => {
      const b = Array.from(document.querySelectorAll('.seg button')).find((x) => (x.textContent || '').trim() === l);
      if (b) b.click();
    }, label);
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT, `${file}.png`) });
    console.log(`  ✅ 设置·${label} → shots/${file}.png`);
  }

  // 隐私模式
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '👁');
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 350));
  await page.screenshot({ path: path.join(OUT, 'privacy_on.png') });
  console.log('  ✅ 隐私模式 → shots/privacy_on.png');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '🙈');
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 250));

  // 账本切换弹层
  await page.evaluate(() => {
    const b = document.querySelector('.ledger-switch');
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 350));
  await page.screenshot({ path: path.join(OUT, 'ledger_switcher.png') });
  console.log('  ✅ 账本切换 → shots/ledger_switcher.png');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 250));

  // 统计页钻取：点「退款」直接进搜索
  await page.evaluate(() => {
    const nav = Array.from(document.querySelectorAll('.nav-item')).find((x) => (x.textContent || '').includes('统计'));
    if (nav) nav.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUT, 'stats_drill.png') });
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.kv.clickable')).find((x) => (x.textContent || '').includes('退款'));
    if (row) row.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUT, 'drill_result.png') });
  console.log('  ✅ 钻取到搜索 → shots/drill_result.png');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 250));

  // 新增账户表单（资产页）
  await page.evaluate(() => {
    const nav = Array.from(document.querySelectorAll('.nav-item')).find((x) => (x.textContent || '').includes('资产'));
    if (nav) nav.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('新增账户'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 450));
  await page.screenshot({ path: path.join(OUT, 'form_account.png') });
  console.log('  ✅ 新增账户表单 → shots/form_account.png');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '取消');
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 350));

  // 新建存钱计划（存钱页）
  await page.evaluate(() => {
    const nav = Array.from(document.querySelectorAll('.nav-item')).find((x) => (x.textContent || '').includes('存钱'));
    if (nav) nav.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.plan-entry')).find((x) => (x.textContent || '').includes('定额存钱'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 450));
  await page.screenshot({ path: path.join(OUT, 'form_plan.png') });
  console.log('  ✅ 新建计划表单 → shots/form_plan.png');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '取消');
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 350));

  // 编辑已有账单（账本页点明细行）
  await page.evaluate(() => {
    const nav = Array.from(document.querySelectorAll('.nav-item')).find((x) => (x.textContent || '').includes('账本'));
    if (nav) nav.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => {
    const row = document.querySelector('.txn-row');
    if (row) row.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUT, 'edit_txn.png') });
  console.log('  ✅ 账单编辑面板 → shots/edit_txn.png');
  await page.evaluate(() => document.querySelector('.recorder-head button')?.click());
  await new Promise((r) => setTimeout(r, 300));

  // 记一笔面板
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('记一笔'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, 'recorder.png') });
  console.log('  ✅ 记一笔面板 → shots/recorder.png');
} finally {
  await browser.close();
}
