import { test, expect } from './fixtures';
import MarkdownIt from 'markdown-it';
import { markdownHighlight } from '../src/highlight';
import { headings } from '../src/headings';

test('unclosed multiline references do not block heading extraction', () => {
  const markdown =
    '[ref]: https://example.com "' + 'x\n'.repeat(200_000) + '\n# 尾部标题\n';
  const start = performance.now();
  const result = headings(markdown);
  expect(performance.now() - start).toBeLessThan(2000);
  expect(result.map((heading) => heading.text)).toEqual(['尾部标题']);
});

test('highlight fragments preserve surrounding formatting and token levels', () => {
  const parser = new MarkdownIt().use(markdownHighlight);
  expect(
    parser.renderInline(
      '**before ==*inside* [link](https://example.com)== after** ' +
        '~~before ==**bold**== after~~ ==`a=b`==',
    ),
  ).toBe(
    '<strong>before <mark><em>inside</em> <a href="https://example.com">link</a></mark> after</strong> ' +
      '<s>before <mark><strong>bold</strong></mark> after</s> <mark><code>a=b</code></mark>',
  );
  const inline = parser.parseInline('**before ==*inside*== after**', {})[0];
  let level = 0;
  for (const token of inline.children!) {
    if (token.nesting < 0) level--;
    expect(token.level).toBe(level);
    if (token.nesting > 0) level++;
  }
  expect(level).toBe(0);
});

test('URL and image attributes do not consume later highlight delimiters', () => {
  const parser = new MarkdownIt().use(markdownHighlight);
  expect(
    parser.renderInline(
      '[链接](https://example.com/?q==x "a==b") ' +
        '![图片](https://example.com/a==b.png) ==重点==',
    ),
  ).toContain('<mark>重点</mark>');
  expect(
    parser.renderInline('[链接 ==标题==](https://example.com) ==正文=='),
  ).toContain(
    '<a href="https://example.com">链接 <mark>标题</mark></a> <mark>正文</mark>',
  );
  expect(parser.renderInline('==前 [链接==](https://example.com)')).toBe(
    '==前 <a href="https://example.com">链接==</a>',
  );
  expect(parser.renderInline('[链接 ==前](https://example.com) 后==')).toBe(
    '<a href="https://example.com">链接 ==前</a> 后==',
  );
});

test('unclosed highlights stay in their own tag and do not block other scopes', () => {
  const parser = new MarkdownIt().use(markdownHighlight);
  const cases = [
    [
      '[==甲](https://a.example) [乙==](https://b.example)',
      '<a href="https://a.example">==甲</a> <a href="https://b.example">乙==</a>',
    ],
    ['**==甲** *乙==*', '<strong>==甲</strong> <em>乙==</em>'],
    [
      '[==未闭合](https://a.example) 后面==重点==',
      '<a href="https://a.example">==未闭合</a> 后面<mark>重点</mark>',
    ],
    [
      '==未闭合 [==重点==](https://a.example)',
      '==未闭合 <a href="https://a.example"><mark>重点</mark></a>',
    ],
    [
      '==前 [链接](https://a.example) **粗体** 后==',
      '<mark>前 <a href="https://a.example">链接</a> <strong>粗体</strong> 后</mark>',
    ],
  ];
  for (const [source, html] of cases)
    expect(parser.renderInline(source), source).toBe(html);
});

test('long equals runs preserve the original literal content and pairing', () => {
  const parser = new MarkdownIt().use(markdownHighlight);
  const cases = [
    ['前=====后', '前<mark>=</mark>后'],
    ['======', '<mark>=</mark>='],
    ['=====甲==', '<mark>=</mark>甲=='],
    ['=======甲==', '<mark>=</mark><mark>甲</mark>'],
    ['前====甲==后', '前<mark>==甲</mark>后'],
  ];
  for (const [source, html] of cases)
    expect(parser.renderInline(source), source).toBe(html);
});

const codeDocument = (count: number, language = 'javascript') =>
  '# 性能回归\n\n' +
  Array.from(
    { length: count },
    (_, i) =>
      `\`\`\`${language}\nconst value_${i} = ${i};\nconsole.log(value_${i});\n\`\`\`\n\n`,
  ).join('');

