import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const blocks = [
  ['codeBlock', '```js\nconst value = 1;\n```'],
  ['image', '![图片](https://example.test/boundary.svg)'],
  ['horizontalRule', '---'],
  ['table', '| 标题 |\n| --- |\n| 内容 |'],
] as const;
const cursorBlocks = blocks;
async function ready(page: Page, markdown: string) {
  await page.route('**/boundary.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#ddd"/></svg>',
    }),
  );
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(
    (text) => (window as any).__mojian.setMarkdown(text),
    markdown,
  );
  await expect(page.locator('.article-editor')).toBeVisible();
  if (markdown.includes('https://example.test/boundary.svg'))
    await expect(page.locator('.image-box img')).toBeVisible();
}
const doc = (page: Page) =>
  page.evaluate(() => (window as any).__mojian.editor.getJSON());
const selection = (page: Page) =>
  page.evaluate(() => (window as any).__mojian.editor.state.selection.toJSON());
async function clickSide(page: Page, index: number) {
  const target = page
    .locator(
      '.article-editor .code-node, .article-editor .image-node, .article-editor .tableWrapper, .article-editor hr',
    )
    .first();
  const box = await target.boundingBox();
  expect(box).toBeTruthy();
  const edge = index === 0 ? 'left' : 'right';
  const type = await target.evaluate((el) =>
    el.classList.contains('image-node') ? 'imageSide' : 'blockCursor',
  );
  await page.mouse.click(
    edge === 'left' ? box!.x - 20 : box!.x + box!.width + 20,
    box!.y + box!.height / 2,
  );
  await expect.poll(() => selection(page)).toMatchObject({ type, edge });
  await expect(page.locator('.ProseMirror-gapcursor')).toBeVisible();
}
type Rect = { x: number; y: number; width: number; height: number };
async function bottomCaret(page: Page, block: Rect) {
  let caret: Rect | null = null;
  await expect
    .poll(async () => {
      caret = await page.locator('.block-side-cursor').boundingBox();
      return caret
        ? Math.max(
            Math.abs(caret.y + caret.height - (block.y + block.height)),
            Math.abs(caret.height - 18),
          )
        : Infinity;
    })
    .toBeLessThan(1);
  return caret!;
}

for (const [type, markdown] of cursorBlocks) {
  for (const [side, index] of [
    ['before', 0],
    ['after', 1],
  ] as const) {
    test(`${type}: click ${side} without mutation, type prose, undo and redo`, async ({
      page,
    }) => {
      await ready(page, markdown);
      const before = await doc(page);
      await clickSide(page, index);
      expect(await doc(page)).toEqual(before);
      await page.keyboard.type('New prose');
      const result = await doc(page);
      const i = result.content.findIndex((node: any) => node.type === type);
      expect(result.content[i + (side === 'before' ? -1 : 1)]).toMatchObject({
        type: 'paragraph',
        content: [{ type: 'text', text: 'New prose' }],
      });
      await expect(page.locator('.article-editor')).toBeFocused();
      await page.keyboard.press('ControlOrMeta+z');
      expect(await doc(page)).toEqual(before);
      await page.keyboard.press('ControlOrMeta+Shift+z');
      expect(await doc(page)).toEqual(result);
    });
  }
  if (type !== 'image')
    for (const [side, index, key] of [
      ['before', 0, 'Delete'],
      ['after', 1, 'Backspace'],
    ] as const) {
      test(`${type}: ${key} ${side} selects the block before removal, undo restores it`, async ({
        page,
      }) => {
        await ready(page, markdown);
        const before = await doc(page);
        await clickSide(page, index);
        await page.keyboard.press(key);
        expect(await doc(page)).toEqual(before);
        expect(await selection(page)).toMatchObject({ type: 'node' });
        await page.keyboard.press(key);
        expect(
          (await doc(page)).content.some((node: any) => node.type === type),
        ).toBe(false);
        await page.keyboard.press('ControlOrMeta+z');
        expect(await doc(page)).toEqual(before);
      });
    }
}
test('side insertion between adjacent blocks creates prose outside both', async ({
  page,
}) => {
  await ready(page, blocks.map(([, text]) => text).join('\n\n'));
  await expect(page.locator('.block-insertion-hit')).toHaveCount(0);
  await clickSide(page, 1);
  await page.keyboard.type('Between');
  expect((await doc(page)).content.slice(0, 3).map((n: any) => n.type)).toEqual(
    ['codeBlock', 'paragraph', 'image'],
  );
  await page.screenshot({ path: '/tmp/mojian-block-boundaries-desktop.png' });
});
test('clearing inserted prose keeps a caret, blur removes the empty paragraph', async ({
  page,
}) => {
  await ready(page, blocks[0][1]);
  const before = await doc(page);
  await clickSide(page, 0);
  await page.keyboard.type('X');
  await page.keyboard.press('Backspace');
  expect((await doc(page)).content[0]).toMatchObject({ type: 'paragraph' });
  await page
    .locator('.article-editor')
    .evaluate((el) => (el as HTMLElement).blur());
  expect(await doc(page)).toEqual(before);
});
test('empty paragraph deletion returns to gap; repeated deletion selects, then removes the block', async ({
  page,
}) => {
  await ready(page, blocks[0][1]);
  await clickSide(page, 0);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Delete');
  expect(await selection(page)).toMatchObject({ type: 'blockCursor' });
  expect((await doc(page)).content[0].type).toBe('codeBlock');
  await page.keyboard.press('Delete');
  expect(await selection(page)).toMatchObject({ type: 'node' });
  await page.keyboard.press('Delete');
  expect(
    (await doc(page)).content.some((n: any) => n.type === 'codeBlock'),
  ).toBe(false);
});
test('Chinese composition at a gap creates a normal paragraph', async ({
  page,
}) => {
  await ready(page, blocks[0][1]);
  await clickSide(page, 0);
  await page.locator('.article-editor').evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    );
    el.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        inputType: 'insertCompositionText',
        data: '中',
        isComposing: true,
      }),
    );
  });
  await page.keyboard.insertText('中文输入');
  await page
    .locator('.article-editor')
    .dispatchEvent('compositionend', { data: '中文输入' });
  expect((await doc(page)).content[0]).toMatchObject({
    type: 'paragraph',
    content: [{ text: '中文输入' }],
  });
});
test('mobile width permits insertion without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, blocks[0][1]);
  await clickSide(page, 0);
  await page.keyboard.insertText('前面的内容');
  expect((await doc(page)).content[0]).toMatchObject({
    type: 'paragraph',
    content: [{ text: '前面的内容' }],
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: '/tmp/mojian-block-boundaries-mobile.png' });
});

