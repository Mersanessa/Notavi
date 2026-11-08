import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { mutate } from '../../app/store';
import type { NovelSummary } from '../../data/model';
import { appendChapters } from '../../data/novels';
import { parseTxt } from '../../import/txt';
import { auditPlan, chaptersFromPlan, nextChapterNumber, planLayout, renumber, type PlanItem, type PlanOptions, type Volume } from '../../import/layout';
import { countWords, formatNumber } from '../../lib/text';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { Switch } from '../components/Fields';
import { PlanReviewDialog, PlanSummary } from '../components/ChapterPlan';

/**
 * Paste any number of chapters at once. They're split at their headings
 * ("Chapter 215: …", "Prologue", "第215章") and added after the existing chapters.
 */
export function PasteChaptersDialog({ novel, existingTitles, onClose, onDone }: { novel: NovelSummary; existingTitles: string[]; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [step, setStep] = useState<'paste' | 'check'>('paste');
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [opts, setOpts] = useState<PlanOptions>({ webTitles: false, startNumber: nextChapterNumber(existingTitles) });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = () => {
    setError(null);
    try {
      const parsed = parseTxt(new TextEncoder().encode(text), 'Pasted text.txt');
      const vols = [{ label: 'Pasted text', sections: parsed.chapters }];
      setVolumes(vols);
      setPlan(planLayout(vols, opts));
      setWarnings(parsed.warnings.filter((w) => !/UTF-8|WINDOWS/i.test(w)));
      setStep('check');
    } catch (e) {
      setError((e as Error).message.replace('“Pasted text.txt”', 'The pasted text'));
    }
  };

  const add = async () => {
    setBusy(true);
    const chapters = auditPlan(volumes, plan).ok ? chaptersFromPlan(plan) : volumes[0].sections.map((s) => ({ title: s.title, content: s.content }));
    const n = await mutate((d) => appendChapters(d, novel.id, chapters), undefined);
    setBusy(false);
    if (n !== undefined) {
      onDone();
      onClose();
    }
  };

  const count = plan.filter((p) => p.include).length;

  return (
    <>
      <Dialog
        open={!reviewing}
        onClose={onClose}
        size="lg"
        title={step === 'paste' ? 'Paste chapters' : 'Check the chapters'}
        description={
          step === 'paste'
            ? `Paste one or many chapters. Notavi splits them at their headings (“Chapter 215: …”, “Prologue”, “第215章”) and adds them after the ${formatNumber(novel.chapterCount)} chapters already in “${novel.title}”. The text itself isn’t changed.`
            : undefined
        }
        footer={
          step === 'paste' ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!text.trim()} onClick={check} data-testid="paste-next">
                Next
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep('paste')}>
                Back
              </Button>
              <Button variant="primary" busy={busy} disabled={!count} onClick={add} data-testid="paste-add">
                Add {formatNumber(count)} {count === 1 ? 'chapter' : 'chapters'}
              </Button>
            </>
          )
        }
      >
        {step === 'paste' ? (
          <>
            <textarea
              className="input input--area paste-area"
              aria-label="Chapters to add"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Chapter 215: The Bell Tower\n\nThe first paragraph…\n\nChapter 216: …'}
              data-autofocus
              data-testid="paste-text"
            />
            <p className="field__hint">{text.trim() ? `${formatNumber(countWords(text))} words` : 'Leave a blank line between paragraphs. Each chapter heading should be on its own line.'}</p>
            {error && (
              <p className="field__error" role="alert">
                {error}
              </p>
            )}
          </>
        ) : (
          <>
            <PlanSummary items={plan} volumes={volumes} />
            {warnings.map((w) => (
              <p key={w} className="field__hint">
                {w}
              </p>
            ))}
            <Switch
              label="Renumber as a continuation"
              hint={`Title them “Chapter ${opts.startNumber}: …”, “Chapter ${opts.startNumber + 1}: …” instead of keeping the headings as pasted.`}
              checked={opts.webTitles}
              onChange={(v) => {
                const o = { ...opts, webTitles: v };
                setOpts(o);
                setPlan((p) => renumber(p, o));
              }}
            />
            <ol className="plan-list plan-list--compact">
              {plan.slice(0, 8).map((p) => (
                <li key={p.id} className={`plan-row ${p.include ? '' : 'is-out'}`}>
                  <span className="plan-row__main">
                    <strong>{p.title}</strong>
                    <span className="plan-row__meta">{formatNumber(p.words)} words</span>
                  </span>
                </li>
              ))}
              {plan.length > 8 && <li className="plan-row muted">and {plan.length - 8} more…</li>}
            </ol>
            <Button size="sm" icon={ListChecks} onClick={() => setReviewing(true)}>
              Review chapters
            </Button>
          </>
        )}
      </Dialog>
      {reviewing && (
        <PlanReviewDialog
          items={plan}
          volumes={volumes}
          opts={opts}
          onClose={() => setReviewing(false)}
          onApply={(p, o) => {
            setPlan(p);
            setOpts(o);
            setReviewing(false);
          }}
        />
      )}
    </>
  );
}
