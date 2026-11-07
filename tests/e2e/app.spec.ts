import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/* ------------------------------------------------------------------ helpers */

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('notavi.offlineReady', '1');
    // Force the plain download path for backups (the native save picker can't be automated).
    // @ts-expect-error test override
    delete window.showSaveFilePicker;
  });
});

async function importFiles(page: Page, files: string[]) {
  await page.goto('/#/import');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('choose-files').click()]);
  await chooser.setFiles(files.map((f) => `fixtures/${f}`));
  await expect(page.locator('.import-item--parsing')).toHaveCount(0);
  const ready = await page.locator('.import-item--ready').count();
  if (ready > 1) await page.getByRole('button', { name: /^Import all/ }).click();
  else if (ready === 1) await page.locator('.import-item--ready').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('.import-item--importing')).toHaveCount(0);
  await expect(page.locator('.import-item--ready')).toHaveCount(0);
}

async function openNovel(page: Page, title: string) {
  await page.goto('/#/library');
  await page.getByTestId('book-card').filter({ hasText: title }).first().click();
  await expect(page.locator('.novel-head__title')).toHaveText(title);
}

async function startReading(page: Page, title: string) {
  await openNovel(page, title);
  await page.getByTestId('start-reading').click();
  await expect(page.getByTestId('chapter-text').locator('p').first()).toBeVisible();
}

const chapterTitle = (page: Page) => page.locator('.chapter-head__title');

/** The text of the first paragraph whose bottom is below the top of the reading area. */
function firstVisibleText(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('.reader__scroll')!;
    const top = scroller.getBoundingClientRect().top + 8;
    const ps = Array.from(document.querySelectorAll('[data-testid=chapter-text] p'));
    return ps.find((p) => p.getBoundingClientRect().bottom > top)?.textContent?.slice(0, 60) ?? '';
  });
}

async function selectText(page: Page, paragraphIndex: number, from: number, to: number) {
  await page.evaluate(
    ([i, a, b]) => {
      const p = document.querySelectorAll('[data-testid=chapter-text] p')[i];
      const t = p.firstChild!;
      const r = document.createRange();
      r.setStart(t, a);
      r.setEnd(t, b);
      const s = getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
    },
    [paragraphIndex, from, to],
  );
  await expect(page.getByRole('toolbar', { name: 'Selected text' })).toBeVisible();
}

async function restart(context: BrowserContext, page: Page, url = '/#/'): Promise<Page> {
  await page.close(); // releases the single-instance lock, like closing the app
  const next = await context.newPage();
  await next.goto(url);
  return next;
}

/* ------------------------------------------------------------------ import */

test('imports EPUB, TXT, HTML and Markdown, and explains bad files', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your library is empty' })).toBeVisible();
  await importFiles(page, ['alice-excerpt.epub', 'pride-and-prejudice-gutenberg.txt', 'scandal-in-bohemia.html', 'lamplighter-notes.md']);
  await page.goto('/#/library');
  await expect(page.getByTestId('book-card')).toHaveCount(4);
  await expect(page.getByText('4 novels')).toBeVisible();

  // Malformed files fail gracefully with a reason, without blocking good ones.
  await page.goto('/#/import');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('choose-files').click()]);
  await chooser.setFiles(['fixtures/malformed/drm.epub', 'fixtures/malformed/truncated.epub', 'fixtures/malformed/empty.txt', 'fixtures/malformed/document.pdf', 'fixtures/xiyouji-excerpt.txt']);
  await expect(page.locator('.import-item--error')).toHaveCount(4);
  await expect(page.getByText(/protected by DRM/)).toBeVisible();
  await expect(page.getByText(/isn't a valid EPUB/)).toBeVisible();
  await expect(page.getByText(/is a PDF/)).toBeVisible();
  await expect(page.locator('.import-item--ready')).toHaveCount(1);
});

