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

  // Escape leaves the reader, and progress isn't lost on the way out.
  await page.keyboard.press('Escape');
  await expect(page.locator('.novel-head__title')).toBeVisible();
  await expect(page.locator('.novel-head__progress')).toContainText('100% read');
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
  await page.getByTestId('highlight-btn').click();
  await expect(page.locator('mark.hl.hl-amber')).toHaveText('Alice was beginning to get very tired o');
  // Colour is changed from the highlight itself, and remembered for the next one.
  await page.locator('mark.hl').first().click();
  await page.getByRole('button', { name: 'Change colour to Sage' }).click();
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
  await page.keyboard.press('Escape'); // closes the find bar
  await expect(page.locator('.reader__find')).toHaveCount(0);
  await page.keyboard.press('Escape'); // nothing else open → leaves the reader
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
  await expect(again.getByRole('heading', { name: 'Locked' })).toBeVisible();
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

/* ------------------------------------------------------------------ web-novel layout */

test('combines ebook volumes into one web-novel chapter list', async ({ page }) => {
  await page.goto('/#/import');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('choose-files').click()]);
  // Picked in the "wrong" order on purpose: volumes are sorted by number.
  await chooser.setFiles(['fixtures/series/lantern-road-vol-2.epub', 'fixtures/series/lantern-road-vol-1.epub']);
  await expect(page.locator('.import-item--ready')).toHaveCount(2);
  await page.getByTestId('combine').click();
  await expect(page.locator('.import-item--ready')).toHaveCount(1);
  await expect(page.locator('.volume-order__name')).toHaveText(['The Lantern Road, Volume 1', 'The Lantern Road, Volume 2']);
  await expect(page.getByTestId('audit-ok')).toContainText('words accounted for');
  await expect(page.locator('.plan-summary')).toContainText('6 chapters');
  await expect(page.locator('.plan-summary')).toContainText('Kept for the book format only: Title Page, Copyright, About the Author, Copyright');
  await expect(page.locator('.import-item__fields input').first()).toHaveValue('The Lantern Road');

  // Bring "About the Author" back and rename a chapter in the review.
  await page.getByTestId('review-chapters').click();
  await page.getByRole('checkbox', { name: 'Include About the Author in the web novel' }).check();
  await page.getByRole('textbox', { name: 'Title for Chapter Three' }).fill('Chapter 3: Cinders');
  await page.getByTestId('plan-apply').click();
  await expect(page.locator('.plan-summary')).toContainText('Kept for the book format only: Title Page, Copyright, Copyright');

  await page.getByTestId('import-one').click();
  await page.getByRole('link', { name: /Open “The Lantern Road”/ }).click();
  await page.getByRole('tab', { name: /Chapters/ }).click();
  await expect(page.locator('.chapter-row:not(.is-book-only) .chapter-row__title')).toHaveText([
    'Prologue',
    'Chapter 1',
    'Chapter 2: The Gate',
    'Chapter 3: Cinders',
    'Chapter 4: Ember',
    'Afterword',
    'About the Author',
    'Chapter 5: New Dawn',
    'Side Story: The Ferryman',
    'Chapter 6: Old Debts',
  ]);

  // The opener page and the split file were re-joined into whole chapters.
  await page.locator('.chapter-row__link', { hasText: 'Chapter 1' }).first().click();
  await expect(page.locator('.chapter-head__title')).toHaveText('Chapter 1');
  await expect(page.getByTestId('chapter-text').locator('p')).toHaveCount(10);
});

