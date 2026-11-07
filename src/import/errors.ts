/** An import failure with a message written for the reader, not a developer. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export const MAX_IMPORT_BYTES = 300 * 1024 * 1024;

/**
 * Decode text bytes: honours a BOM, tries strict UTF-8, then the declared
 * charset (HTML), then Windows-1252 (the usual legacy encoding for .txt).
 */
export function decodeText(bytes: Uint8Array, declared?: string): { text: string; encoding: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  // UTF-16 without BOM: lots of zero bytes in alternate positions.
  const sample = bytes.subarray(0, 4000);
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) (i % 2 ? oddZero++ : evenZero++);
  if (oddZero > sample.length / 4 && evenZero < sample.length / 50) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' };
  if (evenZero > sample.length / 4 && oddZero < sample.length / 50) return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    /* not UTF-8 */
  }
  if (declared) {
    try {
      return { text: new TextDecoder(declared).decode(bytes), encoding: declared };
    } catch {
      /* unknown label */
    }
  }
  return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
}

/** True when the text is mostly control characters, i.e. probably a binary file. */
export function looksBinary(text: string): boolean {
  const sample = text.slice(0, 20000);
  if (!sample.length) return false;
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if ((c < 9 || (c > 13 && c < 32) || c === 0xfffd) && c !== 27) bad++;
  }
  return bad / sample.length > 0.05;
}

export function fileStem(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
