import { test, expect } from './fixtures';

// These exercise browser-visible behavior and total work, not private caches.
test('ordinary prose edits do not rebuild code decorations; code edits update only their block', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__mojian?.editor);
  await page.evaluate(() => {
    const source = Array.from(
      { length: 12 },
      (_, i) => `const value${i} = "hello" + ${i};`,
    ).join('\n');
    window.__mojian!.setMarkdown(
      '正文\n\n' +
        Array.from({ length: 50 }, () => '```js\n' + source + '\n```').join(
          '\n\n',
        ),
    );
  });
  await expect(page.locator('.article-editor .hljs-keyword')).toHaveCount(600);
  await page.evaluate(async () => {
    const { Decoration } = await import('/tests/editorInspection.ts');
    const original = Decoration.inline;
    (window as any).__inlineCreated = 0;
    Decoration.inline = (...args) => {
      (window as any).__inlineCreated++;
      return original(...args);
    };
    const e = window.__mojian!.editor!;
    e.commands.setTextSelection(1);
    e.view.focus();
    e.commands.insertContent('x');
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).__inlineCreated)).toBe(0);
  await page.evaluate(() => {
    const e = window.__mojian!.editor!;
    let at = 0;
    e.state.doc.descendants((node, pos) => {
      if (!at && node.type.name === 'codeBlock') at = pos + 1;
    });
    e.commands.setTextSelection(at);
    e.commands.insertContent(' ');
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__inlineCreated))
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(() => (window as any).__inlineCreated),
  ).toBeLessThan(100);
  await expect(page.locator('.article-editor .hljs-keyword')).toHaveCount(600);
  await page.evaluate(() =>
    window.__mojian!.editor!.commands.toggleCodeBlock(),
  );
  await expect
    .poll(() => page.locator('.article-editor .hljs-keyword').count())
    .toBe(588);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor .hljs-keyword')).toHaveCount(600);
});

test('typing with 200 drafts does not repeatedly format every draft date', async ({
  page,
}) => {
  await page.route('**/review-seed', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/review-seed');
  await page.evaluate(async () => {
    const s = await import('/src/storage.ts'),
      { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    for (let i = 0; i < 200; i++)
      await s.saveDraft({
        ...s.newDraft('正文\n\n后文', DEFAULT_SETTINGS),
        id: 'draft-' + i,
        title: '草稿' + i,
        customTitle: true,
      });
  });
  await page.goto('/');
  await page.waitForFunction(() => !!window.__mojian?.editor);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换到草稿', exact: true }).click();
  await expect(page.locator('.draft-list > li')).toHaveCount(200);
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.evaluate(() => {
    (window as any).__dateWork = 0;
    const locale = Date.prototype.toLocaleString;
    Date.prototype.toLocaleString = function (
      ...args: Parameters<Date['toLocaleString']>
    ) {
      (window as any).__dateWork++;
      return locale.apply(this, args);
    };
    const format = Object.getOwnPropertyDescriptor(
      Intl.DateTimeFormat.prototype,
      'format',
    )!;
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', {
      ...format,
      get() {
        const call = format.get!.call(this);
        return (value: number) => {
          (window as any).__dateWork++;
          return call(value);
        };
      },
    });
  });
  await page.locator('.article-editor > p').first().click();
  await page.keyboard.type('abcdefghijklmnopqrst', { delay: 120 });
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  expect(await page.evaluate(() => (window as any).__dateWork)).toBeLessThan(8);
});

test('article parsing runs off the UI thread, aborts obsolete work, and retains nested structure', async ({
  page,
}) => {
  await page.route('**/review-parser', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/review-parser');
  const loads: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('articleParser.worker'))
      loads.push(request.url());
  });
  const result = await page.evaluate(async () => {
    const { parseArticleAsync } = await import('/src/articleParserClient.ts');
    const controller = new AbortController();
    const obsolete = parseArticleAsync(
      '旧稿'.repeat(100000),
      controller.signal,
    );
    controller.abort();
    let aborted = false;
    try {
      await obsolete;
    } catch (error) {
      aborted = (error as Error).name === 'AbortError';
    }
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    const parsed = await parseArticleAsync(
      '> ## 当前文章\n>\n> - 嵌套内容\n\n' + '正文段落\n\n'.repeat(12000),
    );
    clearInterval(timer);
    return {
      aborted,
      ticks,
      first: parsed.blocks[0],
      count: parsed.blocks.length,
    };
  });
  expect(result.aborted).toBe(true);
  expect(loads.length).toBeGreaterThan(0);
  expect(result.ticks).toBeGreaterThan(0);
  expect(result.first).toContain('<blockquote>');
  expect(result.first).toContain('<h2>当前文章</h2>');
  expect(result.count).toBe(12001);
});
