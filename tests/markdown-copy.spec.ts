import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
async function ready(page: Page, text: string) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(
    (text) => (window as any).__mojian.setMarkdown(text),
    text,
  );
}
async function copy(page: Page, type = 'copy') {
  return page.evaluate((type) => {
    const editor = (window as any).__mojian.editor;
    editor.commands.focus(undefined, { scrollIntoView: false });
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
      markdown: (window as any).__mojian.getMarkdown(),
    };
  }, type);
}
async function selectText(
  page: Page,
  text: string,
  start = 0,
  end = text.length,
) {
  await page.evaluate(
    ({ text, start, end }) => {
      const editor = (window as any).__mojian.editor;
      let from = -1;
      editor.state.doc.descendants((node: any, pos: number) => {
        if (from < 0 && node.isText && node.text.includes(text))
          from = pos + node.text.indexOf(text);
      });
      if (from < 0) throw new Error('Missing selection text');
      editor.commands.setTextSelection({ from: from + start, to: from + end });
    },
    { text, start, end },
  );
}

async function selectLocalImage(page: Page) {
  await ready(page, '');
  const src = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 16;
    canvas.getContext('2d')!.fillRect(0, 0, 32, 16);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!)),
    );
    const { storeImage } = await import('/src/storage.ts');
    return storeImage(blob);
  });
  await page.evaluate(
    (src) =>
      (window as any).__mojian.setMarkdown(
        `![跨存储图片](${src} "width=40% indent=2")`,
      ),
    src,
  );
  await page.waitForFunction(
    () =>
      (document.querySelector('.image-box img') as HTMLImageElement)
        ?.naturalWidth > 0,
  );
  await page.evaluate(() =>
    (window as any).__mojian.editor.chain().setNodeSelection(0).focus().run(),
  );
  await expect(page.locator('.article-editor')).toBeFocused();
  return src;
}

test('image clipboard imports pixels into independent storage and preserves image width', async ({
  page,
  context,
  browser,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const src = await selectLocalImage(page);
  await page.evaluate(() => navigator.clipboard.writeText('seed'));
  await page.keyboard.press('ControlOrMeta+c');
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await navigator.clipboard.read())[0].types.includes('image/png'),
      ),
    )
    .toBe(true);
  const targetContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  try {
    const target = await targetContext.newPage();
    await ready(target, '');
    await target.locator('.article-editor').click();
    await target.keyboard.press('ControlOrMeta+v');
    await expect(target.locator('.image-box img')).toBeVisible();
    await expect
      .poll(() =>
        target
          .locator('.image-box img')
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(32);
    const attrs = await target.evaluate(
      () => (window as any).__mojian.editor.state.doc.firstChild.attrs,
    );
    expect(attrs.src).not.toBe(src);
    expect(attrs.percent).toBe(40);
    expect(attrs.indent).toBe(2);
    await expect(target.locator('.missing-image')).toHaveCount(0);
    await target.keyboard.press('ControlOrMeta+z');
    await expect(target.locator('.image-node')).toHaveCount(0);
    await target.keyboard.press('ControlOrMeta+Shift+z');
    await expect(target.locator('.image-box img')).toBeVisible();
  } finally {
    await targetContext.close();
  }
});

for (const mode of ['missing', 'denied'])
  test(`image shortcut retains native copy when async clipboard is ${mode}`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const src = await selectLocalImage(page);
    await page.evaluate(async (mode) => {
      await navigator.clipboard.writeText('sentinel');
      Object.defineProperty(navigator.clipboard, 'write', {
        configurable: true,
        value:
          mode === 'missing'
            ? undefined
            : () =>
                Promise.reject(new DOMException('Denied', 'NotAllowedError')),
      });
    }, mode);
    await page.keyboard.press('ControlOrMeta+c');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(src);
    expect(
      await page.evaluate(
        async () => (await navigator.clipboard.read())[0].types,
      ),
    ).toContain('text/html');
  });

