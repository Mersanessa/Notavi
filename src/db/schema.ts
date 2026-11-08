/**
 * Schema migrations. Each runs in its own transaction; `meta.schema_version`
 * records progress. Libraries restored from older backups are migrated on open.
 * Never edit a shipped migration — append a new one.
 */
export const MIGRATIONS: string[] = [
  /* v1 */ `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  -- rid is an explicit INTEGER PRIMARY KEY so rowids stay stable across VACUUM;
  -- the FTS tables key off it.
  CREATE TABLE novels (
    rid INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    sort_title TEXT NOT NULL,
    alt_titles TEXT NOT NULL DEFAULT '[]',
    author TEXT NOT NULL DEFAULT '',
    translator TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    genres TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    content_type TEXT NOT NULL DEFAULT 'personal_import'
      CHECK (content_type IN ('original','public_domain','licensed','personal_import','external_link')),
    source TEXT NOT NULL DEFAULT '',
    licence_notes TEXT NOT NULL DEFAULT '',
    external_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'want_to_read'
      CHECK (status IN ('want_to_read','reading','on_hold','completed','dropped')),
    publication_status TEXT NOT NULL DEFAULT '',
    favourite INTEGER NOT NULL DEFAULT 0,
    personal_notes TEXT NOT NULL DEFAULT '',
    cover_id TEXT,
    language TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    content_updated_at INTEGER NOT NULL,
    last_read_at INTEGER
  );
  CREATE INDEX novels_created ON novels(created_at);
  CREATE INDEX novels_content_updated ON novels(content_updated_at);
  CREATE INDEX novels_last_read ON novels(last_read_at);

  CREATE TABLE chapters (
    rid INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    word_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX chapters_novel_pos ON chapters(novel_id, position);

  CREATE TABLE blobs (
    id TEXT PRIMARY KEY,
    novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('cover','image')),
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX blobs_novel ON blobs(novel_id);

  CREATE TABLE collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE collection_items (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (collection_id, novel_id)
  );
  CREATE INDEX collection_items_novel ON collection_items(novel_id);

  -- Where the reader is in each novel. block_index/block_offset survive font changes.
  CREATE TABLE progress (
    novel_id TEXT PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    block_index INTEGER NOT NULL DEFAULT 0,
    block_offset REAL NOT NULL DEFAULT 0,
    chapter_ratio REAL NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  -- Per-chapter history: "chapters read" and "recently read chapters".
  CREATE TABLE chapter_reads (
    chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
    novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    first_opened_at INTEGER NOT NULL,
    last_opened_at INTEGER NOT NULL,
    max_ratio REAL NOT NULL DEFAULT 0,
    completed_at INTEGER
  );
  CREATE INDEX chapter_reads_novel ON chapter_reads(novel_id);
  CREATE INDEX chapter_reads_last ON chapter_reads(last_opened_at);
  CREATE INDEX chapter_reads_completed ON chapter_reads(completed_at);

  -- Measured active reading time, written in slices while reading.
  -- No foreign keys: stats survive deleting a novel.
  CREATE TABLE reading_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id TEXT NOT NULL,
    chapter_id TEXT,
    day TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    words INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX reading_log_day ON reading_log(day);
  CREATE INDEX reading_log_novel ON reading_log(novel_id);

  -- Chapters finished per day (kept even if the chapter is deleted later).
  CREATE TABLE chapter_completions (
    chapter_id TEXT NOT NULL,
    novel_id TEXT NOT NULL,
    day TEXT NOT NULL,
    completed_at INTEGER NOT NULL,
    PRIMARY KEY (chapter_id)
  );
  CREATE INDEX chapter_completions_day ON chapter_completions(day);

  CREATE TABLE annotations (
    id TEXT PRIMARY KEY,
    novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('chapter_bookmark','text_bookmark','highlight','note')),
    start_offset INTEGER,
    end_offset INTEGER,
    block_index INTEGER,
    quote TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'amber',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX annotations_novel ON annotations(novel_id, created_at);
  CREATE INDEX annotations_chapter ON annotations(chapter_id);

  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE VIRTUAL TABLE novel_fts USING fts5(
    title, alt_titles, author, translator, genres, tags, description,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE VIRTUAL TABLE chapter_fts USING fts5(
    title, body,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  -- FTS rows share rowids with their source rows, so deletes (including
  -- ON DELETE CASCADE from novels) keep the index clean automatically.
  CREATE TRIGGER chapters_fts_delete AFTER DELETE ON chapters BEGIN
    DELETE FROM chapter_fts WHERE rowid = old.rid;
  END;
  CREATE TRIGGER novels_fts_delete AFTER DELETE ON novels BEGIN
    DELETE FROM novel_fts WHERE rowid = old.rid;
  END;
  `,
  /* v2 (1.1): your own star rating, 0 = not rated. */ `
  ALTER TABLE novels ADD COLUMN rating INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;
