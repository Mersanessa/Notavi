import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Network, ListTree, Search, X, Waypoints, BookOpen, Lock } from 'lucide-react';
import { useStore } from '../../app/store';
import { useDocumentTitle } from '../../app/hooks';
import { href, navigate, routes, useRoute } from '../../app/router';
import type { NovelSummary } from '../../data/model';
import { LORE_KINDS, type LoreKind } from '../../lore/extract';
import { TIER_LABEL, type LoreEntry, type LoreTier, type LoreView } from '../../lore/view';
import { formatNumber } from '../../lib/text';
import { Button, IconButton } from '../components/Button';
import { Cover } from '../components/Cover';
import { EmptyState, Spinner } from '../components/misc';
import { Segmented } from '../components/Fields';
import { LoreGraph } from '../lore/LoreGraph';
import { LoreNote, KindPill } from '../lore/LoreNote';
import { KIND_COLOUR, KIND_ICON } from '../lore/kinds';
import { useLore } from '../lore/useLore';

type ViewMode = 'graph' | 'index';
const VIEW_KEY = 'notavi.loreView';

/** Lore: a spoiler-free encyclopaedia for each novel, built from what you've read so far. */
export default function LorePage({ novelId, entityKey }: { novelId: string | null; entityKey: string | null }) {
  useDocumentTitle('Lore');
  const novels = useStore((s) => s.novels);
  // Without a novel, open the one you're reading.
  useEffect(() => {
    if (novelId) return;
    const current = [...novels].filter((n) => n.lastReadAt && n.chapterCount).sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0];
    if (current && !new URLSearchParams(location.hash.split('?')[1] ?? '').has('pick')) navigate(routes.lore(current.id), { replace: true });
  }, [novelId, novels]);
  if (!novelId) return <NovelPicker novels={novels} />;
  const novel = novels.find((n) => n.id === novelId);
  if (!novel) return <div className="page"><EmptyState icon={Waypoints} title="Novel not found">It may have been deleted.</EmptyState></div>;
  return <LoreBook novel={novel} entityKey={entityKey} />;
}