test('CORS-enabled remote image copies PNG pixels', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('https://cors-image.test/copy.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      headers: { 'access-control-allow-origin': '*' },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="red"/></svg>',
    }),
  );
  await ready(page, '![网络图](https://cors-image.test/copy.svg)');
  await page.waitForFunction(
    () =>
      (document.querySelector('.image-box img') as HTMLImageElement)
        ?.naturalWidth > 0,
  );
  await page.evaluate(() =>
    (window as any).__mojian.editor.chain().setNodeSelection(0).focus().run(),
  );
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.evaluate(() => navigator.clipboard.writeText('seed'));
  await page.keyboard.press('ControlOrMeta+c');
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await navigator.clipboard.read())[0].types.includes('image/png'),
      ),
    )
    .toBe(true);
  const size = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0];
    const bitmap = await createImageBitmap(await item.getType('image/png'));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  });
  expect(size).toEqual({ width: 32, height: 16 });
});

test('a slow image copy cannot overwrite a later text copy', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const corsRequest = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route('https://cors-image.test/slow.svg', async (route) => {
    if (route.request().headers().origin) {
      requested();
      await responseGate;
    }
    await route.fulfill({
      contentType: 'image/svg+xml',
      headers: { 'access-control-allow-origin': '*' },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="red"/></svg>',
    });
  });
  await ready(
    page,
    '![慢图片](https://cors-image.test/slow.svg)\n\n最后复制的文字',
  );
  await page.waitForFunction(
    () =>
      (document.querySelector('.image-box img') as HTMLImageElement)
        ?.naturalWidth > 0,
  );
  await page.evaluate(() => {
    const write = navigator.clipboard.write.bind(navigator.clipboard);
    (window as any).__imageCopyDone = false;
    navigator.clipboard.write = async (items) => {
      try {
        return await write(items);
      } finally {
        (window as any).__imageCopyDone = true;
      }
    };
    (window as any).__mojian.editor.chain().setNodeSelection(0).focus().run();
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+c');
  await corsRequest;
  await selectText(page, '最后复制的文字');
  await page.keyboard.press('ControlOrMeta+c');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('最后复制的文字');
  release();
  await page.waitForFunction(() => (window as any).__imageCopyDone);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    '最后复制的文字',
  );
});

test('CORS-denied image keeps native rich copy without rewriting the clipboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/copy-image.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      headers: {
        'access-control-allow-origin': 'https://different-origin.test',
      },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#ddd"/></svg>',
    }),
  );
  await ready(
    page,
    '![可复制图片](https://example.test/copy-image.svg "width=50%")\n\n粘贴位置',
  );
  await expect(page.locator('.image-box img')).toBeVisible();
  await page.waitForFunction(
    () =>
      (document.querySelector('.image-box img') as HTMLImageElement)
        ?.naturalWidth > 0,
  );
  const box = await page.locator('.image-node').boundingBox();
  await page.mouse.click(box!.x - 20, box!.y + box!.height / 2);
  await expect(page.locator('.image-node')).toHaveClass(/selected/);
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('old clipboard');
    const write = navigator.clipboard.write.bind(navigator.clipboard);
    (window as any).__imageCopyAttempts = 0;
    (window as any).__imageCopyFinished = false;
    navigator.clipboard.write = async (items) => {
      (window as any).__imageCopyAttempts++;
      try {
        return await write(items);
      } finally {
        (window as any).__imageCopyFinished = true;
      }
    };
  });
  await page.keyboard.press('ControlOrMeta+c');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('![可复制图片]');
  await page.waitForFunction(() => (window as any).__imageCopyFinished);
  expect(await page.evaluate(() => (window as any).__imageCopyAttempts)).toBe(
    1,
  );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        try {
          const item = (await navigator.clipboard.read())[0];
          return {
            text: await (await item.getType('text/plain')).text(),
            html: item.types.includes('text/html')
              ? await (await item.getType('text/html')).text()
              : '',
          };
        } catch (error) {
          if (
            error instanceof DOMException &&
            error.name === 'InvalidStateError'
          )
            return null;
          throw error;
        }
      }),
    )
    .toMatchObject({
      text: expect.stringContaining('![可复制图片]'),
      html: expect.stringMatching(
        /<img\b[^>]*src="https:\/\/example\.test\/copy-image\.svg"/,
      ),
    });
  await page.evaluate(() =>
    (window as any).__mojian.editor.commands.focus('end'),
  );
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.image-node')).toHaveCount(2);
  expect(
    await page.evaluate(() =>
      (() => {
        const widths: number[] = [];
        (window as any).__mojian.editor.state.doc.descendants((node: any) => {
          if (['image', 'inlineImage'].includes(node.type.name))
            widths.push(node.attrs.percent);
        });
        return widths;
      })(),
    ),
  ).toEqual([50, 50]);
});

