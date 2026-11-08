/// <reference lib="webworker" />
/** Builds a Lore index off the main thread: chapters stream in, the finished index comes back. */
import { LoreBuilder, scanChapter } from './extract';

let builder = new LoreBuilder();
self.onmessage = (e: MessageEvent<{ type: 'reset' } | { type: 'chapters'; items: { html: string; pos: number }[] } | { type: 'finish' }>) => {
  const m = e.data;
  if (m.type === 'reset') builder = new LoreBuilder();
  else if (m.type === 'chapters') {
    for (const c of m.items) builder.add(scanChapter(c.html, c.pos));
    (self as unknown as Worker).postMessage({ type: 'ack' });
  } else if (m.type === 'finish') (self as unknown as Worker).postMessage({ type: 'done', index: builder.finish() });
};
