export type ContentType = 'original' | 'public_domain' | 'licensed' | 'personal_import' | 'external_link';
export type ReadingStatus = 'want_to_read' | 'reading' | 'on_hold' | 'completed' | 'dropped';

export const CONTENT_TYPES: { value: ContentType; label: string; hint: string }[] = [
  { value: 'original', label: 'Original work', hint: 'Something you or someone you know wrote' },
  { value: 'public_domain', label: 'Public domain', hint: 'Out of copyright, e.g. from Project Gutenberg' },
  { value: 'licensed', label: 'Licensed', hint: 'Bought or used under a licence' },
  { value: 'personal_import', label: 'Personal import', hint: 'A file you own a copy of' },
  { value: 'external_link', label: 'External link', hint: 'Saved as a link only; no content stored' },
];

export const STATUSES: { value: ReadingStatus; label: string }[] = [
  { value: 'want_to_read', label: 'Want to Read' },
  { value: 'reading', label: 'Reading' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'dropped', label: 'Dropped' },
];

export const statusLabel = (s: ReadingStatus) => STATUSES.find((x) => x.value === s)?.label ?? s;
export const contentTypeLabel = (s: ContentType) => CONTENT_TYPES.find((x) => x.value === s)?.label ?? s;

export interface Novel {
  id: string;
  title: string;
  altTitles: string[];
  author: string;
  translator: string;
  description: string;
  genres: string[];
  tags: string[];
  contentType: ContentType;
  source: string;
  licenceNotes: string;
  externalUrl: string;
  status: ReadingStatus;
  /** Free text such as "Ongoing" or "Completed (1432 chapters)". */
  publicationStatus: string;
  favourite: boolean;
  /** Your own rating, 1–5 stars; 0 = not rated. */
  rating: number;
  /** How the novel is presented: scrolling web-novel chapters, or a paginated book. Switchable at any time. */
  readingMode: ReadingMode;
  personalNotes: string;
  coverId: string | null;
  language: string;
  createdAt: number;
  /** Any change to the novel (metadata or content). */
  updatedAt: number;
  /** Last time chapters were added/edited/removed. Drives "Recently updated". */
  contentUpdatedAt: number;
  lastReadAt: number | null;
}

export interface NovelSummary extends Novel {
  chapterCount: number;
  chaptersRead: number;
  totalWords: number;
  progress: { chapterId: string; position: number; ratio: number; chapterTitle: string } | null;
  /** 0..1 progress through the novel. */
  percent: number;
}

export type ReadingMode = 'web' | 'book';

/** A chapter as handed to storage. */
export interface NewChapter {
  title: string;
  content: string;
  /** Front/back matter that only the book format shows (title page, copyright, contents…). */
  bookOnly?: boolean;
  /** The book's own title for this chapter, when the web-novel title differs. */
  originalTitle?: string;
}

export interface ChapterMeta {
  id: string;
  novelId: string;
  position: number;
  title: string;
  /** The book's own title (falls back to `title`). */
  originalTitle: string;
  bookOnly: boolean;
  wordCount: number;
  createdAt: number;
  updatedAt: number;
  completed?: boolean;
  opened?: boolean;
}

export interface Chapter extends ChapterMeta {
  content: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  position: number;
  createdAt: number;
  updatedAt: number;
  novelCount: number;
  coverNovelIds: string[];
}

export interface Progress {
  novelId: string;
  chapterId: string;
  blockIndex: number;
  blockOffset: number;
  chapterRatio: number;
  updatedAt: number;
}

export type AnnotationKind = 'chapter_bookmark' | 'text_bookmark' | 'highlight' | 'note';
export const HIGHLIGHT_COLORS = ['amber', 'sage', 'sky', 'rose', 'violet'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface Annotation {
  id: string;
  novelId: string;
  chapterId: string;
  kind: AnnotationKind;
  startOffset: number | null;
  endOffset: number | null;
  blockIndex: number | null;
  quote: string;
  note: string;
  color: HighlightColor;
  createdAt: number;
  updatedAt: number;
  chapterTitle?: string;
  chapterPosition?: number;
  novelTitle?: string;
}

/** A section of an imported file. `role` and `titleFrom` are hints for the web-novel layout step. */
export interface ParsedSection {
  title: string;
  content: string;
  /** From EPUB semantics (epub:type) or position: what the publisher says this section is. */
  role?: 'front' | 'body' | 'back' | 'toc';
  /** Where the title came from. 'generated' means the section had no heading or contents entry. */
  titleFrom?: 'toc' | 'heading' | 'generated';
}

/** Output of an importer, before it's stored. */
export interface ParsedNovel {
  format: 'epub' | 'txt' | 'html' | 'markdown';
  title: string;
  author?: string;
  translator?: string;
  description?: string;
  language?: string;
  genres?: string[];
  tags?: string[];
  altTitles?: string[];
  source?: string;
  cover?: { mime: string; data: Uint8Array } | null;
  /** Images referenced from chapter HTML as `notavi-blob:<id>`. */
  images?: { id: string; mime: string; data: Uint8Array }[];
  chapters: ParsedSection[];
  /** Non-fatal problems worth telling the user about. */
  warnings: string[];
}

export type NovelInput = { title: string } & Partial<
  Omit<Novel, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'contentUpdatedAt' | 'lastReadAt' | 'coverId'>
>;
