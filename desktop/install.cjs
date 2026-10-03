const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const os = require('node:os');

(async () => {
  const home = os.homedir();
  const source = path.join(__dirname, 'release/记账-darwin-arm64/记账.app');
  const destination = path.join(home, 'Desktop/记账.app');
  const temporary = path.join(home, 'Desktop/.记账安装中.app');
  const data = path.join(home, 'Library/Application Support/记账');
  const backup = path.join(data, '旧版本');
  await fs.access(path.join(source, 'Contents/Resources/app.asar'));
  await fs.mkdir(data, { recursive: true });
  await fs.mkdir(backup, { recursive: true });
  if (process.argv[2]) {
    const bytes = await fs.readFile(process.argv[2]);
    if (bytes.subarray(0, 16).toString() !== 'SQLite format 3\0') throw new Error('待复制账本格式不正确');
    // 首次复制。后续升级不传数据参数，始终保留已有桌面账本。
    await fs.copyFile(process.argv[2], path.join(data, '账本.sqlite'), constants.COPYFILE_EXCL);
    await fs.chmod(path.join(data, '账本.sqlite'), 0o600);
    await fs.mkdir(path.join(data, '自动备份'), { recursive: true });
    await fs.copyFile(process.argv[2], path.join(data, '自动备份/首次桌面化.sqlite'), constants.COPYFILE_EXCL);
  }
  await fs.rm(temporary, { recursive: true, force: true });
  await fs.cp(source, temporary, { recursive: true, verbatimSymlinks: true });
  try {
    await fs.access(destination);
    const archived = path.join(backup, `记账-旧入口-${Date.now()}.app`);
    await fs.rename(destination, archived);
    console.log('原入口备份：', archived);
    try { await fs.rename(temporary, destination); }
    catch (error) { await fs.rename(archived, destination); throw error; }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.rename(temporary, destination);
  }
  console.log('桌面应用：', destination);
  console.log('账本文件：', path.join(data, '账本.sqlite'));
})().catch(error => { console.error(error); process.exitCode = 1; });
