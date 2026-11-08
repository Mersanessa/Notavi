# Notavi

A private, local-first library and reader for novels you own. One person, no accounts, no analytics, no network:
your library lives on your device, and it leaves only when you export an encrypted backup.

- **Reader:** chapter-by-chapter reading in Nunito Sans by default (plus Literata, Source Serif, Lora, Atkinson
  Hyperlegible and more). Adjustable size, weight, line and paragraph spacing, line length and margins. Night, Black,
  Sepia and Paper themes, full screen, and resume exactly where you stopped. Navigate by tapping the screen edges,
  swiping or using the keyboard. **Read aloud** with your device's voices, **auto-scroll**, find in chapter, and
  dim and warmth filters for night reading.
- **Annotations:** chapter bookmarks, text bookmarks, highlights in five colours, and notes.
- **Library:** imports EPUB, TXT, HTML and Markdown. Add novels by hand, edit details and covers, and add, edit,
  reorder or delete chapters. Collections, sorting and filters.
- **Search:** titles, authors, genres, tags and descriptions, plus full-text search across every chapter.
- **Stats:** reading time, streaks, chapters read and monthly activity, all measured from your actual reading. A
  daily reading goal on Home, alongside one of your own highlights to revisit each day. Rate novels out of five.
- **Security:** optional PIN/passcode lock, and AES-256 encrypted backups.

Runs on **Windows** (installer), **Android** (APK, made for the Honor MagicPad 2) and **iPhone** (as a web app
added to the Home Screen).

### New in 1.1

- The Notavi wordmark, new app icons, and a short opening animation each time the app starts (tap to skip).
- Much more motion: screens flow into each other, covers grow into the novel page, chapters slide in the direction
  you're travelling, highlights sweep in, counters count up. Settings → Appearance → **Reduce motion** turns it
  all off.
- **Haptic feedback** on buttons, page turns and chapter changes: native on Android; on iPhone it needs iOS 18 or
  later. Settings → Appearance → **Haptic feedback** turns it off.
