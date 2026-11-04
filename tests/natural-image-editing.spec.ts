import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
const markdown = (percent = 35) =>
  `前文\n\n![图片](https://example.test/natural.svg "width=${percent}%")\n\n后文`;
async function ready(page: Page, percent = 35) {
  await page.route('**/natural.svg', (r) =>
    r.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#96b5cd"/></svg>',
    }),
  );
  await page.goto('/');
  await page.waitForFunction(() => !!window.__mojian?.editor);
  await page.evaluate(
    (text) => window.__mojian!.setMarkdown(text),
    markdown(percent),
  );
  await expect(page.locator('.image-box img')).toBeVisible();
}
async function side(page: Page, edge: 'left' | 'right') {
  // An oversized image must expose its right edge before clicking outside it.
  await page.locator('.image-scroll').evaluate((el, edge) => {
    el.scrollLeft = edge === 'right' ? el.scrollWidth : 0;
  }, edge);
  const box = (await page.locator('.image-box').boundingBox())!,
    surface = (await page.locator('.writing-scroll').boundingBox())!;
  const x =
    edge === 'left'
      ? box.x - 8
      : Math.min(box.x + box.width + 8, surface.x + surface.width - 2);
  await page.mouse.click(x, box.y + box.height / 2);
  // When the image fills the viewport there is no right-hand blank space.
  // Clicking its visible pixels selects the image; native ArrowRight exits it.
  if (edge === 'right' && x < box.x + box.width) {
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__mojian!.editor!.state.selection.toJSON().type,
        ),
      )
      .toBe('node');
    await page.keyboard.press('ArrowRight');
  }
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__mojian!.editor!.state.selection.toJSON().type,
      ),
    )
    .toBe('text');
}
async function nativeCaret(page: Page) {
  await expect(page.locator('.article-editor')).toBeFocused();
  await expect(page.locator('.article-editor')).toHaveCSS(
    'caret-color',
    'rgb(37, 37, 40)',
  );
  await expect(
    page.locator('.inline-image-side-cursor,.block-side-cursor'),
  ).toHaveCount(0);

  await expect(
    page.locator(
      '.image-caret-anchor,.image-left-caret-line,.safari-text-caret',
    ),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selection = getSelection();
        return (
          !!selection?.isCollapsed &&
          !!selection.rangeCount &&
          window.__mojian!.editor!.state.selection.empty
        );
      }),
    )
    .toBe(true);
}
for (const [width, percent] of [
  [1440, 35],
  [390, 1],
  [390, 100],
  [390, 150],
] as const)
  test(`natural image input and deletion share the native text caret at ${width}px/${percent}%`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await ready(page, percent);
    await expect(page.locator('.image-scroll')).toHaveCSS('display', 'block');
    if (percent > 100) {
      const scroll = await page.locator('.image-scroll').evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
        const result = {
          viewport: el.clientWidth,
          content: el.scrollWidth,
          moved: el.scrollLeft,
        };
        el.scrollLeft = 0;
        return result;
      });
      expect(scroll.viewport).toBeGreaterThan(0);
      expect(scroll.content).toBeGreaterThan(scroll.viewport);
      expect(scroll.moved).toBeGreaterThan(0);
    }
    const original = await page.evaluate(() =>
      window.__mojian!.editor!.getJSON(),
    );
    expect(original.content![1]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'inlineImage' }],
    });
    await side(page, 'right');
    await nativeCaret(page);
    await page.keyboard.insertText('文字内容');
    expect(await page.evaluate(() => window.__mojian!.getMarkdown())).toContain(
      '文字内容',
    );
    for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
    await nativeCaret(page);
    expect(
      await page.evaluate(() => window.__mojian!.editor!.getJSON()),
    ).toEqual(original);
    await side(page, 'left');
    await nativeCaret(page);
    await page.keyboard.insertText('前文');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await nativeCaret(page);
    expect(
      await page.evaluate(() => window.__mojian!.editor!.getJSON()),
    ).toEqual(original);
    const before = (await page.locator('.image-box').boundingBox())!;
    await side(page, 'left');
    await expect(page.locator('.article-editor')).toBeFocused();
    await page.keyboard.press('Tab');
    await nativeCaret(page);
    expect(await page.evaluate(() => window.__mojian!.getMarkdown())).toMatch(
      /(?:\t|&#9;)!\[/,
    );
    expect(
      await page.evaluate(() =>
        window.__mojian!.editor!.getJSON().content![1].content!.at(-1),
      ),
    ).toMatchObject({ type: 'inlineImage', attrs: { indent: 0 } });
    expect((await page.locator('.image-box').boundingBox())!.width).toBeCloseTo(
      before.width,
      1,
    );
    await page.keyboard.press('Backspace');
    await nativeCaret(page);
    await page.keyboard.insertText('前面的文字');
    const raw = await page.evaluate(() => window.__mojian!.getMarkdown());
    expect(raw).toContain('前面的文字![');
    expect(raw).not.toMatch(/[\u200b\ufeff]/);
    await page.keyboard.press('ControlOrMeta+z');
  });
for (const edge of ['left', 'right'] as const)
  test(`native image ${edge} boundary supports composition, Enter and deletion without changing node type`, async ({
    page,
    context,
  }) => {
    await ready(page);
    await side(page, edge);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.imeSetComposition', {
      text: '中文',
      selectionStart: 2,
      selectionEnd: 2,
    });
    await cdp.send('Input.insertText', { text: '中文' });
    await expect
      .poll(() => page.evaluate(() => window.__mojian!.getMarkdown()))
      .toContain('中文');
    const raw = await page.evaluate(() => window.__mojian!.getMarkdown());
    expect(raw).not.toMatch(/[\u200b\ufeff]/);
    await page.evaluate(
      (text) => window.__mojian!.setMarkdown(text),
      markdown(),
    );
    await side(page, edge);
    await page.keyboard.press('Enter');
    await expect(page.locator('.image-box img')).toHaveCount(1);
    await page.keyboard.insertText('新段落');
    await expect(page.locator('.article-editor')).toContainText('新段落');
    await page.evaluate(
      (text) => window.__mojian!.setMarkdown(text),
      markdown(),
    );
    await side(page, edge);
    await page.keyboard.press(edge === 'left' ? 'Delete' : 'Backspace');
    await expect(page.locator('.image-box img')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.image-box img')).toHaveCount(1);
  });