test('block inside a quote supports prose on both sides', async ({ page }) => {
  await ready(page, '> ```js\n> const x = 1;\n> ```');
  await clickSide(page, 0);
  await page.keyboard.type('Before');
  await clickSide(page, 1);
  await page.keyboard.type('After');
  const quote = (await doc(page)).content[0];
  expect(quote.type).toBe('blockquote');
  expect(quote.content.map((n: any) => n.type)).toEqual([
    'paragraph',
    'codeBlock',
    'paragraph',
  ]);
  expect(quote.content[0].content[0].text).toBe('Before');
  expect(quote.content[2].content[0].text).toBe('After');
});
test('plain text paste at a gap becomes prose and preserves the block', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page, blocks[0][1]);
  await page.evaluate(() => navigator.clipboard.writeText('Pasted prose'));
  await clickSide(page, 0);
  await page.keyboard.press('ControlOrMeta+v');
  expect((await doc(page)).content.slice(0, 2).map((n: any) => n.type)).toEqual(
    ['paragraph', 'codeBlock'],
  );
  expect((await doc(page)).content[0].content[0].text).toBe('Pasted prose');
});
test('deleting inside code and table cells stays inside the edited block', async ({
  page,
}) => {
  await ready(page, blocks[0][1] + '\n\n' + blocks[3][1]);
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection(3);
    e.commands.focus();
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('Backspace');
  expect((await doc(page)).content[0].content[0].text).toBe('cnst value = 1;');
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    let pos = 0;
    e.state.doc.descendants((n: any, p: number) => {
      if (n.isText && n.text === '内容') pos = p + 1;
    });
    e.commands.setTextSelection(pos);
    e.commands.focus();
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('Backspace');
  expect(
    (await doc(page)).content.find((n: any) => n.type === 'table').content[1]
      .content[0].content[0].content[0].text,
  ).toBe('容');
});

test('holding Delete never confirms removal of the selected block', async ({
  page,
}) => {
  await ready(page, blocks[0][1]);
  const before = await doc(page);
  await clickSide(page, 0);
  await page.keyboard.down('Delete');
  await page.keyboard.down('Delete');
  expect(await doc(page)).toEqual(before);
  expect(await selection(page)).toMatchObject({ type: 'node' });
  await page.keyboard.up('Delete');
  await page.keyboard.press('Delete');
  expect(
    (await doc(page)).content.some((n: any) => n.type === 'codeBlock'),
  ).toBe(false);
});
test('backward arrows at the document start retain the gap', async ({
  page,
}) => {
  await ready(page, blocks[0][1]);
  await clickSide(page, 0);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  expect(await selection(page)).toMatchObject({ type: 'blockCursor', pos: 0 });
  await page.keyboard.press('ArrowDown');
  expect(await selection(page)).toMatchObject({ type: 'text' });
});
test('deletion preserves the required first paragraph in a list item', async ({
  page,
}) => {
  await ready(page, blocks[0][1]);
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph' },
                {
                  type: 'codeBlock',
                  attrs: { language: 'js' },
                  content: [{ type: 'text', text: 'value' }],
                },
              ],
            },
          ],
        },
      ],
    });
    e.commands.setTextSelection(3);
    e.commands.focus();
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('Delete');
  expect(await selection(page)).toMatchObject({ type: 'node' });
  expect(
    (await doc(page)).content[0].content[0].content.map((n: any) => n.type),
  ).toEqual(['paragraph', 'codeBlock']);
  await page.evaluate(() => (window as any).__mojian.editor.state.doc.check());
});

