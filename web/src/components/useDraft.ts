import { useEffect, useMemo, useRef } from 'react';

/** Drafts stay outside the ledger. Each field change survives closing the window. */
export function useDraft<T>(key: string, value: T, enabled = true) {
  const initial = useMemo<T | null>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
  }, [key]);
  const cleared = useRef(false);
  useEffect(() => {
    if (!enabled || cleared.current) return;
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value, enabled]);
  return { initial, clear: () => { cleared.current = true; localStorage.removeItem(key); } };
}
export function readDraft<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