test('code containing many backticks serializes without a call stack overflow', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const result = await page.evaluate(() => {
    const editor = (window as any).__mojian.editor;
    const source = 'const s = `x`;\n'.repeat(75_000);
    return editor.markdown.serialize({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'javascript' },
          content: [{ type: 'text', text: source }],
        },
      ],
    });
  });
  expect(result).toContain('const s = `x`;');
  expect(result).toContain('```javascript');
  expect(result.length).toBeGreaterThan(1_125_000);
});

test('oversized code remains intact while editor and output skip syntax highlighting', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const source = `{"value":"${'x'.repeat(50_001)}"}`;
  await page.evaluate(async (text) => {
    const { lowlight, highlighter } = await import('/src/syntax.ts');
    const calls = { editor: 0, output: 0 };
    const originalEditor = lowlight.highlight;
    const originalOutput = highlighter.highlight;
    lowlight.highlight = (...args) => {
      calls.editor++;
      return originalEditor(...args);
    };
    highlighter.highlight = ((...args: Parameters<typeof originalOutput>) => {
      calls.output++;
      return originalOutput(...args);
    }) as typeof originalOutput;
    (window as any).__largeCodeCalls = calls;
    (window as any).__mojian.setMarkdown(`\`\`\`json\n${text}\n\`\`\``);
  }, source);
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await page.waitForFunction(() => {
    const m = (window as any).__mojian;
    return (
      m.getOutput()?.key === JSON.stringify([m.getMarkdown(), m.getSettings()])
    );
  });
  expect(await page.evaluate(() => (window as any).__largeCodeCalls)).toEqual({
    editor: 0,
    output: 0,
  });
  await expect(page.locator('.article-editor .code-node code')).toHaveText(
    source,
  );
  await expect(
    page.locator('.preview-paper [data-code-block] code'),
  ).toContainText(source);
});

test('continuous input batches serialization while immediate mode changes and save retain the last key', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown('# 最新正文\n\n原文'),
  );
  const result = await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    const original = e.getMarkdown.bind(e);
    let calls = 0;
    e.getMarkdown = () => {
      calls++;
      return original();
    };
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    for (const key of '连续输入最后一个字') e.commands.insertContent(key);
    const duringTyping = calls;
    (
      Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'Markdown 源码',
      ) as HTMLButtonElement
    ).click();
    return { duringTyping, afterSwitch: calls };
  });
  expect(result).toEqual({ duringTyping: 0, afterSwitch: 1 });
  await expect(
    page.getByRole('textbox', { name: 'Markdown 源码正文' }),
  ).toHaveValue('# 最新正文\n\n原文连续输入最后一个字');
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    e.commands.insertContent('保存前的最后输入');
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }),
    );
  });
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.reload();
  await expect(page.locator('.article-editor')).toContainText(
    '保存前的最后输入',
  );
});

test('export flushes pending input and rich copy refuses an obsolete snapshot', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown('# 导出最新稿\n\n正文'),
  );
  await page.waitForFunction(() => {
    const m = (window as any).__mojian;
    return (
      m.getOutput()?.key === JSON.stringify([m.getMarkdown(), m.getSettings()])
    );
  });
  await page.evaluate(() => {
    (window as any).__richCopyCalls = 0;
    Object.defineProperty(navigator.clipboard, 'write', {
      configurable: true,
      value: async () => {
        (window as any).__richCopyCalls++;
      },
    });
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    e.commands.insertContent('最后输入');
    (document.querySelector('.copy-main') as HTMLButtonElement).click();
  });
  expect(await page.evaluate(() => (window as any).__richCopyCalls)).toBe(0);
  const downloaded = page.waitForEvent('download');
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.insertContent('立即导出');
    (
      Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === '导出 Markdown',
      ) as HTMLButtonElement
    ).click();
  });
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('导出最新稿.md');
  let text = '';
  for await (const chunk of (await download.createReadStream())!)
    text += chunk.toString();
  expect(text).toContain('正文最后输入立即导出');
});

