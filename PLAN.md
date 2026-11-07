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
| 9 | Testing | ✅ 58 unit + 15 end-to-end tests passing (headless Chrome) |
| 10 | Packaging: PWA, CI, README | ✅ done; CI green on GitHub (Windows installer, Android APK, PWA) |

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
`.github/workflows/build.yml`: tests → PWA artifacts (root + GitHub Pages builds, optional Pages deploy via
`DEPLOY_PAGES` variable) → Windows `.msi` + NSIS `.exe` → Android APK (signed release if secrets exist, else debug).
Tags `v*` attach builds to a GitHub Release.

## Verification status

| Area | Verified how |
|---|---|
| Importers, database, search, stats, crypto, backup/restore | Unit tests on the real SQLite engine |
| Reader, navigation, progress across restarts, annotations, search, editing, deletion, backup/restore, app lock, offline, layouts at 390/800/1280/1920 px | End-to-end in headless Chrome against the production build |
| Rust shell / Tauri config / capabilities | `cargo check --release` |
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
- **v2 not started**: reading goals/reminders and live encrypted sync.

## Left to do
1. ~~Connect GitHub and get CI green~~ — done (repo `Mersanessa/Notavi`). First CI runs found and fixed: an invalid
   bundle category, a broken Android setup action, and a reader race (chapter title rendered before its text).
2. Create the Android signing key and secrets (README §7) — until then CI produces a debug APK.
3. Test on the MagicPad 2 and the PC; then v2 if wanted (goals & reminders, live sync).
