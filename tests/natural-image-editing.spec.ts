import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { dragImageWidth } from './imageEditing';
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
  const box = (await page.locator('.image-box').boundingBox())!,
    surface = (await page.locator('.writing-scroll').boundingBox())!;
  await page.mouse.click(
    edge === 'left'
      ? box.x - 8
      : Math.min(box.x + box.width + 8, surface.x + surface.width - 2),
    box.y + box.height / 2,
  );
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

  const normal = await page
    .locator('.article-editor >p')
    .first()
    .evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect().height;
    });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const anchor = document.querySelector('.image-caret-anchor');
        return anchor
          ? anchor.getBoundingClientRect().height
          : getSelection()!.getRangeAt(0).getBoundingClientRect().height;
      }),
    )
    .toBeCloseTo(normal, 1);
}
for (const [width, percent] of [
  [1440, 35],
  [390, 1],
  [390, 35],
  [390, 100],
  [390, 150],
] as const)
  test(`natural image input and deletion share the native text caret at ${width}px/${percent}%`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await ready(page, percent);
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
    const anchor = (await page.locator('.image-caret-anchor').boundingBox())!;
    await page.mouse.click(anchor.x, anchor.y + anchor.height / 2);
    await expect(page.locator('.article-editor')).toBeFocused();
    await page.keyboard.press('Tab');
    await nativeCaret(page);
    expect(await page.evaluate(() => window.__mojian!.getMarkdown())).toMatch(
      /(?:\t|&#9;)!\[/,
    );
    expect(
      await page.evaluate(
        () =>
          window.__mojian!.editor!.getJSON().content![1].content!.at(-1)!.attrs!
            .indent,
      ),
    ).toBe(0);
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
    await side(page, 'right');
    await page.keyboard.press('Backspace');
    await expect(page.locator('.image-box img')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.image-box img')).toHaveCount(1);
  });
test('natural standalone image resizing survives source mode and reload', async ({
  page,
}) => {
  await ready(page);
  for (const percent of [1, 45, 150, 200]) await dragImageWidth(page, percent);
  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  await expect(page.locator('.source-editor')).toHaveValue(/width=200%/);
  expect(await page.locator('.source-editor').inputValue()).not.toContain(
    '\u200b',
  );
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.reload();
  await page.waitForFunction(() => !!window.__mojian?.editor);
  expect(
    await page.evaluate(
      () => window.__mojian!.editor!.getJSON().content![1].content![0].type,
    ),
  ).toBe('inlineImage');
});
