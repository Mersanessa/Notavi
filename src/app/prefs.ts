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
};

export type HomeSection = 'continue' | 'recentChapters' | 'recentlyAdded' | 'recentlyUpdated' | 'favourites' | 'recommended' | 'collections' | 'stats';

export const HOME_SECTIONS: { value: HomeSection; label: string }[] = [
  { value: 'continue', label: 'Continue reading' },
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
}

export const DEFAULT_APP: AppPrefs = {
  theme: 'dark',
  libraryView: 'grid',
  librarySort: 'last_read',
  homeOrder: ['continue', 'recentChapters', 'recentlyAdded', 'recentlyUpdated', 'favourites', 'recommended', 'collections', 'stats'],
  homeHidden: [],
  reduceMotion: false,
};

const THEME_KEY = 'notavi.theme';

/** Theme is mirrored to localStorage so the right colours show before the database opens. */
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