- **Read aloud** (🎧 in the reader's bottom bar): reads sentence by sentence, highlights the sentence being read,
  follows along, and carries on into the next chapter. Speed and voice are in reading settings. In the Android app
  this uses Android's own text-to-speech; if nothing is heard, open Android Settings → Accessibility →
  Text-to-speech and make sure a voice (e.g. Google's) is installed.
- **Auto-scroll** (gauge icon in the bottom bar): adjustable speed, hold a finger on the page to pause, moves on
  to the next chapter by itself.
- **Find in chapter** (🔍 in the top bar, or / and Ctrl+F).
- **Comfort filters** in reading settings: dim the page, add warmth, or warm it automatically between 9 pm and 6 am.
- **Ratings**, a **daily reading goal** (Settings → Reading; 20 minutes by default, 0 turns it off), and
  **From your highlights** on Home.

---

## Contents

1. [Getting the app](#1-getting-the-app)
2. [Installing on Windows](#2-installing-on-windows)
3. [Installing on Android (Honor MagicPad 2)](#3-installing-on-android-honor-magicpad-2)
4. [Installing on iPhone (web app)](#4-installing-on-iphone-web-app)
5. [Importing novels](#5-importing-novels)
6. [Backing up, restoring and moving between devices](#6-backing-up-restoring-and-moving-between-devices)
7. [Setting up Android signing (one-off)](#7-setting-up-android-signing-one-off)
8. [Reader controls](#8-reader-controls)
9. [Privacy and security](#9-privacy-and-security)
10. [Building and testing from source](#10-building-and-testing-from-source)

---

## 1. Getting the app

Builds are made by GitHub Actions. Nothing has to be installed on your PC to build them.

1. Open the repository on GitHub and go to **Actions → Build**.
2. Open the latest run with a green tick.
3. Under **Artifacts**, download:
   - `notavi-windows` for the Windows installer (`.msi` and `.exe`),
   - `notavi-android` for the Android app (`.apk`),
   - `notavi-pwa-root` / `notavi-pwa-github-pages`: the web app files, only needed if you host the iPhone
     version yourself (§4).

Artifacts are kept for 90 days. For a permanent copy, create a release: push a tag such as `v1.0.0`
(or use **Releases → Draft a new release** with a new `v…` tag). The workflow attaches the installers and APK to it.

## 2. Installing on Windows

1. Unzip `notavi-windows` and run **`Notavi_1.0.0_x64-setup.exe`**. It installs for your user only and needs no
   admin rights. Prefer an MSI? Use `Notavi_1.0.0_x64_en-US.msi` instead.
2. Windows SmartScreen will say *“Windows protected your PC”*, because the installer isn't code-signed (signing
   certificates cost money). Click **More info → Run anyway**.
3. Notavi appears in the Start menu. It uses Microsoft Edge WebView2, which Windows 11 already includes.

**Updating:** install the newer version over the old one. Your library is kept.
**Uninstalling** removes the library too, so make a backup first (§6).

## 3. Installing on Android (Honor MagicPad 2)

1. Download `notavi-android` and unzip it. Copy the `.apk` to the tablet (via a cloud folder, USB or email to
   yourself), or download it directly on the tablet.
2. Open the APK from the **Files** app.
3. MagicOS will ask for permission to install unknown apps from that source. Tap **Settings**, switch on
   **Allow**, then go back. (If you aren't asked: *Settings → Security → More settings → Install apps from external
   sources*, then allow **Files**.)
4. If Google Play Protect warns that the app is unknown, tap **More details → Install anyway**. It warns because
   the app isn't from the Play Store.
5. Open **Notavi** from the home screen.

**Which APK?**
- If you set up signing (§7), CI builds a **release APK** (`app-universal-release.apk`). Use this one.
- If not, CI builds a **debug APK** (`app-universal-debug.apk`). It installs and works, but it's larger and a bit
  slower.

**Updating:** install the newer APK over the old one. Android keeps your library *only if both APKs are signed
with the same key*. Going from a debug APK to a release APK (or changing keys) means uninstalling first, which
deletes the library. **Make a backup before switching** (§6), then restore it after.

## 4. Installing on iPhone (web app)

The iPhone version is the same app running in Safari and added to the Home Screen. Once added, it works offline.
Safari only allows this over HTTPS, so the app's code (never your library) has to be hosted somewhere.
Two free options:

**A. GitHub Pages (free for public repositories).**
Only the app's code is public; your novels never leave your devices.
1. In the repository: **Settings → Pages → Source: GitHub Actions**.
2. Push to `main` (or re-run the workflow). The app appears at `https://<your-username>.github.io/<repo-name>/`.

**B. Cloudflare Pages (free, works with private repositories).**
1. Create a free Cloudflare account. Go to **Workers & Pages → Create → Pages → Upload assets**.
2. Download and unzip the `notavi-pwa-root` artifact, then upload the unzipped folder's contents.
3. You get an address like `https://notavi.pages.dev`. Upload again whenever you want a newer version.

Then, on the iPhone:
1. Open the address in **Safari**. It must be Safari; other browsers can't add web apps on iOS.
2. Tap **Share → Add to Home Screen → Add**.
3. Open Notavi from the Home Screen icon (not from Safari) and use it there. It has its own storage.

A hosted address is not a privacy measure, and none is needed: the site contains only the app. Anyone who
opens the address gets an empty Notavi with nothing of yours in it.

## 5. Importing novels

**Library → Import → Choose files** (or drag files onto the window on Windows). You can pick several at once.

| Format | What happens |
|---|---|
| **EPUB** (DRM-free) | Chapters follow the book's reading order and table of contents. Basic formatting (italics, bold, headings, quotes, scene breaks) and illustrations are kept, and the cover is used. Files holding several chapters are split at the table-of-contents entries. |
| **TXT** | Chapter headings are detected (*Chapter 12*, *CHAPTER XII.*, *Prologue*, *第十二章*, bare numerals). Hard-wrapped lines are joined. Project Gutenberg headers and licence text are removed. With no headings, the text is split into ~4,000-word parts. Non-UTF-8 files (Windows-1252, UTF-16) are detected. |
| **HTML** | Split at the main heading level (`<h1>`/`<h2>`/`<h3>`). Inline images are kept; remote ones are not fetched. |
| **Markdown** | Optional front matter (`title`, `author`, `tags`, `genres`, `description`), split at headings. |

Before importing, each file shows a preview: title, author, chapter count, word count and any warnings.
Set its **content type** (original, public domain, licensed, personal import) and **source/licence notes**.
Files that can't be used are explained (*“protected by DRM”*, *“is a PDF”*, *“isn't a valid EPUB”*) and nothing
is imported from them.

### Reading published volumes in web-novel form

If you own a series as ebooks (or a mix of ebooks), Notavi can lay it out the way web novels are read: one flat,
continuously numbered chapter list.

1. **Import → Choose files** and pick every volume at once, then tap **Combine N files into one novel**. Volumes are
   put in order by their number; reorder them if needed.
2. Leave **Web-novel layout** on to retitle chapters “Chapter 1 … Chapter 412: Name”, numbered straight through every
   volume. Turn it off to keep the book’s own titles.
3. Notavi undoes the book structure automatically. It sets aside title pages, copyright, contents and
   “About the Author”. It joins chapter-opener pages to their text, re-joins chapters that a converter split across
   files, and splits files that contain several chapters. Prologues, side stories and afterwords are kept in place.
4. **Review chapters** shows the whole list. Bring back anything set aside, rename chapters, or join a piece onto
   the one before it.

**Your text is never edited.** Every import is checked word for word: *“All 412,345 words accounted for. Chapter
text is unchanged.”* If an arrangement ever failed that check, it wouldn’t be used and the file would be imported
exactly as laid out.

To **continue a series you already have**, import the next volume and set **Add to** to *The end of “…”*. Numbering
carries on from the last chapter. To **paste chapters**, open the novel's **Chapters** tab and choose
**Paste chapters**. Paste as many as you like; they're split at their headings and added at the end.

One limit: if a published edition merged, split or rewrote the original web chapters, the web chapter breaks can't be
recovered from the book. Notavi uses the chapter breaks the book itself has.

Other ways to add things:
- **Add by hand** creates a novel from scratch; then write or paste chapters (**Chapters → Add**).
- **Web novels as links:** add by hand and choose content type **External link**. Only the address is saved.
  Notavi never downloads, scrapes or copies content from websites.
- PDF, MOBI and AZW files aren't supported. Convert DRM-free ones to EPUB first (for example with Calibre).
  Notavi does not remove DRM.

## 6. Backing up, restoring and moving between devices

**Settings → Backup and restore.**

- **Export backup** asks for a passphrase and saves one `.notavi` file containing everything: novels, covers,
  chapters, progress, bookmarks, highlights, notes, collections, stats and settings. The file is encrypted
  (AES-256-GCM, key derived from your passphrase with PBKDF2-SHA256, 600,000 rounds). **Without the passphrase
  nobody can open it, including you.**
- **Restore from backup** shows what the file contains, asks for the passphrase and **replaces** the library on
  this device. If it was a mistake, **Undo last restore** brings the previous library back.

**Moving between devices (v1 sync):** export on one device, put the file somewhere the other device can reach
(OneDrive/Google Drive/Dropbox folder, USB cable, email to yourself), then restore it on the other device. The most
recently restored backup wins. Nothing is merged, so restore before you start reading on the second device.

Make a backup before uninstalling, switching APKs, or resetting a device. The app reminds you when your last backup
is more than two weeks old.

## 7. Setting up Android signing (one-off)

Signing lets you build release APKs and update the app without losing data. It's free.

1. On your PC (with Java installed, or in Android Studio's terminal), create a key. Keep the file and passwords
   somewhere safe; losing them means future updates need an uninstall:
   ```
   keytool -genkeypair -v -keystore notavi.jks -alias notavi -keyalg RSA -keysize 2048 -validity 10000
   ```
   Use the same password for the key and the keystore when asked.
2. Turn the keystore into text:
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("notavi.jks")) | Set-Clipboard`
   - macOS/Linux: `base64 -w0 notavi.jks`
3. In the GitHub repository: **Settings → Secrets and variables → Actions → New repository secret**. Add:
   - `ANDROID_KEYSTORE_BASE64`: the text from step 2
   - `ANDROID_KEY_ALIAS`: `notavi`
   - `ANDROID_KEY_PASSWORD`: your password
4. Re-run the workflow. The `notavi-android` artifact now contains a signed release APK.

## 8. Reader controls

| Action | Touch | Keyboard |
|---|---|---|
| Show or hide the toolbars | Tap the middle of the page | — |
| Next or previous screen | Tap the right or left quarter of the screen, or scroll | Space / ↓ / Page Down / J, or Shift+Space / ↑ / Page Up / K |
| Next or previous chapter | Swipe left or right, use the arrows in the bottom bar, or the button at the end of a chapter | → / ] / N, or ← / [ / P |
| Chapter list | ☰ in the top bar | T or C |
| Reading settings | **Aa** in the top bar | S |
| Bookmark the chapter | Bookmark icon | B |
| Full screen | ⛶ in the top bar (tablet and desktop) | F |
| Find in chapter | 🔍 in the top bar | / or Ctrl+F; Enter for the next match |
| Read aloud | 🎧 in the bottom bar | L |
| Auto-scroll | Gauge in the bottom bar; hold the page to pause | A |
| Highlight, note or bookmark text | Select text, then pick a colour, Note or Bookmark | — |
| Leave (or close find, read aloud or auto-scroll first) | ← in the top bar | Esc |

Tap-to-turn and swipe can be switched off in reading settings.

## 9. Privacy and security

- No accounts, analytics, telemetry, ads or network requests. The production build's Content Security Policy
  allows no remote origins at all.
- The library is a SQLite database in the app's private storage (OPFS) on each device.
- **App lock** (Settings → App lock) asks for a 4–8 digit PIN or a passcode when the app opens and after it has
  been in the background (immediately, or after 1, 5, 15 or 60 minutes). Repeated wrong attempts cause growing
  delays. Only a salted PBKDF2 hash of the code is stored.
  *Be aware:* the lock is a privacy screen, not disk encryption. It stops someone who picks up the tablet from
  browsing your library, but someone with full access to the device's storage could still read the database.
  Backups are encrypted.
- Forgotten code: the lock screen offers **restore a backup** or **erase the library**. Either way the lock is
  removed. The code itself can't be recovered.

## 10. Building and testing from source

Requirements: Node.js 22, and for native builds Rust (stable) plus the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm ci
npm run dev              # web version at http://localhost:5173
npm test                 # unit tests (importers, database, crypto, search, stats)
npm run build && npx playwright test   # end-to-end tests in Chrome
npx tauri dev            # desktop app in development
npx tauri build          # installers for the current OS
npm run fixtures         # regenerate test files in fixtures/
```

Project layout:

```
src/db/        SQLite (WASM) engine, worker, schema/migrations, storage interface
src/data/      repositories: novels & chapters, progress, annotations, collections, search, stats
src/import/    EPUB / TXT / HTML / Markdown importers and the HTML sanitiser
src/ui/        React screens; src/ui/reader/ is the reader
src/styles/    design tokens and styles
src-tauri/     the native shell (Windows/Android)
tests/         unit (Vitest) and end-to-end (Playwright) tests
fixtures/      generated test files, including deliberately broken ones
```

See `PLAN.md` for architecture decisions, status and known limitations.
