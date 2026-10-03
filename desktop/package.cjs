const path = require('node:path');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { packager } = require('@electron/packager');
(async () => {
  execFileSync('npm', ['run', 'build'], { cwd: path.join(__dirname, '../web'), stdio: 'inherit' });
  const stage = path.join(__dirname, '.stage');
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });
  for (const file of ['package.json', 'main.cjs', 'preload.cjs', 'storage.cjs', 'AppIcon.icns']) await fs.copyFile(path.join(__dirname, file), path.join(stage, file));
  await fs.cp(path.join(__dirname, '../web/dist'), path.join(stage, 'web'), { recursive: true });
  const outputs = await packager({
    dir: stage, out: path.join(__dirname, 'release'), name: '记账', platform: 'darwin', arch: 'arm64',
    appBundleId: 'app.jizhang.local', appCategoryType: 'public.app-category.finance',
    icon: path.join(stage, 'AppIcon.icns'), asar: true, overwrite: true, prune: true,
    electronVersion: require('electron/package.json').version,
    extendInfo: { NSHumanReadableCopyright: '本地记账 · 数据仅存本机', CFBundleDisplayName: '记账' }
  });
  console.log('桌面应用：', outputs[0]);
})().catch((error) => { console.error(error); process.exitCode = 1; });