test('adds a later volume to the end of an existing novel, continuing the numbering', async ({ page }) => {
  await importFiles(page, ['series/lantern-road-vol-1.epub']);
  await page.goto('/#/import');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('choose-files').click()]);
  await chooser.setFiles(['fixtures/series/lantern-road-vol-2.epub']);
  await page.getByTestId('import-target').selectOption({ label: 'The end of “The Lantern Road, Volume 1”' });
  await expect(page.getByTestId('import-one')).toHaveText('Add 3 chapters');
  await page.getByTestId('import-one').click();
  await expect(page.getByText('Added 3 chapters.')).toBeVisible();
  await openNovel(page, 'The Lantern Road, Volume 1');
  await page.getByRole('tab', { name: /Chapters/ }).click();
  await expect(page.locator('.chapter-row:not(.is-book-only) .chapter-row__title').last()).toHaveText('Chapter 6: Old Debts');
  await expect(page.locator('.chapter-row:not(.is-book-only) .chapter-row__title').nth(6)).toHaveText('Chapter 5: New Dawn');
});

test('pastes several chapters at once and splits them at their headings', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByLabel('Title', { exact: true }).fill('The Ferry');
  await page.getByRole('button', { name: 'Add novel' }).click();
  await page.getByRole('tab', { name: /Chapters/ }).click();
  await page.getByRole('button', { name: 'Paste chapters' }).click();
  const text = (await import('node:fs')).readFileSync('fixtures/series/pasted-chapters.txt', 'utf8');
  await page.getByTestId('paste-text').fill(text);
  await page.getByTestId('paste-next').click();
  await expect(page.getByTestId('audit-ok')).toBeVisible();
  await expect(page.getByTestId('paste-add')).toHaveText('Add 3 chapters');
  await page.getByTestId('paste-add').click();
  await expect(page.locator('.chapter-row__title')).toHaveText(['Chapter 7: The Ferry', 'Chapter 8: Low Tide', 'Chapter 9: The Lighthouse Keeper']);
});

/* ------------------------------------------------------------------ 1.1: opening, reader extras */

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('opens with the Notavi splash, then hands over to the app', async ({ page }) => {
    await page.goto('/');
    const splash = page.locator('#splash');
    await expect(splash).toBeVisible();
    await expect(splash.locator('svg')).toHaveCount(1);
    await expect(splash).toHaveCount(0, { timeout: 8000 });
    await expect(page.locator('.rail')).toBeVisible();
  });
});

test('finds words inside the chapter from the reader', async ({ page }) => {
  await importFiles(page, ['christmas-carol-epub2.epub']);
  await startReading(page, 'A Christmas Carol (excerpt)');
  await page.keyboard.press('/');
  await expect(page.getByTestId('find-input')).toBeFocused();
  await page.getByTestId('find-input').fill('Marley');
  await expect(page.locator('.reader__find-count')).toHaveText(/^1 of \d+$/);
  const total = Number((await page.locator('.reader__find-count').textContent())!.split(' of ')[1]);
  await expect(page.locator('mark.find')).not.toHaveCount(0);
  await page.getByTestId('find-input').press('Enter');
  await expect(page.locator('.reader__find-count')).toHaveText(total > 1 ? `2 of ${total}` : `1 of ${total}`);
  await page.getByTestId('find-input').fill('zzqqxx');
  await expect(page.locator('.reader__find-count')).toHaveText('No matches');
  await page.getByTestId('find-input').press('Escape');
  await expect(page.locator('.reader__find')).toHaveCount(0);
  await expect(page.locator('mark.find')).toHaveCount(0);
  await expect(page.getByTestId('reader')).toBeVisible(); // Escape in the box only closed the box
});

