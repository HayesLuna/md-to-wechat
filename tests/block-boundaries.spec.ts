import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { dragImageWidth } from './imageEditing';

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
  const surface = (await page.locator('.writing-scroll').boundingBox())!;
  const type = await target.evaluate((el) =>
    el.classList.contains('image-node') ? 'imageSide' : 'blockCursor',
  );
  await page.mouse.click(
    edge === 'left'
      ? Math.max(box!.x - 20, surface.x + 2)
      : Math.min(box!.x + box!.width + 20, surface.x + surface.width - 2),
    box!.y + box!.height / 2,
  );
  await expect.poll(() => selection(page)).toMatchObject({ type, edge });
  await expect(page.locator('.ProseMirror-gapcursor')).toBeVisible();
}
function expectInlineImageText(
  document: any,
  side: 'left' | 'right',
  text: string,
) {
  const line = document.content.find(
    (node: any) =>
      node.type === 'paragraph' &&
      node.content?.some((child: any) => child.type === 'inlineImage'),
  );
  expect(line).toBeDefined();
  expect(line.content).toMatchObject(
    side === 'left'
      ? [{ type: 'text', text }, { type: 'inlineImage' }]
      : [{ type: 'inlineImage' }, { type: 'text', text }],
  );
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

for (const [type, markdown] of cursorBlocks.filter(
  ([type]) => type !== 'image',
))
  for (const [side, index] of (
    [
      ['before', 0],
      ['after', 1],
    ] as const
  ).filter(([side]) => type !== 'codeBlock' || side !== 'before'))
    test(`${type}: Tab ${side} inserts editable indentation without replacing the block`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await ready(page, markdown);
      const original = await doc(page);
      await clickSide(page, index);
      const boundary = await selection(page);
      await page.keyboard.press('Shift+Tab');
      expect(await doc(page)).toEqual(original);
      expect(await selection(page)).toEqual(boundary);
      await expect(page.locator('.article-editor')).toBeFocused();

      await page.keyboard.press('Tab');
      await expect(page.locator('.article-editor')).toBeFocused();
      const indented = await doc(page);
      const blockIndex = indented.content.findIndex(
        (node: any) => node.type === type,
      );
      const paragraphIndex = blockIndex + (side === 'before' ? -1 : 1);
      expect(indented.content[paragraphIndex]).toMatchObject({
        type: 'paragraph',
        content: [{ type: 'text', text: '\t' }],
      });
      expect(indented.content[blockIndex]).toEqual(
        original.content.find((node: any) => node.type === type),
      );
      expect(await selection(page)).toMatchObject({ type: 'text' });
      const caretOffset = await page.evaluate(() => {
        const e = (window as any).__mojian.editor;
        const { from, $from } = e.state.selection;
        return (
          e.view.coordsAtPos(from).left - e.view.coordsAtPos($from.start()).left
        );
      });
      expect(caretOffset).toBeGreaterThan(0);
      await page.keyboard.press('ControlOrMeta+z');
      expect(await doc(page)).toEqual(original);
      expect(await selection(page)).toEqual(boundary);
      await page.keyboard.press('ControlOrMeta+Shift+z');
      expect(await doc(page)).toEqual(indented);
      await page.keyboard.press('Tab');
      await page.keyboard.type('X');
      expect((await doc(page)).content[paragraphIndex].content).toEqual([
        { type: 'text', text: '\t\tX' },
      ]);
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Shift+Tab');
      expect((await doc(page)).content[paragraphIndex].content).toEqual([
        { type: 'text', text: '\t' },
      ]);
      await page
        .getByRole('button', { name: 'Markdown 源码', exact: true })
        .click();
      await page
        .getByRole('button', { name: '所见即所得', exact: true })
        .click();
      expect(await doc(page)).toEqual(indented);
      expect(errors).toEqual([]);
    });

