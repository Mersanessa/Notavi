import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, CircleAlert, CircleCheck, FileText, Layers, Link2, ListChecks, TriangleAlert, Upload, X } from 'lucide-react';
import { db, mutate, useStore } from '../../app/store';
import { useDocumentTitle } from '../../app/hooks';
import { goBack, href, navigate, routes } from '../../app/router';
import { CONTENT_TYPES, type ContentType, type NewChapter, type ParsedNovel } from '../../data/model';
import { appendChapters, chapterTitles, createNovel } from '../../data/novels';
import { ACCEPT_ATTR, parseFile } from '../../import';
import { auditPlan, chaptersFromPlan, nextChapterNumber, planLayout, suggestWebTitles, volumeNumber, type PlanItem, type PlanOptions, type Volume } from '../../import/layout';
import { formatNumber, uniqueStrings } from '../../lib/text';
import { pickFiles, type PickedFile } from '../../platform';
import { Button, IconButton } from '../components/Button';
import { PageHeader, Spinner } from '../components/misc';
import { Switch } from '../components/Fields';
import { PlanReviewDialog, PlanSummary } from '../components/ChapterPlan';

interface Part {
  name: string;
  size: number;
  parsed: ParsedNovel;
}

interface Item {
  key: number;
  state: 'parsing' | 'ready' | 'error' | 'importing' | 'done';
  error?: string;
  /** One file, or several volumes combined into one novel. */
  parts: Part[];
  /** Placeholder file info while parsing / on error. */
  name: string;
  size: number;
  plan: PlanItem[];
  opts: PlanOptions;
  title: string;
  author: string;
  contentType: ContentType;
  source: string;
  licenceNotes: string;
  /** 'new' or the id of a novel to add the chapters to. */
  target: string;
  novelId?: string;
  added?: number;
}

let pending: PickedFile[] = [];
/** Files dropped elsewhere in the app, picked up when this page opens. */
export function queueDroppedFiles(files: PickedFile[]) {
  pending = pending.concat(files);
}

let seq = 0;

function formatSize(b: number) {
  return b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
}

const volumesOf = (it: Pick<Item, 'parts'>): Volume[] => it.parts.map((p) => ({ label: p.parsed.title || p.name, sections: p.parsed.chapters }));

/** Strip "Volume 3" / "Book 2" from a title so a combined novel gets the series name. */
function seriesTitle(t: string): string {
  return t.replace(/[\s,:–—-]*\(?\s*(?:vol(?:ume)?\.?|book|part)\s*\d+\)?.*$/i, '').trim() || t;
}

function plan(it: Pick<Item, 'parts' | 'opts'>): PlanItem[] {
  return planLayout(volumesOf(it), it.opts);
}

