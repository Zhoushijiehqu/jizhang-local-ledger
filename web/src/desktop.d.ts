interface Window {
  ledgerDesktop?: {
    platform: string;
    loadBytes(): Promise<Uint8Array | null>;
    saveBytes(bytes: Uint8Array): Promise<void>;
    clearBytes(): Promise<void>;
    exportFile(bytes: Uint8Array, filename: string): Promise<boolean>;
    showDataFolder(): Promise<void>;
    listBackups(): Promise<Array<{ name: string; modified: number; size: number }>>;
    readBackup(name: string): Promise<Uint8Array>;
    restoreBytes(bytes: Uint8Array): Promise<void>;
    shortcuts(next?: {tray: boolean; shortcut: string}): Promise<{tray: boolean; shortcut: string}>;
    endQuick(hide: boolean): Promise<void>;
    onAction(callback: (action: string) => void): () => void;
  };
}
