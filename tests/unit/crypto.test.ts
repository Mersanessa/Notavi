import { describe, expect, it } from 'vitest';
import { decryptBackup, encryptBackup, readBackupHeader, BackupError, gzip, gunzip } from '../../src/lib/crypto';
import { MemoryDb } from '../../src/db/memory';
import { createNovel, listNovels } from '../../src/data/novels';
import { createBackup, restoreBackup, passphraseStrength } from '../../src/app/backup';

const FAST = 100_000; // the minimum the reader accepts; keeps tests quick

describe('backup encryption', () => {
  it('round-trips and authenticates the header', async () => {
    const data = new TextEncoder().encode('hello library '.repeat(1000));
    const file = await encryptBackup(data, 'correct horse battery', { app: 't', novels: 1, chapters: 2 }, FAST);
    expect(new TextDecoder().decode(file.subarray(0, 8))).toBe('NOTAVI01');
    expect(file.length).toBeLessThan(data.length); // compressed
    const { header, library } = await decryptBackup(file, 'correct horse battery');
    expect(header).toMatchObject({ novels: 1, chapters: 2, kdf: 'PBKDF2-SHA256' });
    expect(library).toEqual(data);
  });

  it('rejects a wrong passphrase', async () => {
    const file = await encryptBackup(new Uint8Array([1, 2, 3]), 'right passphrase', { app: 't', novels: 0, chapters: 0 }, FAST);
    await expect(decryptBackup(file, 'wrong passphrase')).rejects.toThrow(/Wrong passphrase/);
  });

  it('detects tampering with the ciphertext or the header', async () => {
    const file = await encryptBackup(new Uint8Array(500).fill(7), 'right passphrase', { app: 't', novels: 3, chapters: 0 }, FAST);
    const body = file.slice();
    body[body.length - 5] ^= 1;
    await expect(decryptBackup(body, 'right passphrase')).rejects.toThrow(BackupError);
    // Change "novels":3 to "novels":4 in the header — same length, so only authentication can catch it.
    const head = file.slice();
    const text = new TextDecoder().decode(head);
    const i = text.indexOf('"novels":3');
    head[i + 9] = '4'.charCodeAt(0);
    expect(readBackupHeader(head).header.novels).toBe(4);
    await expect(decryptBackup(head, 'right passphrase')).rejects.toThrow(BackupError);
  });

  it('rejects files that are not backups, and short passphrases', async () => {
    expect(() => readBackupHeader(new TextEncoder().encode('just some text file'))).toThrow(/isn't a Notavi backup/);
    await expect(encryptBackup(new Uint8Array(1), 'short', { app: 't', novels: 0, chapters: 0 }, FAST)).rejects.toThrow(/8 characters/);
  });

  it('gzips', async () => {
    const d = new Uint8Array(10000).fill(65);
    expect(await gunzip(await gzip(d))).toEqual(d);
  });

  it('backs up and restores a whole library, with undo', async () => {
    const source = await MemoryDb.create();
    await createNovel(source, { title: 'Travelling Novel' }, { chapters: [{ title: 'One', content: '<p>Hi</p>' }] });
    const { bytes, fileName, header } = await createBackup(source, 'a long passphrase', FAST);
    expect(fileName).toMatch(/^notavi-backup-\d{4}-\d{2}-\d{2}\.notavi$/);
    expect(header).toEqual({ novels: 1, chapters: 1 });

    const target = await MemoryDb.create();
    await createNovel(target, { title: 'Local Novel' });
    await expect(restoreBackup(target, bytes, 'not it at all')).rejects.toThrow(/Wrong passphrase/);
    expect((await listNovels(target)).map((n) => n.title)).toEqual(['Local Novel']); // untouched on failure
    await restoreBackup(target, bytes, 'a long passphrase');
    expect((await listNovels(target)).map((n) => n.title)).toEqual(['Travelling Novel']);
    await target.undoReplace();
    expect((await listNovels(target)).map((n) => n.title)).toEqual(['Local Novel']);
  });

  it('grades passphrases', () => {
    expect(passphraseStrength('abc').score).toBe(0);
    expect(passphraseStrength('abcdefgh').score).toBe(1);
    expect(passphraseStrength('Abcdefgh1234').score).toBe(2);
    expect(passphraseStrength('lantern river copper autumn').score).toBe(3);
  });
});
