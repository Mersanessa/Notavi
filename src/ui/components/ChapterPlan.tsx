import { useMemo, useState } from 'react';
import { CircleCheck, Combine, TriangleAlert } from 'lucide-react';
import { auditPlan, KIND_LABEL, mergeWithPrevious, renumber, type PlanItem, type PlanOptions, type Volume } from '../../import/layout';
import { formatNumber } from '../../lib/text';
import { Button, IconButton } from './Button';
import { Dialog } from './Dialog';
import { Switch } from './Fields';

/** One-line summary of an arrangement plus the word-for-word check. */
export function PlanSummary({ items, volumes }: { items: PlanItem[]; volumes: Volume[] }) {
  const audit = useMemo(() => auditPlan(volumes, items), [volumes, items]);
  const kept = items.filter((i) => i.include);
  const chapters = kept.filter((i) => i.kind === 'chapter').length;
  const extras = kept.length - chapters;
  return (
    <div className="plan-summary">
      <p>
        <strong>{formatNumber(chapters)}</strong> {chapters === 1 ? 'chapter' : 'chapters'}
        {extras > 0 && (
          <>
            {' '}
            and <strong>{extras}</strong> {extras === 1 ? 'extra' : 'extras'} (prologue, side stories, author’s notes)
          </>
        )}
        .
      </p>
      {audit.setAside.length > 0 && (
        <p className="muted">
          Set aside: {audit.setAside.map((s) => s.title).join(', ')} ({formatNumber(audit.setAsideWords)} words). Open “Review chapters” to keep any of them.
        </p>
      )}
      {audit.ok ? (
        <p className="plan-summary__ok" data-testid="audit-ok">
          <CircleCheck size={15} aria-hidden /> All {formatNumber(audit.sourceWords)} words accounted for. Chapter text is unchanged.
        </p>
      ) : (
        <p className="plan-summary__bad" role="alert">
          <TriangleAlert size={15} aria-hidden /> The arrangement didn’t pass the word check, so it won’t be used. The file will be imported exactly as it is laid out.
        </p>
      )}
    </div>
  );
}

/** Full list: keep or set aside, rename, join onto the previous item. Changes apply only on “Use this arrangement”. */
export function PlanReviewDialog({
  items: initial,
  volumes,
  opts: initialOpts,
  onApply,
  onClose,
}: {
  items: PlanItem[];
  volumes: Volume[];
  opts: PlanOptions;
  onApply: (items: PlanItem[], opts: PlanOptions) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState(initial);
  const [opts, setOpts] = useState(initialOpts);
  const [filter, setFilter] = useState('');
  const audit = useMemo(() => auditPlan(volumes, items), [volumes, items]);
  const update = (id: string, patch: Partial<PlanItem>) => setItems((list) => renumber(list.map((x) => (x.id === id ? { ...x, ...patch } : x)), opts));
  const shown = filter ? items.filter((i) => (i.title + ' ' + i.originalTitle).toLowerCase().includes(filter.toLowerCase())) : items;

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title="Review chapters"
      description="Untick anything you don’t want, rename chapters, or join a piece onto the one before it. Chapter text itself is never edited."
      footer={
        <>
          <Button variant="ghost" onClick={() => setItems(renumber(initial.map((i) => ({ ...i })), opts))}>
            Undo my changes
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!audit.ok} onClick={() => onApply(items, opts)} data-testid="plan-apply">
            Use this arrangement
          </Button>
        </>
      }
    >
      <div className="plan-tools">
        <Switch
          label="Web-novel titles"
          hint="“Chapter 12: The Fool”, numbered straight through every volume."
          checked={opts.webTitles}
          onChange={(v) => {
            const o = { ...opts, webTitles: v };
            setOpts(o);
            setItems((list) => renumber(list, o));
          }}
        />
        <label className="filter-input plan-tools__filter">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a chapter" aria-label="Find a chapter" />
        </label>
      </div>
      <p className={audit.ok ? 'plan-summary__ok' : 'plan-summary__bad'}>
        {audit.ok ? <CircleCheck size={15} aria-hidden /> : <TriangleAlert size={15} aria-hidden />}
        {audit.ok
          ? ` ${formatNumber(audit.keptWords)} words kept, ${formatNumber(audit.setAsideWords)} set aside. Nothing lost.`
          : ' Word check failed. This arrangement can’t be used.'}
      </p>
      <ol className="plan-list">
        {shown.map((it) => {
          const idx = items.indexOf(it);
          return (
            <li key={it.id} className={`plan-row ${it.include ? '' : 'is-out'}`} data-testid="plan-row">
              <input type="checkbox" checked={it.include} onChange={(e) => update(it.id, { include: e.target.checked })} aria-label={`Keep ${it.title}`} />
              <div className="plan-row__main">
                <input
                  className="plan-row__title"
                  value={it.customTitle ?? it.title}
                  onChange={(e) => update(it.id, { customTitle: e.target.value })}
                  aria-label={`Title for ${it.originalTitle}`}
                />
                <span className="plan-row__meta">
                  <span className={`plan-kind plan-kind--${it.kind}`}>{KIND_LABEL[it.kind]}</span>
                  <span>{formatNumber(it.words)} words</span>
                  {it.title !== it.originalTitle && <span>was “{it.originalTitle}”</span>}
                  {volumes.length > 1 && <span>{it.origin}</span>}
                  {it.notes.map((n) => (
                    <span key={n} className="plan-row__note">
                      {n}
                    </span>
                  ))}
                </span>
              </div>
              <IconButton icon={Combine} size="sm" label={`Join ${it.originalTitle} onto the previous item`} disabled={idx <= 0} onClick={() => setItems((list) => mergeWithPrevious(list, it.id, opts))} />
            </li>
          );
        })}
      </ol>
    </Dialog>
  );
}
