# Notavi — build plan & status

Single source of truth for progress. If context resets, resume from here.

## Stage status

| # | Stage | Status |
|---|-------|--------|
| 1 | Architecture & stack | ✅ done |
| 2 | App structure & design system | ✅ done |
| 3 | Data layer & storage | ✅ done |
| 4 | Library & import | ✅ done |
| 5 | Reader | ✅ done |
| 6 | Search, annotations, progress | ✅ done |
| 7 | Home, stats, personalisation | ✅ done |
| 8 | Security, app lock, encrypted backup/restore | ✅ done |
| 9 | Testing | ✅ 78 unit + 18 end-to-end tests passing (headless Chrome) |
| 10 | Packaging: PWA, CI, README | ✅ done; CI green on GitHub (Windows installer, Android APK, PWA) |
| 1.1 | Brand, motion, haptics, reader extras, goals | ✅ done |
| 1.2 | Read as web novel or book (paginated, Apple Books-style), reversible | ✅ done |
| 1.3 | Lore: spoiler-free encyclopaedia (graph + index), name cards in the reader, real reading speed | ✅ done — 102 unit + 26 end-to-end tests passing |

## Version 1.3 — Lore (spoiler-free encyclopaedia), real reading speed

Asked for: spoiler-free explanations of names with earlier mentions; a spoiler-free encyclopaedia as its own
section, ranked by importance, with a "complex" Obsidian-style graph view (default) and a "simple" tap-through view;
reading time from real speed; Stats slimmed into Settings; a selection bar that fits the iPhone.

