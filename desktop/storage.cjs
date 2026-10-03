const fs = require('node:fs/promises');
const path = require('node:path');

function createStore(directory) {
  const file = path.join(directory, '账本.sqlite');
  let pending = Promise.resolve();
  const enqueue = (action) => {
    const result = pending.then(action);
    pending = result.catch(() => {});
    return result;
  };
  const read = async () => {
    try { return await fs.readFile(file); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  return {
    file,
    directory,
    load: () => enqueue(read),
    save: (bytes, restore = false) => {
      const data = Buffer.from(bytes);
      if (data.length < 100 || data.subarray(0, 16).toString() !== 'SQLite format 3\0') {
        return Promise.reject(new Error('账本格式不正确，未覆盖现有文件。'));
      }
      return enqueue(async () => {
        await fs.mkdir(directory, { recursive: true });
        const previous = await read();
        if (previous?.equals(data)) return;
        if (previous) {
          const backups = path.join(directory, '自动备份');
          await fs.mkdir(backups, { recursive: true });
          if (restore) await fs.writeFile(path.join(backups, `恢复前-${Date.now()}.sqlite`), previous, { flag: 'wx', mode: 0o600 });
          const day = new Date().toLocaleDateString('sv-SE');
          try { await fs.writeFile(path.join(backups, `${day}.sqlite`), previous, { flag: 'wx', mode: 0o600 }); }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
          await fs.writeFile(path.join(backups, '上次保存.sqlite'), previous, { mode: 0o600 });
        }
        const temp = `${file}.tmp`;
        const handle = await fs.open(temp, 'w', 0o600);
        try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temp, file);
      });
    },
    clear: () => enqueue(async () => {
      const previous = await read();
      if (!previous) return;
      const backups = path.join(directory, '自动备份');
      await fs.mkdir(backups, { recursive: true });
      await fs.rename(file, path.join(backups, `清空前-${Date.now()}.sqlite`));
    }),
    listBackups: () => enqueue(async () => {
      const folder = path.join(directory, '自动备份');
      let names;
      try { names = await fs.readdir(folder); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const entries = await Promise.all(names.filter(name => name.endsWith('.sqlite')).map(async name => {
        const stat = await fs.stat(path.join(folder, name));
        return { name, modified: stat.mtimeMs, size: stat.size };
      }));
      return entries.sort((a, b) => b.modified - a.modified);
    }),
    readBackup: (name) => enqueue(() => {
      if (typeof name !== 'string' || name !== path.basename(name) || !name.endsWith('.sqlite')) throw new Error('备份名称无效');
      return fs.readFile(path.join(directory, '自动备份', name));
    }),
    flush: () => pending
  };
}
module.exports = { createStore };