for (const side of ['before', 'after', 'selected'] as const)
  test(`image: Tab changes image indentation from ${side}, with undo and persistence`, async ({
    page,
  }) => {
    await ready(
      page,
      '前文\n\n![图片](https://example.test/boundary.svg "width=50%")\n\n后文',
    );
    const original = await doc(page);
    if (side === 'selected') {
      await page.evaluate(() => {
        const e = (window as any).__mojian.editor;
        e.state.doc.descendants((node: any, pos: number) => {
          if (node.type.name === 'image') e.commands.setNodeSelection(pos);
        });
        e.commands.focus();
      });
    } else await clickSide(page, side === 'before' ? 0 : 1);
    await expect(page.locator('.article-editor')).toBeFocused();
    const cursor = await selection(page);
    const image = () =>
      page.evaluate(() => {
        const e = (window as any).__mojian.editor;
        let attrs: any;
        e.state.doc.descendants((node: any) => {
          if (node.type.name === 'image') attrs = node.attrs;
        });
        return attrs;
      });
    const left = (await page.locator('.image-box').boundingBox())!.x;
    await page.keyboard.press('Shift+Tab');
    expect(await doc(page)).toEqual(original);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await image()).toMatchObject({ indent: 2, percent: 50 });
    expect((await doc(page)).content).toHaveLength(original.content.length);
    expect(await selection(page)).toEqual(cursor);
    await expect(page.locator('.article-editor')).toBeFocused();
    expect((await page.locator('.image-box').boundingBox())!.x).toBeGreaterThan(
      left,
    );
    await page.keyboard.press('ControlOrMeta+z');
    expect(await image()).toMatchObject({ indent: 1 });
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await image()).toMatchObject({ indent: 2 });
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    expect(await doc(page)).toEqual(original);
    await page.keyboard.press('Tab');
    const raw = await page.evaluate(() =>
      (window as any).__mojian.getMarkdown(),
    );
    expect(raw).toContain('width=50% indent=1');
    await page
      .getByRole('button', { name: 'Markdown 源码', exact: true })
      .click();
    await page.getByRole('button', { name: '所见即所得', exact: true }).click();
    expect(await image()).toMatchObject({ indent: 1, percent: 50 });
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    await page.reload();
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    expect(await image()).toMatchObject({ indent: 1, percent: 50 });
    await page.getByRole('button', { name: '公众号预览', exact: true }).click();
    const preview = page.locator('.preview-paper img');
    await expect
      .poll(() =>
        preview.evaluate(
          (el) => getComputedStyle(el.parentElement!).paddingLeft,
        ),
      )
      .toBe('24px');
    expect(await preview.evaluate((el) => el.style.width)).toBe('50%');
    const geometry = await preview.evaluate((el) => {
      const image = el.getBoundingClientRect();
      const frame = el.parentElement!;
      const style = getComputedStyle(frame);
      return {
        display: style.display,
        width: image.width,
        available:
          frame.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
        left: image.left,
        contentLeft:
          frame.getBoundingClientRect().left + parseFloat(style.paddingLeft),
      };
    });
    expect(geometry.display).toBe('block');
    expect(geometry.width).toBeCloseTo(geometry.available / 2, 0);
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.contentLeft);
    expect(
      await page.evaluate(() => {
        const root = new DOMParser().parseFromString(
          (window as any).__mojian.getOutput().html,
          'text/html',
        );
        return root.querySelector('img')!.parentElement!.style.paddingLeft;
      }),
    ).toBe('min(24px, 40%)');
  });