for (const mode of ['editor', 'preview', 'read-only'])
  test(`local image shortcut copies PNG pixels and pastes an image, mode=${mode}`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await ready(page, '');
    const src = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 80;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#ff0000';
      context.fillRect(0, 0, 120, 80);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((blob) => resolve(blob!)),
      );
      const { storeImage } = await import('/src/storage.ts');
      return storeImage(blob);
    });
    await page.evaluate(
      (src) =>
        (window as any).__mojian.setMarkdown(
          `![本地图](${src} "width=40%")\n\n后文`,
        ),
      src,
    );
    const image = page.locator('.image-box img');
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const before = await page.evaluate(() =>
      (window as any).__mojian.getMarkdown(),
    );
    const preview = mode !== 'editor';
    if (mode === 'read-only')
      await page.getByRole('switch', { name: '只读模式' }).click();
    if (preview) await image.click();
    else
      await page.evaluate(() =>
        (window as any).__mojian.editor
          .chain()
          .setNodeSelection(0)
          .focus()
          .run(),
      );
    await expect(
      preview
        ? page.getByRole('region', { name: '图片预览' })
        : page.locator('.article-editor'),
    ).toBeFocused();
    await page.evaluate(() => navigator.clipboard.writeText('old clipboard'));
    await page.keyboard.press(
      mode === 'read-only' ? 'Control+c' : 'ControlOrMeta+c',
    );
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await navigator.clipboard.read())[0].types.includes('image/png'),
        ),
      )
      .toBe(true);
    const copied = await page.evaluate(async () => {
      const item = (await navigator.clipboard.read())[0];
      const blob = await item.getType('image/png');
      const bitmap = await createImageBitmap(blob);
      const result = {
        width: bitmap.width,
        height: bitmap.height,
        html: await (await item.getType('text/html')).text(),
      };
      bitmap.close();
      return result;
    });
    expect(copied).toMatchObject({ width: 120, height: 80 });
    expect(copied.html).toContain('data:image/png;base64,');
    expect(
      await page.evaluate(() => (window as any).__mojian.getMarkdown()),
    ).toBe(before);
    if (preview) await page.keyboard.press('Escape');
    if (mode === 'read-only')
      await page.getByRole('switch', { name: '只读模式' }).click();
    await expect(page.locator('.article-editor')).toHaveAttribute(
      'contenteditable',
      'true',
    );
    await page.evaluate(() =>
      (window as any).__mojian.editor.commands.focus('end'),
    );
    await expect(page.locator('.article-editor')).toBeFocused();
    await page.keyboard.press('ControlOrMeta+v');
    await expect(page.locator('.image-node')).toHaveCount(2);
    if (!preview)
      expect(
        await page.evaluate(() =>
          (() => {
            const widths: number[] = [];
            (window as any).__mojian.editor.state.doc.descendants(
              (node: any) => {
                if (['image', 'inlineImage'].includes(node.type.name))
                  widths.push(node.attrs.percent);
              },
            );
            return widths;
          })(),
        ),
      ).toEqual([40, 40]);
    expect(errors).toEqual([]);
  });