test('reads aloud sentence by sentence and carries on into the next chapter', async ({ page, context }) => {
  // A stand-in voice: the real ones aren't available to headless browsers.
  await context.addInitScript(() => {
    const spoken: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
    let timer: ReturnType<typeof setTimeout> | undefined;
    class Utterance {
      onend: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      rate = 1;
      voice = null;
      lang = '';
      constructor(public text: string) {}
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [{ voiceURI: 'test-gb', name: 'Test', lang: 'en-GB', localService: true, default: true }],
        addEventListener() {},
        speak(u: Utterance) {
          spoken.push(u.text);
          timer = setTimeout(() => u.onend?.({}), 4);
        },
        cancel() {
          clearTimeout(timer);
        },
      },
    });
  });
  await importFiles(page, ['christmas-carol-epub2.epub']);
  await startReading(page, 'A Christmas Carol (excerpt)');
  const first = await chapterTitle(page).textContent();
  await page.getByTestId('listen-btn').click();
  await expect(page.getByTestId('speech-dock')).toBeVisible();
  const spoken = () => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
  await expect.poll(async () => (await spoken()).length).toBeGreaterThan(3);
  expect((await spoken())[0]).toBe(first); // starts with the chapter title
  expect((await spoken())[1]).not.toContain('\n');
  // At the end of the chapter it moves on and keeps reading.
  await expect(chapterTitle(page)).not.toHaveText(first!, { timeout: 20000 });
  const second = await chapterTitle(page).textContent();
  await expect.poll(async () => (await spoken()).includes(second!)).toBe(true);
  await page.getByRole('button', { name: 'Stop reading aloud' }).first().click();
  await expect(page.getByTestId('speech-dock')).toHaveCount(0);
});

test('auto-scrolls, and dims and warms the page', async ({ page }) => {
  await importFiles(page, ['no-headings.txt']);
  await startReading(page, 'no-headings');
  await page.getByTestId('autoscroll-btn').click();
  await expect(page.getByTestId('scroll-dock')).toBeVisible();
  const top = () => page.locator('.reader__scroll').evaluate((e) => e.scrollTop);
  await expect.poll(top, { timeout: 5000 }).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Pause auto-scroll' }).click();
  const paused = await top();
  await page.waitForTimeout(500);
  expect(await top()).toBe(paused);
  await page.getByTestId('scroll-dock').getByRole('button', { name: 'Stop auto-scroll' }).click();
  await expect(page.getByTestId('scroll-dock')).toHaveCount(0);

  await expect(page.getByTestId('reader-filter')).toHaveCount(0);
  await page.keyboard.press('s');
  await page.getByRole('button', { name: 'Increase dim the page' }).click();
  await page.getByRole('button', { name: 'Increase warmth' }).click();
  const filter = page.getByTestId('reader-filter');
  await expect(filter).toBeVisible();
  expect(await filter.getAttribute('style')).toContain('--dim: 0.05');
  expect(await filter.getAttribute('style')).toContain('--warm: 0.1');
});

