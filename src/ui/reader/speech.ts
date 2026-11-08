/**
 * Read aloud with the device's own voices, which work offline.
 *
 * Two engines behind one interface:
 * - the Web Speech API (iPhone, Windows, and Notavi in a browser on Android);
 * - Android's TextToSpeech through a Tauri plugin, because the Android System
 *   WebView that the installed app runs in has no speech synthesis at all.
 *
 * Text is spoken one sentence at a time, which keeps long chapters reliable on
 * every engine and lets the reader highlight the sentence being read.
 */
import { platformName } from '../../platform';

export interface Sentence {
  block: number;
  start: number; // text offset within the chapter
  end: number;
  text: string;
}

export interface VoiceInfo {
  id: string;
  name: string;
  lang: string;
  /** On-device (works offline) rather than a network voice. */
  local: boolean;
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

/** The chosen voice, else one for the book's language, preferring British English and on-device voices. */
export function pickVoice(voices: VoiceInfo[], id: string | null, lang: string): VoiceInfo | null {
  const chosen = id ? voices.find((v) => v.id === id) : undefined;
  if (chosen) return chosen;
  const norm = (l: string) => l.replace('_', '-').toLowerCase();
  const want = norm(lang === 'en' ? 'en-GB' : lang);
  const base = want.slice(0, 2);
  const score = (v: VoiceInfo) => (norm(v.lang) === want ? 0 : norm(v.lang).startsWith(base) ? 1 : 9) + (v.local ? 0 : 0.5);
  const ranked = voices.filter((v) => score(v) < 9).sort((a, b) => score(a) - score(b));
  return ranked[0] ?? null;
}

/* ------------------------------------------------------------------ engines */

type Outcome = 'done' | 'cancelled';
interface SayOptions {
  rate: number;
  voice: VoiceInfo | null;
  lang: string;
}
interface Engine {
  voices(): Promise<VoiceInfo[]>;
  /** Resolves when the text has been spoken (or was cancelled); rejects if the engine fails. */
  say(text: string, o: SayOptions): Promise<Outcome>;
  cancel(): void;
}

class WebEngine implements Engine {
  private byId = new Map<string, SpeechSynthesisVoice>();
  private pending: ((o: Outcome) => void) | null = null;

  async voices(): Promise<VoiceInfo[]> {
    let list = speechSynthesis.getVoices();
    if (!list.length) {
      list = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
        const done = () => resolve(speechSynthesis.getVoices());
        speechSynthesis.addEventListener?.('voiceschanged', done, { once: true });
        setTimeout(done, 700);
      });
    }
    this.byId = new Map(list.map((v) => [v.voiceURI, v]));
    return list.map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang, local: v.localService }));
  }

  say(text: string, o: SayOptions): Promise<Outcome> {
    return new Promise((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = o.rate;
      const v = o.voice ? this.byId.get(o.voice.id) : undefined;
      if (v) u.voice = v;
      u.lang = v?.lang ?? o.lang;
      this.pending = resolve;
      u.onend = () => resolve('done');
      u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? resolve('cancelled') : reject(new Error(e.error)));
      speechSynthesis.speak(u);
    });
  }

  cancel() {
    this.pending?.('cancelled');
    this.pending = null;
    speechSynthesis.cancel();
  }
}

type Tts = typeof import('tauri-plugin-tts-api');

class AndroidEngine implements Engine {
  private api: Promise<Tts> | null = null;
  private pending: { id: string | null; resolve: (o: Outcome) => void; reject: (e: Error) => void } | null = null;
  /** Events that arrived before speak() told us the utterance id. */
  private early = new Map<string, Outcome | Error>();

  private load(): Promise<Tts> {
    this.api ??= import('tauri-plugin-tts-api').then(async (api) => {
      const on = (outcome: Outcome | 'error') => (e: { id?: string; error?: string }) => {
        const result = outcome === 'error' ? new Error(e.error || 'The voice stopped unexpectedly.') : outcome;
        const p = this.pending;
        if (p && (!p.id || !e.id || p.id === e.id)) {
          this.pending = null;
          if (result instanceof Error) p.reject(result);
          else p.resolve(result);
        } else if (e.id) this.early.set(e.id, result);
      };
      await Promise.all([
        api.onSpeechEvent('speech:finish', on('done')),
        api.onSpeechEvent('speech:cancel', on('cancelled')),
        api.onSpeechEvent('speech:interrupted', on('cancelled')),
        api.onSpeechEvent('speech:error', on('error')),
      ]);
      return api;
    });
    return this.api;
  }

