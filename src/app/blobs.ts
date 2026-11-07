import { useEffect, useState } from 'react';
import { getBlob } from '../data/novels';
import { db } from './store';

/** Object URLs for stored images (covers, EPUB illustrations), cached for the session. */
const cache = new Map<string, Promise<string | null>>();

export function blobUrl(id: string): Promise<string | null> {
  let p = cache.get(id);
  if (!p) {
    p = getBlob(db(), id).then((b) => (b ? URL.createObjectURL(new Blob([b.data as unknown as ArrayBuffer], { type: b.mime })) : null));
    cache.set(id, p);
  }
  return p;
}

export function forgetBlob(id: string) {
  const p = cache.get(id);
  cache.delete(id);
  void p?.then((u) => u && URL.revokeObjectURL(u));
}

export function useBlobUrl(id: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (id) void blobUrl(id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id]);
  return url;
}

/** Replace `notavi-blob:<id>` references in chapter HTML with object URLs. */
export async function resolveBlobRefs(html: string): Promise<string> {
  const ids = Array.from(new Set(Array.from(html.matchAll(/notavi-blob:([a-z0-9-]+)/gi), (m) => m[1])));
  if (!ids.length) return html;
  const urls = await Promise.all(ids.map((id) => blobUrl(id)));
  let out = html;
  ids.forEach((id, i) => {
    out = out.replaceAll(`notavi-blob:${id}`, urls[i] ?? '');
  });
  return out;
}