function NovelPicker({ novels }: { novels: NovelSummary[] }) {
  const list = [...novels].filter((n) => n.chapterCount > 0).sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0));
  return (
    <div className="page page--lore-pick">
      <header className="page-head">
        <h1 className="page-head__title">Lore</h1>
        <p className="page-head__lead">A spoiler-free encyclopaedia for each novel: the people, places and things you’ve met, ranked by how much they matter, built only from the chapters you’ve read.</p>
      </header>
      {!list.length ? (
        <EmptyState icon={Waypoints} title="Nothing to build yet">
          Import a novel and start reading; its Lore fills in as you go.
        </EmptyState>
      ) : (
        <ul className="lore-pick">
          {list.map((n) => (
            <li key={n.id}>
              <a className="lore-pick__item" href={href(routes.lore(n.id))}>
                <Cover coverId={n.coverId} title={n.title} size="sm" />
                <span className="lore-pick__text">
                  <span className="lore-pick__title">{n.title}</span>
                  <span className="lore-pick__sub">{n.progress ? `Up to ${n.progress.chapterTitle}` : n.status === 'completed' ? 'Finished' : 'Not started yet'}</span>
                </span>
                <ChevronRight size={18} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LoreBook({ novel, entityKey }: { novel: NovelSummary; entityKey: string | null }) {
  const { query } = useRoute();
  const lore = useLore(novel.id);
  const [mode, setModeState] = useState<ViewMode>(() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as ViewMode) || 'graph';
    } catch {
      return 'graph';
    }
  });
  const setMode = (m: ViewMode) => {
    setModeState(m);
    try {
      localStorage.setItem(VIEW_KEY, m);
    } catch {
      /* ignore */
    }
  };
  const [q, setQ] = useState('');
  const [kinds, setKinds] = useState<Set<LoreKind>>(new Set(LORE_KINDS.map((k) => k.value)));
  const [detail, setDetail] = useState<'key' | 'more' | 'all'>('more');
  const [focus, setFocus] = useState<{ key: string; n: number } | null>(null);
  const category = (query.get('kind') as LoreKind | null) ?? null;
  const view = lore.view;
  const open = (key: string | null) => navigate(routes.lore(novel.id, key ?? undefined, mode === 'index' && category ? `kind=${category}` : undefined), { replace: mode === 'graph' });

  const entry = entityKey && view ? view.byKey.get(view.resolve(entityKey)) ?? null : null;
  const point = lore.point;
  const upto = point?.finished ? 'You’ve finished this novel: everything is shown.' : point && point.pos > 0 ? `Spoiler-free up to ${point.chapterTitle ?? 'where you are'}` : 'Start reading and entries appear here as you meet them.';

  const graphEntries = useMemo(() => {
    if (!view) return [];
    const tiers: LoreTier[] = detail === 'key' ? ['major', 'recurring'] : detail === 'more' ? ['major', 'recurring', 'minor'] : ['major', 'recurring', 'minor', 'passing'];
    return view.entries.filter((e) => kinds.has(e.kind) && tiers.includes(e.tier)).slice(0, detail === 'all' ? 1500 : 600);
  }, [view, kinds, detail]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !view) return [];
    return view.entries.filter((e) => e.forms.some((f) => f.toLowerCase().includes(s)) || e.name.toLowerCase().includes(s)).slice(0, 8);
  }, [q, view]);

  const head = (
    <header className="lore-head">
      <div className="lore-head__row">
        <a className="lore-head__back" href={href(routes.lore(undefined, undefined, 'pick=1'))} aria-label="All novels">
          <ArrowLeft size={18} aria-hidden />
        </a>
        <div className="lore-head__titles">
          <h1 className="lore-head__title">
            <span className="lore-head__kicker">Lore</span> {novel.title}
          </h1>
          <p className="lore-head__upto">
            <Lock size={12} aria-hidden /> {upto}
            {view && view.entries.length > 0 && <> · {formatNumber(view.entries.length)} entries</>}
          </p>
        </div>
        <Segmented
          label="View"
          value={mode}
          onChange={setMode}
          className="lore-head__mode"
          options={[
            { value: 'graph', label: (<><Network size={15} aria-hidden /> <span className="seg-label">Graph</span></>), title: 'Graph' },
            { value: 'index', label: (<><ListTree size={15} aria-hidden /> <span className="seg-label">Index</span></>), title: 'Index' },
          ]}
        />
      </div>
      <div className="lore-head__row lore-head__row--tools">
        <label className="filter-input lore-search">
          <Search size={16} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find someone or something" aria-label="Find in Lore" data-testid="lore-search" />
          {q && <IconButton icon={X} size="sm" label="Clear" onClick={() => setQ('')} />}
        </label>
        {mode === 'graph' && (
          <>
            <div className="kind-toggles" role="group" aria-label="Show">
              {LORE_KINDS.map((k) => {
                const Icon = KIND_ICON[k.value];
                const on = kinds.has(k.value);
                return (
                  <button
                    key={k.value}
                    type="button"
                    className={`kind-toggle ${on ? 'is-on' : ''}`}
                    style={{ '--kc': KIND_COLOUR[k.value] } as React.CSSProperties}
                    aria-pressed={on}
                    onClick={() => {
                      const n = new Set(kinds);
                      if (on && n.size > 1) n.delete(k.value);
                      else n.add(k.value);
                      setKinds(n);
                    }}
                  >
                    <Icon size={14} aria-hidden /> {k.plural.split(' ')[0]}
                  </button>
                );
              })}
            </div>
            <Segmented
              label="Detail"
              value={detail}
              onChange={setDetail}
              options={[
                { value: 'key', label: 'Key' },
                { value: 'more', label: 'More' },
                { value: 'all', label: 'All' },
              ]}
            />
          </>
        )}
      </div>
      {matches.length > 0 && (
            <ul className="lore-search__results">
              {matches.map((m) => (
                <li key={m.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setQ('');
                      open(m.key);
                      setFocus({ key: m.key, n: Date.now() });
                    }}
                  >
                    <span className="dot" style={{ background: KIND_COLOUR[m.kind] }} /> {m.name}
                    <span className="muted"> · {TIER_LABEL[m.tier]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
    </header>
  );

  let body: React.ReactNode;
  if (lore.status === 'error') body = <EmptyState icon={Waypoints} title="Couldn’t build Lore">Something went wrong reading this novel. Try again later.</EmptyState>;
  else if (!view || lore.status === 'building' || lore.status === 'loading')
    body = (
      <div className="lore-building">
        <Spinner />
        <p>{lore.progress ? `Reading the novel to build its Lore… ${formatNumber(lore.progress.done)} of ${formatNumber(lore.progress.total)} chapters` : 'Opening Lore…'}</p>
        <p className="muted">This happens once; after that it updates as you read.</p>
      </div>
    );
  else if (!view.entries.length)
    body = (
      <EmptyState icon={BookOpen} title="Nothing here yet" action={<Button variant="primary" onClick={() => navigate(routes.read(novel.id))}>Start reading</Button>}>
        Lore only shows what you’ve already read. Read a chapter or two and the people and places you meet will appear.
      </EmptyState>
    );
  else if (mode === 'graph')
    body = (
      <div className={`lore-stage ${entry ? 'has-note' : ''}`}>
        <LoreGraph cacheKey={`${novel.id}|${detail}|${[...kinds].join()}`} entries={graphEntries} selected={entry?.key ?? null} onSelect={(k) => { open(k); if (k) setFocus({ key: k, n: Date.now() }); }} focus={focus} />
        <div className="lore-legend" aria-hidden>
          {LORE_KINDS.map((k) => (
            <span key={k.value}>
              <i style={{ background: KIND_COLOUR[k.value] }} /> {k.plural.split(' ')[0]}
            </span>
          ))}
        </div>
        {entry && (
          <aside className="lore-panel" aria-label={entry.name}>
            <IconButton icon={X} label="Close" size="sm" className="lore-panel__close" onClick={() => open(null)} />
            <LoreNote key={entry.key} novelId={novel.id} entry={entry} view={view} beforePos={point!.pos} onOpen={(k) => (open(k), setFocus({ key: k, n: Date.now() }))} onChanged={lore.reload} />
          </aside>
        )}
      </div>
    );
  else if (entry)
    body = (
      <div className="lore-page-note">
        <button type="button" className="back-link" onClick={() => open(null)}>
          <ArrowLeft size={18} aria-hidden /> {category ? LORE_KINDS.find((k) => k.value === category)!.plural : 'Index'}
        </button>
        <LoreNote key={entry.key} novelId={novel.id} entry={entry} view={view} beforePos={point!.pos} onOpen={(k) => open(k)} onChanged={lore.reload} />
      </div>
    );
  else body = <LoreIndexView novelId={novel.id} view={view} category={category} onOpen={open} />;

  return (
    <div className={`page page--lore lore--${mode}`} data-testid="lore">
      {head}
      {body}
    </div>
  );
}

/* ------------------------------------------------------------------ the simple index */

const TIERS: LoreTier[] = ['major', 'recurring', 'minor', 'passing'];

function LoreIndexView({ novelId, view, category, onOpen }: { novelId: string; view: LoreView; category: LoreKind | null; onOpen: (key: string) => void }) {
  const [showPassing, setShowPassing] = useState(false);
  if (!category) {
    return (
      <div className="lore-cats">
        {LORE_KINDS.map((k) => {
          const list = view.entries.filter((e) => e.kind === k.value);
          if (!list.length) return null;
          const Icon = KIND_ICON[k.value];
          return (
            <a key={k.value} className="lore-cat" href={href(routes.lore(novelId, undefined, `kind=${k.value}`))} style={{ '--kc': KIND_COLOUR[k.value] } as React.CSSProperties} data-testid={`lore-cat-${k.value}`}>
              <span className="lore-cat__icon">
                <Icon size={22} aria-hidden />
              </span>
              <span className="lore-cat__name">{k.plural}</span>
              <span className="lore-cat__count">{formatNumber(list.length)}</span>
              <span className="lore-cat__top">{list.slice(0, 4).map((e) => e.name).join(' · ')}</span>
            </a>
          );
        })}
      </div>
    );
  }
  const list = view.entries.filter((e) => e.kind === category);
  // Places and organisations nest under what they're part of.
  const nested = category === 'place' || category === 'organisation';
  const roots = nested ? list.filter((e) => !e.parent || !list.some((p) => p.key === e.parent)) : list;
  const kind = LORE_KINDS.find((k) => k.value === category)!;
  return (
    <div className="lore-index">
      <a className="back-link" href={href(routes.lore(novelId))}>
        <ArrowLeft size={18} aria-hidden /> All of Lore
      </a>
      <h2 className="lore-index__title">
        <KindPill kind={category} /> {kind.plural}
      </h2>
      {TIERS.map((tier) => {
        const items = roots.filter((e) => e.tier === tier);
        if (!items.length) return null;
        if (tier === 'passing' && !showPassing)
          return (
            <button key={tier} type="button" className="lore-more" onClick={() => setShowPassing(true)}>
              + {formatNumber(items.length)} passing {items.length === 1 ? 'mention' : 'mentions'}
            </button>
          );
        return (
          <section key={tier} className="lore-tier">
            <h3 className="lore-tier__title">{TIER_LABEL[tier]}</h3>
            <ul className="lore-list">
              {items.map((e) => (
                <IndexItem key={e.key} e={e} all={list} onOpen={onOpen} nested={nested} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function IndexItem({ e, all, onOpen, nested, depth = 0 }: { e: LoreEntry; all: LoreEntry[]; onOpen: (key: string) => void; nested: boolean; depth?: number }) {
  const kids = nested && depth < 4 ? all.filter((c) => c.parent === e.key) : [];
  return (
    <li>
      <button type="button" className="lore-item" onClick={() => onOpen(e.key)} data-testid="lore-item">
        <span className="lore-item__name">{e.name}</span>
        {e.desc[0] && <span className="lore-item__desc">{e.desc[0].text.replace(/[.,;:]$/, '')}</span>}
        <span className="lore-item__n">{formatNumber(e.mentions)}</span>
      </button>
      {kids.length > 0 && (
        <ul className="lore-list lore-list--sub">
          {kids.map((k) => (
            <IndexItem key={k.key} e={k} all={all} onOpen={onOpen} nested={nested} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