test('large code articles share highlighting between preview, copy and unchanged snapshots', async ({
  page,
}) => {
  await page.route('**/performance-modules', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/performance-modules');
  const result = await page.evaluate(async (text) => {
    const { renderArticle } = await import('/src/output.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const { highlighter } = await import('/src/syntax.ts');
    let calls = 0;
    const original = highlighter.highlight;
    highlighter.highlight = ((...args: Parameters<typeof original>) => {
      calls++;
      return original(...args);
    }) as typeof original;
    const first = await renderArticle(text, DEFAULT_SETTINGS);
    const firstCalls = calls;
    calls = 0;
    const second = await renderArticle(
      text + '\n仅修改普通正文',
      DEFAULT_SETTINGS,
    );
    const nextCalls = calls;
    const root = new DOMParser().parseFromString(second.html, 'text/html');
    const largeText =
      text.replaceAll('value_', 'large_value_') +
      Array.from(
        { length: 56 },
        (_, i) => `\n\n\`\`\`javascript\nconst extra_${i} = ${i};\n\`\`\``,
      ).join('');
    calls = 0;
    const large = await renderArticle(largeText, DEFAULT_SETTINGS);
    const largeCalls = calls;
    calls = 0;
    const repeated = await renderArticle(
      largeText + '\n只编辑正文',
      DEFAULT_SETTINGS,
    );
    const repeatedCalls = calls;
    first.dispose();
    second.dispose();
    large.dispose();
    repeated.dispose();
    highlighter.highlight = original;
    return {
      firstCalls,
      nextCalls,
      largeCalls,
      repeatedCalls,
      blocks: root.querySelectorAll('[data-code-block]').length,
      last: root.querySelectorAll('code')[23]?.textContent,
    };
  }, codeDocument(24));
  expect(result.firstCalls).toBe(24);
  expect(result.nextCalls).toBe(0);
  expect(result.blocks).toBe(24);
  expect(result.last).toContain('value_23');
  expect(result.largeCalls).toBe(80);
  expect(result.repeatedCalls).toBeLessThanOrEqual(16);
});

test('image-heavy output resolves resource slots with bounded document scans', async ({
  page,
}) => {
  await page.route('**/performance-images', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/performance-images');
  const result = await page.evaluate(async () => {
    const { renderArticle } = await import('/src/output.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const query = Element.prototype.querySelector;
    const queryAll = Element.prototype.querySelectorAll;
    let scans = 0;
    const count = (selector: string) => {
      if (/^\[data-(?:image|diagram)-index/.test(selector)) scans++;
    };
    Element.prototype.querySelector = function (
      this: Element,
      selector: string,
    ) {
      count(selector);
      return query.call(this, selector);
    } as typeof query;
    Element.prototype.querySelectorAll = function (
      this: Element,
      selector: string,
    ) {
      count(selector);
      return queryAll.call(this, selector);
    } as typeof queryAll;
    try {
      const markdown =
        Array.from(
          { length: 400 },
          (_, i) => `![图片 ${i}](local-image:missing-${i})`,
        ).join('\n\n') +
        '\n\n' +
        Array.from(
          { length: 40 },
          () => '```mermaid\ngraph LR; A-->B\n```',
        ).join('\n\n');
      const output = await renderArticle(
        markdown,
        DEFAULT_SETTINGS,
        undefined,
        {
          diagrams: false,
        },
      );
      const result = {
        scans,
        images: output.assets.filter((asset) => asset.kind === 'image').length,
        diagrams: output.assets.filter((asset) => asset.kind === 'diagram')
          .length,
        first: output.previewHTML.includes('本地图片缺失：图片 0'),
        last: output.html.includes('请在此处上传本地图片：图片 399'),
        lastDiagram: output.html.includes('Mermaid 图形 40'),
      };
      output.dispose();
      return result;
    } finally {
      Element.prototype.querySelector = query;
      Element.prototype.querySelectorAll = queryAll;
    }
  });
  expect(result.scans).toBeLessThanOrEqual(4);
  expect(result).toMatchObject({
    images: 400,
    diagrams: 40,
    first: true,
    last: true,
    lastDiagram: true,
  });
});

test('superseded batched output stops and never produces a mixed snapshot', async ({
  page,
}) => {
  await page.route('**/performance-abort', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/performance-abort');
  const result = await page.evaluate(async (text) => {
    const { renderArticle } = await import('/src/output.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const controller = new AbortController();
    const pending = renderArticle(text, DEFAULT_SETTINGS, controller.signal);
    setTimeout(() => controller.abort(), 0);
    let cancelled = '';
    try {
      (await pending).dispose();
    } catch (error) {
      cancelled = (error as Error).name;
    }
    const latest = await renderArticle('# 最新快照\n\n正文', DEFAULT_SETTINGS);
    const value = { cancelled, html: latest.html };
    latest.dispose();
    return value;
  }, codeDocument(80));
  expect(result.cancelled).toBe('AbortError');
  expect(result.html).toContain('最新快照');
  expect(result.html).not.toContain('value_');
});

test('large articles save without background output and prepare the latest version on demand', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const first = '# 大文章\n\n' + '正文内容'.repeat(15_000);
  await page.evaluate(
    (text) => (window as any).__mojian.setMarkdown(text),
    first,
  );
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  expect(
    await page.evaluate(() => {
      const m = (window as any).__mojian;
      return (
        m.getOutput()?.key ===
        JSON.stringify([m.getMarkdown(), m.getSettings()])
      );
    }),
  ).toBe(false);
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click();
  await page.waitForFunction(() => {
    const m = (window as any).__mojian;
    return (
      m.getOutput()?.key === JSON.stringify([m.getMarkdown(), m.getSettings()])
    );
  });
  await page.evaluate(
    (text) => (window as any).__mojian.setMarkdown(text + '\n\n最新修改'),
    first,
  );
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('.preview-paper')).toContainText('最新修改');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  expect(
    await page.evaluate(async () => {
      const s = await import('/src/storage.ts');
      const library = await s.loadDraftLibrary();
      return (await s.loadDraft(library.activeId!))!.markdown.endsWith(
        '最新修改',
      );
    }),
  ).toBe(true);
});

test('long articles list current local images when exporting without a preview', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const src = await page.evaluate(async () => {
    const { storeImage } = await import('/src/storage.ts');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 10;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), 'image/png'),
    );
    return storeImage(blob);
  });
  await page.evaluate((image) => {
    (window as any).__mojian.setMarkdown(
      '# 长文\n\n![实际图片](' +
        image +
        ')\n\n' +
        '普通正文。'.repeat(10_000) +
        '\n\n```md\n![代码示例](local-image:fake)\n```',
    );
  }, src);
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  expect(
    await page.evaluate(() => !!(window as any).__mojian.getOutput()),
  ).toBe(false);
  const markdownDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '导出 Markdown', exact: true })
    .click();
  await markdownDownload;
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('实际图片');
  await expect(dialog).not.toContainText('代码示例');
  await expect(dialog).not.toContainText('暂无本地图片');
  const imageDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '下载', exact: true }).click();
  expect((await imageDownload).suggestedFilename()).toBe('实际图片.png');
});

