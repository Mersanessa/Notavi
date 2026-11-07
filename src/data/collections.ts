import type { Db } from '../db/types';
import { newId } from '../lib/text';
import type { Collection } from './model';

type Row = { id: string; name: string; description: string; position: number; created_at: number; updated_at: number; novel_count: number; cover_ids: string | null };

const toCollection = (r: Row): Collection => ({
  id: r.id,
  name: r.name,
  description: r.description,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  novelCount: r.novel_count,
  coverNovelIds: r.cover_ids ? r.cover_ids.split(',').slice(0, 4) : [],
});

const SELECT = `SELECT c.*,
  (SELECT count(*) FROM collection_items i WHERE i.collection_id = c.id) AS novel_count,
  (SELECT group_concat(novel_id) FROM (SELECT novel_id FROM collection_items i WHERE i.collection_id = c.id ORDER BY i.position, i.added_at LIMIT 4)) AS cover_ids
  FROM collections c`;

export async function listCollections(db: Db): Promise<Collection[]> {
  return (await db.all<Row>(`${SELECT} ORDER BY c.position, c.name COLLATE NOCASE`)).map(toCollection);
}

export async function getCollection(db: Db, id: string): Promise<Collection | undefined> {
  const r = await db.get<Row>(`${SELECT} WHERE c.id = ?`, [id]);
  return r ? toCollection(r) : undefined;
}

export async function createCollection(db: Db, name: string, description = ''): Promise<string> {
  const n = name.trim();
  if (!n) throw new Error('Give the collection a name.');
  const id = newId();
  const now = Date.now();
  await db.run(
    'INSERT INTO collections(id, name, description, position, created_at, updated_at) VALUES (?, ?, ?, (SELECT coalesce(max(position) + 1, 0) FROM collections), ?, ?)',
    [id, n, description.trim(), now, now],
  );
  return id;
}

export async function updateCollection(db: Db, id: string, patch: { name?: string; description?: string }): Promise<void> {
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('Give the collection a name.');
  await db.run('UPDATE collections SET name = coalesce(?, name), description = coalesce(?, description), updated_at = ? WHERE id = ?', [
    patch.name?.trim() ?? null,
    patch.description?.trim() ?? null,
    Date.now(),
    id,
  ]);
}

export async function deleteCollection(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM collections WHERE id = ?', [id]);
}

export async function reorderCollections(db: Db, orderedIds: string[]): Promise<void> {
  await db.batch(orderedIds.map((id, i) => ({ sql: 'UPDATE collections SET position = ? WHERE id = ?', params: [i, id] })));
}

export async function addToCollection(db: Db, collectionId: string, novelId: string): Promise<void> {
  const now = Date.now();
  await db.batch([
    {
      sql: `INSERT OR IGNORE INTO collection_items(collection_id, novel_id, position, added_at)
            VALUES (?, ?, (SELECT coalesce(max(position) + 1, 0) FROM collection_items WHERE collection_id = ?), ?)`,
      params: [collectionId, novelId, collectionId, now],
    },
    { sql: 'UPDATE collections SET updated_at = ? WHERE id = ?', params: [now, collectionId] },
  ]);
}

export async function removeFromCollection(db: Db, collectionId: string, novelId: string): Promise<void> {
  await db.run('DELETE FROM collection_items WHERE collection_id = ? AND novel_id = ?', [collectionId, novelId]);
}

export async function collectionNovelIds(db: Db, collectionId: string): Promise<string[]> {
  return (await db.all<{ novel_id: string }>('SELECT novel_id FROM collection_items WHERE collection_id = ? ORDER BY position, added_at', [collectionId])).map((r) => r.novel_id);
}

export async function reorderCollectionItems(db: Db, collectionId: string, orderedNovelIds: string[]): Promise<void> {
  await db.batch(orderedNovelIds.map((nid, i) => ({ sql: 'UPDATE collection_items SET position = ? WHERE collection_id = ? AND novel_id = ?', params: [i, collectionId, nid] })));
}

export async function collectionsForNovel(db: Db, novelId: string): Promise<string[]> {
  return (await db.all<{ collection_id: string }>('SELECT collection_id FROM collection_items WHERE novel_id = ?', [novelId])).map((r) => r.collection_id);
}
