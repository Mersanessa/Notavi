/**
 * Read aloud with the device's own voices (Web Speech API: works offline on
 * iPhone, Android and Windows). Speaks one sentence at a time, which is what
 * keeps long chapters reliable on every engine, and highlights the sentence
 * being read with the CSS Custom Highlight API (the chapter's DOM is untouched).
 */

export interface Sentence {
  block: number;
  start: number; // text offset within the chapter
  end: number;
  text: string;
}

/** Split text into sentences with their offsets. Uses Intl.Segmenter where available. */
export function splitSentences(text: string, lang = 'en'): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: 'sentence' }) => { segment(t: string): Iterable<{ segment: string; index: number }> } }).Segmenter;
  if (Seg) {
    for (const s of new Seg(lang, { granularity: 'sentence' }).segment(text)) {
      const trimmedStart = s.segment.length - s.segment.trimStart().length;
      const t = s.segment.trim();
      if (t) out.push({ start: s.index + trimmedStart, end: s.index + trimmedStart + t.length, text: t });
    }
    return out;
  }
  const re = /[^.!?…。！？]+[.!?…。！？]*["'”’)\]]*\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const lead = m[0].length - m[0].trimStart().length;
    const t = m[0].trim();
    if (t) out.push({ start: m.index + lead, end: m.index + lead + t.length, text: t });
  }
  return out;
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function listVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 700);
  });
}

/** The chosen voice, else one for the book's language, preferring British English and on-device voices. */
export function pickVoice(voices: SpeechSynthesisVoice[], uri: string | null, lang: string): SpeechSynthesisVoice | null {
  const chosen = uri ? voices.find((v) => v.voiceURI === uri) : undefined;
  if (chosen) return chosen;
  const norm = (l: string) => l.replace('_', '-').toLowerCase();
  const want = norm(lang === 'en' ? 'en-GB' : lang);
  const base = want.slice(0, 2);
  const score = (v: SpeechSynthesisVoice) => (norm(v.lang) === want ? 0 : norm(v.lang).startsWith(base) ? 1 : 9) + (v.localService ? 0 : 0.5);
  const ranked = voices.filter((v) => score(v) < 9).sort((a, b) => score(a) - score(b));
  return ranked[0] ?? null;
}

export interface SpeakerOptions {
  rate: number;
  voiceURI: string | null;
  lang: string;
  onSentence: (i: number) => void;
  onEnd: () => void;
  onError: (message: string) => void;
}

/** Speaks a list of sentences in order. Pause = stop and remember; resume restarts the current sentence. */
export class Speaker {
  index = 0;
  playing = false;
  private gen = 0;
  constructor(
    private sentences: Sentence[],
    private opts: SpeakerOptions,
  ) {}

  setOptions(o: Partial<SpeakerOptions>) {
    this.opts = { ...this.opts, ...o };
    if (this.playing) this.play(this.index); // apply rate/voice immediately
  }

  async play(from = this.index) {
    if (!speechSupported()) return this.opts.onError('Read aloud isn’t available on this device.');
    this.gen++;
    const gen = this.gen;
    speechSynthesis.cancel();
    this.index = Math.max(0, Math.min(from, this.sentences.length - 1));
    this.playing = true;
    const voices = await listVoices();
    const voice = pickVoice(voices, this.opts.voiceURI, this.opts.lang);
    const speakNext = () => {
      if (gen !== this.gen || !this.playing) return;
      if (this.index >= this.sentences.length) {
        this.playing = false;
        this.opts.onEnd();
        return;
      }
      const s = this.sentences[this.index];
      this.opts.onSentence(this.index);
      const u = new SpeechSynthesisUtterance(s.text);
      u.rate = this.opts.rate;
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? this.opts.lang;
      u.onend = () => {
        if (gen !== this.gen) return;
        this.index++;
        speakNext();
      };
      u.onerror = (e) => {
        if (gen !== this.gen || e.error === 'interrupted' || e.error === 'canceled') return;
        this.playing = false;
        this.opts.onError('The device’s voice stopped unexpectedly.');
      };
      speechSynthesis.speak(u);
    };
    speakNext();
  }

  pause() {
    this.playing = false;
    this.gen++;
    speechSynthesis.cancel();
  }

  skip(delta: number) {
    const next = Math.max(0, Math.min(this.sentences.length - 1, this.index + delta));
    if (this.playing) void this.play(next);
    else {
      this.index = next;
      this.opts.onSentence(next);
    }
  }

  stop() {
    this.pause();
  }
}