- **No AI, all on device** (Notavi never goes online). `src/lore/extract.ts` reads every chapter once (in a worker,
  `src/lore/worker.ts`): capitalised runs → candidate names; a word is part of a name only if it's capitalised
  mid-sentence far more often than lower-case across the novel; honorifics stripped; first/last names grouped with
  the full name they overwhelmingly belong to; kind from cues (speech verbs, "in X", place/organisation words, "the
  X"); descriptions from appositives ("X, a …", "X was a …"); co-occurrence per paragraph (top 60 pairs per chapter).
- **Spoiler gating** (`src/lore/view.ts`): everything is stored per chapter; the view sums only chapters before the
  reading position plus a live scan of the read part of the current chapter. Display names, rank, tiers,
  descriptions and connections are all computed from that cut-off, so nothing about later chapters leaks (not even
  a surname or future importance). Earlier mentions come from FTS with `position < current`.
- **Storage** (schema v4): `lore_index` (JSON per novel, rebuilt when `content_updated_at` changes) and `lore_user`
  (your renames, kinds, merges, part-of, hidden, notes — never overwritten).
- **UI**: `src/ui/pages/Lore.tsx` (graph/index/notes), `src/ui/lore/LoreGraph.tsx` (canvas + d3-force; pan, pinch,
  wheel, drag, hover highlight, fly-to), `LoreNote.tsx`, reader `LoreCard.tsx` (tap or hover a name).
- Scale check (synthetic, Node): 1,500 chapters / 22 MB of HTML → scan 1.7 s + finish 0.6 s; a view in ~140 ms.
  Expect a few times slower on a phone (it runs once, in the background).
- **Reading speed**: words passed per active stretch (≥20 s, 60–1000 wpm, not while auto-scrolling or listening),
  smoothed with recent reading weighted most; used once 1,500+ words are measured.

## Version 1.2 — read as a web novel or as a book

Asked for: an option to read an EPUB as an ebook or as a web novel, professional (Apple Books as reference), and
**not irreversible**.

- **Data (schema v3)**: `novels.reading_mode` ('web' | 'book'), `chapters.book_only`, `chapters.original_title`.
  The web-novel layout no longer drops set-aside sections; they're stored as book-only chapters, and the book's own
  titles are stored next to the web titles. Which chapters count (lists, counts, progress position, words, search)
  is decided in SQL by `book_only = 0 OR reading_mode = 'book'`. Switching format only flips `reading_mode`.
- **Same text in both formats**, so reading anchors (block + fraction) and annotation offsets are shared: the
  place, highlights and notes carry across a switch. Tested both ways in e2e.
- **Book reader**: the chapter flows into CSS columns one screen wide (`column-count` 1 or 2, gap = 2 × side
  margin, so one page turn = one screen width); pages slide with a transform and follow the finger. Page anchors
  come from where block fragments sit (`capturePageAnchor`/`pageForAnchor` in `anchors.ts`), independent of the
  transform. Cover page, centred front matter, sunk chapter openers with the brass lozenge, drop cap, running
  heads, folios, gutter shadow on spreads. Separate `reader.book` typography profile.
- Existing novels imported before 1.2 lost their set-aside sections at import (that was the old behaviour); Book
  format still works for them, minus those pages.

## Version 1.1 (November 2026)

Asked for: a rich wordmark logo (the name, not a book), a short luxurious opening on every launch, far more
animation, haptics on iPhone, and "everything I'd want but haven't mentioned".

- **Brand**: wordmark drawn from Fraunces glyph outlines (opentype.js, `scripts/logo/`), the i's dot replaced by a
  brass lozenge; app icon = N + lozenge. All icons regenerated (`npm run icons`, `npx tauri icon`).
- **Opening**: inline HTML/CSS splash injected by a Vite plugin (`scripts/splash.*`) so it paints before any JS;
  letters rise out of a blur, the lozenge springs in; dismissed once the library is open (minimum 1.3 s; tap
  skips; Reduce motion shows it still and briefly).
- **Motion**: View Transitions between routes (cover → novel page shared element), sliding nav/tab/segment
  indicators, spring presses, count-ups, direction-aware chapter slides, highlight sweep, star pops, goal ring fill.
  `src/styles/motion.css`. Reduce motion (setting or system) disables all of it.
- **Haptics** (`src/platform/haptics.ts`): Android app → `tauri-plugin-haptics`; iPhone → the iOS 18
  `<input type=checkbox switch>` tick (the only haptic a web page can trigger on iOS; Safari has no Vibration API);
  other browsers → `navigator.vibrate`. One global click listener, so every button gets it.
- **Read aloud** (`src/ui/reader/speech.ts`): sentence-by-sentence, highlighted with the CSS Custom Highlight API
  (no DOM changes), continues across chapters, Media Session controls. Web Speech API on iPhone/Windows/browsers;
  **Android app uses `tauri-plugin-tts`** because the Android System WebView has no `speechSynthesis`.
- **Auto-scroll**, **find in chapter**, **dim/warmth filters** (multiply-blend overlay), **ratings** (schema v2
  adds `novels.rating`), **daily goal** (Home ring + a toast when reached), **highlight of the day** (stable per
  day, FNV hash of the date).
- **Fixed**: the Reduce-motion CSS set `transition-duration: 1ms` on everything, which made *every* property
  (including font-size) transition and could lose the reading position when changing text size; now 0s. The
  reader also ignores the scroll event caused by its own position restore, and opts out of browser scroll
  anchoring.

## Stage 1 — Architecture & stack

### Decision summary

| Concern | Choice |
|---|---|
| UI | React 19 + TypeScript + Vite 8 (as requested) |
| Native shell | Tauri 2 → Windows (.msi + NSIS .exe) and Android (.apk) |
| iPhone / fallback | Same build as an installable, offline PWA (service worker via vite-plugin-pwa) |
| Storage engine | **Changed:** SQLite compiled to WebAssembly (official `@sqlite.org/sqlite-wasm`) in a Web Worker, persisted to OPFS — on *every* platform |
| Storage fallback | In-memory SQLite snapshotted to IndexedDB when OPFS isn't available |
| Search | SQLite FTS5 (`unicode61`, diacritics folded), one index for metadata, one for chapter text |
| State | Zustand for UI state; the DB is the source of truth |
| Routing | Small hash router (no server needed; works under `tauri://`, file hosting and sub-paths) |
| Icons / fonts | lucide (one consistent stroke set); fonts self-hosted via @fontsource (no CDN calls) |
| Crypto | WebCrypto: PBKDF2-SHA256 (600k iterations) → AES-256-GCM |
| Tests | Vitest (unit, real SQLite in Node) + Playwright on headless Chrome (end-to-end) |
| CI | GitHub Actions: Windows installer, Android APK, PWA bundle (free tiers only) |

### Why SQLite-WASM everywhere instead of native SQLite under Tauri + IndexedDB for the PWA

The brief asked for SQLite under Tauri with an abstraction so the PWA can use IndexedDB.
I kept the abstraction (`Db` interface in `src/db/types.ts`) but run one engine everywhere:

* **One behaviour on every device.** The same SQL, schema, migrations and FTS5 search on
  Windows, Android and iPhone. Two engines (SQLite + IndexedDB) would need two search
  implementations and two sets of bugs.
* **Verifiable here.** The whole data layer runs in Node unit tests and in headless Chrome
  end-to-end tests. A native Tauri SQLite path can't be exercised in this sandbox at all.
* **Fast.** Queries run in a worker with no Rust↔JS IPC hop per statement; the UI thread never blocks.
* **Backups are trivial and exact.** The backup payload is the SQLite file itself.

Trade-offs, stated honestly:
* Data lives in the WebView's origin storage (OPFS). Under Tauri this is app-private storage
  that's removed when the app is uninstalled; in a browser PWA the OS may evict it under
  storage pressure. Mitigations: `navigator.storage.persist()`, and encrypted backups.
* OPFS access handles are exclusive, so only one window/tab can open the library at a time.
  A second one shows a clear message instead of opening an empty library.
* ~1 MB WASM download (cached by the service worker / bundled in the binary).
* If a native backend is ever wanted, implement `Db` with `tauri-plugin-sql`; repositories don't change.

### Other notable decisions
* **Chapters are stored as sanitised HTML** (own allow-list sanitiser, at import and again at render); EPUB images
  are stored as blobs in the DB and rewritten to `blob:` URLs when displayed.
* **Restore replaces the whole library** after validating the file (SQLite header, integrity check,
  schema version), keeping a safety copy so a restore can be undone. This is the v1 "sync": export on
  one device, import on another (last export wins). Merging is out of scope for v1.
* **App lock is a privacy lock, not at-rest encryption.** It stops someone picking up the tablet
  from seeing the library; it doesn't encrypt the database on disk. Backups *are* encrypted.
* **No network at all.** Production CSP has no remote origins; the app never makes requests.
* **Android signing:** if signing secrets exist in the repo, CI produces a signed release APK;
  otherwise a debug-signed APK that still installs.

## Decisions log
- 2026-11-07: Restarted from scratch at the user's request (model upgraded). First attempt set aside, not reused.
- 2026-11-07: **Default reading font is Nunito Sans** (user's request: it's the font of the site they read on now),
  with generous line spacing to match. Other reader fonts stay selectable. UI: Fraunces + Hanken Grotesk.
- 2026-11-07: **All user-facing text in British English** (favourite, colour, licence, customise, organise…).
- 2026-11-07: FTS tables key off explicit `rid INTEGER PRIMARY KEY` columns so rowids stay stable across VACUUM.

## Stage notes

**Stage 2 — design system.** Tokens in `src/styles/tokens.css`. Ink-dark base (#141a1f), paper text (#e9e2d4),
brass accent (#c8a15a) used only for progress, primary actions and focus. Fraunces (display) + Hanken Grotesk (UI).
Books without covers get a generated cloth binding. Rail navigation ≥ 761px, bottom tab bar below.

**Stage 4 — import.** Own allow-list sanitiser (`src/import/dom.ts`) instead of DOMPurify: DOMPurify silently
no-ops under the unit-test DOM, so its tests proved nothing. EPUB: OPF metadata, nav/NCX titles, splitting files
that hold several chapters at TOC anchors, images stored as blobs, cover pages skipped, DRM refused. TXT: encoding
detection (BOM/UTF-8/UTF-16/Windows-1252), chapter heading families (Chapter N / Prologue / 第N章 / roman / numbers),
Project Gutenberg wrapper stripped, hard-wrapped lines joined, size-based split as a fallback.

**Stage 5 — reader.** Position = (block index, fraction through block), so it survives font/size/width changes.
Highlights/notes = text offsets + quote (re-found if the chapter is edited). Tap zones, swipe, keyboard, chapter
drawer, bookmarks drawer, find-in-chapter, selection toolbar, non-modal settings panel, wake lock, full screen.
Reading time = active time only (stops after 3 min without interaction).

**Stage 8 — security.** Backups: AES-256-GCM, PBKDF2-SHA256 600k, header authenticated as additional data,
gzip inside; restore validates (magic, integrity_check, schema version) and keeps an undo copy. App lock: PIN/passcode
hashed with PBKDF2 (210k), escalating lockout after 5 failures, auto-lock after time in background, "forgot code"
path = restore a backup or erase.

**Stage 9 — testing.** Bugs found and fixed by the tests: (1) a race where the delayed re-layout after fonts loaded
could undo the reader's first scroll and skip saving; (2) adding a note lost the selection when the note box took
focus; (3) EPUB chapters whose heading differed from the TOC label ("Stave One" vs "Stave I") showed the title twice;
(4) leaving the reader saved the chapter fraction as 0 because the scroller was already detached;
(5) DOMPurify silently did nothing under the test DOM (replaced with own sanitiser).

**Stage 10 — packaging.** `src-tauri/` compiles (`cargo check --release` passes on Linux with Tauri 2).
`.github/workflows/build.yml`: tests → PWA artifacts (root + GitHub Pages builds, Pages deploy on every push to main once Pages is enabled) → Windows `.msi` + NSIS `.exe` → Android APK (signed release if secrets exist, else debug).
Tags `v*` attach builds to a GitHub Release.

**Web-novel layout (added after v1, at the user's request).** `src/import/layout.ts`: combines volumes into one
continuously numbered chapter list; splits sections holding several chapters at chapter headings; joins opener pages
and converter-split files; sets aside front/back matter (reversibly); optional "Chapter N: Name" titles; continues
numbering when appending to an existing novel; bulk paste. **Guarantee:** chapter text passes through unchanged and
`auditPlan` proves every source word is present, in order (kept or set aside); arrangements failing the check are not
used. The EPUB importer no longer silently drops any section; it tags sections (front/back/toc) instead.

## Verification status

| Area | Verified how |
|---|---|
| Importers, database, search, stats, crypto, backup/restore | Unit tests on the real SQLite engine |
| Reader, navigation, progress across restarts, annotations, search, editing, deletion, backup/restore, app lock, offline, layouts at 390/800/1280/1920 px | End-to-end in headless Chrome against the production build |
| Rust shell / Tauri config / capabilities | `cargo check` (host). The Android-only TTS plugin can't be compiled in the sandbox (no Android target download); CI builds it |
| Read aloud | End-to-end with a stand-in voice (headless browsers have none); real voices untested |
| Windows installer, Android APK, GitHub Actions workflow | ✅ Built by CI on GitHub (run 42418104825); installers not yet installed on a device |
| Real devices (MagicPad 2, Windows 11 PC, iPhone) | **Not tested** |

## Known issues / limitations
- **Untested on real devices.** Chromium (headless) behaviour is verified; the Android System WebView and WebView2
  are Chromium too, so behaviour should match, but touch feel, Android file pickers and backup saving on Android
  need checking on the tablet.
- **Backup saving on Android** uses the dialog plugin's save picker + fs plugin writing to the returned location.
  This is the documented Tauri 2 path but is the part most likely to need a fix after the first device test.
- **Full screen on Android**: the reader hides its own bars; Android's status/navigation bars may stay visible.
- **Android 15+ edge-to-edge**: if the tablet updates to Android 15, content may sit under the status bar until the
  Android theme is adjusted. The MagicPad 2 ships with Android 14 (MagicOS 8).
- **iPhone (PWA)**: Safari may clear a web app's storage if the phone runs very low on space. Keep backups.
- **One window at a time**: a second tab/window of the PWA shows a message instead of opening the library.
- **Sync is file-based** (export → restore replaces). No merging.
- **Collections can't be reordered** from the UI yet (the data layer supports it; the list sorts by creation).
- **Fixtures** are short public-domain excerpts typed from memory plus original filler text (Project Gutenberg is
  unreachable from the build sandbox).
- **No haptics on iPhone from iOS 26.5**: Apple patched the `<input switch>` trick (confirmed by the user: nothing
  is felt). iOS 18–26.4 still get it. Only a native iOS build could vibrate, which needs a Mac and an Apple
  developer account.
- **Read aloud on iPhone** stops when the screen locks (Safari suspends speech); keep the screen on while listening.
  On Android the app uses the system TTS engine, which needs a voice installed (Google TTS usually is).
- **View transitions** need iOS 18+/Chrome 111+; elsewhere screens change instantly.
- **Lore is heuristic**: names are found from capitalisation and context, so expect some misses and some junk on a
  real web novel; corrections (rename/merge/retype/hide) are there for that. Descriptions are only the book's own
  appositive sentences, so many entries have none. Tested on an original fixture story and synthetic scale data,
  not yet on Lord of Mysteries / Shadow Slave themselves.
- **v2 not started**: reminders and live encrypted sync.

## Left to do
1. ~~Connect GitHub and get CI green~~ — done (repo `Mersanessa/Notavi`). First CI runs found and fixed: an invalid
   bundle category, a broken Android setup action, and a reader race (chapter title rendered before its text).
2. Create the Android signing key and secrets (README §7) — until then CI produces a debug APK.
3. Test on the MagicPad 2 and the PC; then v2 if wanted (goals & reminders, live sync).