test('rates novels, and Home shows the daily goal and a highlight to revisit', async ({ page, context }) => {
  await importFiles(page, ['alice-excerpt.epub', 'christmas-carol-epub2.epub']);
  await openNovel(page, 'A Christmas Carol (excerpt)');
  await page.getByRole('radio', { name: '4 stars' }).click();
  await expect(page.getByTestId('stars')).toContainText('Really liked it');
  await page.getByRole('radio', { name: '4 stars' }).click(); // tapping it again clears it
  await expect(page.getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('radio', { name: '5 stars' }).click();

  await page.goto('/#/library?sort=rating');
  await expect(page.getByTestId('book-card').first()).toContainText('A Christmas Carol');
  await expect(page.getByTestId('book-card').first().getByLabel('Rated 5 out of 5')).toBeVisible();

  await page.goto('/#/');
  await expect(page.getByTestId('goal')).toContainText('of 20 minutes today');
  await expect(page.getByTestId('revisit')).toHaveCount(0);

  await startReading(page, 'Alice’s Adventures in Wonderland (excerpt)');
  await selectText(page, 0, 0, 39);
  await page.getByTestId('highlight-btn').click();
  await expect(page.locator('mark.hl')).toBeVisible();

  const home = await restart(context, page, '/#/');
  await expect(home.getByTestId('revisit')).toContainText('Alice was beginning to get very tired o');
  await home.getByTestId('revisit').click();
  await expect(home.locator('mark.is-flash')).toBeVisible();
  await expect(home.getByTestId('reader')).toBeVisible();

  // The goal can be changed or switched off.
  await home.goto('/#/settings');
  for (let i = 0; i < 4; i++) await home.getByRole('button', { name: 'Decrease daily reading goal' }).click();
  await home.goto('/#/');
  await expect(home.getByTestId('goal')).toHaveCount(0);
  await expect(home.getByTestId('revisit')).toBeVisible();
});

test.describe('book format on a phone-sized screen', () => {
test.use({ viewport: { width: 390, height: 844 } });
test('reads an ebook as a book with pages, and switches to web novel and back without losing the place', async ({ page }) => {
  await importFiles(page, ['series/lantern-road-vol-1.epub']);
  await openNovel(page, 'The Lantern Road, Volume 1');
  // As a web novel the title page and copyright are kept, but only for the book.
  await page.getByRole('tab', { name: /Chapters/ }).click();
  await expect(page.locator('.chapter-row.is-book-only').first()).toContainText('In the book only');
  const webCount = await page.locator('.chapter-row:not(.is-book-only)').count();

  await page.getByRole('radio', { name: /Book/ }).click();
  await expect(page.locator('.chapter-row.is-book-only')).toHaveCount(0);
  expect(await page.locator('.chapter-row').count()).toBeGreaterThan(webCount);

  await page.getByTestId('start-reading').click();
  const reader = page.getByTestId('reader');
  await expect(reader).toHaveClass(/reader--book/);
  await expect(page.locator('.book-cover-page')).toBeVisible(); // the cover is the first page
  const folio = page.getByTestId('book-folio');
  await expect(folio).toContainText(/^1/);

  // Turn pages until we're inside the Prologue, a few pages in.
  for (let i = 0; i < 12; i++) {
    if ((await page.locator('.reader__chapter').textContent())?.includes('Prologue') && (await folio.textContent())!.startsWith('2 ')) break;
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(80);
  }
  await expect(page.locator('.reader__chapter')).toHaveText('Prologue');
  // The page actually moved: the flow is shifted by whole screens.
  const shift = await page.getByTestId('reader-page').evaluate((el) => getComputedStyle(el).getPropertyValue('--page'));
  expect(Number(shift)).toBeGreaterThan(0);
  const bookFirst = await page.evaluate(() => {
    const flow = document.querySelector('[data-testid=reader-page]')!;
    const ps = Array.from(document.querySelectorAll('[data-testid=chapter-text] p'));
    const vw = window.innerWidth;
    return ps.find((p) => Array.from(p.getClientRects()).some((r) => r.left >= 0 && r.left < vw))?.textContent?.slice(0, 40) ?? '';
    void flow;
  });

  // Switch to web novel from the reader: same chapter, same passage on screen.
  await page.keyboard.press('s');
  await page.getByTestId('format-web').click();
  await expect(reader).not.toHaveClass(/reader--book/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.chapter-head__title')).toHaveText('Prologue');
  await expect.poll(async () => (await firstVisibleText(page)).slice(0, 40)).toBe(bookFirst);

  // …and back to the book, on the same page.
  await page.keyboard.press('s');
  await page.getByTestId('format-book').click();
  await expect(reader).toHaveClass(/reader--book/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.reader__chapter')).toHaveText('Prologue');
  const again = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('[data-testid=chapter-text] p'));
    const vw = window.innerWidth;
    return ps.find((p) => Array.from(p.getClientRects()).some((r) => r.left >= 0 && r.left < vw))?.textContent?.slice(0, 40) ?? '';
  });
  expect(again).toBe(bookFirst);

  // The page is remembered.
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1200);
  const onPage = () =>
    page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('[data-testid=chapter-text] p'));
      const vw = window.innerWidth;
      return ps.find((p) => Array.from(p.getClientRects()).some((r) => r.left >= 0 && r.left < vw))?.textContent?.slice(0, 40) ?? '';
    });
  const remembered = await onPage();
  await page.reload();
  await expect(reader).toHaveClass(/reader--book/);
  await expect.poll(onPage).toBe(remembered);

  // Turning back past the first page goes to the previous section's last page.
  for (let i = 0; i < 12 && (await page.locator('.reader__chapter').textContent()) === 'Prologue'; i++) await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.reader__chapter')).not.toHaveText('Prologue');
});
});