  async voices(): Promise<VoiceInfo[]> {
    const api = await this.load();
    return (await api.getVoices()).map((v) => ({ id: v.id, name: v.name, lang: v.language, local: true }));
  }

  async say(text: string, o: SayOptions): Promise<Outcome> {
    const api = await this.load();
    return new Promise<Outcome>((resolve, reject) => {
      const p = { id: null as string | null, resolve, reject };
      this.pending = p;
      api
        .speak({ text: text.slice(0, 3900), voiceId: o.voice?.id ?? null, language: o.voice ? null : o.lang, rate: o.rate, queueMode: 'flush' })
        .then((r) => {
          if (this.pending !== p) return;
          p.id = r.utteranceId ?? null;
          const early = p.id ? this.early.get(p.id) : undefined;
          if (early !== undefined) {
            this.pending = null;
            this.early.clear();
            if (early instanceof Error) reject(early);
            else resolve(early);
          }
        })
        .catch((e: unknown) => {
          if (this.pending === p) this.pending = null;
          reject(new Error((e as { message?: string })?.message ?? String(e)));
        });
    });
  }

  cancel() {
    this.pending?.resolve('cancelled');
    this.pending = null;
    this.early.clear();
    void this.api?.then((api) => api.stop()).catch(() => {});
  }
}

let engine: Engine | null | undefined;
function getEngine(): Engine | null {
  if (engine !== undefined) return engine;
  if (typeof window === 'undefined') return (engine = null);
  if (platformName() === 'android') engine = new AndroidEngine();
  else if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') engine = new WebEngine();
  else engine = null;
  return engine;
}

export function speechSupported(): boolean {
  return getEngine() !== null;
}

export function listVoices(): Promise<VoiceInfo[]> {
  return getEngine()?.voices().catch(() => []) ?? Promise.resolve([]);
}

/* ------------------------------------------------------------------ speaker */

export interface SpeakerOptions {
  rate: number;
  voiceId: string | null;
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

  setOptions(o: Partial<Pick<SpeakerOptions, 'rate' | 'voiceId'>>) {
    if ((o.rate ?? this.opts.rate) === this.opts.rate && (o.voiceId === undefined || o.voiceId === this.opts.voiceId)) return;
    this.opts = { ...this.opts, ...o };
    if (this.playing) void this.play(this.index); // apply rate/voice straight away
  }

  async play(from = this.index) {
    const eng = getEngine();
    if (!eng) return this.opts.onError('Read aloud isn’t available on this device.');
    const gen = ++this.gen;
    eng.cancel();
    this.index = Math.max(0, Math.min(from, this.sentences.length - 1));
    this.playing = true;
    const voice = pickVoice(await listVoices(), this.opts.voiceId, this.opts.lang);
    while (gen === this.gen && this.playing) {
      if (this.index >= this.sentences.length) {
        this.playing = false;
        return this.opts.onEnd();
      }
      this.opts.onSentence(this.index);
      let outcome: Outcome;
      try {
        outcome = await eng.say(this.sentences[this.index].text, { rate: this.opts.rate, voice, lang: voice?.lang ?? this.opts.lang });
      } catch {
        if (gen !== this.gen) return;
        this.playing = false;
        return this.opts.onError(platformName() === 'android' ? 'The voice stopped. Check that Android’s text-to-speech settings have a voice installed.' : 'The device’s voice stopped unexpectedly.');
      }
      if (gen !== this.gen) return;
      if (outcome === 'cancelled') {
        this.playing = false;
        return;
      }
      this.index++;
    }
  }

  pause() {
    this.playing = false;
    this.gen++;
    getEngine()?.cancel();
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
