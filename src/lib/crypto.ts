/**
 * Cryptography, all via WebCrypto (no custom primitives).
 *
 * Backup file format (".notavi"):
 *   bytes 0..7    magic "NOTAVI01"
 *   bytes 8..11   header length N (uint32, big-endian)
 *   bytes 12..    header: UTF-8 JSON { v, kdf, iterations, salt, iv, createdAt, app, novels, chapters }
 *   then          AES-256-GCM ciphertext of the gzip-compressed SQLite library
 * The header is authenticated as GCM additional data, so it can't be altered
 * without the passphrase. The key comes from the passphrase via PBKDF2-SHA256.
 */

export const BACKUP_MAGIC = 'NOTAVI01';
export const BACKUP_ITERATIONS = 600_000;
export const BACKUP_EXTENSION = 'notavi';

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

const buf = (u: Uint8Array) => u as unknown as BufferSource;

export async function pbkdf2(secret: string, salt: Uint8Array, iterations: number, bits = 256): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(new TextEncoder().encode(secret.normalize('NFKC'))), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations }, key, bits));
}

async function aesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const raw = await pbkdf2(passphrase, salt, iterations);
  return crypto.subtle.importKey('raw', buf(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Constant-time comparison. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function streamThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([buf(bytes) as ArrayBuffer]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const gzip = (b: Uint8Array) => streamThrough(b, new CompressionStream('gzip'));
export const gunzip = (b: Uint8Array) => streamThrough(b, new DecompressionStream('gzip'));

export interface BackupHeader {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  createdAt: number;
  app: string;
  novels: number;
  chapters: number;
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export async function encryptBackup(
  library: Uint8Array,
  passphrase: string,
  info: { app: string; novels: number; chapters: number },
  iterations = BACKUP_ITERATIONS,
): Promise<Uint8Array> {
  if (passphrase.length < 8) throw new BackupError('Use a passphrase of at least 8 characters.');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header: BackupHeader = { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toB64(salt), iv: toB64(iv), createdAt: Date.now(), ...info };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const key = await aesKey(passphrase, salt, iterations);
  const compressed = await gzip(library);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(headerBytes) }, key, buf(compressed)));
  const out = new Uint8Array(8 + 4 + headerBytes.length + cipher.length);
  out.set(new TextEncoder().encode(BACKUP_MAGIC), 0);
  new DataView(out.buffer).setUint32(8, headerBytes.length);
  out.set(headerBytes, 12);
  out.set(cipher, 12 + headerBytes.length);
  return out;
}

export function readBackupHeader(file: Uint8Array): { header: BackupHeader; headerBytes: Uint8Array; cipher: Uint8Array } {
  if (file.length < 12 || new TextDecoder().decode(file.subarray(0, 8)) !== BACKUP_MAGIC) {
    throw new BackupError("This isn't a Notavi backup file.");
  }
  const len = new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(8);
  if (len > 64 * 1024 || 12 + len > file.length) throw new BackupError('This backup file is damaged.');
  const headerBytes = file.subarray(12, 12 + len);
  let header: BackupHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    throw new BackupError('This backup file is damaged.');
  }
  if (header.v !== 1 || header.kdf !== 'PBKDF2-SHA256') throw new BackupError('This backup was made by a newer version of Notavi. Update the app first.');
  if (!(header.iterations >= 100_000 && header.iterations <= 10_000_000)) throw new BackupError('This backup file is damaged.');
  return { header, headerBytes, cipher: file.subarray(12 + len) };
}

export async function decryptBackup(file: Uint8Array, passphrase: string): Promise<{ header: BackupHeader; library: Uint8Array }> {
  const { header, headerBytes, cipher } = readBackupHeader(file);
  const key = await aesKey(passphrase, fromB64(header.salt), header.iterations);
  let compressed: Uint8Array;
  try {
    compressed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(fromB64(header.iv)), additionalData: buf(headerBytes) }, key, buf(cipher)));
  } catch {
    throw new BackupError('Wrong passphrase, or the backup file has been changed or damaged.');
  }
  try {
    return { header, library: await gunzip(compressed) };
  } catch {
    throw new BackupError('This backup file is damaged.');
  }
}