test('switching to source drops cleared transient paragraphs before serializing', async ({
  page,
}) => {
  await ready(page, blocks[0][1]);
  const before = await doc(page);
  await clickSide(page, 0);
  await page.keyboard.type('X');
  await page.keyboard.press('Backspace');
  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  expect(await doc(page)).toEqual(before);
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  expect(await doc(page)).toEqual(before);
});

test('removing one block leaves a protected gap beside the next block', async ({
  page,
}) => {
  await ready(page, blocks[0][1] + '\n\n' + blocks[0][1]);
  await clickSide(page, 0);
  await page.keyboard.press('Delete');
  await page.keyboard.down('Delete');
  expect(await selection(page)).toMatchObject({ type: 'blockCursor' });
  await page.keyboard.down('Delete');
  expect(
    (await doc(page)).content.filter((n: any) => n.type === 'codeBlock'),
  ).toHaveLength(1);
  await page.keyboard.up('Delete');
});

const blockSelectors = {
  codeBlock: '.code-node',
  image: '.image-node',
  horizontalRule: '.article-editor hr',
  table: '.tableWrapper',
};
for (const [type, markdown] of cursorBlocks)
  for (const edge of ['left', 'right'] as const) {
    test(`${type}: clicking ${edge} whitespace shows a bottom-aligned caret without creating a line`, async ({
      page,
    }) => {
      await ready(page, markdown);
      const original = await doc(page);
      const box = await page.locator(blockSelectors[type]).boundingBox();
      expect(box).toBeTruthy();
      await page.mouse.click(
        edge === 'left' ? box!.x - 20 : box!.x + box!.width + 20,
        box!.y + box!.height / 2,
      );
      await expect
        .poll(() => selection(page))
        .toMatchObject({
          type: type === 'image' ? 'imageSide' : 'blockCursor',
          edge,
        });
      expect(await doc(page)).toEqual(original);
      await expect(page.locator('.block-side-cursor')).toBeVisible();
      if (type === 'image')
        await expect(page.locator('.image-controls')).toBeVisible();
      const currentBox = await page.locator(blockSelectors[type]).boundingBox();
      const caret = await bottomCaret(page, currentBox!);
      if (edge === 'left') expect(caret!.x).toBeLessThan(box!.x);
      else expect(caret!.x).toBeGreaterThan(box!.x + box!.width);
      await expect(page.locator('.ProseMirror-gapcursor')).toHaveClass(
        /block-side-cursor/,
      );
      if (type === 'codeBlock')
        await page.screenshot({ path: `/tmp/mojian-code-cursor-${edge}.png` });
    });
  }
test('clicking a visible code line still edits inside the code block', async ({
  page,
}) => {
  await ready(page, blocks[0][1]);
  await page.locator('.code-node pre').click();
  await expect(page.locator('.article-editor')).toBeFocused();
  expect(await selection(page)).toMatchObject({ type: 'text' });
  await expect(page.locator('.block-side-cursor')).toBeHidden();
});

for (const edge of ['left', 'right'] as const)
  test(`typing from the ${edge} side creates prose only after typing starts`, async ({
    page,
  }) => {
    await ready(page, blocks[0][1]);
    const original = await doc(page);
    const box = await page.locator('.code-node').boundingBox();
    await page.mouse.click(
      edge === 'left' ? box!.x - 20 : box!.x + box!.width + 20,
      box!.y + box!.height / 2,
    );
    expect(await doc(page)).toEqual(original);
    await page.keyboard.insertText('正文');
    const result = await doc(page);
    const code = result.content.findIndex((n: any) => n.type === 'codeBlock');
    expect(result.content[code + (edge === 'left' ? -1 : 1)]).toMatchObject({
      type: 'paragraph',
      content: [{ text: '正文' }],
    });
    await expect(page.locator('.block-side-cursor')).toBeHidden();
    await page.keyboard.press('ControlOrMeta+z');
    expect(await doc(page)).toEqual(original);
    await expect
      .poll(() => selection(page))
      .toMatchObject({ type: 'blockCursor', edge });
  });