test('adds a novel by hand, edits it, manages chapters and collections', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: 'Add novel' }).click();
  await expect(page.getByText('Give the novel a title.')).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('The Clockmaker');
  await page.getByLabel('Author', { exact: true }).fill('A. N. Other');
  await page.getByLabel('Genres').fill('Mystery,');
  await page.getByLabel('Content type').selectOption('original');
  await page.getByRole('button', { name: 'Add novel' }).click();
  await expect(page.locator('.novel-head__title')).toHaveText('The Clockmaker');

  // Add two chapters in plain-text mode.
  for (const [title, text] of [
    ['First Tick', 'The clock struck one.\n\nThen it struck two.'],
    ['Second Tick', 'A quiet morning.'],
  ]) {
    await page.goto(page.url().split('?')[0].replace(/#\/novel\/([^/]+).*/, '#/novel/$1/chapter/new'));
    await page.getByLabel('Chapter title').fill(title);
    await page.getByRole('radio', { name: 'Plain text' }).click();
    await page.getByRole('textbox', { name: 'Chapter text' }).fill(text);
    await page.getByRole('button', { name: 'Add chapter' }).click();
    await expect(page.getByRole('tab', { name: /Chapters/ })).toHaveAttribute('aria-selected', 'true');
  }
  const rows = page.locator('.chapter-row .chapter-row__title');
  await expect(rows).toHaveText(['First Tick', 'Second Tick']);

  // Reorder.
  await page.getByRole('button', { name: 'Reorder' }).click();
  await page.getByRole('button', { name: 'Move Second Tick up' }).click();
  await expect(page.locator('.reorder__content')).toHaveText(['1Second Tick', '2First Tick']);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(rows).toHaveText(['Second Tick', 'First Tick']);

  // Edit a chapter's title.
  await page.getByRole('button', { name: 'Actions for First Tick' }).click();
  await page.getByRole('menuitem', { name: 'Edit chapter' }).click();
  await page.getByLabel('Chapter title').fill('The First Tick');
  await page.getByRole('button', { name: 'Save chapter' }).click();
  await expect(rows).toHaveText(['Second Tick', 'The First Tick']);

  // Delete a chapter.
  await page.getByRole('button', { name: 'Actions for Second Tick' }).click();
  await page.getByRole('menuitem', { name: 'Delete chapter' }).click();
  await page.getByRole('button', { name: 'Delete chapter' }).click();
  await expect(rows).toHaveText(['The First Tick']);

  // Edit metadata.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit details' }).click();
  await page.getByLabel('Title', { exact: true }).fill('The Clockmaker’s Daughter');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.locator('.novel-head__title')).toHaveText('The Clockmaker’s Daughter');
  await page.getByRole('tab', { name: 'About' }).click();
  await expect(page.getByRole('link', { name: 'Mystery' })).toBeVisible();

  // Favourite, status and collections.
  await page.getByRole('button', { name: 'Add to favourites' }).click();
  await expect(page.getByRole('button', { name: 'Remove from favourites' })).toBeVisible();
  await page.getByTestId('status-select').selectOption('on_hold');
  await page.getByRole('button', { name: 'Add to collection' }).click();
  await page.getByLabel('New collection').fill('Clockwork');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('checkbox', { name: /Clockwork/ })).toBeChecked();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.goto('/#/collections');
  await page.getByRole('link', { name: /Clockwork/ }).click();
  await expect(page.getByTestId('book-card')).toHaveCount(1);
  await page.goto('/#/library?fav=1');
  await expect(page.getByTestId('book-card')).toHaveText(/Clockmaker/);
});

/* ------------------------------------------------------------------ reading */

