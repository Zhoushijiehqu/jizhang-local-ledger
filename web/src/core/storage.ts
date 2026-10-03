/**
 * 本地持久化 —— 数据库字节存 IndexedDB，可导出为真正的 .sqlite 文件。
 * 纯本地、不联网、不上传。
 */
const DB_NAME = 'jizhang';
const STORE = 'sqlite';
const KEY = 'main';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadBytes(): Promise<Uint8Array | null> {
  if (window.ledgerDesktop) return window.ledgerDesktop.loadBytes();
  try {
    const db = await open();
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => {
        const v = req.result;
        if (!v) resolve(null);
        else if (v instanceof Uint8Array) resolve(v);
        else if (v instanceof ArrayBuffer) resolve(new Uint8Array(v));
        else resolve(null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    throw new Error(`无法读取本地账本：${String(error)}`);
  }
}

export async function saveBytes(bytes: Uint8Array): Promise<void> {
  if (window.ledgerDesktop) return window.ledgerDesktop.saveBytes(bytes);
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(bytes, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearBytes(): Promise<void> {
  if (window.ledgerDesktop) return window.ledgerDesktop.clearBytes();
  const db = await open();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
  });
}

/** 导出为文件（仅导出，不导入） */
export function downloadFile(bytes: Uint8Array, filename: string, mime = 'application/octet-stream') {
  if (window.ledgerDesktop) {
    void window.ledgerDesktop.exportFile(bytes, filename).catch(console.error);
    return;
  }
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const blob = new Blob([buf], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function todayStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
