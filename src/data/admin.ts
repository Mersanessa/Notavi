import type { Db } from '../db/types';

/**
 * Delete everything in the library. Returns a snapshot of the library as it
 * was, so the caller can offer an undo (via db.replaceWith).
 */
export async function eraseLibrary(db: Db): Promise<Uint8Array> {
  const snapshot = await db.exportBytes();
  await db.batch([
    { sql: 'DELETE FROM collections' },
    { sql: 'DELETE FROM novels' }, // cascades to chapters, blobs, progress, reads, annotations, collection items
    { sql: 'DELETE FROM reading_log' },
    { sql: 'DELETE FROM chapter_completions' },
    { sql: "DELETE FROM settings WHERE key NOT IN ('app', 'reader')" },
    { sql: 'DELETE FROM novel_fts' },
    { sql: 'DELETE FROM chapter_fts' },
  ]);
  await db.run('VACUUM');
  return snapshot;
}