test('a side caret follows its block while the writing area scrolls', async ({
  page,
}) => {
  await ready(
    page,
    Array.from({ length: 14 }, (_, i) => `Paragraph ${i}`).join('\n\n') +
      '\n\n' +
      blocks[0][1] +
      '\n\n' +
      Array.from({ length: 25 }, (_, i) => `Following ${i}`).join('\n\n'),
  );
  await page.locator('.code-node').scrollIntoViewIfNeeded();
  const box = await page.locator('.code-node').boundingBox();
  await page.mouse.click(box!.x - 20, box!.y + box!.height / 2);
  await expect(page.locator('.block-side-cursor')).toBeVisible();
  await page.locator('.writing-scroll').evaluate((el) => el.scrollBy(0, 40));
  await expect
    .poll(async () => {
      const block = await page.locator('.code-node').boundingBox();
      const cursor = await page.locator('.block-side-cursor').boundingBox();
      return cursor && block
        ? Math.abs(cursor.y + cursor.height - (block.y + block.height))
        : 999;
    })
    .toBeLessThan(1);
});

test('clicking beside a partially scrolled code block keeps the writing position', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  await ready(
    page,
    '```js\n' +
      Array.from({ length: 100 }, (_, i) => `const value${i} = ${i};`).join(
        '\n',
      ) +
      '\n```',
  );
  await page.locator('.writing-scroll').evaluate((el) => {
    el.scrollTop = 40;
  });
  const box = await page.locator('.code-node').boundingBox();
  const scroll = await page
    .locator('.writing-scroll')
    .evaluate((el) => el.scrollTop);
  await page.mouse.click(box!.x - 20, 350);
  await expect
    .poll(() => selection(page))
    .toMatchObject({ type: 'blockCursor', edge: 'left' });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.locator('.writing-scroll').evaluate((el) => el.scrollTop),
  ).toBe(scroll);
  // The block's bottom is offscreen; the fixed baseline must not float at the click height.
  await expect(page.locator('.block-side-cursor')).toBeHidden();
  await page.locator('.writing-scroll').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator('.block-side-cursor')).toBeVisible();
  const block = await page.locator('.code-node').boundingBox();
  await bottomCaret(page, block!);
});
for (const edge of ['left', 'right'] as const)
  test(`${edge} side deletion selects the block before removing it`, async ({
    page,
  }) => {
    await ready(page, blocks[0][1]);
    const original = await doc(page);
    const box = await page.locator('.code-node').boundingBox();
    await page.mouse.click(
      edge === 'left' ? box!.x - 20 : box!.x + box!.width + 20,
      box!.y + box!.height / 2,
    );
    const key = edge === 'left' ? 'Delete' : 'Backspace';
    await page.keyboard.press(key);
    expect(await selection(page)).toMatchObject({ type: 'node' });
    expect(await doc(page)).toEqual(original);
    await page.keyboard.press(key);
    expect(
      (await doc(page)).content.some((n: any) => n.type === 'codeBlock'),
    ).toBe(false);
    await page.keyboard.press('ControlOrMeta+z');
    expect(await doc(page)).toEqual(original);
  });
test.describe('touch side margin', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  test('tapping beside code places a lateral caret and accepts Chinese text', async ({
    page,
  }) => {
    await ready(page, blocks[0][1]);
    const box = await page.locator('.code-node').boundingBox();
    await page.touchscreen.tap(box!.x - 12, box!.y + box!.height / 2);
    await expect
      .poll(() => selection(page))
      .toMatchObject({ type: 'blockCursor', edge: 'left' });
    await page.keyboard.insertText('触摸正文');
    expect((await doc(page)).content[0]).toMatchObject({
      type: 'paragraph',
      content: [{ text: '触摸正文' }],
    });
  });
});

for (const type of ['codeBlock', 'table'] as const)
  test(`${type}: top, middle and bottom side clicks share one bottom baseline`, async ({
    page,
  }) => {
    await ready(page, blocks.find(([name]) => name === type)![1]);
    const original = await doc(page);
    const box = await page.locator(blockSelectors[type]).boundingBox();
    const positions: number[] = [];
    for (const edge of ['left', 'right'] as const)
      for (const height of [0.1, 0.5, 0.9]) {
        await page.mouse.click(
          edge === 'left' ? box!.x - 20 : box!.x + box!.width + 20,
          box!.y + box!.height * height,
        );
        await expect
          .poll(() => selection(page))
          .toMatchObject({ type: 'blockCursor', edge });
        await expect(page.locator('.block-side-cursor')).toBeVisible();
        const caret = await bottomCaret(page, box!);
        positions.push(caret!.y);
        expect(
          Math.abs(caret!.y + caret!.height - (box!.y + box!.height)),
        ).toBeLessThan(1);
        expect(await doc(page)).toEqual(original);
      }
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
    await page.screenshot({ path: `/tmp/mojian-${type}-bottom-baseline.png` });
  });

