import type { Db } from '../db/types';

export async function getSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const r = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  if (!r) return fallback;
  try {
    const v = JSON.parse(r.value) as T;
    // Merge objects so newly added settings get their defaults.
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback) && v && typeof v === 'object') {
      return { ...fallback, ...v };
    }
    return v;
  } catch {
    return fallback;
  }
}

export async function setSetting<T>(db: Db, key: string, value: T): Promise<void> {
  await db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
}
