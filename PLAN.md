# Notavi — build plan & status

Single source of truth for progress. If context resets, resume from here.

## Stage status

| # | Stage | Status |
|---|-------|--------|
| 1 | Architecture & stack | ✅ done |
| 2 | App structure & design system | ⏳ |
| 3 | Data layer & storage | ✅ done (20 unit tests on real SQLite) |
| 4 | Library & import | ⏳ |
| 5 | Reader | ⏳ |
| 6 | Search, annotations, progress | ⏳ |
| 7 | Home, stats, personalisation | ⏳ |
| 8 | Security, app lock, encrypted backup/restore | ⏳ |
| 9 | Testing | ⏳ |
| 10 | Packaging: PWA, CI, README | ⏳ |

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
* **Chapters are stored as sanitised HTML** (DOMPurify at import and again at render); EPUB images
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

## Known issues / limitations
_(filled in as found)_

## Left to do
Everything from Stage 2 on.
