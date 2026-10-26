import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

async function seed(page: Page) {
  await page.route('**/reorder-seed', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/reorder-seed');
  await page.evaluate(async () => {
    const storage = await import('/src/storage.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    for (const [id, createdAt] of [
      ['A', 100],
      ['B', 200],
      ['C', 300],
    ] as const) {
      await storage.saveDraft({
        ...storage.newDraft(`# ${id}`, DEFAULT_SETTINGS),
        id,
        createdAt,
        version: 1,
      });
    }
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换到草稿', exact: true }).click();
}

const titles = (page: Page) => page.locator('.draft-select strong').allTextContents();
async function drag(page: Page, id: string, targetId: string) {
  const source = await page.locator(`[data-draft-id="${id}"] .draft-drag-handle`).boundingBox();
  const target = await page.locator(`[data-draft-id="${targetId}"]`).boundingBox();
  expect(source && target).toBeTruthy();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + 30, target!.y + target!.height - 3, { steps: 8 });
  await expect(page.locator(`[data-draft-id="${targetId}"]`)).toHaveClass(/drop-after/);
  await page.mouse.up();
}

test('drag order survives refresh; new drafts join the top without switching articles', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      errors.push(message.text());
  });
  await seed(page);
  await expect(page).toHaveTitle('墨笺 · Markdown 公众号排版');
  await expect(page.locator('.workspace')).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect.poll(() => titles(page)).toEqual(['C', 'B', 'A']);
  const handle = page.locator('[data-draft-id="C"] .draft-drag-handle');
  await expect(handle).toHaveAttribute('aria-hidden', 'true');
  expect(await handle.evaluate((node) => node.tabIndex)).toBe(-1);
  await page.locator('[data-draft-id="C"] .draft-select').focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => titles(page)).toEqual(['C', 'B', 'A']);
  await page.locator('[data-draft-id="C"] .draft-select').evaluate((node) => (node as HTMLElement).blur());
  await drag(page, 'C', 'A');
  await expect.poll(() => titles(page)).toEqual(['B', 'A', 'C']);
  await expect(page.locator('.article-editor h1')).toHaveText('C');
  await page.screenshot({ path: '/tmp/mojian-draft-reorder-desktop.png' });
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换到草稿', exact: true }).click();
  await expect.poll(() => titles(page)).toEqual(['B', 'A', 'C']);
  await page.locator('.draft-select').filter({ hasText: 'A' }).click();
  await expect(page.locator('.article-editor h1')).toHaveText('A');
  await page.evaluate(() => (window as any).__mojian.setMarkdown('# A\n\n修改后'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await expect.poll(() => titles(page)).toEqual(['B', 'A', 'C']);
  await page.getByRole('button', { name: '重命名 A', exact: true }).click();
  await page.getByRole('textbox', { name: '文章标题' }).fill('A 改名');
  await page.getByRole('button', { name: '保存标题', exact: true }).click();
  await expect.poll(() => titles(page)).toEqual(['B', 'A 改名', 'C']);
  await page.getByRole('button', { name: '新建文章', exact: true }).click();
  await expect.poll(() => titles(page)).toEqual(['未命名文章', 'B', 'A 改名', 'C']);
  await page.getByRole('button', { name: '搜索草稿', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索草稿标题' }).fill('A');
  await expect(page.getByText('清空搜索后可调整顺序')).toBeVisible();
  await expect(page.locator('[data-draft-id="A"] .draft-drag-handle')).toHaveAttribute('data-disabled', 'true');
  expect(errors).toEqual([]);
});

test('failed reorder keeps the original order and explains the failure', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'meta' && args[1] === 'draftOrder')
        throw new DOMException('quota', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await drag(page, 'C', 'A');
  await expect(page.locator('.toast')).toContainText('排序未保存，请重试');
  await expect.poll(() => titles(page)).toEqual(['C', 'B', 'A']);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换到草稿', exact: true }).click();
  await expect.poll(() => titles(page)).toEqual(['C', 'B', 'A']);
});

test('a failed list refresh does not misreport a saved move', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    let failed = false;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof transaction>) {
      if (!failed && args[1] !== 'readwrite' && Array.isArray(args[0]) && args[0].includes('draftInfo') && args[0].includes('meta')) {
        failed = true;
        (window as any).__reorderReadFailed = true;
        throw new DOMException('read failure', 'UnknownError');
      }
      return transaction.apply(this, args);
    };
  });
  await drag(page, 'C', 'A');
  await expect.poll(() => titles(page)).toEqual(['B', 'A', 'C']);
  await page.waitForFunction(() => (window as any).__reorderReadFailed);
  await expect.poll(() => page.evaluate(async () => (await (await import('/src/storage.ts')).loadDraftLibrary()).drafts.map((item) => item.id))).toEqual(['B', 'A', 'C']);
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(page.locator('.article-editor h1')).toHaveText('C');
});

