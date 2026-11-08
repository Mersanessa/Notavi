import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Combine, Eye, EyeOff, Hash, Layers, MessageSquareQuote, Network, Pencil, Quote, StickyNote, Tag, X } from 'lucide-react';
import { db, mutate } from '../../app/store';
import { href, navigate, routes } from '../../app/router';
import { chapterTitleMap, loreMentions, setLoreOverride, type LoreMention } from '../../data/lore';
import { LORE_KINDS, type LoreKind } from '../../lore/extract';
import { TIER_LABEL, type LoreEntry, type LoreView } from '../../lore/view';
import { defineEntry, possibleDuplicates } from '../../lore/define';
import { formatNumber } from '../../lib/text';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { SelectField, Switch, TextField } from '../components/Fields';
import { KIND_COLOUR, KIND_ICON, KIND_LABEL } from './kinds';
import { Peek, type PeekStop } from './Peek';

/** Chapter titles by position, loaded once per novel. */
export function useChapterTitles(novelId: string) {
  const [map, setMap] = useState<Map<number, { id: string; title: string }>>(new Map());
  useEffect(() => {
    void chapterTitleMap(db(), novelId).then(setMap);
  }, [novelId]);
  return map;
}

export function KindPill({ kind }: { kind: LoreKind }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className="kind-pill" style={{ '--kc': KIND_COLOUR[kind] } as React.CSSProperties}>
      <Icon size={13} aria-hidden /> {KIND_LABEL[kind]}
    </span>
  );
}

/** A wiki-style link to another entry. */
export function WikiLink({ entry, onOpen, weight }: { entry: LoreEntry; onOpen: (key: string) => void; weight?: number }) {
  return (
    <button type="button" className="wikilink" style={{ '--kc': KIND_COLOUR[entry.kind] } as React.CSSProperties} onClick={() => onOpen(entry.key)}>
      <span className="wikilink__dot" aria-hidden />
      {entry.name}
      {weight !== undefined && weight > 1 && <span className="wikilink__n">{weight}</span>}
    </button>
  );
}

/** The automatic definition: the book's own description, then what you've seen so far. */
export function Definition({ entry, view, beforePos, chapterLabel, compact }: { entry: LoreEntry; view: LoreView; beforePos: number; chapterLabel: (pos: number) => string; compact?: boolean }) {
  const def = useMemo(() => defineEntry(entry, view, chapterLabel, beforePos), [entry, view, chapterLabel, beforePos]);
  // The card already lists who it's seen with, so it keeps to standing, when, names and last seen.
  const facts = compact ? def.facts.filter((f) => !/^(Most often|Usually around|Linked to|Where you|Includes|Often comes up|Most linked|Shares the)/.test(f)) : def.facts;
  return (
    <div className={`lore-def${compact ? ' lore-def--compact' : ''}`} data-testid="lore-definition">
      {def.lead && (
        <p className="lore-def__lead">
          {def.lead}
          {!compact && def.leadPos !== null && <span className="lore-def__src"> {chapterLabel(def.leadPos)}</span>}
        </p>
      )}
      <p className="lore-def__facts">{facts.join(' ')}</p>
    </div>
  );
}

/** When it comes up, chapter by chapter, across what you've read. */
export function Presence({ entry, chapters, chapterLabel }: { entry: LoreEntry; chapters: number; chapterLabel: (pos: number) => string }) {
  const n = Math.max(chapters, (entry.presence[entry.presence.length - 1]?.[0] ?? 0) + 1);
  if (n < 3) return null;
  const buckets = Math.min(n, 60);
  const per = n / buckets;
  const vals = new Array<number>(buckets).fill(0);
  for (const [pos, c] of entry.presence) vals[Math.min(buckets - 1, Math.floor(pos / per))] += c;
  const max = Math.max(1, ...vals);
  const w = 100 / buckets;
  return (
    <figure className="presence" style={{ '--kc': KIND_COLOUR[entry.kind] } as React.CSSProperties} aria-label={`Mentioned in ${entry.chapters} of ${n} chapters read`}>
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-hidden>
        <line x1="0" x2="100" y1="23.5" y2="23.5" className="presence__base" />
        {vals.map((v, i) =>
          v ? <rect key={i} x={i * w + w * 0.15} width={Math.max(0.6, w * 0.7)} y={24 - Math.max(2, (Math.sqrt(v) / Math.sqrt(max)) * 22)} height={Math.max(2, (Math.sqrt(v) / Math.sqrt(max)) * 22)} rx="0.4" /> : null,
        )}
      </svg>
      <figcaption>
        <span>{chapterLabel(0)}</span>
        <span>{chapterLabel(n - 1)}</span>
      </figcaption>
    </figure>
  );
}