test('reads chapter by chapter with keyboard, buttons, taps and the chapter list', async ({ page }) => {
  await importFiles(page, ['christmas-carol-epub2.epub']);
  await startReading(page, 'A Christmas Carol (excerpt)');
  await expect(chapterTitle(page)).toHaveText('Stave I: Marley’s Ghost');
  await expect(page.getByTestId('chapter-text')).toContainText('Marley was dead');

  await page.keyboard.press('ArrowRight');
  await expect(chapterTitle(page)).toHaveText('Stave II: The First of the Three Spirits');
  await page.keyboard.press('ArrowLeft');
  await expect(chapterTitle(page)).toHaveText('Stave I: Marley’s Ghost');

  // Page down with the keyboard scrolls by about a screen.
  const before = await page.locator('.reader__scroll').evaluate((e) => e.scrollTop);
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.locator('.reader__scroll').evaluate((e) => e.scrollTop)).toBeGreaterThan(before + 300);

  // Tap the right edge to page forward (touch-style).
  const s1 = await page.locator('.reader__scroll').evaluate((e) => e.scrollTop);
  await page.mouse.click(1240, 400);
  await expect.poll(() => page.locator('.reader__scroll').evaluate((e) => e.scrollTop)).toBeGreaterThan(s1 + 300);

  // Next-chapter button at the end of the chapter.
  await page.locator('.reader__scroll').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await page.getByTestId('next-chapter').click();
  await expect(chapterTitle(page)).toHaveText('Stave II: The First of the Three Spirits');

  // Chapter list.
  await page.keyboard.press('t');
  await page.locator('.drawer-chapter', { hasText: 'Stave III' }).click();
  await expect(chapterTitle(page)).toHaveText('Stave III: The Last of the Spirits');
  await expect(page.getByText('You’ve reached the last chapter.')).toBeVisible();
  // Reading to the end of a chapter marks it as read.
  await page.locator('.reader__scroll').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await page.waitForTimeout(1200);

  // Escape leaves the reader.
  await page.keyboard.press('Escape');
  await expect(page.locator('.novel-head__title')).toBeVisible();
  // Stave I (finished by moving on) and Stave III (read to the end) are read; Stave II was skipped.
  await page.getByRole('tab', { name: /Chapters/ }).click();
  await expect(page.locator('.chapter-row.is-read .chapter-row__title')).toHaveText(['Stave I: Marley’s Ghost', 'Stave III: The Last of the Spirits']);
});

test('remembers the exact position and settings across a restart', async ({ page, context }) => {
  await importFiles(page, ['pride-and-prejudice-gutenberg.txt']);
  await startReading(page, 'Pride and Prejudice');
  await page.keyboard.press('ArrowRight');
  await expect(chapterTitle(page)).toHaveText('Chapter 2');

  // Change typography.
  await page.getByTestId('reader-settings-btn').click();
  await page.getByRole('radio', { name: 'Sepia' }).click();
  await page.getByRole('radio', { name: 'Literata' }).click();
  await page.getByRole('button', { name: 'Increase size' }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();

  // Scroll into the middle of the chapter and let it save.
  await page.locator('.reader__scroll').evaluate((e) => e.scrollTo(0, e.scrollHeight * 0.45));
  await page.waitForTimeout(1500);
  const where = await firstVisibleText(page);
  expect(where.length).toBeGreaterThan(10);

  const again = await restart(context, page);
  await expect(again.getByTestId('continue-lead')).toContainText('Pride and Prejudice');
  await expect(again.getByTestId('continue-lead')).toContainText('Chapter 2');
  await again.getByTestId('continue-lead').click();
  await expect(chapterTitle(again)).toHaveText('Chapter 2');
  await expect.poll(() => firstVisibleText(again)).toBe(where);
  await expect(again.getByTestId('reader')).toHaveAttribute('data-reader-theme', 'sepia');
  const style = await again.getByTestId('reader').getAttribute('style');
  expect(style).toContain('Literata');
  expect(style).toContain('--r-size: 21px');
});

test('keeps the same passage in view when the text size changes', async ({ page }) => {
  await importFiles(page, ['no-headings.txt']);
  await startReading(page, 'no-headings');
  await page.locator('.reader__scroll').evaluate((e) => e.scrollTo(0, e.scrollHeight * 0.5));
  await page.waitForTimeout(400);
  const where = await firstVisibleText(page);
  await page.keyboard.press('s');
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Increase size' }).click();
  await page.waitForTimeout(500);
  expect(await firstVisibleText(page)).toBe(where);
});

/* ------------------------------------------------------------------ annotations */

test('bookmarks, highlights and notes, browsable per novel', async ({ page, context }) => {
  await importFiles(page, ['alice-excerpt.epub']);
  await startReading(page, 'Alice’s Adventures in Wonderland (excerpt)');

  // Chapter bookmark.
  await page.getByRole('button', { name: 'Bookmark this chapter' }).click();
  await expect(page.getByRole('button', { name: 'Remove chapter bookmark' })).toBeVisible();

  // Highlight.
  await selectText(page, 0, 0, 39); // "Alice was beginning to get very tired o"
  await page.getByRole('button', { name: 'Highlight in Sage' }).click();
  await expect(page.locator('mark.hl.hl-sage')).toHaveText('Alice was beginning to get very tired o');

  // Note on another passage.
  await selectText(page, 1, 0, 30);
  await page.getByRole('button', { name: 'Note' }).click();
  await page.getByLabel('Your note').fill('Daisy-chains!');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('mark.hl.has-note')).toHaveCount(1);

  // Text bookmark.
  await selectText(page, 2, 0, 10);
  await page.getByRole('button', { name: 'Bookmark', exact: true }).click();
  await expect(page.locator('.has-bookmark')).toHaveCount(1);

  // Change a highlight's colour, then survive a restart.
  await page.locator('mark.hl-sage').click();
  await page.getByRole('button', { name: 'Change colour to Rose' }).click();
  await expect(page.locator('mark.hl.hl-rose')).toHaveCount(1);
  const again = await restart(context, page, page.url());
  await expect(again.locator('mark.hl.hl-rose')).toHaveCount(1);
  await expect(again.locator('mark.hl.has-note')).toHaveCount(1);

  // Browse them on the novel page.
  await again.keyboard.press('Escape');
  await again.getByRole('tab', { name: 'Bookmarks & notes' }).click();
  await expect(again.locator('.ann')).toHaveCount(4);
  await expect(again.getByText('Daisy-chains!')).toBeVisible();
  await again.getByRole('radio', { name: 'Highlights' }).click();
  await expect(again.locator('.ann')).toHaveCount(1);

  // Jump from a note into the reader.
  await again.getByRole('radio', { name: /All/ }).click();
  await again.locator('.ann--note .ann__open').click();
  await expect(again.locator('mark.is-flash')).toBeVisible();

  // Delete one.
  await again.keyboard.press('Escape');
  await again.getByRole('tab', { name: 'Bookmarks & notes' }).click();
  await again.locator('.ann--highlight').getByRole('button', { name: 'Delete' }).click();
  await expect(again.locator('.ann')).toHaveCount(3);
});

