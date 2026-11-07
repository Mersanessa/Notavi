import type { Db } from '../db/types';
import { newId } from '../lib/text';
import type { Annotation, AnnotationKind, HighlightColor } from './model';

type Row = {
  id: string; novel_id: string; chapter_id: string; kind: AnnotationKind; start_offset: number | null;
  end_offset: number | null; block_index: number | null; quote: string; note: string; color: HighlightColor;
  created_at: number; updated_at: number; chapter_title?: string; chapter_position?: number; novel_title?: string;
};

const toAnnotation = (r: Row): Annotation => ({
  id: r.id,
  novelId: r.novel_id,
  chapterId: r.chapter_id,
  kind: r.kind,
  startOffset: r.start_offset,
  endOffset: r.end_offset,
  blockIndex: r.block_index,
  quote: r.quote,
  note: r.note,
  color: r.color,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  chapterTitle: r.chapter_title,
  chapterPosition: r.chapter_position,
  novelTitle: r.novel_title,
});

const SELECT = `SELECT a.*, c.title AS chapter_title, c.position AS chapter_position, n.title AS novel_title
  FROM annotations a JOIN chapters c ON c.id = a.chapter_id JOIN novels n ON n.id = a.novel_id`;

export type NewAnnotation = Pick<Annotation, 'novelId' | 'chapterId' | 'kind'> &
  Partial<Pick<Annotation, 'startOffset' | 'endOffset' | 'blockIndex' | 'quote' | 'note' | 'color'>>;

export async function addAnnotation(db: Db, a: NewAnnotation): Promise<string> {
  if ((a.kind === 'highlight' || a.kind === 'note') && (a.startOffset == null || a.endOffset == null || a.endOffset <= a.startOffset)) {
    throw new Error('Highlights and notes need a text selection.');
  }
  const id = newId();
  const now = Date.now();
  await db.run(
    `INSERT INTO annotations(id, novel_id, chapter_id, kind, start_offset, end_offset, block_index, quote, note, color, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, a.novelId, a.chapterId, a.kind, a.startOffset ?? null, a.endOffset ?? null, a.blockIndex ?? null, (a.quote ?? '').slice(0, 4000), a.note ?? '', a.color ?? 'amber', now, now],
  );
  return id;
}

export async function updateAnnotation(db: Db, id: string, patch: Partial<Pick<Annotation, 'note' | 'color' | 'kind'>>): Promise<void> {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (patch.note !== undefined) (sets.push('note = ?'), params.push(patch.note));
  if (patch.color !== undefined) (sets.push('color = ?'), params.push(patch.color));
  if (patch.kind !== undefined) (sets.push('kind = ?'), params.push(patch.kind));
  if (!sets.length) return;
  await db.run(`UPDATE annotations SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, Date.now(), id]);
}

export async function deleteAnnotation(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM annotations WHERE id = ?', [id]);
}

export async function listAnnotationsForNovel(db: Db, novelId: string): Promise<Annotation[]> {
  return (await db.all<Row>(`${SELECT} WHERE a.novel_id = ? ORDER BY c.position, coalesce(a.start_offset, -1), a.created_at`, [novelId])).map(toAnnotation);
}

export async function listAnnotationsForChapter(db: Db, chapterId: string): Promise<Annotation[]> {
  return (await db.all<Row>(`${SELECT} WHERE a.chapter_id = ? ORDER BY coalesce(a.start_offset, -1), a.created_at`, [chapterId])).map(toAnnotation);
}

export async function listAllAnnotations(db: Db, limit = 200): Promise<Annotation[]> {
  return (await db.all<Row>(`${SELECT} ORDER BY a.created_at DESC LIMIT ?`, [limit])).map(toAnnotation);
}

export async function annotationCounts(db: Db, novelId: string): Promise<Record<AnnotationKind, number>> {
  const rows = await db.all<{ kind: AnnotationKind; n: number }>('SELECT kind, count(*) AS n FROM annotations WHERE novel_id = ? GROUP BY kind', [novelId]);
  const out: Record<AnnotationKind, number> = { chapter_bookmark: 0, text_bookmark: 0, highlight: 0, note: 0 };
  for (const r of rows) out[r.kind] = r.n;
  return out;
}

/** Toggle the chapter bookmark; returns whether the chapter is now bookmarked. */
export async function toggleChapterBookmark(db: Db, novelId: string, chapterId: string): Promise<boolean> {
  const existing = await db.get<{ id: string }>("SELECT id FROM annotations WHERE chapter_id = ? AND kind = 'chapter_bookmark'", [chapterId]);
  if (existing) {
    await deleteAnnotation(db, existing.id);
    return false;
  }
  await addAnnotation(db, { novelId, chapterId, kind: 'chapter_bookmark' });
  return true;
}
