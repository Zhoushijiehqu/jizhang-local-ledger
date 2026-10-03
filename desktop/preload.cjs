const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ledgerDesktop', {
  platform: process.platform,
  loadBytes: () => ipcRenderer.invoke('ledger:load'),
  saveBytes: (bytes) => ipcRenderer.invoke('ledger:save', bytes),
  clearBytes: () => ipcRenderer.invoke('ledger:clear'),
  exportFile: (bytes, filename) => ipcRenderer.invoke('ledger:export', bytes, filename),
  showDataFolder: () => ipcRenderer.invoke('ledger:folder'),
  listBackups: () => ipcRenderer.invoke('ledger:backups'),
  readBackup: name => ipcRenderer.invoke('ledger:backup-read', name),
  restoreBytes: bytes => ipcRenderer.invoke('ledger:restore', bytes),
  shortcuts: next => ipcRenderer.invoke('ledger:shortcuts', next),
  endQuick: hide => ipcRenderer.invoke('ledger:quick-end', hide),
  onAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('ledger:action', listener);
    ipcRenderer.send('ledger:ready');
    return () => ipcRenderer.removeListener('ledger:action', listener);
  }
});