/* ------------------------------------------------------------------ search */

test('searches metadata and full text, and jumps to matches', async ({ page }) => {
  await importFiles(page, ['alice-excerpt.epub', 'christmas-carol-epub2.epub', 'pride-and-prejudice-gutenberg.txt']);
  await page.goto('/#/search');
  await page.getByTestId('search-input').fill('austen');
  await expect(page.getByTestId('book-row')).toHaveCount(1);
  await expect(page.getByTestId('book-row')).toContainText('Pride and Prejudice');
  await page.getByTestId('search-input').fill('ghost stor'); // genre, prefix
  await expect(page.getByTestId('book-row')).toContainText('Christmas Carol');

  await page.getByRole('radio', { name: 'Chapter text' }).click();
  await page.getByTestId('search-input').fill('Marley');
  await expect(page.getByTestId('text-hit')).toHaveCount(1);
  await expect(page.getByTestId('text-hit').locator('mark').first()).toHaveText('Marley');
  await page.getByTestId('text-hit').click();
  await expect(chapterTitle(page)).toHaveText('Stave I: Marley’s Ghost');
  await expect(page.locator('.reader__find')).toContainText('1 of 2');
  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(page.locator('.reader__find')).toContainText('2 of 2');

  // Within one novel.
  await page.keyboard.press('Escape'); // closes nothing (no panel) → leaves reader
  await page.getByRole('tab', { name: /Chapters/ }).click();
  await page.getByRole('radio', { name: 'Full text' }).click();
  await page.getByRole('textbox', { name: 'Search chapters' }).fill('Phantom');
  await expect(page.locator('.text-hit')).toHaveCount(1);
});

/* ------------------------------------------------------------------ deletion */

test('deletes a novel and everything that belongs to it', async ({ page }) => {
  await importFiles(page, ['christmas-carol-epub2.epub', 'alice-excerpt.epub']);
  await openNovel(page, 'A Christmas Carol (excerpt)');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete novel' }).click();
  await page.getByRole('button', { name: 'Delete novel' }).click();
  await expect(page.getByTestId('book-card')).toHaveCount(1);
  await page.goto('/#/search?q=Marley&in=text');
  await expect(page.getByText('No chapter contains “Marley”.')).toBeVisible();
});

/* ------------------------------------------------------------------ backup */

