import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BookOpen, Bookmark, CheckCheck, Copy, ExternalLink, FolderPlus, Heart, Highlighter, ImagePlus, ImageOff, ListChecks, MoreHorizontal,
  NotebookPen, Pencil, Plus, RotateCcw, Search, StickyNote, Trash2, X, ArrowUpDown, Circle, CircleCheck, ClipboardPaste,
} from 'lucide-react';
import { PasteChaptersDialog } from './PasteChapters';
import { db, mutate, toast, useStore } from '../../app/store';
import { useAsync, useDocumentTitle } from '../../app/hooks';
import { forgetBlob } from '../../app/blobs';
import { goBack, href, navigate, routes, useRoute } from '../../app/router';
import { contentTypeLabel, STATUSES, type Annotation, type AnnotationKind, type ChapterMeta, type NovelSummary, type ReadingStatus } from '../../data/model';
import { deleteChapter, deleteNovel, listChapters, reorderChapters, setCover, updateNovel, getNovel } from '../../data/novels';
import { markReadUpTo, novelReadingTime, resetProgress, setChapterRead } from '../../data/reading';
import { deleteAnnotation, listAnnotationsForNovel, updateAnnotation } from '../../data/annotations';
import { addToCollection, collectionsForNovel, createCollection, removeFromCollection } from '../../data/collections';
import { searchText, type TextHit } from '../../data/search';
import { formatDate, formatDuration, formatMinutes, formatNumber, readingMinutes, relativeTime } from '../../lib/text';
import { prepareCover } from '../../lib/image';
import { copyText, openExternal, pickFiles } from '../../platform';
import { Cover } from '../components/Cover';
import { Button, IconButton } from '../components/Button';
import { Menu, type MenuItem } from '../components/Menu';
import { EmptyState, Ribbon, Spinner, StatusBadge } from '../components/misc';
import { Dialog } from '../components/Dialog';
import { confirmAction } from '../components/confirm';
import { ReorderList } from '../components/ReorderList';
import { Segmented, TextField } from '../components/Fields';

type Tab = 'about' | 'chapters' | 'notes';