test('the divider row is selectable across its width and height without adding text', async ({
  page,
}) => {
  await ready(page, '前文\n\n---\n\n后文');
  const original = await doc(page);
  const line = page.locator('.article-editor hr');
  const box = await line.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(20);
  for (const horizontal of [0.1, 0.5, 0.9])
    for (const vertical of [0.1, 0.5, 0.9]) {
      await page.mouse.click(
        box!.x + box!.width * horizontal,
        box!.y + box!.height * vertical,
      );
      expect(await selection(page)).toMatchObject({ type: 'node' });
      expect(await doc(page)).toEqual(original);
      await expect(line).toHaveClass(/ProseMirror-selectednode/);
      await expect(line).toHaveCSS('background-color', 'rgb(240, 240, 242)');
    }
  await page.screenshot({ path: '/tmp/mojian-divider-selected.png' });
  await page.keyboard.press('Delete');
  await expect(line).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await doc(page)).toEqual(original);
});

test('divider side whitespace places a cursor before or after without selecting the line', async ({
  page,
}) => {
  await ready(page, '前文\n\n---\n\n后文');
  const original = await doc(page);
  const box = await page.locator('.article-editor hr').boundingBox();
  for (const edge of ['left', 'right']) {
    await page.mouse.click(
      edge === 'left' ? box!.x - 80 : box!.x + box!.width + 80,
      box!.y + box!.height / 2,
    );
    expect(await selection(page)).toMatchObject({ type: 'blockCursor', edge });
    await expect(page.locator('.article-editor hr')).not.toHaveClass(
      /ProseMirror-selectednode/,
    );
    await bottomCaret(page, box!);
    expect(await doc(page)).toEqual(original);
  }
});

const smallImage = '![图片](https://example.test/boundary.svg "width=35%")';
for (const edge of ['left', 'right'] as const)
  test(`small image: the ${edge} caret reuses the selected outer frame`, async ({
    page,
  }) => {
    await ready(page, '前文\n\n' + smallImage + '\n\n后文');
    await page.evaluate(() => {
      const e = (window as any).__mojian.editor;
      let pos = 0;
      e.state.doc.descendants((n: any, p: number) => {
        if (n.type.name === 'image') pos = p;
      });
      e.commands.setNodeSelection(pos);
    });
    await expect(page.locator('.image-controls')).toBeVisible();
    const selected = await page.locator('.image-node').boundingBox();
    const frameStyle = await page.locator('.node-image').evaluate((el) => {
      (window as any).__selectedImageElement = el;
      return {
        outline: getComputedStyle(el).outline,
        offset: getComputedStyle(el).outlineOffset,
      };
    });
    const inner = await page.locator('.image-box').boundingBox();
    expect(inner!.width).toBeLessThan(selected!.width * 0.4);
    await page.mouse.click(
      edge === 'left' ? selected!.x - 20 : selected!.x + selected!.width + 20,
      selected!.y + selected!.height / 2,
    );
    await expect
      .poll(() => selection(page))
      .toMatchObject({ type: 'imageSide', edge });
    await expect(page.locator('.image-controls')).toBeVisible();
    await expect(page.locator('.image-node')).toHaveCSS(
      'outline-style',
      'none',
    );
    await expect(
      page.locator('.node-image.ProseMirror-selectednode'),
    ).toHaveCSS('outline', frameStyle.outline);
    await expect(
      page.locator('.node-image.ProseMirror-selectednode'),
    ).toHaveCSS('outline-offset', frameStyle.offset);
    await expect(page.locator('.image-node')).toHaveClass(/selected/);
    expect(
      await page
        .locator('.node-image')
        .evaluate((el) => el === (window as any).__selectedImageElement),
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        (window as any).__mojian.editor.isActive('image'),
      ),
    ).toBe(true);
    await expect(page.locator('.block-cursor-image')).toHaveCount(0);
    let caret: Rect | null = null;
    await expect
      .poll(async () => {
        const outer = await page.locator('.image-node').boundingBox();
        caret = await page.locator('.block-side-cursor').boundingBox();
        if (!outer || !caret) return Infinity;
        return Math.max(
          Math.abs(caret.y + caret.height - (outer.y + outer.height)),
          Math.abs(
            caret.x -
              (edge === 'left' ? outer.x - 8 : outer.x + outer.width + 7),
          ),
        );
      })
      .toBeLessThan(1);
    await page.screenshot({ path: `/tmp/mojian-image-outer-${edge}.png` });
    await page.keyboard.insertText('新增正文');
    const result = await doc(page);
    const image = result.content.findIndex((n: any) => n.type === 'image');
    expect(result.content[image + (edge === 'left' ? -1 : 1)]).toMatchObject({
      type: 'paragraph',
      content: [{ text: '新增正文' }],
    });
    expect(result.content[0].content[0].text).toBe('前文');
    expect(result.content.at(-1).content[0].text).toBe('后文');
  });

