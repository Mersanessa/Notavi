/**
 * Platform helpers: the only place that knows whether we run inside Tauri
 * (Windows / Android) or a browser (PWA). Everything else is shared.
 */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function platformName(): 'windows' | 'android' | 'ios' | 'web' {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return isTauri() ? 'android' : 'web';
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (isTauri() && /Windows/i.test(ua)) return 'windows';
  return 'web';
}

export function isStandalonePwa(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/** Ask the browser not to evict our storage. Harmless no-op where unsupported. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ files */

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

/** Open the system file picker. Works in browsers and in Tauri's WebViews (Windows, Android). */
export function pickFiles(accept: string, multiple = true): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    let settled = false;
    const done = async () => {
      if (settled) return;
      settled = true;
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(await readFiles(files));
    };
    input.addEventListener('change', done);
    input.addEventListener('cancel', () => {
      settled = true;
      input.remove();
      resolve([]);
    });
    document.body.appendChild(input);
    input.click();
  });
}

export async function readFiles(files: File[]): Promise<PickedFile[]> {
  return Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

/**
 * Save bytes as a file the user chooses.
 * Tauri: native save dialog + file write (works on Windows; on Android the
 * system document picker returns a content URI that the fs plugin writes to).
 * Browser: File System Access API when available, else a download.
 */
export async function saveFile(name: string, bytes: Uint8Array, mime = 'application/octet-stream'): Promise<'saved' | 'downloaded' | 'cancelled'> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const ext = name.split('.').pop() ?? '';
    const path = await save({ defaultPath: name, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined });
    if (!path) return 'cancelled';
    await writeFile(path, bytes);
    return 'saved';
  }
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker && !isStandalonePwa()) {
    try {
      const handle = await picker({ suggestedName: name });
      const w = await handle.createWritable();
      await w.write(bytes as unknown as ArrayBuffer);
      await w.close();
      return 'saved';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      // Fall through to a plain download.
    }
  }
  const url = URL.createObjectURL(new Blob([bytes as unknown as ArrayBuffer], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

/* ------------------------------------------------------------------ fullscreen & screen */

export async function setFullscreen(on: boolean): Promise<boolean> {
  try {
    if (isTauri() && platformName() === 'windows') {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setFullscreen(on);
      return true;
    }
    if (on && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      return true;
    }
    if (!on && document.fullscreenElement) {
      await document.exitFullscreen();
      return true;
    }
  } catch {
    /* not allowed here; the reader still hides its own chrome */
  }
  return false;
}

let wakeLock: { release: () => Promise<void> } | null = null;

/** Keep the screen on while reading, where supported. */
export async function keepScreenOn(on: boolean) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request('screen');
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

export function vibrate(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}

/** Open an external link in the system browser. Only http(s) links are allowed. */
export async function openExternal(url: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("That link isn't a valid web address.");
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only web links (http or https) can be opened.');
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(u.toString());
    return;
  }
  window.open(u.toString(), '_blank', 'noopener,noreferrer');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