test('exports an encrypted backup and restores it', async ({ page }) => {
  await importFiles(page, ['alice-excerpt.epub', 'christmas-carol-epub2.epub']);
  await page.goto('/#/settings?s=backup');
  await page.getByTestId('backup-export').click();
  await page.getByTestId('backup-pass1').fill('copper lantern river');
  await page.getByTestId('backup-pass2').fill('copper lantern river');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByTestId('backup-confirm').click()]);
  expect(download.suggestedFilename()).toMatch(/^notavi-backup-.*\.notavi$/);
  const file = test.info().outputPath('backup.notavi');
  await download.saveAs(file);

  // Lose a novel, then restore.
  await openNovel(page, 'A Christmas Carol (excerpt)');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete novel' }).click();
  await page.getByRole('button', { name: 'Delete novel' }).click();
  await expect(page.getByTestId('book-card')).toHaveCount(1);

  await page.goto('/#/settings?s=backup');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('backup-restore').click()]);
  await chooser.setFiles(file);
  await expect(page.getByText('2 novels, 5 chapters', { exact: true })).toBeVisible();
  await page.getByTestId('restore-pass').fill('wrong passphrase');
  await page.getByTestId('restore-confirm').click();
  await expect(page.getByText(/Wrong passphrase/)).toBeVisible();
  await page.getByTestId('restore-pass').fill('copper lantern river');
  await page.getByTestId('restore-confirm').click();
  await expect(page.getByText('Restored 2 novels.')).toBeVisible();
  await page.goto('/#/library');
  await expect(page.getByTestId('book-card')).toHaveCount(2);
});

/* ------------------------------------------------------------------ app lock */

test('locks with a PIN, rejects wrong codes and unlocks', async ({ page, context }) => {
  await page.goto('/#/settings?s=security');
  await page.getByTestId('lock-setup').click();
  await page.getByTestId('lock-code1').fill('2468');
  await page.getByTestId('lock-code2').fill('2468');
  await page.getByTestId('lock-save').click();
  await expect(page.getByText('On, using a PIN.')).toBeVisible();

  const again = await restart(context, page);
  await expect(again.getByRole('heading', { name: 'Notavi is locked' })).toBeVisible();
  await expect(again.locator('.rail')).toHaveCount(0); // nothing behind the lock
  await again.getByTestId('unlock-input').fill('1111');
  await again.getByTestId('unlock-btn').click();
  await expect(again.getByText('Wrong PIN.')).toBeVisible();
  await again.getByTestId('unlock-input').fill('2468');
  await again.getByTestId('unlock-btn').click();
  await expect(again.getByRole('heading', { name: 'Your library is empty' })).toBeVisible();
});

/* ------------------------------------------------------------------ offline */

test('works offline once loaded', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // now controlled by the service worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await importFiles(page, ['alice-excerpt.epub']);
  await context.setOffline(true);
  await page.reload();
  await page.goto('/#/library');
  await expect(page.getByTestId('book-card')).toHaveCount(1);
  await startReading(page, 'Alice’s Adventures in Wonderland (excerpt)');
  await expect(page.getByTestId('chapter-text')).toContainText('White Rabbit');
  await context.setOffline(false);
});

/* ------------------------------------------------------------------ layout */

for (const vp of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet portrait', width: 800, height: 1280 },
  { name: 'tablet landscape', width: 1280, height: 800 },
  { name: 'desktop', width: 1920, height: 1080 },
]) {
  test(`has no horizontal overflow on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await importFiles(page, ['alice-excerpt.epub', 'scandal-in-bohemia.html']);
    for (const url of ['/#/', '/#/library', '/#/search', '/#/collections', '/#/stats', '/#/settings', '/#/import']) {
      await page.goto(url);
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, url).toBeLessThanOrEqual(0);
    }
    await openNovel(page, 'Alice’s Adventures in Wonderland (excerpt)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.getByTestId('start-reading').click();
    await expect(page.getByTestId('chapter-text')).toBeVisible();
    const text = await page.getByTestId('chapter-text').boundingBox();
    expect(text!.x).toBeGreaterThanOrEqual(0);
    expect(text!.x + text!.width).toBeLessThanOrEqual(vp.width);
    // Navigation: rail on wide screens, tab bar on phones.
    await page.goto('/#/');
    if (vp.width <= 760) await expect(page.locator('.tabbar')).toBeVisible();
    else await expect(page.locator('.rail')).toBeVisible();
  });
}