for (const [edge, key] of [
  ['left', 'Delete'],
  ['right', 'Backspace'],
] as const)
  test(`small image: ${key} at the ${edge} outer edge deletes the image in one press and undo restores it`, async ({
    page,
  }) => {
    await ready(page, '前文\n\n' + smallImage + '\n\n后文');
    const original = await doc(page);
    const outer = await page.locator('.image-node').boundingBox();
    await page.mouse.click(
      edge === 'left' ? outer!.x - 20 : outer!.x + outer!.width + 20,
      outer!.y + outer!.height / 2,
    );
    await expect
      .poll(() => selection(page))
      .toMatchObject({ type: 'imageSide', edge });
    await page.keyboard.press(key);
    await expect(page.locator('.image-node')).toHaveCount(0);
    expect(
      (await doc(page)).content.map((n: any) => n.content?.[0]?.text),
    ).toEqual(['前文', '后文']);
    await page.keyboard.press('ControlOrMeta+z');
    expect(await doc(page)).toEqual(original);
  });

test('blank space inside the image outer frame does not create an outside cursor', async ({
  page,
}) => {
  await ready(page, smallImage);
  const outer = await page.locator('.image-node').boundingBox();
  const inner = await page.locator('.image-box').boundingBox();
  await page.mouse.click(inner!.x - 20, inner!.y + inner!.height / 2);
  expect((await selection(page)).type).not.toBe('imageSide');
  expect(inner!.x - 20).toBeGreaterThan(outer!.x);
  await expect(page.locator('.block-side-cursor')).toBeHidden();
});

for (const edge of ['left', 'right'] as const)
  test(`real image selection: Chinese composition at the ${edge} side preserves the image`, async ({
    page,
  }) => {
    await ready(page, '前文\n\n' + smallImage + '\n\n后文');
    const outer = await page.locator('.image-node').boundingBox();
    await page.mouse.click(
      edge === 'left' ? outer!.x - 20 : outer!.x + outer!.width + 20,
      outer!.y + outer!.height / 2,
    );
    await expect
      .poll(() => selection(page))
      .toMatchObject({ type: 'imageSide', edge });
    await page.locator('.article-editor').evaluate((el) => {
      el.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true }),
      );
      el.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          inputType: 'insertCompositionText',
          data: '中',
          isComposing: true,
        }),
      );
    });
    await page.keyboard.insertText('中文正文');
    await page
      .locator('.article-editor')
      .dispatchEvent('compositionend', { data: '中文正文' });
    const result = await doc(page);
    const at = result.content.findIndex((n: any) => n.type === 'image');
    expect(at).toBeGreaterThan(0);
    expect(result.content[at + (edge === 'left' ? -1 : 1)]).toMatchObject({
      type: 'paragraph',
      content: [{ text: '中文正文' }],
    });
  });
for (const edge of ['left', 'right'] as const)
  test(`real image selection: Enter at the ${edge} side inserts a paragraph without replacing the image`, async ({
    page,
  }) => {
    await ready(page, '前文\n\n' + smallImage + '\n\n后文');
    const outer = await page.locator('.image-node').boundingBox();
    await page.mouse.click(
      edge === 'left' ? outer!.x - 20 : outer!.x + outer!.width + 20,
      outer!.y + outer!.height / 2,
    );
    await expect
      .poll(() => selection(page))
      .toMatchObject({ type: 'imageSide', edge });
    await page.keyboard.press('Enter');
    await page.keyboard.type('New prose');
    const result = await doc(page);
    const at = result.content.findIndex((n: any) => n.type === 'image');
    expect(at).toBeGreaterThan(0);
    expect(result.content[at + (edge === 'left' ? -1 : 1)]).toMatchObject({
      type: 'paragraph',
      content: [{ text: 'New prose' }],
    });
  });

for (const [type, markdown] of cursorBlocks)
  test(`${type}: clicking the gap above the next paragraph creates no block cursor`, async ({
    page,
  }) => {
    await ready(page, '前文\n\n' + markdown + '\n\n下一行正文');
    const before = await doc(page);
    const block = await page.locator(blockSelectors[type]).boundingBox();
    const next = await page.locator('.article-editor > p').last().boundingBox();
    expect(next!.y).toBeGreaterThan(block!.y + block!.height);
    await page.mouse.click(
      block!.x + block!.width / 2,
      (block!.y + block!.height + next!.y) / 2,
    );
    expect(['blockCursor', 'imageSide', 'gapcursor']).not.toContain(
      (await selection(page)).type,
    );
    await expect(page.locator('.ProseMirror-gapcursor')).toHaveCount(0);
    await expect(page.locator('.block-insertion-hit')).toHaveCount(0);
    expect(await doc(page)).toEqual(before);
  });
