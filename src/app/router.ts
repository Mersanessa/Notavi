import { useSyncExternalStore } from 'react';

/**
 * Minimal hash router. Hash routing needs no server configuration, so it works
 * under Tauri's custom protocol, static hosting and sub-paths alike.
 */
export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path, segments: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) };
}

let current = parse();
const listeners = new Set<() => void>();
// In-app history so "back" never leaves the app or lands somewhere unexpected.
const stack: string[] = [location.hash || '#/'];
window.addEventListener('hashchange', () => {
  const h = location.hash || '#/';
  if (stack.length > 1 && stack[stack.length - 2] === h) stack.pop();
  else if (stack[stack.length - 1] !== h) stack.push(h);
  current = parse();
  listeners.forEach((l) => l());
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const hash = '#' + (to.startsWith('/') ? to : '/' + to);
  if (hash === location.hash) return;
  if (opts.replace) {
    history.replaceState(history.state, '', hash);
    stack[stack.length - 1] = hash;
    current = parse();
    listeners.forEach((l) => l());
  } else {
    location.hash = hash;
  }
}

/** Go back within the app if there is in-app history, otherwise to a sensible parent. */
export function goBack(fallback = '/') {
  if (stack.length > 1) history.back();
  else navigate(fallback, { replace: true });
}

export function href(path: string): string {
  return '#' + path;
}

export const routes = {
  home: () => '/',
  library: (q?: string) => '/library' + (q ? `?${q}` : ''),
  novel: (id: string, tab?: string) => `/novel/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ''}`,
  editNovel: (id: string) => `/novel/${encodeURIComponent(id)}/edit`,
  newNovel: () => '/new',
  read: (novelId: string, chapterId?: string, extra?: string) =>
    `/read/${encodeURIComponent(novelId)}${chapterId ? `/${encodeURIComponent(chapterId)}` : ''}${extra ? `?${extra}` : ''}`,
  editChapter: (novelId: string, chapterId: string) => `/novel/${encodeURIComponent(novelId)}/chapter/${encodeURIComponent(chapterId)}`,
  newChapter: (novelId: string) => `/novel/${encodeURIComponent(novelId)}/chapter/new`,
  search: (q?: string) => '/search' + (q ? `?q=${encodeURIComponent(q)}` : ''),
  collections: () => '/collections',
  collection: (id: string) => `/collections/${encodeURIComponent(id)}`,
  stats: () => '/stats',
  settings: (section?: string) => '/settings' + (section ? `?s=${section}` : ''),
  importFiles: () => '/import',
};