export function ImportPage() {
  useDocumentTitle('Import');
  const novels = useStore((s) => s.novels);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const busy = items.some((i) => i.state === 'parsing' || i.state === 'importing');
  const zone = useRef<HTMLDivElement>(null);

  const update = (key: number, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const add = async (files: PickedFile[]) => {
    const fresh: Item[] = files.map((f) => ({
      key: ++seq, state: 'parsing', parts: [], name: f.name, size: f.bytes.length, plan: [], opts: { webTitles: false, startNumber: 1 },
      title: '', author: '', contentType: 'personal_import', source: '', licenceNotes: '', target: 'new',
    }));
    setItems((l) => [...l, ...fresh]);
    for (let i = 0; i < files.length; i++) {
      await new Promise((r) => setTimeout(r, 0)); // let the UI paint between files
      try {
        const parsed = await parseFile(files[i].name, files[i].bytes);
        const pd = parsed.source === 'Project Gutenberg';
        const parts = [{ name: files[i].name, size: files[i].bytes.length, parsed }];
        // Web-novel titles by default only when the book already calls its chapters "Chapter …".
        const opts = { webTitles: parsed.format === 'epub' && suggestWebTitles([{ label: '', sections: parsed.chapters }]), startNumber: 1 };
        update(fresh[i].key, {
          state: 'ready',
          parts,
          opts,
          plan: plan({ parts, opts }),
          title: parsed.title,
          author: parsed.author ?? '',
          source: parsed.source ?? '',
          contentType: pd ? 'public_domain' : 'personal_import',
          licenceNotes: pd ? 'Public domain text from Project Gutenberg. Header and licence boilerplate removed on import.' : '',
        });
      } catch (err) {
        update(fresh[i].key, { state: 'error', error: (err as Error).message });
      }
    }
  };

  useEffect(() => {
    if (pending.length) {
      const files = pending;
      pending = [];
      void add(files);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Re-plan an item after its options, target or volume order change. */
  const replan = async (it: Item, patch: Partial<Item>) => {
    const next = { ...it, ...patch };
    if (patch.target !== undefined) {
      next.opts = { ...next.opts, startNumber: next.target === 'new' ? 1 : nextChapterNumber(await chapterTitles(db(), next.target)) };
    }
    update(it.key, { ...patch, opts: next.opts, plan: plan(next) });
  };

  const ready = items.filter((i) => i.state === 'ready');
  const done = items.filter((i) => i.state === 'done');

  const combine = () => {
    const sorted = [...ready].sort((a, b) => {
      const va = volumeNumber(a.parts[0].parsed.title) ?? volumeNumber(a.parts[0].name) ?? 9999;
      const vb = volumeNumber(b.parts[0].parsed.title) ?? volumeNumber(b.parts[0].name) ?? 9999;
      return va - vb || a.parts[0].name.localeCompare(b.parts[0].name, undefined, { numeric: true });
    });
    const first = sorted[0];
    const parts = sorted.flatMap((i) => i.parts);
    const opts = { webTitles: true, startNumber: 1 };
    const combined: Item = {
      ...first,
      key: ++seq,
      parts,
      name: parts.map((p) => p.name).join(', '),
      size: parts.reduce((s, p) => s + p.size, 0),
      opts,
      plan: plan({ parts, opts }),
      title: seriesTitle(first.title),
      target: 'new',
    };
    setItems((list) => [...list.filter((i) => i.state !== 'ready'), combined]);
  };

  const separate = (it: Item) => {
    const singles: Item[] = it.parts.map((p) => {
      const parts = [p];
      const opts = { webTitles: p.parsed.format === 'epub' && suggestWebTitles([{ label: '', sections: p.parsed.chapters }]), startNumber: 1 };
      return { ...it, key: ++seq, parts, name: p.name, size: p.size, opts, plan: plan({ parts, opts }), title: p.parsed.title, author: p.parsed.author ?? '', target: 'new' };
    });
    setItems((list) => list.flatMap((x) => (x.key === it.key ? singles : [x])));
  };

  const importOne = async (it: Item) => {
    if (!it.title.trim() && it.target === 'new') return;
    update(it.key, { state: 'importing' });
    const vols = volumesOf(it);
    // Use the arrangement only if it passes the word check; otherwise import exactly as laid out in the file.
    const chapters: NewChapter[] = auditPlan(vols, it.plan).ok
      ? chaptersFromPlan(it.plan)
      : vols.flatMap((v) => v.sections.map((s) => ({ title: s.title, content: s.content })));
    const images = it.parts.flatMap((p) => p.parsed.images ?? []);
    const first = it.parts[0].parsed;
    if (it.target === 'new') {
      const id = await mutate((d) =>
        createNovel(
          d,
          {
            title: it.title.trim(),
            author: it.author.trim(),
            translator: first.translator,
            description: first.description,
            language: first.language,
            genres: uniqueStrings(it.parts.flatMap((p) => p.parsed.genres ?? [])),
            tags: uniqueStrings(it.parts.flatMap((p) => p.parsed.tags ?? [])),
            altTitles: first.altTitles,
            contentType: it.contentType,
            source: it.source.trim(),
            licenceNotes: it.licenceNotes.trim(),
          },
          { cover: first.cover, chapters, images },
        ),
      );
      update(it.key, id ? { state: 'done', novelId: id, added: chapters.filter((c) => !c.bookOnly).length } : { state: 'ready' });
    } else {
      const n = await mutate((d) => appendChapters(d, it.target, chapters, images));
      update(it.key, n !== undefined ? { state: 'done', novelId: it.target, added: n } : { state: 'ready' });
    }
  };

  const importAll = async () => {
    for (const it of items.filter((i) => i.state === 'ready')) await importOne(it);
  };

  const reviewItem = items.find((i) => i.key === reviewing);

  return (
    <div className="page page--import">
      <button type="button" className="back-link" onClick={() => goBack(routes.library())}>
        <ArrowLeft size={18} aria-hidden /> Library
      </button>
      <PageHeader title="Import novels" lead="Choose files you own: EPUB (DRM-free), TXT, HTML or Markdown. Files are read on this device and never uploaded. Several volumes of one series can be combined into a single web-novel-style chapter list." />

      <div
        ref={zone}
        className={`dropzone ${over ? 'is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const files = await Promise.all(Array.from(e.dataTransfer.files).map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
          void add(files);
        }}
      >
        <Upload size={28} strokeWidth={1.5} aria-hidden className="dropzone__icon" />
        <p className="dropzone__text">Drop files here, or</p>
        <Button variant="primary" icon={FileText} onClick={async () => add(await pickFiles(ACCEPT_ATTR, true))} data-testid="choose-files">
          Choose files
        </Button>
        <p className="dropzone__hint">
          Want to save a web novel as a link instead? <a className="link" href={href(routes.newNovel())}>Add it by hand</a> and choose “External link”.
        </p>
      </div>

      {items.length > 0 && (
        <div className="import-list">
          <div className="import-list__head">
            <h2 className="section-head__title">
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </h2>
            <div className="import-list__actions">
              {done.length > 0 && !busy && (
                <Button variant="ghost" onClick={() => setItems((l) => l.filter((i) => i.state !== 'done' && i.state !== 'error'))}>
                  Clear finished
                </Button>
              )}
              {ready.length > 1 && !busy && (
                <Button icon={Layers} onClick={combine} data-testid="combine">
                  Combine {ready.length} files into one novel
                </Button>
              )}
              {ready.length > 1 && (
                <Button variant="primary" onClick={importAll} disabled={busy}>
                  Import all {ready.length}
                </Button>
              )}
            </div>
          </div>
          <ul>
            {items.map((it) => (
              <li key={it.key} className={`import-item import-item--${it.state}`} data-testid="import-item">
                <div className="import-item__head">
                  {it.state === 'parsing' || it.state === 'importing' ? <Spinner /> : it.state === 'error' ? <CircleAlert size={20} className="tone-danger" aria-hidden /> : it.state === 'done' ? <CircleCheck size={20} className="tone-ok" aria-hidden /> : it.parts.length > 1 ? <Layers size={20} aria-hidden /> : <FileText size={20} aria-hidden />}
                  <span className="import-item__file">
                    {it.parts.length > 1 ? `${it.parts.length} volumes combined` : it.name}
                    <span className="muted"> {formatSize(it.size)}</span>
                  </span>
                  {it.state !== 'importing' && it.state !== 'parsing' && <IconButton icon={X} size="sm" label={`Remove ${it.name} from the list`} onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))} />}
                </div>

                {it.state === 'parsing' && <p className="muted">Reading the file…</p>}
                {it.state === 'error' && <p className="import-item__error" role="alert">{it.error}</p>}
                {it.state === 'done' && (
                  <p>
                    {it.target === 'new' ? 'Imported.' : `Added ${it.added} ${it.added === 1 ? 'chapter' : 'chapters'}.`}{' '}
                    <a className="link" href={href(routes.novel(it.novelId!))}>
                      Open “{it.target === 'new' ? it.title : novels.find((n) => n.id === it.novelId)?.title ?? 'novel'}”
                    </a>
                  </p>
                )}
                {(it.state === 'ready' || it.state === 'importing') && it.parts.length > 0 && (
                  <ImportPreview
                    item={it}
                    novels={novels}
                    duplicate={it.target === 'new' && novels.some((n) => n.title.toLowerCase() === it.title.trim().toLowerCase())}
                    onChange={(p) => update(it.key, p)}
                    onReplan={(p) => void replan(it, p)}
                    onReview={() => setReviewing(it.key)}
                    onSeparate={() => separate(it)}
                    onImport={() => importOne(it)}
                  />
                )}
              </li>
            ))}
          </ul>
          {done.length > 0 && !busy && !ready.length && (
            <div className="import-list__done">
              <Button variant="primary" onClick={() => navigate(done.length === 1 ? routes.novel(done[0].novelId!) : routes.library('sort=added'))}>
                {done.length === 1 ? 'Open novel' : 'Go to Library'}
              </Button>
            </div>
          )}
        </div>
      )}
      {reviewItem && (
        <PlanReviewDialog
          items={reviewItem.plan}
          volumes={volumesOf(reviewItem)}
          opts={reviewItem.opts}
          onClose={() => setReviewing(null)}
          onApply={(plan, opts) => {
            update(reviewItem.key, { plan, opts });
            setReviewing(null);
          }}
        />
      )}
    </div>
  );
}

function ImportPreview({
  item,
  novels,
  duplicate,
  onChange,
  onReplan,
  onReview,
  onSeparate,
  onImport,
}: {
  item: Item;
  novels: { id: string; title: string }[];
  duplicate: boolean;
  onChange: (p: Partial<Item>) => void;
  onReplan: (p: Partial<Item>) => void;
  onReview: () => void;
  onSeparate: () => void;
  onImport: () => void;
}) {
  const warnings = item.parts.flatMap((p) => p.parsed.warnings);
  const images = item.parts.reduce((s, p) => s + (p.parsed.images?.length ?? 0), 0);
  const formats = uniqueStrings(item.parts.map((p) => p.parsed.format.toUpperCase()));
  const sortedNovels = useMemo(() => [...novels].sort((a, b) => a.title.localeCompare(b.title)), [novels]);
  // Only the files decide this, not the title or author: typing must not re-check every word of the novel.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const vols = useMemo(() => volumesOf(item), [item.parts]);
  const moveVolume = (i: number, d: -1 | 1) => {
    const parts = [...item.parts];
    const [x] = parts.splice(i, 1);
    parts.splice(i + d, 0, x);
    onReplan({ parts });
  };

  return (
    <div className="import-item__body">
      <p className="import-item__summary">
        <span>{formats.join(', ')}</span>
        {item.parts[0].parsed.cover && <span>Cover included</span>}
        {images > 0 && <span>{images} images</span>}
      </p>
      {item.parts.length > 1 && (
        <div className="volume-order">
          <p className="field__label">Order of volumes</p>
          <ol>
            {item.parts.map((p, i) => (
              <li key={p.name + i}>
                <span className="volume-order__n">{i + 1}</span>
                <span className="volume-order__name">{p.parsed.title || p.name}</span>
                <IconButton icon={ArrowUp} size="sm" label={`Move ${p.name} earlier`} disabled={i === 0} onClick={() => moveVolume(i, -1)} />
                <IconButton icon={ArrowDown} size="sm" label={`Move ${p.name} later`} disabled={i === item.parts.length - 1} onClick={() => moveVolume(i, 1)} />
              </li>
            ))}
          </ol>
          <button type="button" className="link link--quiet" onClick={onSeparate}>
            Import them separately instead
          </button>
        </div>
      )}

      <PlanSummary items={item.plan} volumes={vols} />
      <div className="import-item__layout">
        <Switch
          label="Web-novel layout"
          hint="Number chapters straight through (“Chapter 214: The Fool”) instead of keeping the book’s titles."
          checked={item.opts.webTitles}
          onChange={(v) => onReplan({ opts: { ...item.opts, webTitles: v } })}
        />
        <Button size="sm" icon={ListChecks} onClick={onReview} data-testid="review-chapters">
          Review chapters
        </Button>
      </div>

      {warnings.length > 0 && (
        <ul className="import-item__warnings">
          {warnings.map((w, i) => (
            <li key={i}>
              <TriangleAlert size={15} aria-hidden /> {w}
            </li>
          ))}
        </ul>
      )}
      <div className="import-item__fields">
        <label className="field import-item__wide">
          <span className="field__label">Add to</span>
          <select className="input input--select" value={item.target} onChange={(e) => onReplan({ target: e.target.value })} data-testid="import-target">
            <option value="new">A new novel</option>
            {sortedNovels.map((n) => (
              <option key={n.id} value={n.id}>
                The end of “{n.title}”
              </option>
            ))}
          </select>
        </label>
        {item.target === 'new' && (
          <>
            <label className="field">
              <span className="field__label">Title</span>
              <input className="input" value={item.title} onChange={(e) => onChange({ title: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">Author</span>
              <input className="input" value={item.author} onChange={(e) => onChange({ author: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">Content type</span>
              <select className="input input--select" value={item.contentType} onChange={(e) => onChange({ contentType: e.target.value as ContentType })}>
                {CONTENT_TYPES.filter((c) => c.value !== 'external_link').map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Source</span>
              <input className="input" value={item.source} onChange={(e) => onChange({ source: e.target.value })} placeholder="Where the file came from" />
            </label>
            <label className="field import-item__wide">
              <span className="field__label">Licence notes</span>
              <input className="input" value={item.licenceNotes} onChange={(e) => onChange({ licenceNotes: e.target.value })} placeholder="e.g. Bought DRM-free; public domain" />
            </label>
          </>
        )}
      </div>
      {duplicate && (
        <p className="import-item__dup">
          <Link2 size={15} aria-hidden /> You already have a novel called “{item.title.trim()}”. To continue it, choose it under “Add to”.
        </p>
      )}
      <div className="import-item__go">
        <Button variant="primary" onClick={onImport} busy={item.state === 'importing'} disabled={item.target === 'new' && !item.title.trim()} data-testid="import-one">
          {item.target === 'new' ? 'Import' : `Add ${formatNumber(item.plan.filter((p) => p.include).length)} chapters`}
        </Button>
      </div>
    </div>
  );
}