for (const [first, second] of [
  ['codeBlock', 'image'],
  ['image', 'table'],
  ['table', 'codeBlock'],
] as const)
  test(`${first} then ${second}: clicking the vertical gap creates no extra cursor`, async ({
    page,
  }) => {
    await ready(
      page,
      '前文\n\n' +
        blocks.find(([type]) => type === first)![1] +
        '\n\n' +
        blocks.find(([type]) => type === second)![1] +
        '\n\n后文',
    );
    const before = await doc(page);
    const a = await page.locator(blockSelectors[first]).boundingBox();
    const b = await page.locator(blockSelectors[second]).boundingBox();
    await page.mouse.click(a!.x + a!.width / 2, (a!.y + a!.height + b!.y) / 2);
    expect(['blockCursor', 'imageSide', 'gapcursor']).not.toContain(
      (await selection(page)).type,
    );
    await expect(page.locator('.ProseMirror-gapcursor')).toHaveCount(0);
    expect(await doc(page)).toEqual(before);
  });
for (const edge of ['left', 'right'] as const)
  test(`real image selection: pasting at the ${edge} side preserves the picture`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await ready(page, '前文\n\n' + smallImage + '\n\n后文');
    const outer = await page.locator('.image-node').boundingBox();
    await page.mouse.click(
      edge === 'left' ? outer!.x - 20 : outer!.x + outer!.width + 20,
      outer!.y + outer!.height / 2,
    );
    await expect
      .poll(() => selection(page))
      .toMatchObject({ type: 'imageSide', edge });
    await page.evaluate(() => navigator.clipboard.writeText('粘贴正文'));
    await page.keyboard.press('ControlOrMeta+v');
    const result = await doc(page);
    const at = result.content.findIndex((n: any) => n.type === 'image');
    expect(at).toBeGreaterThan(0);
    expect(result.content[at + (edge === 'left' ? -1 : 1)]).toMatchObject({
      type: 'paragraph',
      content: [{ text: '粘贴正文' }],
    });
    expect(result.content[0].content[0].text).toBe('前文');
    expect(result.content.at(-1).content[0].text).toBe('后文');
  });
test('Markdown paste at the image right side preserves the image before the pasted blocks', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page, '前文\n\n' + smallImage + '\n\n后文');
  const outer = await page.locator('.image-node').boundingBox();
  await page.mouse.click(
    outer!.x + outer!.width + 20,
    outer!.y + outer!.height / 2,
  );
  await page.evaluate(() =>
    navigator.clipboard.writeText('## 粘贴标题\n\n正文'),
  );
  await page.keyboard.press('ControlOrMeta+v');
  const result = await doc(page);
  const at = result.content.findIndex((n: any) => n.type === 'image');
  expect(at).toBeGreaterThan(0);
  expect(result.content[at + 1]).toMatchObject({
    type: 'heading',
    content: [{ text: '粘贴标题' }],
  });
  expect(result.content[at + 2]).toMatchObject({
    type: 'paragraph',
    content: [{ text: '正文' }],
  });
});

for (const [name, markdown, selector] of [
  ['paragraph', '正文内容', '.article-editor > p'],
  ['heading', '## 标题内容', '.article-editor > h2'],
  ['list', '- 第一项\n- 第二项', '.article-editor li p'],
  ['quote', '> 引用内容', '.article-editor blockquote p'],
] as const)
  for (const edge of ['left', 'right'] as const)
    test(`${name}: the full ${edge} margin focuses the matching text line`, async ({
      page,
    }) => {
      await ready(page, markdown);
      const target = page.locator(selector).last();
      const text = await target.innerText();
      const box = await target.boundingBox();
      const surface = await page.locator('.writing-scroll').boundingBox();
      const before = await doc(page);
      await page.mouse.click(
        edge === 'left' ? surface!.x + 3 : surface!.x + surface!.width - 3,
        box!.y + box!.height / 2,
      );
      expect(await doc(page)).toEqual(before);
      expect((await selection(page)).type).toBe('text');
      await page.keyboard.insertText('新增');
      await expect(target).toHaveText(
        edge === 'left' ? '新增' + text : text + '新增',
      );
      await page.keyboard.press('ControlOrMeta+z');
      expect(await doc(page)).toEqual(before);
    });

