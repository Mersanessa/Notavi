import type { Db } from '../db/types';
import { BACKUP_EXTENSION, decryptBackup, encryptBackup, readBackupHeader, type BackupHeader } from '../lib/crypto';
import { localDay } from '../lib/text';
import { getSetting, setSetting } from '../data/settings';

export const APP_VERSION = '1.1.0';

export async function createBackup(db: Db, passphrase: string, iterations?: number): Promise<{ bytes: Uint8Array; fileName: string; header: Pick<BackupHeader, 'novels' | 'chapters'> }> {
  // Record the backup time inside the library first, so the restored copy knows when it was made.
  await setSetting(db, 'lastBackupAt', Date.now());
  const counts = (await db.get<{ novels: number; chapters: number }>('SELECT (SELECT count(*) FROM novels) AS novels, (SELECT count(*) FROM chapters) AS chapters'))!;
  const library = await db.exportBytes();
  const bytes = await encryptBackup(library, passphrase, { app: APP_VERSION, ...counts }, iterations);
  return { bytes, fileName: `notavi-backup-${localDay()}.${BACKUP_EXTENSION}`, header: counts };
}

export function inspectBackup(bytes: Uint8Array): BackupHeader {
  return readBackupHeader(bytes).header;
}

/** Decrypt, validate and replace the library. The previous library is kept so the restore can be undone. */
export async function restoreBackup(db: Db, bytes: Uint8Array, passphrase: string): Promise<{ novels: number }> {
  const { library } = await decryptBackup(bytes, passphrase);
  return db.replaceWith(library);
}

export async function lastBackupAt(db: Db): Promise<number | null> {
  return getSetting<number | null>(db, 'lastBackupAt', null);
}

/** Rough passphrase strength for guidance only. */
export function passphraseStrength(p: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (p.length < 8) return { score: 0, label: 'Too short' };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(p)).length;
  const words = p.trim().split(/\s+/).length;
  if (p.length >= 20 || (words >= 4 && p.length >= 16)) return { score: 3, label: 'Strong' };
  if (p.length >= 12 && classes >= 2) return { score: 2, label: 'Good' };
  return { score: 1, label: 'Weak: longer is better, e.g. four random words' };
}
