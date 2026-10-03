const { app, BrowserWindow, Menu, protocol, net, ipcMain, dialog, shell, screen, nativeTheme, Tray, nativeImage, globalShortcut } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createStore } = require('./storage.cjs');

app.setName('记账');
app.setPath('userData', process.env.JIZHANG_TEST_DATA_DIR || path.join(app.getPath('appData'), '记账'));
protocol.registerSchemesAsPrivileged([{ scheme: 'ledger', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const store = createStore(app.getPath('userData'));
const boundsFile = path.join(store.directory, '窗口.json');
let win;
let quitting = false;
let boundsTimer;
let savingBounds = Promise.resolve();
let rendererReady = false;
let pendingAction;
let tray;
let quickMode = false;
let mainBounds;
let shortcutSettings = { tray: false, shortcut: '' };
const shortcutsFile = path.join(store.directory, '快捷入口.json');
async function configureShortcuts(next, persist = true) {
  if (typeof next.tray !== 'boolean' || typeof next.shortcut !== 'string' || next.shortcut.length > 80) throw new Error('快捷入口设置无效');
  const previous = shortcutSettings.shortcut;
  if (next.shortcut !== previous && next.shortcut) {
    let registered = false;
    try { registered = globalShortcut.register(next.shortcut, () => void showQuick()); } catch {}
    if (!registered) throw new Error('快捷键无效或已被其他应用占用，请换一个');
  }
  if (previous && previous !== next.shortcut) globalShortcut.unregister(previous);
  if (next.tray && !tray) {
    tray = new Tray(nativeImage.createEmpty());
    tray.setTitle('￥'); tray.setToolTip('记账');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '快速记一笔', click: () => void showQuick() },
      { label: '打开账本', click: () => void finishQuick(false) },
      { type: 'separator' }, { label: '退出记账', role: 'quit' }
    ]));
    tray.on('click', () => void showQuick());
  } else if (!next.tray && tray) { tray.destroy(); tray = undefined; }
  shortcutSettings = { tray: next.tray, shortcut: next.shortcut };
  if (persist) {
    await fs.mkdir(store.directory, {recursive: true});
    await fs.writeFile(shortcutsFile, JSON.stringify(shortcutSettings));
  }
  return shortcutSettings;
}
function dispatch(name) {
  if (!rendererReady || win.webContents.isLoading()) pendingAction = name;
  else win.webContents.send('ledger:action', name);
}
async function showQuick() {
  if (!win) await createWindow();
  if (!quickMode) {
    mainBounds = win.getNormalBounds();
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    if (win.isMinimized()) win.restore();
    quickMode = true;
    win.setMinimumSize(440, 560); win.setBounds({width: 480, height: 760}); win.center();
    win.setAlwaysOnTop(true, 'floating');
  }
  dispatch('quick-record'); win.show(); win.focus();
}
async function finishQuick(hide = false) {
  if (!win) await createWindow();
  if (quickMode) {
    quickMode = false; win.setAlwaysOnTop(false); win.setMinimumSize(800, 600);
    if (mainBounds) win.setBounds(mainBounds);
  }
  dispatch('quick-end');
  if (hide) win.hide(); else { win.show(); win.focus(); }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!win) void createWindow();
    else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });
  app.whenReady().then(async () => {
    const bundled = path.join(__dirname, 'web');
    const webRoot = require('node:fs').existsSync(bundled) ? bundled : path.join(__dirname, '../web/dist');
    protocol.handle('ledger', async (request) => {
      const url = new URL(request.url);
      const file = path.resolve(webRoot, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      if (url.host !== 'app' || !file.startsWith(webRoot + path.sep)) return new Response('', { status: 403 });
      const response = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
      return new Response(response.body, { status: response.status, headers });
    });
    const trusted = (event) => {
      if (!win || event.sender !== win.webContents || !event.senderFrame?.url.startsWith('ledger://app/')) throw new Error('请求来源不正确');
    };
    ipcMain.on('ledger:ready', (event) => {
      trusted(event);
      rendererReady = true;
      if (pendingAction) { win.webContents.send('ledger:action', pendingAction); pendingAction = undefined; }
    });
    ipcMain.handle('ledger:load', async (event) => { trusted(event); return store.load(); });
    ipcMain.handle('ledger:save', async (event, bytes) => {
      trusted(event);
      try { await store.save(bytes); }
      catch (error) { dialog.showErrorBox('账本保存失败', `${error.message}\n请检查磁盘空间或导出账本备份。`); throw error; }
    });
    ipcMain.handle('ledger:backups', async event => { trusted(event); return store.listBackups(); });
    ipcMain.handle('ledger:backup-read', async (event, name) => { trusted(event); return store.readBackup(name); });
    ipcMain.handle('ledger:restore', async (event, bytes) => { trusted(event); await store.save(bytes, true); });
    ipcMain.handle('ledger:shortcuts', async (event, next) => { trusted(event); return next ? configureShortcuts(next) : shortcutSettings; });
    ipcMain.handle('ledger:quick-end', async (event, hide) => { trusted(event); await finishQuick(!!hide); });
    ipcMain.handle('ledger:clear', async (event) => { trusted(event); await store.clear(); });
    ipcMain.handle('ledger:folder', async (event) => { trusted(event); await fs.mkdir(store.directory, { recursive: true }); await shell.openPath(store.directory); });
    ipcMain.handle('ledger:export', async (event, bytes, filename) => {
      trusted(event);
      const result = await dialog.showSaveDialog(win, {
        title: '导出账本备份', defaultPath: path.join(app.getPath('documents'), path.basename(filename)),
        filters: [{ name: filename.endsWith('.json') ? 'JSON 文件' : 'SQLite 账本', extensions: [filename.endsWith('.json') ? 'json' : 'sqlite'] }]
      });
      if (result.canceled || !result.filePath) return false;
      try { await fs.writeFile(result.filePath, Buffer.from(bytes), { mode: 0o600 }); return true; }
      catch (error) { dialog.showErrorBox('导出失败', error.message); throw error; }
    });
    const action = (name) => async () => {
      if (!win) await createWindow();
      if (quickMode) await finishQuick(false);
      win.show();
      if (!rendererReady || win.webContents.isLoading()) pendingAction = name;
      else win.webContents.send('ledger:action', name);
    };
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '记账', submenu: [
        { label: '关于记账', role: 'about' }, { type: 'separator' },
        { label: '设置…', accelerator: 'CmdOrCtrl+,', click: action('settings') },
        { type: 'separator' }, { role: 'services', label: '服务' }, { type: 'separator' },
        { role: 'hide', label: '隐藏记账' }, { role: 'hideOthers', label: '隐藏其他' }, { role: 'unhide', label: '显示全部' },
        { type: 'separator' }, { role: 'quit', label: '退出记账' }
      ] },
      { label: '文件', submenu: [
        { label: '快速小窗', click: () => void showQuick() },
        { label: '记一笔', accelerator: 'CmdOrCtrl+N', click: action('record') },
        { label: '对话记账…', accelerator: 'CmdOrCtrl+Shift+N', click: action('sentence') },
        { label: '导出账本…', accelerator: 'CmdOrCtrl+Shift+E', click: action('export') },
        { label: '打开数据文件夹', click: async () => { await fs.mkdir(store.directory, { recursive: true }); await shell.openPath(store.directory); } },
        { type: 'separator' }, { label: '关闭窗口', role: 'close' }
      ] },
      { label: '编辑', submenu: [
        { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' },
        { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' },
        { type: 'separator' }, { label: '搜索账单', accelerator: 'CmdOrCtrl+F', click: action('search') },
        { label: '切换账本', accelerator: 'CmdOrCtrl+K', click: action('ledgers') }
      ] },
      { label: '视图', submenu: [
        ...['账本', '资产', '存钱', '统计', '设置'].map((label, i) => ({ label, accelerator: `CmdOrCtrl+${i + 1}`, click: action(['ledger', 'assets', 'save', 'stats', 'settings'][i]) })),
        { type: 'separator' }, { label: '刷新', role: 'reload' },
        { label: '实际大小', role: 'resetZoom' }, { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' },
        { type: 'separator' }, { label: '进入全屏', role: 'togglefullscreen' }
      ] },
      { label: '窗口', submenu: [{ label: '最小化', role: 'minimize' }, { label: '缩放', role: 'zoom' }, { type: 'separator' }, { label: '前置全部窗口', role: 'front' }] }
    ]));
    app.setAboutPanelOptions({ applicationName: '记账', applicationVersion: app.getVersion(), copyright: '本地记账 · 数据仅存本机' });
    try {
      const saved = JSON.parse(await fs.readFile(shortcutsFile, 'utf8'));
      await configureShortcuts(saved, false);
    } catch (error) { if (error.code !== 'ENOENT') console.error('快捷入口未启用', error.message); }
    await createWindow();
    app.on('activate', () => { if (!win) void createWindow(); else win.show(); });
  }).catch((error) => { dialog.showErrorBox('记账无法启动', error.message); app.quit(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    clearTimeout(boundsTimer);
    rememberBounds();
    Promise.all([store.flush(), savingBounds]).finally(() => { quitting = true; app.quit(); });
  });
}

