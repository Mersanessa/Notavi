import type { ParsedNovel } from '../data/model';
import { parseEpub } from './epub';
import { ImportError, MAX_IMPORT_BYTES } from './errors';
import { parseHtmlFile, parseMarkdown } from './html';
import { parseTxt } from './txt';

export { ImportError } from './errors';

export const ACCEPTED_EXTENSIONS = ['.epub', '.txt', '.text', '.html', '.htm', '.xhtml', '.md', '.markdown'];
export const ACCEPT_ATTR = [...ACCEPTED_EXTENSIONS, 'application/epub+zip', 'text/plain', 'text/html', 'text/markdown'].join(',');

type Kind = 'epub' | 'txt' | 'html' | 'markdown';

function detectKind(name: string, bytes: Uint8Array): Kind {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (ext === 'epub') {
    if (!isZip) throw new ImportError(`“${name}” is named .epub but isn't an EPUB file.`);
    return 'epub';
  }
  if (isZip) {
    if (['txt', 'html', 'htm', 'md', 'markdown', 'xhtml', 'text'].includes(ext)) throw new ImportError(`“${name}” is a compressed archive, not a ${ext.toUpperCase()} file.`);
    return 'epub';
  }
  if (ext === 'txt' || ext === 'text') return 'txt';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'html';
  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<?xml')) return 'html';
  if (ext === 'pdf' || head.startsWith('%pdf')) throw new ImportError(`“${name}” is a PDF. Notavi imports EPUB, TXT, HTML and Markdown.`);
  if (ext && !['', 'rtf'].includes(ext) && /^(mobi|azw\d?|kfx|doc|docx|odt|cbz|cbr|rar|7z)$/.test(ext)) {
    throw new ImportError(`“${name}” is a .${ext} file. Notavi imports EPUB, TXT, HTML and Markdown. Convert it to EPUB first (e.g. with Calibre).`);
  }
  return 'txt';
}

/** Parse a file the user picked. Throws ImportError with a readable message when the file can't be used. */
export async function parseFile(name: string, bytes: Uint8Array): Promise<ParsedNovel> {
  if (!bytes.length) throw new ImportError(`“${name}” is empty.`);
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportError(`“${name}” is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB, which is too big to import.`);
  const kind = detectKind(name, bytes);
  try {
    switch (kind) {
      case 'epub':
        return await parseEpub(bytes, name);
      case 'html':
        return parseHtmlFile(bytes, name);
      case 'markdown':
        return parseMarkdown(bytes, name);
      default:
        return parseTxt(bytes, name);
    }
  } catch (err) {
    if (err instanceof ImportError) throw err;
    console.error('[notavi] import failed', err);
    throw new ImportError(`“${name}” couldn't be imported: ${(err as Error).message || 'unknown error'}.`);
  }
}
