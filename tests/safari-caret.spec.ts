import { test, expect } from './fixtures';

test.use({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
});

for (const width of [1440, 390]) {
  test(`Safari caret follows text beside tall images and exits for selections at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/caret.svg', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="teal"/></svg>',
      }),
    );
    await page.goto('/');
    await page.waitForFunction(() => !!window.__mojian?.editor);
    await page.evaluate(() =>
      window.__mojian!.setMarkdown(
        '# 大标题\n\n前文![图](https://example.test/caret.svg "width=50%")后文\n\n分隔线上方的正文\n\n---\n\n末尾\n\n```js\nconst x = 1;\n```',
      ),
    );
    await expect(page.locator('.image-box img')).toBeVisible();
    const caret = page.locator('.safari-text-caret');
    for (const text of ['大标题', '前文', '后文', '分隔线上方的正文']) {
      await page.evaluate((text) => {
        const e = window.__mojian!.editor!;
        e.state.doc.descendants((node, pos) => {
          if (node.isText && node.text === text)
            e.commands.setTextSelection(pos + 1);
        });
        e.commands.focus();
        e.view.dispatch(e.state.tr.scrollIntoView());
      }, text);
      await expect(caret).not.toHaveAttribute('hidden');
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const s = getSelection()!;
            const r = document.createRange();
            r.setStart(s.focusNode!, s.focusOffset - 1);
            r.setEnd(s.focusNode!, s.focusOffset);
            const glyph = r.getBoundingClientRect();
            const caret = document
              .querySelector('.safari-text-caret')!
              .getBoundingClientRect();
            const font = parseFloat(
              getComputedStyle(s.focusNode!.parentElement!).fontSize,
            );
            // A text caret must stay close to its glyph baseline and cannot
            // grow to the image/line height, regardless of the browser's range.
            return (
              caret.height >= font * 0.8 &&
              caret.height <= font * 1.5 &&
              Math.abs(caret.bottom - glyph.bottom) < 2
            );
          }),
        )
        .toBe(true);
    }
    await page.keyboard.type('新');
    await expect(page.locator('.article-editor')).toContainText('新');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(caret).toHaveAttribute('hidden');
    await page.keyboard.press('ArrowLeft');
    await expect(caret).not.toHaveAttribute('hidden');
    await page
      .locator('.article-editor')
      .dispatchEvent('compositionstart', { data: '' });
    await expect(caret).toHaveAttribute('hidden');
    await page
      .locator('.article-editor')
      .dispatchEvent('compositionend', { data: '' });
    await expect(caret).not.toHaveAttribute('hidden');
    await page.evaluate(() => {
      const e = window.__mojian!.editor!;
      e.state.doc.descendants((node, pos) => {
        if (node.type.name === 'codeBlock')
          e.commands.setTextSelection(pos + 1);
      });
    });
    await expect(caret).toHaveAttribute('hidden');
    await page.getByRole('switch', { name: '只读模式' }).click();
    await expect(caret).toHaveAttribute('hidden');
    await expect(page.locator('.article-editor')).not.toHaveClass(
      /safari-caret-active/,
    );
  });
}
