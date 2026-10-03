/** 统计页交互验收：启动临时浏览器，使用账本备份副本；不会连接用户浏览器。 */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import initSqlJs from 'sql.js';
const BASE = process.argv[2] ?? 'http://127.0.0.1:8791';
const require = createRequire(import.meta.url);
const SQL = await initSqlJs({ locateFile: f => path.join(path.dirname(require.resolve('sql.js')), f) });
const copy = new SQL.Database(await readFile(new URL('../../imports/2026-10-01-account-merge/after-merge.sqlite', import.meta.url)));
copy.run("INSERT OR REPLACE INTO preference(key,value) VALUES('reference_now',?)", [String(Date.parse('2026-10-01T12:00:00+08:00') / 1000)]);
const bytes = [...copy.export()];
const browser = await puppeteer.launch({ executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true, args: ['--no-sandbox'] });
const out = new URL('../shots/stats-20261001/', import.meta.url);
await mkdir(out, { recursive: true });
try {
  const page = await browser.newPage();
  await page.emulateTimezone('Asia/Shanghai');
  await page.setViewport({ width: 1440, height: 1050 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}/favicon.ico`);
  await page.evaluate(async data => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('jizhang', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('sqlite');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const t = db.transaction('sqlite', 'readwrite');
      t.objectStore('sqlite').put(new Uint8Array(data), 'main');
      t.oncomplete = resolve; t.onerror = () => reject(t.error);
    }); db.close();
  }, bytes);
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  const clickText = async (text, selector = 'button') => {
    assert(await page.evaluate((text, selector) => {
      const b = [...document.querySelectorAll(selector)].find(x => x.textContent.replace(/\s/g, '') === text.replace(/\s/g, ''));
      b?.click(); return !!b;
    }, text, selector), `Missing button ${text}`);
  };
  await clickText('📊 统计', '.nav-item');
  await page.waitForSelector('.stats-page');
  assert.equal(await page.$eval('.stats-summary-card:first-child .metric-value', e => e.textContent), '¥1,245.80');
  assert.equal(await page.$eval('.stats-summary-card:nth-child(2) .metric-value', e => e.textContent), '¥2,300.00');
  assert(await page.$('section[aria-label="支出分类详情"]'));
  assert(await page.$('section[aria-label="收入分类详情"]'));
  for (const name of ['每日收支柱线组合图', '分类支出堆叠面积图', '分类与日期消费热力图', '消费金额区间直方图', '分类单笔消费箱线与散点图', '本期与上期分类支出哑铃对比图']) {
    assert(await page.$(`svg[aria-label="${name}"]`), name);
  }
  const heat = await page.$('svg[aria-label="分类与日期消费热力图"] rect[aria-label*="10/1 · 社交"]');
  await heat.evaluate(e => e.focus());
  assert((await page.$eval('section[aria-label="消费热力图"] .stats-chart-tip', e => e.textContent)).includes('¥1,000.00'));
  await heat.click();
  await page.waitForSelector('.txn-row');
  assert.equal(await page.$$eval('.txn-row', es => es.length), 1);
  assert((await page.$eval('.txn-row', e => e.textContent)).includes('爷爷奶奶'));
  await clickText('取消');
  const bin = await page.$('svg[aria-label="消费金额区间直方图"] g[aria-label^="100–500"]');
  await bin.click();
  assert((await page.evaluate(() => document.body.innerText)).includes('没有匹配的账单'));
  await clickText('取消');
  const high = await page.$('svg[aria-label="消费金额区间直方图"] g[aria-label^="500及以上"]');
  await high.click();
  await page.waitForSelector('.txn-row');
  assert.equal(await page.$$eval('.txn-row', es => es.length), 1);
  await clickText('取消');
  await clickText('按月统计');
  await page.click('button[aria-label="上一月"]');
  assert.equal(await page.$eval('.stats-summary-card:first-child .metric-value', e => e.textContent), '¥4,288.64');
  assert((await page.$eval('.stats-summary-card:last-child', e => e.textContent)).includes('30 天'));
  assert((await page.$eval('section[aria-label="支出分类详情"]', e => e.textContent)).includes('三餐'));
  assert(!(await page.$eval('section[aria-label="消费热力图"] .stats-chart-tip', e => e.textContent)).includes('10/1'));
  assert(!(await page.$eval('section[aria-label="消费金额分布"] .stats-chart-tip', e => e.textContent)).includes('1 笔'));
  await page.screenshot({ path: path.join(fileURLToPath(out), 'monthly-overview.png') });
  await page.$eval('section[aria-label="消费金额分布"]', e => e.scrollIntoView());
  await page.screenshot({ path: path.join(fileURLToPath(out), 'distribution.png') });
  await page.setViewport({ width: 720, height: 1050 });
  await page.$eval('.stats-page', e => e.scrollIntoView());
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: path.join(fileURLToPath(out), 'narrow.png') });
  await page.setViewport({ width: 1440, height: 1050 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: path.join(fileURLToPath(out), 'dark.png') });
  await clickText('回到本月');
  await page.click('button[aria-label="下一月"]');
  assert((await page.$eval('section[aria-label="支出分类详情"]', e => e.textContent)).includes('还没有支出记录'));
  const after = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('jizhang', 1); r.onsuccess = () => resolve(r.result); });
    const result = await new Promise(resolve => { const r = db.transaction('sqlite').objectStore('sqlite').get('main'); r.onsuccess = () => resolve([...r.result]); });
    db.close(); return result;
  });
  assert.deepEqual(after, bytes, '统计浏览与点击查询不应写入数据库');
  assert.deepEqual(errors, []);
  console.log('统计页通过：收支同时显示、六类新图、悬停数值、热图/金额区间准确钻取、9月金额/30天日均、细分类、窄窗/深色、空数据、数据库字节未变。');
} finally { await browser.close(); }
