import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const blocks = [
  ['codeBlock', '```js\nconst value = 1;\n```'],
  ['image', '![图片](https://example.test/boundary.svg)'],
  ['horizontalRule', '---'],
  ['table', '| 标题 |\n| --- |\n| 内容 |'],
] as const;
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
  await expect(page.locator('.block-insertion-hit').first()).toBeAttached();
  if (markdown.includes('https://example.test/boundary.svg'))
    await expect(page.locator('.image-box img')).toBeVisible();
}
const doc = (page: Page) =>
  page.evaluate(() => (window as any).__mojian.editor.getJSON());
const selection = (page: Page) =>
  page.evaluate(() => (window as any).__mojian.editor.state.selection.toJSON());
async function clickGap(page: Page, index: number) {
  await page.locator('.block-insertion-hit').nth(index).click();
  await expect
    .poll(() => selection(page))
    .toMatchObject({ type: 'blockCursor' });
  await expect(page.locator('.ProseMirror-gapcursor')).toBeVisible();
}
for (const [type, markdown] of blocks) {
  for (const [side, index] of [
    ['before', 0],
    ['after', 1],
  ] as const) {
    test(`${type}: click ${side} without mutation, type prose, undo and redo`, async ({
      page,
    }) => {
      await ready(page, markdown);
      const before = await doc(page);
      await clickGap(page, index);
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
  for (const [side, index, key] of [
    ['before', 0, 'Delete'],
    ['after', 1, 'Backspace'],
  ] as const) {
    test(`${type}: ${key} ${side} selects the block before removal, undo restores it`, async ({
      page,
    }) => {
      await ready(page, markdown);
      const before = await doc(page);
      await clickGap(page, index);
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
test('adjacent blocks share a single insertion point and prose stays outside both', async ({
  page,
}) => {
  await ready(page, blocks.map(([, text]) => text).join('\n\n'));
  await expect(page.locator('.block-insertion-hit')).toHaveCount(5);
  await clickGap(page, 1);
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
  await clickGap(page, 0);
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
  await clickGap(page, 0);
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
  await clickGap(page, 0);
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
  await clickGap(page, 0);
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
  await clickGap(page, 0);
  await page.keyboard.type('Before');
  await clickGap(page, 1);
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
  await clickGap(page, 0);
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
  await clickGap(page, 0);
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
  await clickGap(page, 0);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  expect(await selection(page)).toMatchObject({ type: 'blockCursor', pos: 0 });
  await page.keyboard.press('ArrowDown');
  expect(await selection(page)).toMatchObject({ type: 'text' });
});
test.describe('touch boundary', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  test('tap places a gap cursor and text enters outside the code block', async ({
    page,
  }) => {
    await ready(page, blocks[0][1]);
    const hit = await page
      .locator('.block-insertion-hit')
      .first()
      .boundingBox();
    expect(hit).toBeTruthy();
    await page.touchscreen.tap(
      hit!.x + hit!.width / 2,
      hit!.y + hit!.height / 2,
    );
    expect(await selection(page)).toMatchObject({ type: 'blockCursor' });
    await page.keyboard.insertText('触摸输入');
    expect((await doc(page)).content[0]).toMatchObject({
      type: 'paragraph',
      content: [{ text: '触摸输入' }],
    });
  });
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
  await clickGap(page, 0);
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
  await clickGap(page, 0);
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
  image: '.image-box',
  horizontalRule: '.article-editor hr',
  table: '.tableWrapper',
};
for (const [type, markdown] of blocks)
  for (const edge of ['left', 'right'] as const) {
    test(`${type}: clicking ${edge} whitespace shows the caret alongside the block without creating a line`, async ({
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
        .toMatchObject({ type: 'blockCursor', edge });
      expect(await doc(page)).toEqual(original);
      await expect(page.locator('.block-side-cursor')).toBeVisible();
      const caret = await page.locator('.block-side-cursor').boundingBox();
      expect(
        Math.abs(caret!.y + caret!.height / 2 - (box!.y + box!.height / 2)),
      ).toBeLessThan(1);
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
        ? Math.abs(cursor.y + 9 - (block.y + block.height / 2))
        : 999;
    })
    .toBeLessThan(1);
});

test('clicking beside a partially scrolled code block keeps the writing position', async ({
  page,
}) => {
  await ready(
    page,
    '```js\n' +
      Array.from({ length: 100 }, (_, i) => `const value${i} = ${i};`).join(
        '\n',
      ) +
      '\n```',
  );
  await page.locator('.writing-scroll').evaluate((el) => {
    el.scrollTop = 500;
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
  const caret = await page.locator('.block-side-cursor').boundingBox();
  expect(Math.abs(caret!.y + 9 - 350)).toBeLessThan(1);
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