test('code block: Tab at the left side indents the whole block, while text still goes above it', async ({
  page,
}) => {
  await ready(page, blocks[0][1]);
  const original = await doc(page);
  await clickSide(page, 0);
  const cursor = await selection(page);
  const left = (await page.locator('.code-node').boundingBox())!.x;
  await page.keyboard.press('Tab');
  expect((await doc(page)).content[0].attrs.indent).toBe(1);
  expect((await doc(page)).content[0].content).toEqual(
    original.content[0].content,
  );
  expect(await selection(page)).toEqual(cursor);
  expect((await page.locator('.code-node').boundingBox())!.x).toBeGreaterThan(
    left,
  );
  await page.keyboard.press('Shift+Tab');
  expect(await doc(page)).toEqual(original);
  await page.keyboard.press('Tab');
  await page.keyboard.insertText('代码说明');
  expect((await doc(page)).content[0]).toMatchObject({
    type: 'paragraph',
    content: [{ text: '代码说明' }],
  });
  expect((await doc(page)).content[1].attrs.indent).toBe(1);
  await page.keyboard.press('ControlOrMeta+z');
  expect((await doc(page)).content[0].type).toBe('codeBlock');
  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  await expect(page.locator('.source-editor')).toHaveValue(/```js indent=1/);
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.reload();
  await page.waitForFunction(() => !!window.__mojian?.editor);
  expect((await doc(page)).content[0].attrs.indent).toBe(1);
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('.preview-paper [data-code-block]')).toBeVisible();
  expect(
    await page
      .locator('.preview-paper [data-code-block]')
      .evaluate((el) => getComputedStyle(el.parentElement!).paddingLeft),
  ).toBe('24px');
  expect(
    await page.evaluate(() => window.__mojian!.getOutput()!.html),
  ).toContain('padding-left: min(24px, 40%)');
  await page.evaluate(
    (markdown) => window.__mojian!.setMarkdown(markdown),
    blocks[1][1] + '\n\n' + blocks[0][1],
  );
  const adjacent = (await page.locator('.code-node').boundingBox())!;
  await page.mouse.click(adjacent.x - 20, adjacent.y + adjacent.height / 2);
  await page.keyboard.press('Tab');
  expect((await doc(page)).content[0].attrs.indent).toBe(0);
  expect((await doc(page)).content[1].attrs.indent).toBe(1);
});

for (const key of ['Backspace', 'Delete'])
  test(`code block: ${key} before the block removes one indentation step before deleting content`, async ({
    page,
  }) => {
    await ready(page, '前文\n\n' + blocks[0][1]);
    const original = await doc(page);
    await clickSide(page, 0);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const cursor = await selection(page);
    for (const indent of [1, 0]) {
      await page.keyboard.press(key);
      const current = await doc(page);
      expect(current.content[1].attrs.indent).toBe(indent);
      expect(current.content[1].content).toEqual(original.content[1].content);
      expect(current.content[0]).toEqual(original.content[0]);
      expect(await selection(page)).toEqual(cursor);
    }
    await page.keyboard.press('ControlOrMeta+z');
    expect((await doc(page)).content[1].attrs.indent).toBe(1);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect((await doc(page)).content[1].attrs.indent).toBe(0);
    // Once indentation is gone, forward deletion resumes block selection.
    if (key === 'Delete') {
      await page.keyboard.press(key);
      expect(await selection(page)).toMatchObject({ type: 'node' });
      expect((await doc(page)).content[1].type).toBe('codeBlock');
    }
  });

test('mixed image paragraphs keep text on the same line, wrap naturally, and preserve indentation and copy', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(
    page,
    '图片说明 ![图片](https://example.test/boundary.svg "width=40%") 后文',
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const line = page.locator('.article-editor > p');
  await expect(line).toHaveCount(1);
  await expect(line.locator('.inline-image-node')).toHaveCount(1);
  const geometry = () =>
    line.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el.firstChild!);
      const text = range.getClientRects()[0];
      const image = el.querySelector('img')!.getBoundingClientRect();
      return {
        textBottom: text.bottom,
        imageTop: image.top,
        imageBottom: image.bottom,
      };
    });
  const initial = await geometry();
  expect(initial.textBottom).toBeGreaterThan(initial.imageTop);
  await page.evaluate(() => {
    const editor = window.__mojian!.editor!;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'inlineImage')
        editor.commands.setTextSelection(pos);
    });
    editor.commands.focus();
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.inline-image-node > span')).toHaveCSS(
    'padding-left',
    '24px',
  );
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.inline-image-node > span')).toHaveCSS(
    'padding-left',
    '0px',
  );
  await page.keyboard.insertText('长说明'.repeat(100));
  expect((await geometry()).imageTop).toBeGreaterThan(initial.imageTop);
  await page.keyboard.press('ControlOrMeta+z');
  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  await expect(page.locator('.source-editor')).toHaveValue(
    /^图片说明 !\[图片\].* 后文$/,
  );
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  await page.evaluate(() => {
    const editor = window.__mojian!.editor!;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'inlineImage')
        editor.chain().setNodeSelection(pos).focus().run();
    });
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+c');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('![图片]');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.reload();
  await page.waitForFunction(() => !!window.__mojian?.editor);
  await expect(page.locator('.inline-image-node')).toBeVisible();
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('.preview-paper img')).toBeVisible();
  await expect(page.locator('.preview-paper img')).toHaveCSS(
    'display',
    'inline-block',
  );
  const output = await page.evaluate(() => window.__mojian!.getOutput()!.html);
  expect(output).toContain('display: inline-block');
  await page.evaluate(() =>
    window.__mojian!.editor!.chain().selectAll().focus().run(),
  );
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+c');
  await page.evaluate(() => window.__mojian!.setMarkdown(''));
  await page.locator('.article-editor').click();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.inline-image-node')).toBeVisible();
  const pasted = await doc(page);
  expect(pasted.content[0].content).toMatchObject([
    { type: 'text', text: '图片说明 ' },
    { type: 'inlineImage', attrs: { percent: 40 } },
    { type: 'text', text: ' 后文' },
  ]);
  await expect(page.locator('.image-controls')).toHaveCount(0);
  await dragImageWidth(page, 50);
  await page.evaluate(() => {
    const editor = window.__mojian!.editor!;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'inlineImage')
        editor.commands.setTextSelection(pos + node.nodeSize);
    });
    editor.commands.focus();
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('Backspace');
  await expect(page.locator('.image-node')).toHaveCount(0);
  await expect(page.locator('.article-editor > p')).toHaveText(
    '图片说明  后文',
  );
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.inline-image-node')).toBeVisible();
  expect((await doc(page)).content[0].content[1].attrs.percent).toBe(50);
  await page.evaluate(async () => {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob(
          [
            '<p>外部文字<img src="https://example.test/boundary.svg" alt="外部图片" title="width=30%">后文</p>',
          ],
          { type: 'text/html' },
        ),
        'text/plain': new Blob(['外部文字后文'], { type: 'text/plain' }),
      }),
    ]);
    window.__mojian!.editor!.chain().selectAll().focus().run();
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+v');
  expect((await doc(page)).content[0].content).toMatchObject([
    { type: 'text', text: '外部文字' },
    { type: 'inlineImage', attrs: { percent: 30 } },
    { type: 'text', text: '后文' },
  ]);
  expect(errors).toEqual([]);
});

for (const [arrow, pos] of [
  ['ArrowLeft', 0],
  ['ArrowRight', 1],
] as const)
  test(`arrow-key gap cursor ${arrow} beside an image supports indentation and keeps focus`, async ({
    page,
  }) => {
    await ready(page, blocks[1][1] + '\n\n---');
    const original = await doc(page);
    await page.evaluate(() =>
      (window as any).__mojian.editor.chain().setNodeSelection(0).focus().run(),
    );
    await expect(page.locator('.article-editor')).toBeFocused();
    await page.keyboard.press(arrow);
    const cursor = await selection(page);
    expect(cursor).toEqual({ type: 'gapcursor', pos });
    await page.keyboard.press('Tab');
    expect((await doc(page)).content[0].attrs.indent).toBe(1);
    expect(await selection(page)).toEqual(cursor);
    await expect(page.locator('.article-editor')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await doc(page)).toEqual(original);
    await page.keyboard.press('ControlOrMeta+z');
    expect((await doc(page)).content[0].attrs.indent).toBe(1);
    await expect(page.locator('.article-editor')).toBeFocused();
    const indented = await doc(page);
    await page.keyboard.press(arrow === 'ArrowLeft' ? 'Delete' : 'Backspace');
    await expect(page.locator('.image-node')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    expect(await doc(page)).toEqual(indented);
  });

for (const container of ['table', 'nested quote'])
  test(`image indentation stays visible inside a narrow ${container} in editor, preview and clipboard HTML`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await ready(page, '');
    await page.evaluate((container) => {
      const paragraph = (text = '') => ({
        type: 'paragraph',
        ...(text ? { content: [{ type: 'text', text }] } : {}),
      });
      const image = {
        type: 'image',
        attrs: { src: 'https://example.test/boundary.svg', percent: 100 },
      };
      const cell = (content: any[]) => ({ type: 'tableCell', content });
      const content =
        container === 'table'
          ? [
              {
                type: 'table',
                content: [
                  {
                    type: 'tableRow',
                    content: [
                      cell([paragraph(), image]),
                      cell([paragraph('第二列')]),
                      cell([paragraph('第三列')]),
                    ],
                  },
                ],
              },
            ]
          : [
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [
                      paragraph('外层'),
                      {
                        type: 'bulletList',
                        content: [
                          {
                            type: 'listItem',
                            content: [
                              paragraph('内层'),
                              {
                                type: 'blockquote',
                                content: [
                                  { type: 'blockquote', content: [image] },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ];
      const e = (window as any).__mojian.editor;
      e.commands.setContent({ type: 'doc', content });
      e.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'image') e.commands.setNodeSelection(pos);
      });
      e.commands.focus();
    }, container);
    await expect(page.locator('.article-editor')).toBeFocused();
    const originalWidth = (await page.locator('.image-box').boundingBox())!
      .width;
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    expect(
      (await page.locator('.image-box').boundingBox())!.width,
    ).toBeGreaterThanOrEqual(originalWidth * 0.59);
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await page.locator('.image-box').evaluate((el) => {
        const frame = el.parentElement!.parentElement!;
        return {
          image: el.getBoundingClientRect().width,
          frame: frame.clientWidth,
          padding: parseFloat(getComputedStyle(frame).paddingLeft),
        };
      });
      expect(geometry.image).toBeGreaterThan(0);
      expect(geometry.padding).toBeLessThanOrEqual(geometry.frame * 0.4 + 1);
    }
    await page.getByRole('button', { name: '公众号预览', exact: true }).click();
    const preview = page.locator('.preview-paper img');
    await expect(preview).toBeVisible();
    expect((await preview.boundingBox())!.width).toBeGreaterThan(0);
    const copiedWidth = await page.evaluate(() => {
      const host = document.createElement('div');
      host.style.cssText =
        'position:fixed;left:-10000px;width:240px;visibility:hidden;';
      host.innerHTML = (window as any).__mojian.getOutput().html;
      document.body.append(host);
      const width = host.querySelector('img')!.getBoundingClientRect().width;
      host.remove();
      return width;
    });
    expect(copiedWidth).toBeGreaterThan(0);
    const inline =
      '说明 ![图片](https://example.test/boundary.svg "width=40%") 后文';
    await page.evaluate(
      (markdown) => {
        window.__mojian!.setMarkdown(markdown);
        window.__mojian!.editor!.state.doc.check();
      },
      container === 'table'
        ? `| 标题 |\n| --- |\n| ${inline} |`
        : `> > ${inline}`,
    );
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect(page.locator('.inline-image-node')).toBeVisible();
  });

test('image indentation is bounded, remains visible on mobile and is protected by read-only mode', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await ready(page, blocks[1][1]);
  await clickSide(page, 0);
  for (let i = 0; i < 10; i++) await page.keyboard.press('Tab');
  const indented = await doc(page);
  expect(indented.content[0].attrs.indent).toBe(6);
  expect(
    indented.content.filter((node: any) => node.type === 'image'),
  ).toHaveLength(1);
  expect(
    (await page.locator('.image-box').boundingBox())!.width,
  ).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await page.getByRole('switch', { name: '只读模式' }).click();
  await page
    .locator('.article-editor')
    .dispatchEvent('keydown', { key: 'Tab', code: 'Tab' });
  expect(await doc(page)).toEqual(indented);
  await page.getByRole('switch', { name: '只读模式' }).click();
  await clickSide(page, 0);
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+Tab');
  expect((await doc(page)).content[0].attrs.indent).toBe(0);
});

test('indented local images keep enlarged scrolling and indentation around copied upload placeholders', async ({
  page,
}) => {
  await ready(page, '');
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 16;
    canvas.getContext('2d')!.fillRect(0, 0, 32, 16);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!)),
    );
    const { storeImage } = await import('/src/storage.ts');
    const src = await storeImage(blob);
    (window as any).__mojian.setMarkdown(
      `![本地图](${src} "width=150% indent=3")`,
    );
  });
  await expect(page.locator('.image-box img')).toBeVisible();
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('.preview-paper img')).toBeVisible();
  await expect(page.locator('.preview-paper [data-image-scroll]')).toHaveCount(
    1,
  );
  expect(
    await page.evaluate(() => {
      const root = new DOMParser().parseFromString(
        (window as any).__mojian.getOutput().html,
        'text/html',
      );
      let el = Array.from(root.querySelectorAll('*')).find(
        (el) =>
          !el.children.length &&
          el.textContent?.startsWith('[请在此处上传本地图片'),
      ) as HTMLElement | undefined;
      while (el) {
        if (el.style.paddingLeft === 'min(72px, 40%)') return true;
        el = el.parentElement ?? undefined;
      }
      return false;
    }),
  ).toBe(true);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
});

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
      if (type === 'image')
        expectInlineImageText(
          result,
          side === 'before' ? 'left' : 'right',
          'New prose',
        );
      else
        expect(result.content[i + (side === 'before' ? -1 : 1)]).toMatchObject({
          type: 'paragraph',
          content: [{ type: 'text', text: 'New prose' }],
        });
      await expect(page.locator('.article-editor')).toBeFocused();
      await expect(page.locator('.block-side-cursor')).toBeHidden();
      await page.keyboard.press('ControlOrMeta+z');
      expect(await doc(page)).toEqual(before);
      if (type === 'codeBlock')
        await expect
          .poll(() => selection(page))
          .toMatchObject({
            type: 'blockCursor',
            edge: side === 'before' ? 'left' : 'right',
          });
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
test('side insertion after code joins a following image without changing the code', async ({
  page,
}) => {
  await ready(page, blocks.map(([, text]) => text).join('\n\n'));
  await expect(page.locator('.block-insertion-hit')).toHaveCount(0);
  await clickSide(page, 1);
  await page.keyboard.type('Between');
  expect((await doc(page)).content.slice(0, 3).map((n: any) => n.type)).toEqual(
    ['codeBlock', 'paragraph', 'horizontalRule'],
  );
  expectInlineImageText(await doc(page), 'left', 'Between');
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
  image: '.image-box',
  horizontalRule: '.article-editor hr',
  table: '.tableWrapper',
};
// Code/table geometry is covered at three heights by the baseline test below.
for (const [type, markdown] of cursorBlocks.filter(
  ([type]) => type === 'image' || type === 'horizontalRule',
))
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
        await expect(
          page.getByRole('button', { name: '拖拽调整图片宽度', exact: true }),
        ).toBeVisible();
      const currentBox = await page.locator(blockSelectors[type]).boundingBox();
      const caret = await bottomCaret(page, currentBox!);
      if (edge === 'left') expect(caret!.x).toBeLessThan(box!.x);
      else expect(caret!.x).toBeGreaterThan(box!.x + box!.width);
      await expect(page.locator('.ProseMirror-gapcursor')).toHaveClass(
        /block-side-cursor/,
      );
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
        if (edge === 'left') expect(caret.x).toBeLessThan(box!.x);
        else expect(caret.x).toBeGreaterThan(box!.x + box!.width);
        await expect(page.locator('.ProseMirror-gapcursor')).toHaveClass(
          /block-side-cursor/,
        );
        positions.push(caret!.y);
        expect(
          Math.abs(caret!.y + caret!.height - (box!.y + box!.height)),
        ).toBeLessThan(1);
        expect(await doc(page)).toEqual(original);
      }
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
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
  test(`small image: the ${edge} caret and selection frame follow the visible image`, async ({
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
    await expect(
      page.getByRole('button', { name: '拖拽调整图片宽度', exact: true }),
    ).toBeVisible();
    const selected = await page.locator('.image-node').boundingBox();
    await expect(page.locator('.node-image')).toHaveCSS(
      'outline-style',
      'none',
    );
    const frame = page.locator('.image-box');
    await expect(frame).toHaveCSS('outline-style', 'solid');
    await expect(frame).toHaveCSS('outline-offset', '0px');
    const image = (await page.locator('.image-box img').boundingBox())!;
    const frameBounds = (await frame.boundingBox())!;
    expect(frameBounds.width).toBeCloseTo(image.width, 1);
    expect(frameBounds.height).toBeCloseTo(image.height, 1);
    const inner = await page.locator('.image-box').boundingBox();
    expect(inner!.width).toBeLessThan(selected!.width * 0.4);
    await page.mouse.click(
      edge === 'left' ? selected!.x - 20 : selected!.x + selected!.width + 20,
      selected!.y + selected!.height / 2,
    );
    await expect
      .poll(() => selection(page))
      .toMatchObject({ type: 'imageSide', edge });
    await expect(
      page.getByRole('button', { name: '拖拽调整图片宽度', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.image-node')).toHaveCSS(
      'outline-style',
      'none',
    );
    await expect(
      page.locator('.node-image.ProseMirror-selectednode'),
    ).toHaveCSS('outline-style', 'none');
    await expect(page.locator('.image-node')).toHaveClass(/selected/);
    expect(
      await page.evaluate(() =>
        (window as any).__mojian.editor.isActive('image'),
      ),
    ).toBe(true);
    await expect(page.locator('.block-cursor-image')).toHaveCount(0);
    let caret: Rect | null = null;
    await expect
      .poll(async () => {
        const outer = await page.locator('.image-box').boundingBox();
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

    await page.keyboard.insertText('新增正文');
    const result = await doc(page);
    expectInlineImageText(result, edge, '新增正文');
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

for (const percent of [1, 35, 150])
  test(`mobile image at ${percent}%: the frame fits the image and its trailing caret stays inside the viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(
      page,
      `![图片](https://example.test/boundary.svg "width=${percent}%")`,
    );
    const outer = (await page.locator('.image-node').boundingBox())!;
    const image = (await page.locator('.image-box img').boundingBox())!;
    const surface = (await page.locator('.writing-scroll').boundingBox())!;
    await page.mouse.click(
      Math.min(outer.x + outer.width + 12, surface.x + surface.width - 2),
      image.y + image.height / 2,
    );
    await expect
      .poll(() => selection(page))
      .toMatchObject({ type: 'imageSide', edge: 'right' });
    const frame = (await page.locator('.image-box').boundingBox())!;
    expect(frame.width).toBeCloseTo(image.width, 1);
    expect(frame.height).toBeCloseTo(image.height, 1);
    await expect(page.locator('.node-image')).toHaveCSS(
      'outline-style',
      'none',
    );
    const checkCaret = async () => {
      await expect(page.locator('.block-side-cursor')).toBeVisible();
      await expect
        .poll(async () => {
          const caret = (await page
            .locator('.block-side-cursor')
            .boundingBox())!;
          const currentImage = (await page
            .locator('.image-box img')
            .boundingBox())!;
          return (
            caret.x >= surface.x &&
            caret.x + caret.width < surface.x + surface.width &&
            Math.abs(
              caret.y + caret.height - currentImage.y - currentImage.height,
            ) < 1
          );
        })
        .toBe(true);
    };
    await checkCaret();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await checkCaret();
    await page.keyboard.insertText('后文');
    expectInlineImageText(await doc(page), 'right', '后文');
  });

test('blank space beside the visible image places a side cursor', async ({
  page,
}) => {
  await ready(page, smallImage);
  const outer = await page.locator('.image-node').boundingBox();
  const inner = await page.locator('.image-box').boundingBox();
  await page.mouse.click(inner!.x - 20, inner!.y + inner!.height / 2);
  expect(await selection(page)).toMatchObject({
    type: 'imageSide',
    edge: 'left',
  });
  expect(inner!.x - 20).toBeGreaterThan(outer!.x);
  await expect(page.locator('.block-side-cursor')).toBeVisible();
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
    expectInlineImageText(result, edge, '中文正文');
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
    expectInlineImageText(result, edge, '粘贴正文');
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
  const at = result.content.findIndex((n: any) =>
    n.content?.some((child: any) => child.type === 'inlineImage'),
  );
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
});