function rememberBounds() {
  if (quickMode || !win || win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
  const bounds = win.getNormalBounds();
  savingBounds = savingBounds.catch(() => {}).then(async () => {
    await fs.mkdir(store.directory, { recursive: true });
    await fs.writeFile(boundsFile, JSON.stringify(bounds));
  });
}
async function createWindow() {
  rendererReady = false;
  let bounds = { width: 1280, height: 840 };
  try {
    const saved = JSON.parse(await fs.readFile(boundsFile, 'utf8'));
    const visible = screen.getAllDisplays().some(({ workArea: a }) => saved.x + saved.width > a.x + 80 && saved.x < a.x + a.width - 80 && saved.y >= a.y && saved.y < a.y + a.height - 80);
    if (visible && saved.width >= 800 && saved.height >= 600) bounds = saved;
  } catch {}
  win = new BrowserWindow({
    ...bounds, minWidth: 800, minHeight: 600, title: '记账', show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f11' : '#f7f8fa',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('ledger://app/')) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  win.on('resize', () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(rememberBounds, 300); });
  win.on('move', () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(rememberBounds, 300); });
  win.on('close', event => { if (quickMode && !quitting) { event.preventDefault(); void finishQuick(true); } else rememberBounds(); });
  win.on('closed', () => { win = null; });
  win.once('ready-to-show', () => win.show());
  await win.loadURL('ledger://app/');
}