/* ------------------------------------------------------------------ Lore */

async function readUpTo(page: Page, target: string) {
  for (let i = 0; i < 10 && (await chapterTitle_(page)) !== target; i++) {
    await page.keyboard.press('n');
    await page.waitForTimeout(250);
  }
  await expect(chapterTitle(page)).toHaveText(target);
  await page.waitForTimeout(900); // progress is saved
}
const chapterTitle_ = (page: Page) => page.locator('.chapter-head__title').textContent();

/** Click the middle of the first occurrence of `word` in the middle of the page (not a page-turn zone). */
async function tapWord(page: Page, word: string) {
  const pt = await page.evaluate((w) => {
    const walker = document.createTreeWalker(document.querySelector('[data-testid=chapter-text]')!, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      let i = n.textContent!.indexOf(w);
      while (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i + 1);
        r.setEnd(n, i + 2);
        const b = r.getBoundingClientRect();
        if (b.left > innerWidth * 0.3 && b.right < innerWidth * 0.7 && b.top > 120 && b.bottom < innerHeight - 120) return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        i = n.textContent!.indexOf(w, i + 1);
      }
    }
    return null;
  }, word);
  expect(pt, `"${word}" visible in the middle of the page`).not.toBeNull();
  await page.mouse.click(pt!.x, pt!.y);
}

test('Lore: a spoiler-free encyclopaedia built from what you have read', async ({ page }) => {
  await importFiles(page, ['lore-saga.txt']);
  await startReading(page, 'lore-saga');
  await readUpTo(page, 'Chapter 3: Greywater');

  // Tap a name while reading: what the book has said so far and where it came up before.
  await page.waitForTimeout(1500); // Lore builds in the background
  await tapWord(page, 'Orsk');
  const card = page.getByTestId('lore-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Orsk');
  await expect(card).toContainText(/a broad man with a lantern/i);
  await expect(card.getByTestId('lore-definition')).toContainText('First appears in Chapter 1');
  await expect(card).toContainText('Previously');
  await expect(card).not.toContainText('Seraphine');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);

  // The Lore section: index view.
  await page.goto('/#/lore');
  await expect(page.getByTestId('lore')).toBeVisible();
  await expect(page.locator('.lore-head__upto')).toContainText('Chapter 3: Greywater');
  await page.getByRole('radio', { name: 'Index' }).click();
  await page.getByTestId('lore-cat-character').click();
  const items = page.getByTestId('lore-item');
  await expect(items.first()).toBeVisible();
  const names = await items.locator('.lore-item__name').allTextContents();
  expect(names).toEqual(expect.arrayContaining(['Mira Valen', 'Orsk', 'Doran Kett']));
  expect(names).not.toContain('Seraphine Vale'); // only appears later
  await items.filter({ hasText: 'Doran Kett' }).click();
  const note = page.getByTestId('lore-note');
  await expect(note.getByTestId('lore-definition')).toContainText('The master of the Tidewatch Guild.');
  await expect(note).toContainText('Most often alongside');
  await expect(note).toContainText('Chapter 2: The Guild');
  await page.getByTestId('lore-note-box').fill('Knows more than he says.');
  await expect(note).toContainText('Saved');
  await page.reload();
  await expect(page.getByTestId('lore-note-box')).toHaveValue('Knows more than he says.');

  // Graph view (the default) draws the map.
  await page.getByRole('radio', { name: 'Graph' }).click();
  await expect(page.getByTestId('lore-graph')).toBeVisible();
  await expect(page.getByTestId('lore-note')).toBeVisible(); // the selected entry opens beside it
});

test('stats live in Settings now', async ({ page }) => {
  await page.goto('/#/stats');
  await expect(page).toHaveURL(/#\/settings\?s=stats/);
  await expect(page.getByRole('heading', { name: 'Your reading' })).toBeVisible();
  await expect(page.locator('.rail').getByText('Lore')).toBeVisible();
  await expect(page.locator('.rail').getByText('Stats')).toHaveCount(0);
});
