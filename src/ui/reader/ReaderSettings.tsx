import { useEffect, useState } from 'react';
import { BookOpenText, RotateCcw, ScrollText, X } from 'lucide-react';
import { useStore } from '../../app/store';
import { MEASURE_MIN_WORDS, DEFAULT_BOOK, DEFAULT_READER, READER_FONTS, READER_THEMES, TYPOGRAPHY_KEYS, type ReaderPrefs } from '../../app/prefs';
import type { ReadingMode } from '../../data/model';
import { formatNumber } from '../../lib/text';
import { IconButton, Button } from '../components/Button';
import { Segmented, SelectField, Stepper, Switch } from '../components/Fields';
import { listVoices, speechSupported, type VoiceInfo } from './speech';

/** British voices first (then other English), the rest alphabetically. */
function rankVoice(v: VoiceInfo) {
  return v.lang === 'en-GB' ? 0 : v.lang.startsWith('en') ? 1 : 2;
}

/**
 * Typography and behaviour settings. Non-modal: the chapter stays visible
 * behind it so every change can be judged as it happens.
 */
export function ReaderSettings({ onClose, mode, onFormat }: { onClose: () => void; mode: ReadingMode; onFormat: (m: ReadingMode) => void }) {
  const prefs = useStore((s) => s.reader);
  const set = useStore((s) => s.setReader);
  const book = mode === 'book';
  const bookT = { ...DEFAULT_BOOK, ...prefs.book };
  // Each format keeps its own typography; everything else is shared.
  const r = book ? { ...prefs, ...bookT } : prefs;
  const upd = (p: Partial<ReaderPrefs> & { spreads?: boolean }) => {
    if (!book) return void set(p);
    const typo: Record<string, unknown> = {};
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) ((TYPOGRAPHY_KEYS as readonly string[]).includes(k) || k === 'spreads' ? typo : rest)[k] = v;
    void set({ ...(rest as Partial<ReaderPrefs>), ...(Object.keys(typo).length ? { book: { ...bookT, ...typo } } : {}) });
  };
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  useEffect(() => {
    void listVoices().then((v) => setVoices([...v].sort((a, b) => rankVoice(a) - rankVoice(b) || a.name.localeCompare(b.name))));
  }, []);

  return (
    <aside className="reader-panel reader-panel--settings" aria-label="Reading settings" data-notap>
      <header className="reader-panel__head">
        <h2>Reading settings</h2>
        <IconButton icon={X} label="Close settings" onClick={onClose} size="sm" />
      </header>
      <div className="reader-panel__body">
        <section className="rs-section">
          <h3 className="rs-title">Read as</h3>
          <div className="format-cards" role="radiogroup" aria-label="Read as">
            <button type="button" role="radio" aria-checked={!book} className={`format-card ${!book ? 'is-on' : ''}`} onClick={() => !book || onFormat('web')} data-testid="format-web">
              <ScrollText size={20} aria-hidden />
              <span className="format-card__name">Web novel</span>
              <span className="format-card__hint">Scroll through chapters</span>
            </button>
            <button type="button" role="radio" aria-checked={book} className={`format-card ${book ? 'is-on' : ''}`} onClick={() => book || onFormat('book')} data-testid="format-book">
              <BookOpenText size={20} aria-hidden />
              <span className="format-card__name">Book</span>
              <span className="format-card__hint">Turn pages, as printed</span>
            </button>
          </div>
          <p className="rs-note">{book ? 'Shows the book’s own chapter titles, its cover, and its front and back matter. Book format keeps its own text settings, so your web-novel look stays as it is.' : 'Switch any time; your place, highlights and notes stay the same in both.'}</p>
        </section>

        <section className="rs-section">
          <h3 className="rs-title">Theme</h3>
          <div className="theme-swatches" role="radiogroup" aria-label="Theme">
            {READER_THEMES.map((t) => (
              <button key={t.value} type="button" role="radio" aria-checked={r.theme === t.value} className={`theme-swatch theme-swatch--${t.value} ${r.theme === t.value ? 'is-on' : ''}`} onClick={() => upd({ theme: t.value })}>
                <span className="theme-swatch__sample">Aa</span>
                <span className="theme-swatch__label">{t.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rs-section">
          <h3 className="rs-title">Font</h3>
          <div className="font-list" role="radiogroup" aria-label="Font">
            {READER_FONTS.map((f) => (
              <button key={f.value} type="button" role="radio" aria-checked={r.font === f.value} className={`font-option ${r.font === f.value ? 'is-on' : ''}`} style={{ fontFamily: f.stack }} onClick={() => upd({ font: f.value })}>
                {f.label}
              </button>
            ))}
          </div>
        </section>

        <section className="rs-section">
          <h3 className="rs-title">Text</h3>
          <Stepper label="Size" value={r.fontSize} min={12} max={40} step={1} format={(v) => `${v}px`} onChange={(v) => upd({ fontSize: v })} />
          <Stepper label="Weight" value={r.fontWeight} min={300} max={600} step={50} format={(v) => (v <= 350 ? 'Light' : v <= 400 ? 'Regular' : v <= 500 ? 'Medium' : 'Semibold')} onChange={(v) => upd({ fontWeight: v })} />
          <Stepper label="Line spacing" value={r.lineHeight} min={1.2} max={2.6} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => upd({ lineHeight: Number(v.toFixed(2)) })} />
          <Stepper label="Paragraph spacing" value={r.paragraphSpacing} min={0} max={2.5} step={0.1} format={(v) => `${v.toFixed(1)} em`} onChange={(v) => upd({ paragraphSpacing: Number(v.toFixed(1)) })} />
        </section>

        <section className="rs-section">
          <h3 className="rs-title">Layout</h3>
          <Stepper label="Line length" value={r.measure} min={30} max={110} step={2} format={(v) => `${v} ch`} onChange={(v) => upd({ measure: v })} />
          <Stepper label="Margins" value={r.margin} min={0} max={96} step={4} format={(v) => `${v}px`} onChange={(v) => upd({ margin: v })} />
          <div className="rs-row">
            <span className="rs-row__label">Alignment</span>
            <Segmented
              label="Alignment"
              value={r.align}
              onChange={(v) => upd({ align: v })}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'justify', label: 'Justified' },
              ]}
            />
          </div>
          <Switch label="Indent paragraphs" checked={r.indent} onChange={(v) => upd({ indent: v })} />
          <Switch label="Hyphenation" hint="Breaks long words at line ends. Works best with justified text." checked={r.hyphenate} onChange={(v) => upd({ hyphenate: v })} />
        </section>

        <section className="rs-section">
          <h3 className="rs-title">Comfort</h3>
          <Stepper label="Dim the page" value={r.dim} min={0} max={0.7} step={0.05} format={(v) => (v ? `${Math.round(v * 100)}%` : 'Off')} onChange={(v) => upd({ dim: Number(v.toFixed(2)) })} />
          <Stepper label="Warmth" value={r.warmth} min={0} max={1} step={0.1} format={(v) => (v ? `${Math.round(v * 100)}%` : 'Off')} onChange={(v) => upd({ warmth: Number(v.toFixed(1)) })} />
          <Switch label="Warm the page at night" hint="Between 9 pm and 6 am the page takes on a gentle amber tint, even if Warmth is off." checked={r.warmAtNight} onChange={(v) => upd({ warmAtNight: v })} />
        </section>

        {speechSupported() && (
          <section className="rs-section">
            <h3 className="rs-title">Read aloud</h3>
            <SelectField
              label="Voice"
              value={r.ttsVoice ?? ''}
              onChange={(v) => upd({ ttsVoice: v || null })}
              options={[{ value: '', label: 'Automatic (matches the book’s language)' }, ...voices.map((v) => ({ value: v.id, label: `${v.name} · ${v.lang}${v.local ? '' : ' · online'}` }))]}
              hint="Voices come from your device’s own text-to-speech settings and work offline unless marked ‘online’."
            />
            <Stepper label="Speaking speed" value={r.ttsRate} min={0.5} max={2.5} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => upd({ ttsRate: Number(v.toFixed(1)) })} />
          </section>
        )}

        <section className="rs-section">
          <h3 className="rs-title">Behaviour</h3>
          {book ? (
            <Switch label="Two pages side by side" hint="In landscape on a tablet or computer, like an open book." checked={bookT.spreads} onChange={(v) => upd({ spreads: v })} />
          ) : (
            <>
              <Switch label="Tap edges to turn pages" hint="Tap the left or right quarter of the screen to move a screen up or down." checked={r.tapToTurn} onChange={(v) => upd({ tapToTurn: v })} />
              <Switch label="Swipe sideways to change chapter" checked={r.swipeChapters} onChange={(v) => upd({ swipeChapters: v })} />
              <Switch label="Smooth page scrolling" checked={r.smoothScroll} onChange={(v) => upd({ smoothScroll: v })} />
            </>
          )}
          <Switch label="Tap names for a spoiler-free recap" hint="Characters, places and things you’ve met: what the book has said so far and where they came up before." checked={prefs.loreTaps} onChange={(v) => upd({ loreTaps: v })} />
          <Switch label="Keep the screen on" checked={r.keepAwake} onChange={(v) => upd({ keepAwake: v })} />
          <Switch label="Show progress line" checked={r.showStatus} onChange={(v) => upd({ showStatus: v })} />
          <Switch
            label="Learn my reading speed"
            hint={
              prefs.measuredWpm && prefs.measuredWords >= MEASURE_MIN_WORDS
                ? `You read about ${Math.round(prefs.measuredWpm)} words a minute (from ${formatNumber(prefs.measuredWords)} words). Time estimates use this.`
                : `Time estimates switch to your real speed after about ${formatNumber(MEASURE_MIN_WORDS)} words of reading${prefs.measuredWords ? ` (${formatNumber(prefs.measuredWords)} so far)` : ''}.`
            }
            checked={prefs.autoSpeed}
            onChange={(v) => upd({ autoSpeed: v })}
          />
          {(!prefs.autoSpeed || !prefs.measuredWpm || prefs.measuredWords < MEASURE_MIN_WORDS) && (
            <Stepper label={prefs.autoSpeed ? 'Reading speed until then' : 'Reading speed'} value={r.wpm} min={100} max={600} step={10} format={(v) => `${v} wpm`} onChange={(v) => upd({ wpm: v })} />
          )}
        </section>

        <Button variant="ghost" icon={RotateCcw} onClick={() => (book ? void set({ book: DEFAULT_BOOK }) : upd({ ...DEFAULT_READER, theme: r.theme, ttsVoice: r.ttsVoice, ttsRate: r.ttsRate, autoScrollSpeed: r.autoScrollSpeed, dim: r.dim, warmth: r.warmth, warmAtNight: r.warmAtNight, book: prefs.book }))}>
          {book ? 'Reset book text and layout' : 'Reset text and layout'}
        </Button>
      </div>
    </aside>
  );
}
