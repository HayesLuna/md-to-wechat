import { test, expect } from './fixtures';

test('heading tabs do not leak into outline labels, draft titles or export names', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    (window as any).__mojian.setMarkdown('# 标题\n\n## 小节');
    e.commands.setTextSelection(1);
    e.commands.focus();
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await expect(page.locator('.sidebar-outline>button')).toHaveText([
    '标题',
    '小节',
  ]);
  await page.locator('.sidebar-outline>button').first().click();
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.getByRole('button', { name: '切换到草稿' }).click();
  await expect(page.locator('.draft-select strong')).toHaveText('标题');
  await page.getByRole('button', { name: '搜索草稿' }).click();
  await page.getByRole('textbox', { name: '搜索草稿标题' }).fill('标题');
  await expect(page.locator('.draft-list li')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '导出 Markdown', exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe('标题.md');
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  expect(await page.locator('.article-editor h1').textContent()).toBe('\t标题');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await expect(page.locator('.sidebar-outline>button')).toHaveText([
    '标题',
    '小节',
  ]);
  await page.getByRole('button', { name: '切换到草稿' }).click();
  await expect(page.locator('.draft-select strong')).toHaveText('标题');
});

test('formatted heading labels use visible text and ignore headings inside fences', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown(
      '```md\n# 假标题\n```\n\n# &#9;**真实标题** [链接](https://example.com) `代码`&#9;\n\n## 字面 &amp;#9;\n\n正文',
    ),
  );
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await expect(page.locator('.sidebar-outline>button')).toHaveText([
    '真实标题 链接 代码',
    '字面 &#9;',
  ]);
  await page.locator('.sidebar-outline>button').last().click();
  expect(
    await page.evaluate(
      () =>
        (window as any).__mojian.editor.state.selection.$from.parent
          .textContent,
    ),
  ).toBe('字面 &#9;');
  await page.getByRole('button', { name: '切换到草稿' }).click();
  await expect(page.locator('.draft-select strong')).toHaveText(
    '真实标题 链接 代码',
  );
  await page
    .getByRole('button', { name: '重命名 真实标题 链接 代码', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: '文章标题' })
    .fill('自定义 &#9; 名称');
  await page.getByRole('button', { name: '保存标题', exact: true }).click();
  await expect(page.locator('.draft-select strong')).toHaveText(
    '自定义 &#9; 名称',
  );
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换到草稿' }).click();
  await expect(page.locator('.draft-select strong')).toHaveText(
    '自定义 &#9; 名称',
  );
});

test('loading existing automatic draft labels repairs escaped tabs without changing Markdown', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown('# &#9;旧标题'),
  );
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mojian-v1', 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = database.transaction('draft', 'readwrite');
    const store = tx.objectStore('draft');
    await new Promise<void>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const draft = request.result[0];
        store.put({ ...draft, title: '&#9;旧标题' }, draft.id);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  expect(await page.locator('.article-editor h1').textContent()).toBe(
    '\t旧标题',
  );
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换到草稿' }).click();
  await expect(page.locator('.draft-select strong')).toHaveText('旧标题');
});

test('hovering an editor heading shows its level without changing the text', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown(
      '# 一级\n\n## 二级\n\n### 三级\n\n#### 四级\n\n##### 五级\n\n###### 六级',
    ),
  );
  const level = (selector: string) =>
    page.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element, '::before');
      return {
        content: style.content,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        paddingBottom: style.paddingBottom,
        transitionDuration: style.transitionDuration,
      };
    });
  expect(await level('.article-editor h1')).toEqual({
    content: '"H1" / ""',
    opacity: '0',
    pointerEvents: 'none',
    paddingBottom: '8px',
    transitionDuration: '0.12s',
  });
  await expect(page.locator('.article-editor h1')).toHaveAccessibleName('一级');
  for (const [tag, label, text] of [
    ['h1', 'H1', '一级'],
    ['h2', 'H2', '二级'],
    ['h3', 'H3', '三级'],
    ['h4', 'H4', '四级'],
    ['h5', 'H5', '五级'],
    ['h6', 'H6', '六级'],
  ] as const) {
    const selector = `.article-editor ${tag}`;
    await page.locator(selector).hover();
    await expect
      .poll(() => level(selector))
      .toEqual({
        content: `"${label}" / ""`,
        opacity: '1',
        pointerEvents: 'none',
        paddingBottom: '8px',
        transitionDuration: '0.12s',
      });
    await expect(page.locator(selector)).toHaveText(text);
    await expect(page.locator(selector)).toHaveAccessibleName(text);
  }
  expect(await level('.article-editor h1')).toMatchObject({ opacity: '0' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => level('.article-editor h2'))
    .toMatchObject({
      transitionDuration: '0s',
    });
});
