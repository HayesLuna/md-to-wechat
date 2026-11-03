import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const image = (alt: string, width = 20) =>
  `![${alt}](https://example.test/selection.svg "width=${width}%")`;
async function ready(page: Page, markdown: string) {
  await page.route('**/selection.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#96b5cd"/></svg>',
    }),
  );
  await page.goto('/');
  await page.waitForFunction(() => !!window.__mojian?.editor);
  await page.evaluate((text) => window.__mojian!.setMarkdown(text), markdown);
  await expect(page.locator('.image-box img').first()).toBeVisible();
}
const selected = (page: Page) =>
  page.locator('.image-range-selected .image-box img');
async function clipboard(page: Page, type: 'copy' | 'cut') {
  return page.evaluate((type) => {
    const editor = window.__mojian!.editor!;
    editor.view.focus();
    const data = new DataTransfer();
    editor.view.dom.dispatchEvent(
      new ClipboardEvent(type, {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    return {
      text: data.getData('text/plain'),
      html: data.getData('text/html'),
    };
  }, type);
}

for (const width of [1440, 390])
  test(`dragging a mixed range highlights exactly its images and preserves copy, cut and undo at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await ready(
      page,
      `前文选择开始\n\n${image('独立图')}\n\n中间 ${image('同行图', 15)} 文字\n\n后文选择结束\n\n未选中 ${image('范围外图', 15)}`,
    );
    const original = await page.evaluate(() =>
      window.__mojian!.editor!.getJSON(),
    );
    const points = await page.evaluate(() => {
      const editor = window.__mojian!.editor!;
      const points: Record<string, { x: number; y: number }> = {};
      editor.state.doc.descendants((node, pos) => {
        for (const [key, text, offset] of [
          ['from', '前文选择开始', 0],
          ['to', '后文选择结束', 6],
        ] as const) {
          if (!node.isText || node.text !== text) continue;
          const rect = editor.view.coordsAtPos(pos + offset);
          points[key] = {
            x: rect.left + (key === 'from' ? 1 : -1),
            y: (rect.top + rect.bottom) / 2,
          };
        }
      });
      return points;
    });
    await page.mouse.move(points.to.x, points.to.y);
    await page.mouse.down();
    await page.mouse.move(points.from.x, points.from.y, { steps: 12 });
    await page.mouse.up();
    await expect(selected(page)).toHaveCount(2);
    expect(
      await selected(page).evaluateAll((images) =>
        images.map((image) => image.getAttribute('alt')),
      ),
    ).toEqual(['独立图', '同行图']);
    const overlay = await selected(page)
      .first()
      .evaluate((image) => {
        const css = getComputedStyle(image.closest('.image-box')!, '::after');
        return {
          background: css.backgroundColor,
          opacity: css.opacity,
          events: css.pointerEvents,
          content: css.content,
        };
      });
    expect(overlay).toEqual({
      background: 'rgb(200, 225, 255)',
      opacity: '0.65',
      events: 'none',
      content: '""',
    });
    const copy = await clipboard(page, 'copy');
    expect(copy.text).toContain('![独立图]');
    expect(copy.text).toContain('![同行图]');
    expect(copy.text).not.toContain('范围外图');
    expect(copy.html).not.toContain('image-range-selected');
    expect(
      await page.evaluate(() => window.__mojian!.editor!.getJSON()),
    ).toEqual(original);
    await clipboard(page, 'cut');
    await expect(page.locator('.image-box img')).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+z');
    expect(
      await page.evaluate(() => window.__mojian!.editor!.getJSON()),
    ).toEqual(original);
    await expect(selected(page)).toHaveCount(2);
    await page.keyboard.press('ArrowRight');
    await expect(selected(page)).toHaveCount(0);
  });

test('range boundaries, select-all and single image selection have distinct feedback', async ({
  page,
}) => {
  await ready(page, `前文 ${image('A')} 后文\n\n${image('B')}`);
  const pos = await page.evaluate(() => {
    let found = 0;
    window.__mojian!.editor!.state.doc.descendants((node, pos) => {
      if (!found && node.type.name === 'inlineImage') found = pos;
    });
    return found;
  });
  await page.evaluate(
    (pos) =>
      window.__mojian!.editor!.commands.setTextSelection({ from: 1, to: pos }),
    pos,
  );
  await expect(selected(page)).toHaveCount(0);
  await page.evaluate(
    (pos) =>
      window.__mojian!.editor!.commands.setTextSelection({
        from: pos,
        to: pos + 1,
      }),
    pos,
  );
  await expect(selected(page)).toHaveCount(1);
  await page.evaluate(
    (pos) =>
      window.__mojian!.editor!.chain().setNodeSelection(pos).focus().run(),
    pos,
  );
  await expect(selected(page)).toHaveCount(0);
  await expect(page.locator('.inline-image-node.selected')).toHaveClass(
    /selected/,
  );
  await expect(
    page.locator('.inline-image-node.selected .image-preview-trigger'),
  ).toHaveCSS('cursor', 'zoom-in');
  await page.evaluate(() =>
    window.__mojian!.editor!.chain().setTextSelection(1).focus().run(),
  );
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(selected(page)).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await expect(selected(page)).toHaveCount(0);
});

test('table cell selections highlight only images in selected cells, including read-only selection', async ({
  page,
}) => {
  await ready(
    page,
    `| ${image('A')} | ${image('B')} |\n| --- | --- |\n| ${image('C')} | ${image('D')} |`,
  );
  const cells = await page.evaluate(() => {
    const cells: number[] = [];
    window.__mojian!.editor!.state.doc.descendants((node, pos) => {
      if (['tableCell', 'tableHeader'].includes(node.type.name))
        cells.push(pos);
    });
    return cells;
  });
  await page.evaluate(
    (cells) =>
      window.__mojian!.editor!.commands.setCellSelection({
        anchorCell: cells[0],
        headCell: cells[2],
      }),
    cells,
  );
  await expect(selected(page)).toHaveCount(2);
  expect(
    await selected(page).evaluateAll((images) =>
      images.map((image) => image.getAttribute('alt')),
    ),
  ).toEqual(['A', 'C']);
  await page.getByRole('switch', { name: '只读模式' }).click();
  await expect(selected(page)).toHaveCount(2);
  await page.evaluate(() =>
    window.__mojian!.editor!.commands.setTextSelection(4),
  );
  await expect(selected(page)).toHaveCount(0);
});