const NOT_DUP = (novelId: string) => `notavi:lore-notdup:${novelId}`;
function readNotDup(novelId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(NOT_DUP(novelId)) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** "Klein" and "Klein Moretti" are probably the same person: one tap to merge. */
function Duplicates({ novelId, entry, view, onChanged }: { novelId: string; entry: LoreEntry; view: LoreView; onChanged: () => void }) {
  const [dismissed, setDismissed] = useState(() => readNotDup(novelId));
  const dups = possibleDuplicates(entry, view).filter((d) => !dismissed.includes([entry.key, d.key].sort().join('|')));
  if (!dups.length) return null;
  const merge = async (d: LoreEntry) => {
    // Keep the fuller name and the one mentioned more.
    const [from, into] = d.mentions > entry.mentions || d.name.length > entry.name.length ? [entry, d] : [d, entry];
    await mutate((db) => setLoreOverride(db, novelId, from.key, { mergedInto: into.key }), `Merged ${from.name} into ${into.name}`);
    onChanged();
    if (from === entry) navigate(routes.lore(novelId, into.key), { replace: true });
  };
  const dismiss = (d: LoreEntry) => {
    const next = [...dismissed, [entry.key, d.key].sort().join('|')];
    setDismissed(next);
    try {
      localStorage.setItem(NOT_DUP(novelId), JSON.stringify(next));
    } catch {
      /* fine: it just asks again next time */
    }
  };
  return (
    <section className="dup-hint" data-testid="lore-duplicates">
      {dups.map((d) => (
        <div key={d.key} className="dup-hint__row">
          <span>
            Same {entry.kind === 'character' ? 'person' : 'thing'} as <strong>{d.name}</strong>?
          </span>
          <span className="dup-hint__actions">
            <Button size="sm" icon={Combine} onClick={() => void merge(d)}>
              Merge
            </Button>
            <button type="button" className="icon-btn icon-btn--sm" aria-label={`Not the same as ${d.name}`} onClick={() => dismiss(d)}>
              <X size={15} aria-hidden />
            </button>
          </span>
        </div>
      ))}
    </section>
  );
}

/**
 * An entry as a note: properties, what the book has said, who it's seen with, every earlier mention,
 * and your own notes. Only from chapters you've read.
 */
export function LoreNote({
  novelId,
  entry,
  view,
  beforePos,
  onOpen,
  onChanged,
}: {
  novelId: string;
  entry: LoreEntry;
  view: LoreView;
  beforePos: number;
  onOpen: (key: string) => void;
  onChanged: () => void;
}) {
  const titles = useChapterTitles(novelId);
  const chapterLabel = useCallback((pos: number) => titles.get(pos)?.title ?? `Chapter ${pos + 1}`, [titles]);
  const [mentions, setMentions] = useState<{ hits: LoreMention[]; total: number } | null>(null);
  const [more, setMore] = useState(0);
  const [editing, setEditing] = useState(false);
  const [peek, setPeek] = useState<{ stops: PeekStop[]; start: number } | null>(null);
  const formsKey = entry.forms.join('|');

  useEffect(() => {
    let alive = true;
    void loreMentions(db(), novelId, entry.forms, beforePos, { limit: 6 + more * 10 }).then((m) => alive && setMentions(m));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId, formsKey, beforePos, more]);

  const related = entry.related.map((r) => ({ e: view.byKey.get(r.key)!, w: r.weight })).filter((r) => r.e);
  const parent = entry.parent ? view.byKey.get(entry.parent) : null;
  const children = entry.children.map((k) => view.byKey.get(k)!).filter(Boolean);
  const first = titles.get(entry.firstPos);
  const readCount = beforePos >= Number.MAX_SAFE_INTEGER ? titles.size : beforePos + 1;

  return (
    <article className="lore-note" data-testid="lore-note">
      <header className="lore-note__head">
        <div className="lore-note__pills">
          <KindPill kind={entry.kind} />
          <span className="tier-pill">{TIER_LABEL[entry.tier]}</span>
        </div>
        <h1 className="lore-note__title">{entry.name}</h1>
        <Definition entry={entry} view={view} beforePos={beforePos} chapterLabel={chapterLabel} />
      </header>

      <Duplicates novelId={novelId} entry={entry} view={view} onChanged={onChanged} />

      <dl className="props">
        <div>
          <dt>
            <Hash size={14} aria-hidden /> Importance
          </dt>
          <dd>
            #{formatNumber(entry.rank)} of {formatNumber(view.entries.length)}
          </dd>
        </div>
        <div>
          <dt>
            <BookOpen size={14} aria-hidden /> First seen
          </dt>
          <dd>
            {first && entry.firstPos < beforePos ? (
              <button type="button" className="link" onClick={() => setPeek({ stops: [{ position: entry.firstPos, title: first.title }], start: 0 })} data-testid="lore-first-seen">
                {first.title}
              </button>
            ) : first ? (
              <a className="link" href={href(routes.read(novelId, first.id))}>
                {first.title}
              </a>
            ) : (
              chapterLabel(entry.firstPos)
            )}
          </dd>
        </div>
        <div>
          <dt>
            <MessageSquareQuote size={14} aria-hidden /> Mentions so far
          </dt>
          <dd>
            {formatNumber(entry.mentions)} in {formatNumber(entry.chapters)} {entry.chapters === 1 ? 'chapter' : 'chapters'}
          </dd>
        </div>
        {(entry.forms.length > 1 || entry.aliases.length > 0) && (
          <div>
            <dt>
              <Tag size={14} aria-hidden /> Also called
            </dt>
            <dd className="wikilinks">
              {entry.forms.filter((f) => f !== entry.name).join(', ')}
              {entry.aliases.map((a) => {
                const other = a.key ? view.byKey.get(a.key) : null;
                return other && other.key !== entry.key ? <WikiLink key={a.name} entry={other} onOpen={onOpen} /> : <span key={a.name}>{a.name}</span>;
              })}
            </dd>
          </div>
        )}
        {parent && (
          <div>
            <dt>
              <Layers size={14} aria-hidden /> Part of
            </dt>
            <dd>
              <WikiLink entry={parent} onOpen={onOpen} />
            </dd>
          </div>
        )}
        {children.length > 0 && (
          <div>
            <dt>
              <Network size={14} aria-hidden /> Contains
            </dt>
            <dd className="wikilinks">
              {children.map((c) => (
                <WikiLink key={c.key} entry={c} onOpen={onOpen} />
              ))}
            </dd>
          </div>
        )}
      </dl>

      {readCount >= 3 && (
        <section className="lore-note__section">
          <h2>Through the book</h2>
          <Presence entry={entry} chapters={readCount} chapterLabel={chapterLabel} />
        </section>
      )}

      {entry.desc.length > 1 && (
        <section className="lore-note__section">
          <h2>In the book's words</h2>
          <ul className="desc-list">
            {entry.desc.map((d, i) => (
              <li key={i}>
                <Quote size={13} aria-hidden className="desc-list__q" />
                <span>
                  {entry.name.split(' ')[0]}
                  {d.kind === 'def' ? ': ' : ', '}
                  {d.text.replace(/[.,;:]$/, '')}
                </span>
                <span className="desc-list__src">{chapterLabel(d.pos)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section className="lore-note__section">
          <h2>Appears with</h2>
          <div className="wikilinks">
            {related.slice(0, 16).map((r) => (
              <WikiLink key={r.e.key} entry={r.e} weight={r.w} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}

      <section className="lore-note__section">
        <h2>
          <StickyNote size={16} aria-hidden /> Your notes
        </h2>
        <NoteBox novelId={novelId} entryKey={entry.key} initial={entry.note} onSaved={onChanged} />
      </section>

      <section className="lore-note__section">
        <h2>Earlier mentions{mentions ? ` (${formatNumber(mentions.total)} ${mentions.total === 1 ? 'chapter' : 'chapters'})` : ''}</h2>
        {!mentions ? null : !mentions.hits.length ? (
          <p className="muted">Nothing in earlier chapters: it first comes up in the chapter you're reading.</p>
        ) : (
          <ol className="mention-list">
            {mentions.hits.map((m, i) => (
              <li key={m.chapterId}>
                <button
                  type="button"
                  className="mention"
                  onClick={() => setPeek({ stops: mentions.hits.map((h) => ({ position: h.position, title: h.chapterTitle })), start: i })}
                  data-testid="lore-mention"
                >
                  <span className="mention__ch">{m.chapterTitle}</span>
                  <span className="mention__snip" dangerouslySetInnerHTML={{ __html: m.snippet }} />
                </button>
              </li>
            ))}
          </ol>
        )}
        {mentions && mentions.hits.length < mentions.total && (
          <Button size="sm" variant="ghost" onClick={() => setMore((n) => n + 1)}>
            Show more
          </Button>
        )}
      </section>

      <footer className="lore-note__foot">
        <Button size="sm" icon={Pencil} onClick={() => setEditing(true)}>
          Edit entry
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={entry.hidden ? Eye : EyeOff}
          onClick={() => void mutate((d) => setLoreOverride(d, novelId, entry.key, { hidden: !entry.hidden }), entry.hidden ? 'Shown again' : 'Hidden from Lore').then(onChanged)}
        >
          {entry.hidden ? 'Show in Lore' : 'Hide'}
        </Button>
      </footer>
      {peek && <Peek novelId={novelId} stops={peek.stops} start={peek.start} terms={entry.forms} onClose={() => setPeek(null)} />}
      {editing && <EditEntry novelId={novelId} entry={entry} view={view} onClose={() => setEditing(false)} onSaved={onChanged} />}
    </article>
  );
}

function NoteBox({ novelId, entryKey, initial, onSaved }: { novelId: string; entryKey: string; initial: string; onSaved: () => void }) {
  const [text, setText] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setText(initial), [entryKey, initial]);
  const save = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    setState('saving');
    timer.current = setTimeout(async () => {
      await setLoreOverride(db(), novelId, entryKey, { note: v });
      setState('saved');
      onSaved();
    }, 700);
  };
  return (
    <div className="note-box">
      <textarea
        className="input input--area note-box__area"
        value={text}
        placeholder="Theories, reminders, who they really are… Only you see this."
        aria-label="Your notes"
        onChange={(e) => {
          setText(e.target.value);
          save(e.target.value);
        }}
        rows={3}
        data-testid="lore-note-box"
      />
      <span className="note-box__state" aria-live="polite">
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}
      </span>
    </div>
  );
}

function EditEntry({ novelId, entry, view, onClose, onSaved }: { novelId: string; entry: LoreEntry; view: LoreView; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(entry.name);
  const [kind, setKind] = useState<LoreKind>(entry.kind);
  const [parent, setParent] = useState(entry.parent ?? '');
  const [merge, setMerge] = useState('');
  const [hidden, setHidden] = useState(entry.hidden);
  const others = useMemo(() => view.entries.filter((e) => e.key !== entry.key).sort((a, b) => a.name.localeCompare(b.name)), [view, entry.key]);
  const mergeTarget = others.find((e) => e.name.toLowerCase() === merge.trim().toLowerCase());
  const save = async () => {
    await mutate(
      (d) =>
        setLoreOverride(d, novelId, entry.key, {
          name: name.trim() && name.trim() !== entry.forms[0] ? name.trim() : null,
          kind,
          parent: parent || null,
          hidden,
          mergedInto: mergeTarget ? mergeTarget.key : null,
        }),
      mergeTarget ? `Merged into ${mergeTarget.name}` : 'Entry updated',
    );
    onSaved();
    onClose();
    if (mergeTarget) navigate(routes.lore(novelId, mergeTarget.key), { replace: true });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit entry"
      description="Your corrections are kept even when the novel's Lore is rebuilt."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!!merge.trim() && !mergeTarget}>
            Save
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField label="Type" value={kind} onChange={setKind} options={LORE_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
        <SelectField label="Part of" value={parent} onChange={setParent} options={[{ value: '', label: 'Nothing' }, ...others.filter((e) => e.kind === 'place' || e.kind === 'organisation').map((e) => ({ value: e.key, label: e.name }))]} hint="For example, a city that's part of a country." />
        <label className="field">
          <span className="field__label">Merge into another entry</span>
          <input className="input" list="lore-merge-list" value={merge} onChange={(e) => setMerge(e.target.value)} placeholder="Type a name, e.g. a character’s other name" />
          <datalist id="lore-merge-list">
            {others.slice(0, 2000).map((e) => (
              <option key={e.key} value={e.name} />
            ))}
          </datalist>
          <span className="field__hint">{merge.trim() && !mergeTarget ? 'No entry with that name yet.' : 'Use this when two names are the same person, place or thing.'}</span>
        </label>
        <Switch label="Hide from Lore" checked={hidden} onChange={setHidden} />
      </div>
    </Dialog>
  );
}