export function NovelPage({ novelId }: { novelId: string }) {
  const fromStore = useStore((s) => s.novels.find((n) => n.id === novelId));
  const { query } = useRoute();
  const tab = (query.get('tab') as Tab) || 'about';
  const fallback = useAsync(() => (fromStore ? Promise.resolve(fromStore) : getNovel(db(), novelId)), [novelId, !!fromStore]);
  const novel = fromStore ?? fallback.data;
  useDocumentTitle(novel?.title);

  if (!novel) {
    if (fallback.loading) return <div className="page"><Spinner /></div>;
    return (
      <div className="page">
        <EmptyState icon={BookOpen} title="This novel isn't in your library" action={<Button onClick={() => navigate(routes.library())}>Go to Library</Button>}>
          It may have been deleted.
        </EmptyState>
      </div>
    );
  }
  const setTab = (t: Tab) => navigate(routes.novel(novel.id, t === 'about' ? undefined : t), { replace: true });

  return (
    <div className="page page--novel">
      <button type="button" className="back-link" onClick={() => goBack(routes.library())}>
        <ArrowLeft size={18} aria-hidden /> Back
      </button>
      <NovelHeader novel={novel} />
      <div className="tabs" role="tablist" aria-label="Novel sections">
        {(
          [
            ['about', 'About'],
            ['chapters', `Chapters ${novel.chapterCount ? `(${formatNumber(novel.chapterCount)})` : ''}`],
            ['notes', 'Bookmarks & notes'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} className={`tabs__tab ${tab === t ? 'is-on' : ''}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'about' && <AboutTab novel={novel} />}
        {tab === 'chapters' && <ChaptersTab novel={novel} />}
        {tab === 'notes' && <NotesTab novel={novel} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ header */

function NovelHeader({ novel }: { novel: NovelSummary }) {
  const wpm = useStore((s) => s.reader.wpm);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const started = !!novel.progress;
  const minutesTotal = readingMinutes(novel.totalWords, wpm);

  const changeCover = async () => {
    const [file] = await pickFiles('image/*', false);
    if (!file) return;
    try {
      const prepared = await prepareCover(file.bytes);
      if (novel.coverId) forgetBlob(novel.coverId);
      await mutate((d) => setCover(d, novel.id, prepared), 'Cover updated');
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  };

  const remove = async () => {
    const ok = await confirmAction({
      title: `Delete “${novel.title}”?`,
      body: 'This removes the novel, its chapters, progress, bookmarks, highlights and notes from this device. Reading stats are kept. This can’t be undone (unless you restore a backup).',
      confirmLabel: 'Delete novel',
      danger: true,
    });
    if (!ok) return;
    await mutate((d) => deleteNovel(d, novel.id), 'Novel deleted');
    navigate(routes.library(), { replace: true });
  };

  const menu: (MenuItem | 'divider')[] = [
    { label: 'Edit details', icon: Pencil, onSelect: () => navigate(routes.editNovel(novel.id)) },
    { label: novel.coverId ? 'Change cover' : 'Add cover', icon: ImagePlus, onSelect: changeCover },
    ...(novel.coverId ? [{ label: 'Remove cover', icon: ImageOff, onSelect: () => void mutate((d) => setCover(d, novel.id, null), 'Cover removed') }] : []),
    { label: 'Add chapter', icon: Plus, onSelect: () => navigate(routes.newChapter(novel.id)) },
    'divider',
    {
      label: 'Reset reading progress',
      icon: RotateCcw,
      disabled: !started && !novel.chaptersRead,
      onSelect: async () => {
        if (await confirmAction({ title: 'Reset reading progress?', body: 'Your place and the read markers on chapters are cleared. Bookmarks, notes and stats are kept.', confirmLabel: 'Reset progress', danger: true }))
          await mutate((d) => resetProgress(d, novel.id), 'Progress reset');
      },
    },
    { label: 'Delete novel', icon: Trash2, danger: true, onSelect: remove },
  ];

  return (
    <section className="novel-head">
      <button type="button" className="novel-head__cover" onClick={changeCover} aria-label={novel.coverId ? 'Change cover' : 'Add cover'}>
        <Cover coverId={novel.coverId} title={novel.title} author={novel.author} size="xl" />
      </button>
      <div className="novel-head__body">
        <h1 className="novel-head__title">{novel.title}</h1>
        {novel.altTitles.length > 0 && <p className="novel-head__alt">{novel.altTitles.join(' / ')}</p>}
        <p className="novel-head__byline">
          {novel.author ? <span>{novel.author}</span> : <span className="muted">Unknown author</span>}
          {novel.translator && <span className="muted"> translated by {novel.translator}</span>}
        </p>
        <div className="novel-head__facts">
          <span>{formatNumber(novel.chapterCount)} {novel.chapterCount === 1 ? 'chapter' : 'chapters'}</span>
          {novel.totalWords > 0 && <span>{formatNumber(novel.totalWords)} words</span>}
          {novel.totalWords > 0 && <span>about {formatMinutes(minutesTotal)}</span>}
          {novel.publicationStatus && <span>{novel.publicationStatus}</span>}
        </div>
        {novel.chapterCount > 0 && (
          <div className="novel-head__progress">
            <Ribbon value={novel.percent} label={`${Math.round(novel.percent * 100)}% read`} />
            <span className="novel-head__pct">
              <span>{Math.round(novel.percent * 100)}% read</span>
              {novel.progress && <span className="muted">Now on {novel.progress.chapterTitle}</span>}
            </span>
          </div>
        )}
        <div className="novel-head__actions">
          {novel.chapterCount > 0 ? (
            <Button variant="primary" size="lg" icon={BookOpen} onClick={() => navigate(routes.read(novel.id))} data-testid="start-reading">
              {started ? 'Continue reading' : 'Start reading'}
            </Button>
          ) : novel.externalUrl ? (
            <Button variant="primary" size="lg" icon={ExternalLink} onClick={() => openExternal(novel.externalUrl).catch((e) => toast({ message: e.message, tone: 'error' }))}>
              Open link
            </Button>
          ) : (
            <Button variant="primary" size="lg" icon={Plus} onClick={() => navigate(routes.newChapter(novel.id))}>
              Add first chapter
            </Button>
          )}
          <label className="status-select">
            <span className="visually-hidden">Reading status</span>
            <select value={novel.status} onChange={(e) => void mutate((d) => updateNovel(d, novel.id, { status: e.target.value as ReadingStatus }))} data-testid="status-select">
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <IconButton
            icon={Heart}
            tone="heart"
            active={novel.favourite}
            label={novel.favourite ? 'Remove from favourites' : 'Add to favourites'}
            onClick={() => void mutate((d) => updateNovel(d, novel.id, { favourite: !novel.favourite }))}
          />
          <IconButton icon={FolderPlus} label="Add to collection" onClick={() => setCollectionsOpen(true)} />
          <Menu label="More actions" items={menu} trigger={(p) => <IconButton icon={MoreHorizontal} label="More actions" {...p} />} />
        </div>
      </div>
      <CollectionsDialog novel={novel} open={collectionsOpen} onClose={() => setCollectionsOpen(false)} />
    </section>
  );
}

function CollectionsDialog({ novel, open, onClose }: { novel: NovelSummary; open: boolean; onClose: () => void }) {
  const collections = useStore((s) => s.collections);
  const member = useAsync(() => collectionsForNovel(db(), novel.id), [novel.id, open]);
  const [name, setName] = useState('');
  const ids = member.data ?? [];
  const create = async () => {
    const id = await mutate((d) => createCollection(d, name));
    if (id) {
      await mutate((d) => addToCollection(d, id, novel.id), `Added to ${name.trim()}`);
      setName('');
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Collections" description={`Choose collections for “${novel.title}”.`} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      {collections.length > 0 && (
        <ul className="check-list">
          {collections.map((c) => {
            const on = ids.includes(c.id);
            return (
              <li key={c.id}>
                <label className="check-list__item">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => void mutate((d) => (on ? removeFromCollection(d, c.id, novel.id) : addToCollection(d, c.id, novel.id)))}
                  />
                  <span>{c.name}</span>
                  <span className="muted">{c.novelCount}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <TextField label="New collection" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rainy-day rereads" />
        <Button type="submit" icon={Plus} disabled={!name.trim()}>
          Create
        </Button>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ about */

function AboutTab({ novel }: { novel: NovelSummary }) {
  const time = useAsync(() => novelReadingTime(db(), novel.id), [novel.id]);
  const [notes, setNotes] = useState(novel.personalNotes);
  useEffect(() => setNotes(novel.personalNotes), [novel.personalNotes]);
  const saveNotes = () => {
    if (notes !== novel.personalNotes) void mutate((d) => updateNovel(d, novel.id, { personalNotes: notes }), 'Notes saved');
  };
  const rows: [string, React.ReactNode][] = [
    ['Content type', contentTypeLabel(novel.contentType)],
    ['Source', novel.source || '—'],
    ['Licence notes', novel.licenceNotes || '—'],
    ...(novel.externalUrl
      ? ([
          [
            'External link',
            <span className="ext-link" key="l">
              <span className="ext-link__url">{novel.externalUrl}</span>
              <IconButton icon={ExternalLink} size="sm" label="Open link in browser" onClick={() => openExternal(novel.externalUrl).catch((e) => toast({ message: e.message, tone: 'error' }))} />
              <IconButton icon={Copy} size="sm" label="Copy link" onClick={async () => toast((await copyText(novel.externalUrl)) ? 'Link copied' : "Couldn't copy the link")} />
            </span>,
          ],
        ] as [string, React.ReactNode][])
      : []),
    ['Status', <StatusBadge key="s" status={novel.status} />],
    ...(novel.publicationStatus ? ([['Publication', novel.publicationStatus]] as [string, string][]) : []),
    ...(novel.language ? ([['Language', novel.language]] as [string, string][]) : []),
    ['Chapters read', `${formatNumber(novel.chaptersRead)} of ${formatNumber(novel.chapterCount)}`],
    ['Time spent reading', time.data !== undefined ? formatDuration(time.data) : '…'],
    ['Added', formatDate(novel.createdAt)],
    ['Updated', formatDate(novel.contentUpdatedAt)],
    ['Last read', novel.lastReadAt ? relativeTime(novel.lastReadAt) : 'Not yet'],
  ];
  return (
    <div className="about">
      <div className="about__main">
        {novel.description ? <p className="about__desc">{novel.description}</p> : <p className="muted">No description. <a className="link" href={href(routes.editNovel(novel.id))}>Add one</a></p>}
        {(novel.genres.length > 0 || novel.tags.length > 0) && (
          <div className="about__chips">
            {novel.genres.map((g) => (
              <a key={g} className="chip chip--genre" href={href(routes.library(`genre=${encodeURIComponent(g)}`))}>
                {g}
              </a>
            ))}
            {novel.tags.map((t) => (
              <a key={t} className="chip" href={href(routes.library(`tag=${encodeURIComponent(t)}`))}>
                {t}
              </a>
            ))}
          </div>
        )}
        <div className="about__notes">
          <label className="field__label" htmlFor="personal-notes">
            Personal notes
          </label>
          <textarea id="personal-notes" className="input input--area" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} placeholder="Thoughts, theories, where you heard about it…" />
        </div>
      </div>
      <dl className="details">
        {rows.map(([k, v]) => (
          <div key={k} className="details__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ chapters */

function ChaptersTab({ novel }: { novel: NovelSummary }) {
  const chapters = useAsync(() => listChapters(db(), novel.id), [novel.id]);
  const [mode, setMode] = useState<'titles' | 'text'>('titles');
  const [q, setQ] = useState('');
  const [reorder, setReorder] = useState(false);
  const [hits, setHits] = useState<{ hits: TextHit[]; total: number } | null>(null);
  const [pasting, setPasting] = useState(false);
  const list = chapters.data ?? [];
  const pasteDialog = pasting && (
    <PasteChaptersDialog novel={novel} existingTitles={list.map((c) => c.title)} onClose={() => setPasting(false)} onDone={() => chapters.reload()} />
  );
  const wpm = useStore((s) => s.reader.wpm);

  useEffect(() => {
    if (mode !== 'text' || !q.trim()) return setHits(null);
    const t = setTimeout(() => void searchText(db(), q, { novelId: novel.id, limit: 100 }).then(setHits), 180);
    return () => clearTimeout(t);
  }, [q, mode, novel.id]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return mode === 'titles' && s ? list.filter((c) => c.title.toLowerCase().includes(s) || String(c.position + 1) === s) : list;
  }, [list, q, mode]);

  if (chapters.loading && !chapters.data) return <Spinner />;
  if (!list.length)
    return (
      <>
        <EmptyState
          icon={NotebookPen}
          title="No chapters yet"
          action={
            <div className="button-row">
              <Button variant="primary" icon={ClipboardPaste} onClick={() => setPasting(true)}>
                Paste chapters
              </Button>
              <Button icon={Plus} onClick={() => navigate(routes.newChapter(novel.id))}>
                Write a chapter
              </Button>
            </div>
          }
        >
          {novel.contentType === 'external_link' ? 'This novel is saved as a link. You can still add chapters.' : 'Paste many chapters at once, or write one by hand.'}
        </EmptyState>
        {pasteDialog}
      </>
    );

  const chapterMenu = (c: ChapterMeta): (MenuItem | 'divider')[] => [
    { label: 'Read', icon: BookOpen, onSelect: () => navigate(routes.read(novel.id, c.id)) },
    { label: 'Edit chapter', icon: Pencil, onSelect: () => navigate(routes.editChapter(novel.id, c.id)) },
    { label: c.completed ? 'Mark as unread' : 'Mark as read', icon: c.completed ? Circle : CircleCheck, onSelect: () => void mutate((d) => setChapterRead(d, novel.id, c.id, !c.completed)) },
    { label: 'Mark all before this as read', icon: CheckCheck, disabled: c.position === 0, onSelect: () => void mutate((d) => markReadUpTo(d, novel.id, c.position), 'Marked as read') },
    { label: 'Insert chapter after', icon: Plus, onSelect: () => navigate(routes.newChapter(novel.id) + `?at=${c.position + 1}`) },
    'divider',
    {
      label: 'Delete chapter',
      icon: Trash2,
      danger: true,
      onSelect: async () => {
        if (await confirmAction({ title: `Delete “${c.title}”?`, body: 'Its bookmarks, highlights and notes are deleted too.', confirmLabel: 'Delete chapter', danger: true }))
          await mutate((d) => deleteChapter(d, c.id), 'Chapter deleted');
      },
    },
  ];

  return (
    <div className="chapters">
      <div className="chapters__bar">
        {!reorder && (
          <>
            <label className="filter-input chapters__search">
              <Search size={18} aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === 'titles' ? 'Filter chapter titles or go to number' : 'Search the text of this novel'} aria-label="Search chapters" />
              {q && <IconButton icon={X} size="sm" label="Clear" onClick={() => setQ('')} />}
            </label>
            <Segmented
              label="Search in"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'titles', label: 'Titles' },
                { value: 'text', label: 'Full text' },
              ]}
            />
          </>
        )}
        <div className="chapters__actions">
          {novel.progress && !reorder && (
            <Button size="sm" variant="ghost" onClick={() => document.getElementById(`ch-${novel.progress!.chapterId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>
              Jump to current
            </Button>
          )}
          <Button size="sm" variant={reorder ? 'primary' : 'secondary'} icon={reorder ? ListChecks : ArrowUpDown} onClick={() => setReorder(!reorder)}>
            {reorder ? 'Done' : 'Reorder'}
          </Button>
          {!reorder && (
            <Button size="sm" icon={ClipboardPaste} onClick={() => setPasting(true)} data-testid="paste-chapters">
              Paste chapters
            </Button>
          )}
          {!reorder && (
            <Button size="sm" icon={Plus} onClick={() => navigate(routes.newChapter(novel.id))}>
              Add
            </Button>
          )}
        </div>
      </div>

      {reorder ? (
        <ReorderList
          items={list}
          label={(c) => c.title}
          onReorder={(ids) => void mutate((d) => reorderChapters(d, novel.id, ids)).then(() => chapters.reload())}
          renderItem={(c, i) => (
            <span className="chapter-row__title">
              <span className="chapter-row__num">{i + 1}</span>
              {c.title}
            </span>
          )}
        />
      ) : hits ? (
        <div className="text-hits">
          <p className="muted">{hits.total ? `${formatNumber(hits.total)} ${hits.total === 1 ? 'chapter matches' : 'chapters match'}` : 'No matches in this novel.'}</p>
          <ul>
            {hits.hits.map((h) => (
              <li key={h.chapterId}>
                <a className="text-hit" href={href(routes.read(novel.id, h.chapterId, `find=${encodeURIComponent(q)}`))}>
                  <span className="text-hit__title">
                    <span className="chapter-row__num">{h.position + 1}</span> {h.chapterTitle}
                  </span>
                  <span className="text-hit__snippet" dangerouslySetInnerHTML={{ __html: h.snippet }} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ol className="chapter-list">
          {filtered.map((c) => {
            const current = novel.progress?.chapterId === c.id;
            return (
              <li key={c.id} id={`ch-${c.id}`} className={`chapter-row ${c.completed ? 'is-read' : ''} ${current ? 'is-current' : ''}`}>
                <a className="chapter-row__link" href={href(routes.read(novel.id, c.id))}>
                  <span className="chapter-row__num">{c.position + 1}</span>
                  <span className="chapter-row__title">{c.title}</span>
                  {current && <span className="chapter-row__here">Reading</span>}
                  {c.wordCount > 0 && (
                    <span className="chapter-row__meta">
                      <span>{formatNumber(c.wordCount)} words</span>
                      <span>{formatMinutes(readingMinutes(c.wordCount, wpm))}</span>
                    </span>
                  )}
                  {c.completed && <CircleCheck className="chapter-row__check" size={16} aria-label="Read" />}
                </a>
                <Menu label={`Actions for ${c.title}`} items={chapterMenu(c)} trigger={(p) => <IconButton icon={MoreHorizontal} size="sm" label={`Actions for ${c.title}`} {...p} />} />
              </li>
            );
          })}
        </ol>
      )}
      {pasteDialog}
    </div>
  );
}

/* ------------------------------------------------------------------ notes */

const KIND_LABEL: Record<AnnotationKind, string> = {
  chapter_bookmark: 'Chapter bookmark',
  text_bookmark: 'Bookmark',
  highlight: 'Highlight',
  note: 'Note',
};
const KIND_ICON = { chapter_bookmark: Bookmark, text_bookmark: Bookmark, highlight: Highlighter, note: StickyNote };

function NotesTab({ novel }: { novel: NovelSummary }) {
  const anns = useAsync(() => listAnnotationsForNovel(db(), novel.id), [novel.id]);
  const [filter, setFilter] = useState<'all' | 'bookmarks' | 'highlight' | 'note'>('all');
  const [editing, setEditing] = useState<Annotation | null>(null);
  const list = (anns.data ?? []).filter((a) =>
    filter === 'all' ? true : filter === 'bookmarks' ? a.kind === 'chapter_bookmark' || a.kind === 'text_bookmark' : filter === 'highlight' ? a.kind === 'highlight' : a.kind === 'note' || (a.kind === 'highlight' && a.note),
  );
  const groups = useMemo(() => {
    const m = new Map<string, Annotation[]>();
    for (const a of list) m.set(a.chapterId, [...(m.get(a.chapterId) ?? []), a]);
    return [...m.values()];
  }, [list]);

  if (anns.loading && !anns.data) return <Spinner />;
  if (!anns.data?.length)
    return (
      <EmptyState icon={Bookmark} title="No bookmarks or notes yet">
        While reading, tap the bookmark icon to bookmark a chapter, or select text to highlight it, bookmark it or add a note.
      </EmptyState>
    );

  return (
    <div className="notes">
      <Segmented
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: `All (${anns.data.length})` },
          { value: 'bookmarks', label: 'Bookmarks' },
          { value: 'highlight', label: 'Highlights' },
          { value: 'note', label: 'Notes' },
        ]}
      />
      {groups.map((g) => (
        <section key={g[0].chapterId} className="notes__group">
          <h3 className="notes__chapter">
            <span className="chapter-row__num">{(g[0].chapterPosition ?? 0) + 1}</span> {g[0].chapterTitle}
          </h3>
          <ul className="notes__list">
            {g.map((a) => {
              const Icon = KIND_ICON[a.kind];
              return (
                <li key={a.id} className={`ann ann--${a.kind} hl-${a.color}`}>
                  <a className="ann__open" href={href(routes.read(novel.id, a.chapterId, `a=${a.id}`))}>
                    <span className="ann__kind">
                      <Icon size={14} aria-hidden /> {KIND_LABEL[a.kind]}
                      <span className="muted ann__date">{formatDate(a.createdAt)}</span>
                    </span>
                    {a.quote && <blockquote className="ann__quote">{a.quote}</blockquote>}
                    {a.note && <p className="ann__note">{a.note}</p>}
                  </a>
                  <div className="ann__actions">
                    {a.kind !== 'chapter_bookmark' && <IconButton icon={Pencil} size="sm" label="Edit note" onClick={() => setEditing(a)} />}
                    <IconButton
                      icon={Trash2}
                      size="sm"
                      label="Delete"
                      onClick={async () => {
                        await mutate((d) => deleteAnnotation(d, a.id), `${KIND_LABEL[a.kind]} deleted`);
                        anns.reload();
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {editing && <NoteEditor annotation={editing} onClose={() => setEditing(null)} onSaved={anns.reload} />}
    </div>
  );
}

export function NoteEditor({ annotation, onClose, onSaved }: { annotation: Annotation; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState(annotation.note);
  const save = async () => {
    await mutate((d) => updateAnnotation(d, annotation.id, { note, kind: annotation.kind === 'text_bookmark' && note ? 'note' : annotation.kind }), 'Note saved');
    onSaved();
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Note"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save note
          </Button>
        </>
      }
    >
      {annotation.quote && <blockquote className="ann__quote">{annotation.quote}</blockquote>}
      <label className="field__label" htmlFor="note-text">
        Your note
      </label>
      <textarea id="note-text" className="input input--area" rows={5} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus />
    </Dialog>
  );
}