for (const [type, markdown] of blocks)
  test(`${type}: far left and right margins keep the matching block`, async ({
    page,
  }) => {
    await ready(page, '上一行\n\n' + markdown + '\n\n下一行');
    const original = await doc(page);
    const box = await page.locator(blockSelectors[type]).boundingBox();
    const surface = await page.locator('.writing-scroll').boundingBox();
    for (const edge of ['left', 'right']) {
      await page.mouse.click(
        edge === 'left' ? surface!.x + 3 : surface!.x + surface!.width - 3,
        box!.y + box!.height / 2,
      );
      expect(await selection(page)).toMatchObject({
        type: type === 'image' ? 'imageSide' : 'blockCursor',
        edge,
      });
      expect(await doc(page)).toEqual(original);
    }
    await page.screenshot({
      path: `/tmp/mojian-unified-${type}.png`,
      animations: 'disabled',
    });
  });

test('wrapped text: side clicks follow the clicked line instead of the paragraph bottom', async ({
  page,
}) => {
  await ready(page, '这是用于验证多行侧边定位的正文。'.repeat(30));
  const paragraph = page.locator('.article-editor > p');
  const box = await paragraph.boundingBox();
  const surface = await page.locator('.writing-scroll').boundingBox();
  const lineHeight = await paragraph.evaluate((el) =>
    parseFloat(getComputedStyle(el).lineHeight),
  );
  const anchors: number[] = [];
  for (const y of [box!.y + lineHeight / 2, box!.y + lineHeight * 1.5]) {
    await page.mouse.click(surface!.x + surface!.width - 3, y);
    anchors.push((await selection(page)).anchor);
    await expect(page.locator('.editor-text-cursor')).toHaveCount(0);
    await expect(page.locator('.article-editor')).toHaveCSS(
      'caret-color',
      'rgb(37, 37, 40)',
    );
  }
  expect(anchors[1]).toBeGreaterThan(anchors[0]);
  expect(anchors[1]).toBeLessThan((await paragraph.innerText()).length);
});

test('native text caret stays visible during input and composition, while side carets stay 2px', async ({
  page,
}) => {
  await ready(page, '正文内容\n\n---\n\n后文');
  const editor = page.locator('.article-editor');
  await editor.locator('p').first().click();
  await expect(page.locator('.editor-text-cursor')).toHaveCount(0);
  await expect(editor).not.toHaveClass(/custom-text-cursor/);
  await expect(editor).toHaveCSS('caret-color', 'rgb(37, 37, 40)');
  await editor.dispatchEvent('compositionstart', { data: '' });
  await expect(editor).toHaveCSS('caret-color', 'rgb(37, 37, 40)');
  await editor.dispatchEvent('compositionend', { data: '' });
  await clickSide(page, 1);
  const style = await page.locator('.ProseMirror-gapcursor').evaluate((el) => {
    const css = getComputedStyle(el, '::after');
    return { width: css.width, color: css.backgroundColor };
  });
  expect(style).toEqual({ width: '2px', color: 'rgb(23, 23, 23)' });
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await editor.locator('p').last().boundingBox();
  const surface = await page.locator('.writing-scroll').boundingBox();
  await page.mouse.click(
    surface!.x + surface!.width - 2,
    box!.y + box!.height / 2,
  );
  expect((await selection(page)).type).toBe('text');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveCSS('caret-color', 'rgb(37, 37, 40)');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '/tmp/mojian-native-caret-mobile.png',
    caret: 'initial',
  });
});

test('code editing retains a contrasting native caret without a floating overlay', async ({
  page,
}) => {
  await ready(page, '```js\nconst longName = "' + 'x'.repeat(200) + '";\n```');
  const code = page.locator('.code-node pre');
  await code.click({ position: { x: 40, y: 25 } });
  await expect(page.locator('.article-editor')).toBeFocused();
  const styles = await code.evaluate((el) => ({
    caret: getComputedStyle(el).caretColor,
    color: getComputedStyle(el).color,
  }));
  expect(styles.caret).toBe('rgb(36, 41, 46)');
  expect(styles.caret).not.toBe('rgba(0, 0, 0, 0)');
  await expect(page.locator('.editor-text-cursor')).toHaveCount(0);
  const before = await doc(page);
  await page.keyboard.type('native');
  expect(JSON.stringify(await doc(page))).toContain('native');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await doc(page)).toEqual(before);
  const language = page.getByRole('combobox', { name: '代码语言' });
  await language.focus();
  const inputStyles = await language.evaluate((el) => ({
    caret: getComputedStyle(el).caretColor,
    color: getComputedStyle(el).color,
  }));
  expect(inputStyles.caret).toBe(inputStyles.color);
  expect(inputStyles.caret).toBe('rgb(87, 96, 106)');
  await code.click({ position: { x: 40, y: 25 } });
  await page.screenshot({
    path: '/tmp/mojian-native-code-caret.png',
    caret: 'initial',
  });
});
