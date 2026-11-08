export type AppTheme = 'dark' | 'light' | 'system';
export type ReaderTheme = 'night' | 'paper' | 'sepia' | 'black';
export type ReaderFont = 'nunito' | 'literata' | 'source-serif' | 'lora' | 'atkinson' | 'hanken' | 'system-serif' | 'system-sans';

export const READER_FONTS: { value: ReaderFont; label: string; stack: string }[] = [
  { value: 'nunito', label: 'Nunito Sans', stack: "'Nunito Sans Variable', 'Nunito Sans', system-ui, sans-serif" },
  { value: 'literata', label: 'Literata', stack: "'Literata Variable', Georgia, serif" },
  { value: 'source-serif', label: 'Source Serif', stack: "'Source Serif 4 Variable', Georgia, serif" },
  { value: 'lora', label: 'Lora', stack: "'Lora Variable', Georgia, serif" },
  { value: 'atkinson', label: 'Atkinson Hyperlegible', stack: "'Atkinson Hyperlegible', system-ui, sans-serif" },
  { value: 'hanken', label: 'Hanken Grotesk', stack: "'Hanken Grotesk Variable', system-ui, sans-serif" },
  { value: 'system-serif', label: 'System serif', stack: "ui-serif, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif" },
  { value: 'system-sans', label: 'System sans', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
];

export const READER_THEMES: { value: ReaderTheme; label: string }[] = [
  { value: 'night', label: 'Night' },
  { value: 'black', label: 'Black' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'paper', label: 'Paper' },
];

/** Typography used when a novel is read as a book; kept apart so each format keeps its own feel. */
export interface BookTypography {
  font: ReaderFont;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  paragraphSpacing: number;
  measure: number;
  margin: number;
  align: 'left' | 'justify';
  indent: boolean;
  hyphenate: boolean;
  /** Two pages side by side when the screen is wide and in landscape. */
  spreads: boolean;
}

export const TYPOGRAPHY_KEYS = ['font', 'fontSize', 'fontWeight', 'lineHeight', 'paragraphSpacing', 'measure', 'margin', 'align', 'indent', 'hyphenate'] as const;

/** Printed-book defaults: a book serif, justified and hyphenated, indented paragraphs with no gaps between them. */
export const DEFAULT_BOOK: BookTypography = {
  font: 'literata',
  fontSize: 19,
  fontWeight: 400,
  lineHeight: 1.6,
  paragraphSpacing: 0,
  measure: 66,
  margin: 28,
  align: 'justify',
  indent: true,
  hyphenate: true,
  spreads: true,
};

export interface ReaderPrefs {
  font: ReaderFont;
  fontSize: number; // px
  fontWeight: number;
  lineHeight: number; // unitless
  paragraphSpacing: number; // em
  measure: number; // max line length in ch
  margin: number; // px side padding (minimum)
  theme: ReaderTheme;
  align: 'left' | 'justify';
  indent: boolean;
  hyphenate: boolean;
  tapToTurn: boolean;
  swipeChapters: boolean;
  keepAwake: boolean;
  showStatus: boolean;
  smoothScroll: boolean;
  wpm: number;
  /** Read aloud speed (1 = the voice's normal pace) and chosen voice. */
  ttsRate: number;
  ttsVoice: string | null;
  /** Auto-scroll speed, in tenths of a line per second. */
  autoScrollSpeed: number;
  /** Comfort filters: 0–0.7 darkening, 0–1 warmth; optionally warm the page automatically at night. */
  dim: number;
  warmth: number;
  warmAtNight: boolean;
  book: BookTypography;
}

/** Defaults mirror the reading feel the user is used to: Nunito Sans with airy line spacing. */
export const DEFAULT_READER: ReaderPrefs = {
  font: 'nunito',
  fontSize: 20,
  fontWeight: 400,
  lineHeight: 1.9,
  paragraphSpacing: 1.1,
  measure: 66,
  margin: 24,
  theme: 'night',
  align: 'left',
  indent: false,
  hyphenate: false,
  tapToTurn: true,
  swipeChapters: true,
  keepAwake: true,
  showStatus: true,
  smoothScroll: true,
  wpm: 230,
  ttsRate: 1,
  ttsVoice: null,
  autoScrollSpeed: 5,
  dim: 0,
  warmth: 0,
  warmAtNight: false,
  book: DEFAULT_BOOK,
};

export type HomeSection = 'continue' | 'today' | 'recentChapters' | 'recentlyAdded' | 'recentlyUpdated' | 'favourites' | 'recommended' | 'collections' | 'stats';

export const HOME_SECTIONS: { value: HomeSection; label: string }[] = [
  { value: 'continue', label: 'Continue reading' },
  { value: 'today', label: 'Today' },
  { value: 'recentChapters', label: 'Recently read chapters' },
  { value: 'recentlyAdded', label: 'Recently added' },
  { value: 'recentlyUpdated', label: 'Recently updated' },
  { value: 'favourites', label: 'Favourites' },
  { value: 'recommended', label: 'Recommended from your library' },
  { value: 'collections', label: 'Collections' },
  { value: 'stats', label: 'Reading summary' },
];

export interface AppPrefs {
  theme: AppTheme;
  libraryView: 'grid' | 'list';
  librarySort: string;
  homeOrder: HomeSection[];
  homeHidden: HomeSection[];
  reduceMotion: boolean;
  haptics: boolean;
  /** Minutes of reading a day to aim for; 0 turns the goal off. */
  dailyGoal: number;
}

export const DEFAULT_APP: AppPrefs = {
  theme: 'dark',
  libraryView: 'grid',
  librarySort: 'last_read',
  homeOrder: ['continue', 'today', 'recentChapters', 'recentlyAdded', 'recentlyUpdated', 'favourites', 'recommended', 'collections', 'stats'],
  homeHidden: [],
  reduceMotion: false,
  haptics: true,
  dailyGoal: 20,
};

/** The saved Home order plus any sections added in later versions, each slotted in at its default place. */
export function resolveHomeOrder(saved: HomeSection[]): HomeSection[] {
  const known = new Set<string>(HOME_SECTIONS.map((h) => h.value));
  const order = saved.filter((s) => known.has(s));
  DEFAULT_APP.homeOrder.forEach((s, i) => {
    if (!order.includes(s)) order.splice(Math.min(i, order.length), 0, s);
  });
  return order;
}

const THEME_KEY = 'notavi.theme';

/** Theme is mirrored to localStorage so the right colours show before the database opens. */
/** The browser/status-bar colour; iOS tints its top blur with it, so it must match what's on screen. */
export function setThemeColour(colour: string) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colour);
}

export function applyAppTheme(theme: AppTheme) {
  const resolved = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#edefea' : '#141a1f');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable */
  }
}

export function initialTheme(): AppTheme {
  try {
    return (localStorage.getItem(THEME_KEY) as AppTheme) || 'dark';
  } catch {
    return 'dark';
  }
}