test('WYSIWYG copy writes Markdown text and retains native rich HTML for a full selection', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(
    page,
    '# 标题\n\n正文 **加粗** 和 *斜体*、[链接](https://example.com)\n\n- 项目一\n  - 嵌套项目\n\n1. 有序项\n\n> 引用\n\n| 名称 | 值 |\n| :---: | ---: |\n| 表格内容 | 123 |\n\n```js\nconst value = 1;\n```',
  );
  const before = await page.evaluate(() =>
    (window as any).__mojian.getMarkdown(),
  );
  await page.locator('.article-editor').click();
  await page.evaluate(() =>
    (window as any).__mojian.editor.commands.selectAll(),
  );
  await page.keyboard.press('ControlOrMeta+c');
  const data = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0];
    return {
      text: await (await item.getType('text/plain')).text(),
      html: await (await item.getType('text/html')).text(),
    };
  });
  for (const part of [
    '# 标题',
    '**加粗**',
    '*斜体*',
    '[链接](https://example.com)',
    '- 项目一',
    '嵌套项目',
    '1. 有序项',
    '> 引用',
    '| 名称',
    '```js',
    'const value = 1;',
  ])
    expect(data.text).toContain(part);
  expect(data.text).toMatch(/:-{3,}:/);
  for (const tag of ['<h1', '<strong', '<ul', '<ol', '<table', '<pre'])
    expect(data.html).toContain(tag);
  expect(
    await page.evaluate(() => (window as any).__mojian.getMarkdown()),
  ).toBe(before);
});
test('partial selections copy only selected text while retaining heading, list and inline marks', async ({
  page,
}) => {
  await ready(
    page,
    '## 大纲标题\n\n普通 **加粗文字** 段落\n\n- 第一项目\n- 第二项目\n\n```js\nconst first = 1;\nconst second = 2;\n```',
  );
  await selectText(page, '加粗文字', 1, 3);
  expect((await copy(page)).text.trim()).toBe('**粗文**');
  await selectText(page, '大纲标题', 0, 2);
  expect((await copy(page)).text.trim()).toBe('## 大纲');
  await selectText(page, '第二项目');
  const list = await copy(page);
  expect(list.text).toContain('- 第二项目');
  expect(list.text).not.toContain('第一项目');
  await selectText(page, 'const second = 2;');
  const code = await copy(page);
  expect(code.text).toBe('const second = 2;');
  expect(code.text).not.toContain('```');
  expect(code.text).not.toContain('const first');
});
test('selected tables copy GFM alignment and cut keeps Markdown and undo behavior', async ({
  page,
}) => {
  await ready(
    page,
    '| 名称 | 数值 |\n| :---: | ---: |\n| 项目 | 123 |\n\n前面 **剪切文字** 后面',
  );
  await page.evaluate(() => {
    const editor = (window as any).__mojian.editor;
    let pos = 0;
    editor.state.doc.descendants((n: any, p: number) => {
      if (n.type.name === 'table') pos = p;
    });
    editor.commands.setNodeSelection(pos);
  });
  const table = await copy(page);
  expect(table.text).toContain('| 名称');
  expect(table.text).toContain(':---:');
  expect(table.text).toContain('---:');
  expect(table.html).toContain('<table');
  await selectText(page, '剪切文字');
  const cut = await copy(page, 'cut');
  expect(cut.text.trim()).toBe('**剪切文字**');
  await expect(page.locator('.article-editor')).not.toContainText('剪切文字');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor')).toContainText('剪切文字');
});

test('copied prose uses ordinary spaces while intentional code and source NBSP remain unchanged', async ({
  page,
}) => {
  await ready(page, '# 标题\n\n正文\n\n```txt\n代码\n```');
  await page.evaluate(() => {
    const editor = (window as any).__mojian.editor;
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '标题\u00a0文字' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '普通\u00a0\u00a0空格' },
            { type: 'text', text: '加粗\u00a0文字', marks: [{ type: 'bold' }] },
            {
              type: 'text',
              text: 'inline\u00a0code',
              marks: [{ type: 'code' }],
            },
            { type: 'text', text: '字面 &nbsp;' },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'txt' },
          content: [{ type: 'text', text: 'code\u00a0space' }],
        },
      ],
    });
    editor.commands.selectAll();
  });
  const before = await page.evaluate(() =>
    (window as any).__mojian.editor.getJSON(),
  );
  const result = await copy(page);
  expect(result.text).toContain('## 标题 文字');
  expect(result.text).toContain('普通  空格');
  expect(result.text).toContain('**加粗 文字**');
  expect(result.text).toContain('`inline\u00a0code`');
  expect(result.text).toContain('code\u00a0space');
  expect(result.text).toContain('nbsp;');
  expect(result.text.match(/\u00a0/g)).toHaveLength(2);
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getJSON()),
  ).toEqual(before);
});
