import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
async function emptyOrigin(page: Page) {
  await page.route('**/draft-order-seed', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/draft-order-seed');
}
async function openDrafts(page: Page) {
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换到草稿', exact: true }).click();
}
const titles = (page: Page) =>
  page.locator('.draft-select strong').allTextContents();
test('draft storage sorts by immutable creation time, including deterministic ties', async ({
  page,
}) => {
  await emptyOrigin(page);
  const result = await page.evaluate(async () => {
    const s = await import('/src/storage.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const a = {
      ...s.newDraft('# 较早创建', DEFAULT_SETTINGS),
      id: 'a',
      createdAt: 100,
      savedAt: 900,
      version: 1,
    };
    const b = {
      ...s.newDraft('# 较晚创建', DEFAULT_SETTINGS),
      id: 'b',
      createdAt: 200,
      savedAt: 200,
      version: 1,
    };
    await s.saveDraft(a);
    await s.saveDraft(b);
    const before = (await s.loadDrafts()).drafts.map((d) => d.id);
    await s.saveDraft({ ...a, createdAt: 99999, savedAt: 99999, version: 2 });
    const after = await s.loadDrafts();
    const c = {
      ...s.newDraft('# 同时创建', DEFAULT_SETTINGS),
      id: 'c',
      createdAt: 200,
      savedAt: 0,
      version: 1,
    };
    await s.saveDraft(c);
    const ties = (await s.loadDrafts()).drafts.map((d) => d.id);
    await s.saveDraft({ ...b, savedAt: 999999, version: 2 });
    const stable = (await s.loadDrafts()).drafts.map((d) => d.id);
    return {
      before,
      after: after.drafts.map((d) => d.id),
      createdAt: after.drafts.find((d) => d.id === 'a')!.createdAt,
      ties,
      stable,
    };
  });
  expect(result).toEqual({
    before: ['b', 'a'],
    after: ['b', 'a'],
    createdAt: 100,
    ties: ['b', 'c', 'a'],
    stable: ['b', 'c', 'a'],
  });
});
test('draft sidebar keeps creation order after opening, editing, renaming, searching and refreshing', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => (window as any).__mojian.setMarkdown('# 第一篇'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await openDrafts(page);
  await page.getByRole('button', { name: '新建文章', exact: true }).click();
  await expect(page.locator('.draft-select')).toHaveCount(2);
  await page.evaluate(() => (window as any).__mojian.setMarkdown('# 第二篇'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => titles(page)).toEqual(['第二篇', '第一篇']);
  await page.locator('.draft-select').filter({ hasText: '第一篇' }).click();
  await expect(page.locator('.article-editor h1')).toHaveText('第一篇');
  expect(await titles(page)).toEqual(['第二篇', '第一篇']);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown('# 第一篇\n\n新修改的内容'),
  );
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  expect(await titles(page)).toEqual(['第二篇', '第一篇']);
  await page
    .getByRole('button', { name: '重命名 第一篇', exact: true })
    .click();
  await page.getByRole('textbox', { name: '文章标题' }).fill('第一篇改名');
  await page.getByRole('button', { name: '保存标题', exact: true }).click();
  await expect.poll(() => titles(page)).toEqual(['第二篇', '第一篇改名']);
  await page.getByRole('button', { name: '搜索草稿', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索草稿标题' }).fill('篇');
  expect(await titles(page)).toEqual(['第二篇', '第一篇改名']);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await openDrafts(page);
  expect(await titles(page)).toEqual(['第二篇', '第一篇改名']);
  await expect(page.locator('.article-editor')).toContainText('新修改的内容');
});