test('typing and selection changes do not measure geometry to paint a text caret', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    (window as any).__mojian.setMarkdown('正文段落。'.repeat(1000));
    e.commands.setTextSelection(1);
    e.view.focus();
    const view = e.view;
    const index = view.state.plugins
      .filter((p: any) => p.spec.view)
      .findIndex((p: any) => p.key.startsWith('blockBoundaries'));
    const pv = view.pluginViews[index];
    const update = pv.update;
    const coord = view.coordsAtPos.bind(view);
    const calls = ((window as any).__textCaretWork = {
      updates: 0,
      geometry: 0,
    });
    let active = false;
    pv.update = (...args: any[]) => {
      calls.updates++;
      active = true;
      try {
        return update(...args);
      } finally {
        active = false;
      }
    };
    view.coordsAtPos = (...args: any[]) => {
      if (active) calls.geometry++;
      return coord(...args);
    };
  });
  await page.keyboard.type('typing at normal speed', { delay: 10 });
  await page.keyboard.press('ArrowLeft');
  const calls = await page.evaluate(() => (window as any).__textCaretWork);
  expect(calls.updates).toBeGreaterThan(10);
  expect(calls.geometry).toBe(0);
  await expect(page.locator('.editor-text-cursor')).toHaveCount(0);
});

test('ordinary Markdown rejects task and table tokenizers without repeatedly splitting the remaining document', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__mojian?.editor);
  const result = await page.evaluate(async () => {
    const { safeDocument } = await import('/src/EditorPane.tsx');
    const source = Array.from(
      { length: 1200 },
      (_, i) =>
        `## 章节 ${i}\n\n` + '没有任务和表格的普通正文。'.repeat(10) + '\n\n',
    ).join('');
    const prototype = String.prototype as any;
    const original = prototype.split;
    let splitCharacters = 0;
    prototype.split = function (this: string, ...args: any[]) {
      if (args[0] === '\n') splitCharacters += this.length;
      return original.apply(this, args);
    };
    try {
      const document = safeDocument(window.__mojian!.editor!, source);
      return {
        length: source.length,
        splitCharacters,
        blocks: document.content?.filter((node) => node.content?.length).length,
      };
    } finally {
      prototype.split = original;
    }
  });
  expect(result.blocks).toBe(2400);
  expect(result.splitCharacters).toBeLessThan(result.length * 12);
});

