/**
 * App lock (PIN or passcode).
 *
 * This is a privacy screen, not encryption: it stops someone who picks up the
 * device from browsing the library. The library itself is stored unencrypted in
 * app storage. Only a salted PBKDF2 hash of the code is kept, in localStorage
 * (outside the library, so restoring a backup from another device doesn't
 * change this device's lock).
 */
import { create } from 'zustand';
import { equalBytes, fromB64, pbkdf2, randomBytes, toB64 } from '../lib/crypto';

const KEY = 'notavi.lock';
const ITERATIONS = 210_000;

export interface LockConfig {
  enabled: boolean;
  kind: 'pin' | 'passcode';
  salt: string;
  hash: string;
  iterations: number;
  /** Minutes in the background before locking again. 0 = immediately. */
  autoLockMinutes: number;
  failures: number;
  lockedUntil: number;
}

function load(): LockConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LockConfig) : null;
  } catch {
    return null;
  }
}

function save(cfg: LockConfig | null) {
  if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg));
  else localStorage.removeItem(KEY);
}

interface LockState {
  config: LockConfig | null;
  locked: boolean;
}

export const useLock = create<LockState>(() => ({ config: null, locked: false }));

export function initLock() {
  const config = load();
  useLock.setState({ config, locked: !!config?.enabled });
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    const cfg = useLock.getState().config;
    if (!cfg?.enabled) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      if (cfg.autoLockMinutes === 0) lockNow();
    } else if (hiddenAt && Date.now() - hiddenAt >= cfg.autoLockMinutes * 60000) {
      lockNow();
    }
  });
}

export function validateCode(kind: 'pin' | 'passcode', code: string): string | null {
  if (kind === 'pin') return /^\d{4,8}$/.test(code) ? null : 'A PIN is 4 to 8 digits.';
  return code.length >= 6 ? null : 'Use at least 6 characters.';
}

export async function enableLock(kind: 'pin' | 'passcode', code: string, autoLockMinutes: number) {
  const err = validateCode(kind, code);
  if (err) throw new Error(err);
  const salt = randomBytes(16);
  const hash = await pbkdf2(code, salt, ITERATIONS);
  const config: LockConfig = { enabled: true, kind, salt: toB64(salt), hash: toB64(hash), iterations: ITERATIONS, autoLockMinutes, failures: 0, lockedUntil: 0 };
  save(config);
  useLock.setState({ config });
}

export function setAutoLock(minutes: number) {
  const cfg = useLock.getState().config;
  if (!cfg) return;
  const next = { ...cfg, autoLockMinutes: minutes };
  save(next);
  useLock.setState({ config: next });
}

export function disableLock() {
  save(null);
  useLock.setState({ config: null, locked: false });
}

export function lockNow() {
  if (useLock.getState().config?.enabled) useLock.setState({ locked: true });
}

/** Seconds until another attempt is allowed (0 = now). */
export function lockoutRemaining(): number {
  const cfg = useLock.getState().config;
  return cfg ? Math.max(0, Math.ceil((cfg.lockedUntil - Date.now()) / 1000)) : 0;
}

/**
 * Check a code. After 5 wrong attempts, waits grow (30 s, 1 min, 2 min… up to 15 min)
 * to make guessing slow. Unlocks on success.
 */
export async function verifyCode(code: string, opts: { unlock?: boolean } = { unlock: true }): Promise<boolean> {
  const cfg = useLock.getState().config;
  if (!cfg) return true;
  if (lockoutRemaining() > 0) return false;
  const hash = await pbkdf2(code, fromB64(cfg.salt), cfg.iterations);
  const ok = equalBytes(hash, fromB64(cfg.hash));
  const failures = ok ? 0 : cfg.failures + 1;
  const wait = failures >= 5 ? Math.min(15 * 60, 30 * 2 ** (failures - 5)) : 0;
  const next = { ...cfg, failures, lockedUntil: wait ? Date.now() + wait * 1000 : 0 };
  save(next);
  useLock.setState({ config: next, locked: ok && opts.unlock ? false : useLock.getState().locked });
  return ok;
}
