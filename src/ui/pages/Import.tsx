import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CircleAlert, CircleCheck, FileText, Link2, TriangleAlert, Upload, X } from 'lucide-react';
import { mutate, useStore } from '../../app/store';
import { useDocumentTitle } from '../../app/hooks';
import { goBack, href, navigate, routes } from '../../app/router';
import { CONTENT_TYPES, type ContentType, type ParsedNovel } from '../../data/model';
import { importParsed } from '../../data/novels';
import { ACCEPT_ATTR, parseFile } from '../../import';
import { formatNumber, countWords, htmlToText } from '../../lib/text';
import { pickFiles, type PickedFile } from '../../platform';
import { Button, IconButton } from '../components/Button';
import { PageHeader, Spinner } from '../components/misc';

interface Item {
  key: number;
  name: string;
  size: number;
  state: 'parsing' | 'ready' | 'error' | 'importing' | 'done';
  error?: string;
  parsed?: ParsedNovel;
  title: string;
  author: string;
  contentType: ContentType;
  source: string;
  licenceNotes: string;
  novelId?: string;
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

export function ImportPage() {
  useDocumentTitle('Import');
  const novels = useStore((s) => s.novels);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const busy = items.some((i) => i.state === 'parsing' || i.state === 'importing');
  const zone = useRef<HTMLDivElement>(null);

  const update = (key: number, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const add = async (files: PickedFile[]) => {
    const fresh: Item[] = files.map((f) => ({ key: ++seq, name: f.name, size: f.bytes.length, state: 'parsing', title: '', author: '', contentType: 'personal_import', source: '', licenceNotes: '' }));
    setItems((l) => [...l, ...fresh]);
    for (let i = 0; i < files.length; i++) {
      await new Promise((r) => setTimeout(r, 0)); // let the UI paint between files
      try {
        const parsed = await parseFile(files[i].name, files[i].bytes);
        const pd = parsed.source === 'Project Gutenberg';
        update(fresh[i].key, {
          state: 'ready',
          parsed,
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

  const importOne = async (item: Item) => {
    if (!item.parsed || !item.title.trim()) return;
    update(item.key, { state: 'importing' });
    const id = await mutate((d) =>
      importParsed(d, item.parsed!, {
        title: item.title.trim(),
        author: item.author.trim(),
        contentType: item.contentType,
        source: item.source.trim(),
        licenceNotes: item.licenceNotes.trim(),
      }),
    );
    update(item.key, id ? { state: 'done', novelId: id, parsed: undefined } : { state: 'ready' });
  };

  const importAll = async () => {
    for (const it of items.filter((i) => i.state === 'ready')) await importOne(it);
  };

  const ready = items.filter((i) => i.state === 'ready');
  const done = items.filter((i) => i.state === 'done');

  return (
    <div className="page page--import">
      <button type="button" className="back-link" onClick={() => goBack(routes.library())}>
        <ArrowLeft size={18} aria-hidden /> Library
      </button>
      <PageHeader title="Import novels" lead="Choose files you own. Supported: EPUB (DRM-free), TXT, HTML and Markdown. Files are read on this device and never uploaded." />

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
              {items.length} {items.length === 1 ? 'file' : 'files'}
            </h2>
            <div className="import-list__actions">
              {done.length > 0 && !busy && (
                <Button variant="ghost" onClick={() => setItems((l) => l.filter((i) => i.state !== 'done' && i.state !== 'error'))}>
                  Clear finished
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
                  {it.state === 'parsing' || it.state === 'importing' ? <Spinner /> : it.state === 'error' ? <CircleAlert size={20} className="tone-danger" aria-hidden /> : it.state === 'done' ? <CircleCheck size={20} className="tone-ok" aria-hidden /> : <FileText size={20} aria-hidden />}
                  <span className="import-item__file">
                    {it.name}
                    <span className="muted"> {formatSize(it.size)}</span>
                  </span>
                  {it.state !== 'importing' && it.state !== 'parsing' && <IconButton icon={X} size="sm" label={`Remove ${it.name} from the list`} onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))} />}
                </div>

                {it.state === 'parsing' && <p className="muted">Reading the file…</p>}
                {it.state === 'error' && <p className="import-item__error" role="alert">{it.error}</p>}
                {it.state === 'done' && (
                  <p>
                    Imported. <a className="link" href={href(routes.novel(it.novelId!))}>Open “{it.title}”</a>
                  </p>
                )}
                {(it.state === 'ready' || it.state === 'importing') && it.parsed && (
                  <ImportPreview item={it} duplicate={novels.some((n) => n.title.toLowerCase() === it.title.trim().toLowerCase())} onChange={(p) => update(it.key, p)} onImport={() => importOne(it)} />
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
    </div>
  );
}

function ImportPreview({ item, duplicate, onChange, onImport }: { item: Item; duplicate: boolean; onChange: (p: Partial<Item>) => void; onImport: () => void }) {
  const p = item.parsed!;
  const words = p.chapters.reduce((s, c) => s + countWords(htmlToText(c.content)), 0);
  const first = p.chapters.slice(0, 4).map((c) => c.title);
  return (
    <div className="import-item__body">
      <p className="import-item__summary">
        <span>{p.format.toUpperCase()}</span>
        <span>
          {formatNumber(p.chapters.length)} {p.chapters.length === 1 ? 'chapter' : 'chapters'}
        </span>
        <span>{formatNumber(words)} words</span>
        {p.cover && <span>Cover included</span>}
        {(p.images?.length ?? 0) > 0 && <span>{p.images!.length} images</span>}
      </p>
      <p className="import-item__chapters muted">
        Starts with: {first.join(', ')}
        {p.chapters.length > first.length ? '…' : ''}
      </p>
      {p.warnings.length > 0 && (
        <ul className="import-item__warnings">
          {p.warnings.map((w, i) => (
            <li key={i}>
              <TriangleAlert size={15} aria-hidden /> {w}
            </li>
          ))}
        </ul>
      )}
      <div className="import-item__fields">
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
      </div>
      {duplicate && (
        <p className="import-item__dup">
          <Link2 size={15} aria-hidden /> You already have a novel called “{item.title.trim()}”. Importing again creates a second copy.
        </p>
      )}
      <div className="import-item__go">
        <Button variant="primary" onClick={onImport} busy={item.state === 'importing'} disabled={!item.title.trim()}>
          Import
        </Button>
      </div>
    </div>
  );
}