test('touch handle reorders after a long press', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await seed(page);
    const source = await page.locator('[data-draft-id="C"] .draft-drag-handle').boundingBox();
    const target = await page.locator('.draft-list li').filter({ hasText: 'A' }).boundingBox();
    expect(source && target).toBeTruthy();
    const client = await context.newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: source!.x + source!.width / 2, y: source!.y + source!.height / 2 }],
    });
    await expect(page.locator('.draft-list li').filter({ hasText: 'C' })).toHaveClass(/dragging/, { timeout: 1000 });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: target!.x + 30, y: target!.y + target!.height - 3 }],
    });
    await expect(page.locator('.draft-list li').filter({ hasText: 'A' })).toHaveClass(/drop-after/);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => titles(page)).toEqual(['B', 'A', 'C']);
    await page.screenshot({ path: '/tmp/mojian-draft-reorder-mobile.png' });
  } finally {
    await context.close();
  }
});

test('dragging near the list edge scrolls long draft libraries', async ({ page }) => {
  await seed(page);
  await page.evaluate(async () => {
    const storage = await import('/src/storage.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    for (let index = 0; index < 28; index++)
      await storage.saveDraft({
        ...storage.newDraft(`# 草稿 ${index}`, DEFAULT_SETTINGS),
        id: `extra-${index}`,
        createdAt: 301 + index,
        version: 1,
      });
  });
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换到草稿', exact: true }).click();
  const handle = await page.locator('[data-draft-id="extra-27"] .draft-drag-handle').boundingBox();
  const scroll = await page.locator('.sidebar-draft-scroll').boundingBox();
  expect(handle && scroll).toBeTruthy();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(scroll!.x + 60, scroll!.y + scroll!.height - 12, { steps: 8 });
  await expect.poll(() => page.locator('.sidebar-draft-scroll').evaluate((node) => node.scrollTop)).toBeGreaterThan(50);
  await page.mouse.up();
  await expect.poll(() => titles(page).then((items) => items[0])).not.toBe('草稿 27');
});

test('stored order reconciles new and deleted drafts across tabs', async ({ page }) => {
  await seed(page);
  const result = await page.evaluate(async () => {
    const storage = await import('/src/storage.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    await storage.moveDraft('C', 'A', 'after');
    const first = (await storage.loadDraftLibrary()).drafts.map((item) => item.id);
    await storage.saveDraft({
      ...storage.newDraft('# D', DEFAULT_SETTINGS),
      id: 'D',
    });
    const added = (await storage.loadDraftLibrary()).drafts.map((item) => item.id);
    await storage.moveDraft('B', 'C', 'after');
    const moved = (await storage.loadDraftLibrary()).drafts.map((item) => item.id);
    await storage.removeDraft('A', (await storage.loadDraft('D'))!);
    const deleted = (await storage.loadDraftLibrary()).drafts.map((item) => item.id);
    return { first, added, moved, deleted };
  });
  expect(result).toEqual({
    first: ['B', 'A', 'C'],
    added: ['D', 'B', 'A', 'C'],
    moved: ['D', 'A', 'C', 'B'],
    deleted: ['D', 'C', 'B'],
  });
});