test('bounded block tokenizers retain code-span pipes in tables and nested mixed task lists', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__mojian?.editor);
  await page.evaluate(() =>
    window.__mojian!.setMarkdown(
      '普通正文\n\n| `a|b` | 标题 |\n| --- | --- |\n| `c|d` | 内容 |\n\n- [ ] 父任务\n  - 普通子项\n  - [x] 完成的子任务\n\n后续正文',
    ),
  );
  const editor = page.locator('.article-editor');
  await expect(editor.locator('th')).toHaveCount(2);
  await expect(editor.locator('td')).toHaveCount(2);
  await expect(editor.locator('th code')).toHaveText('a|b');
  await expect(editor.locator('td code')).toHaveText('c|d');
  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(
    editor.locator('input[type="checkbox"]').nth(0),
  ).not.toBeChecked();
  await expect(editor.locator('input[type="checkbox"]').nth(1)).toBeChecked();
  await expect(editor).toContainText('普通子项');
  await expect(editor).toContainText('后续正文');
});

test('sharing large text and image packages keeps the main thread responsive', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await page.route('**/sharing-performance', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><title>Sharing performance</title></html>',
    }),
  );
  await page.goto('/sharing-performance');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  try {
    const results = await page.evaluate(async () => {
      const { createArticlePackage, readArticlePackage } =
        await import('/src/sharing/articlePackage.ts');
      const { storeImage } = await import('/src/storage.ts');
      const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
      const canvas = document.createElement('canvas');
      canvas.width = 2048;
      canvas.height = 1024;
      const ctx = canvas.getContext('2d')!;
      const pixels = ctx.createImageData(canvas.width, canvas.height);
      for (let offset = 0; offset < pixels.data.length; offset += 65536)
        crypto.getRandomValues(pixels.data.subarray(offset, offset + 65536));
      ctx.putImageData(pixels, 0, 0);
      const image = await new Promise<Blob>((resolve) =>
        canvas.toBlob((blob) => resolve(blob!), 'image/png'),
      );
      const sources: string[] = [];
      for (let i = 0; i < 6; i++) sources.push(await storeImage(image));
      async function measure<T>(run: () => Promise<T>) {
        let active = true;
        let last = 0;
        let maxFrameGap = 0;
        const frames = (now: number) => {
          if (!active) return;
          if (last) maxFrameGap = Math.max(maxFrameGap, now - last);
          last = now;
          requestAnimationFrame(frames);
        };
        requestAnimationFrame(frames);
        await new Promise((resolve) => setTimeout(resolve, 80));
        maxFrameGap = 0;
        const start = performance.now();
        const value = await run();
        const elapsed = performance.now() - start;
        await new Promise((resolve) => setTimeout(resolve, 80));
        active = false;
        return {
          value,
          elapsed: Math.round(elapsed),
          maxFrameGap: Math.round(maxFrameGap),
        };
      }
      const markdown =
        ('# 长文\n\n' + '普通正文。'.repeat(100) + '\n\n').repeat(3200) +
        '\n\n![图](' +
        sources[0] +
        ')';
      const textPackage = await createArticlePackage({
        title: '长文',
        markdown,
        settings: DEFAULT_SETTINGS,
      });
      const text = await measure(
        async () =>
          (
            await readArticlePackage(
              new Uint8Array(await textPackage.blob.arrayBuffer()),
            )
          ).draft.markdown.length,
      );
      let imagePackage: { blob: Blob; sha256: string };
      const images = await measure(async () => {
        imagePackage = await createArticlePackage({
          title: '多图',
          markdown: sources
            .map((source) => '![图](' + source + ')')
            .join('\n\n'),
          settings: DEFAULT_SETTINGS,
        });
        return imagePackage.blob.size;
      });
      const readImages = await measure(
        async () =>
          (
            await readArticlePackage(
              new Uint8Array(await imagePackage.blob.arrayBuffer()),
            )
          ).images.length,
      );
      return {
        text,
        images,
        readImages,
        textLength: markdown.length,
        imageBytes: image.size * 6,
      };
    });
    expect(results.text.value).toBe(results.textLength);
    expect(results.imageBytes).toBeGreaterThan(45 * 1024 * 1024);
    expect(results.readImages.value).toBe(6);
    for (const measurement of [
      results.text,
      results.images,
      results.readImages,
    ])
      expect(measurement.maxFrameGap).toBeLessThan(150);
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
});
