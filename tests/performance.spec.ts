import { test, expect } from './fixtures';
import MarkdownIt from 'markdown-it';
import { markdownHighlight, matchHighlight } from '../src/highlight';

test('dense highlights process only their own inline tokens', () => {
  const parser = new MarkdownIt().use(markdownHighlight);
  let processedTokens = 0;
  parser.inline.ruler2.push('measure-highlight-work', (state) => {
    processedTokens += state.tokens.length;
    return true;
  });
  const html = parser.renderInline('==word== '.repeat(4000));
  expect(html.match(/<mark>/g)).toHaveLength(4000);
  expect(processedTokens).toBeLessThan(4000 * 10);
});

test('invalid highlight openings never scan the remaining paragraph', () => {
  const parser = new MarkdownIt().use(markdownHighlight);
  const source = '== word '.repeat(4000);
  const original = String.prototype.startsWith;
  let scanChecks = 0;
  String.prototype.startsWith = function (search, position) {
    if (search === '==') scanChecks++;
    return original.call(this, search, position);
  };
  let html: string;
  try {
    html = parser.renderInline(source);
    expect(matchHighlight('== unfinished')).toBeNull();
  } finally {
    String.prototype.startsWith = original;
  }
  expect(html).toBe(source);
  expect(scanChecks).toBeLessThan(4000 * 2);
});

test('unclosed nonempty highlights scan a paragraph only once', () => {
  const parser = new MarkdownIt().use(markdownHighlight);
  const source = '==word '.repeat(4000);
  const original = String.prototype.startsWith;
  let checks = 0;
  String.prototype.startsWith = function (search, position) {
    if (search === '==') checks++;
    return original.call(this, search, position);
  };
  try {
    expect(parser.renderInline(source)).toBe(source);
  } finally {
    String.prototype.startsWith = original;
  }
  expect(checks).toBeLessThan(source.length * 3);
});

test('editor import skips repeated unclosed highlights without rescanning suffixes', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const result = await page.evaluate(() => {
    const source = '==word '.repeat(4000);
    const original = String.prototype.startsWith;
    let checks = 0;
    String.prototype.startsWith = function (search, position) {
      if (search === '==') checks++;
      return original.call(this, search, position);
    };
    try {
      const parsed = (window as any).__mojian.editor.markdown.parse(source);
      return { checks, text: parsed.content[0].content[0].text };
    } finally {
      String.prototype.startsWith = original;
    }
  });
  expect(result.text).toBe('==word '.repeat(4000));
  expect(result.checks).toBeLessThan(100_000);
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

test('selecting a dense highlight paragraph queries decorations by range', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown('==word== '.repeat(1000)),
  );
  await expect(page.locator('.article-editor mark')).toHaveCount(1000);
  await page.locator('.article-editor mark').first().click();
  const queries = await page.evaluate(async () => {
    const { DecorationSet } = await import('/tests/editorInspection.ts');
    const original = DecorationSet.prototype.find;
    let calls = 0;
    DecorationSet.prototype.find = function (...args) {
      calls++;
      return original.apply(this, args);
    };
    try {
      (window as any).__mojian.editor.commands.selectAll();
      return calls;
    } finally {
      DecorationSet.prototype.find = original;
    }
  });
  await expect(page.locator('.highlight-delimiter.expanded')).toHaveCount(2000);
  expect(queries).toBeLessThan(50);
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

test('editing one code block never detects languages or highlights unchanged blocks', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(
    (text) => (window as any).__mojian.setMarkdown(text),
    codeDocument(24),
  );
  await expect(page.locator('.article-editor .hljs-keyword')).toHaveCount(24);
  const counts = await page.evaluate(async () => {
    const { lowlight } = await import('/src/syntax.ts');
    const original = lowlight.highlight,
      originalAuto = lowlight.highlightAuto;
    let calls = 0,
      auto = 0;
    lowlight.highlight = (...args) => {
      calls++;
      return original(...args);
    };
    lowlight.highlightAuto = (...args) => {
      auto++;
      return originalAuto(...args);
    };
    const e = (window as any).__mojian.editor;
    const setOptions = e.setOptions.bind(e);
    let optionUpdates = 0;
    e.setOptions = (...args: any[]) => {
      optionUpdates++;
      return setOptions(...args);
    };
    let position = 0;
    e.state.doc.descendants((node: any, pos: number) => {
      if (!position && node.type.name === 'codeBlock') position = pos + 1;
    });
    e.commands.setTextSelection(position);
    e.commands.insertContent('x');
    const duringTyping = calls;
    await new Promise((resolve) => setTimeout(resolve, 180));
    const known = { calls, auto };
    (window as any).__mojian.setMarkdown(
      '```\nconst unlabelled = true;\n```\n\n```unknown-language\nraw source\n```',
    );
    e.commands.setTextSelection(1);
    e.commands.insertContent('y');
    await new Promise((resolve) => setTimeout(resolve, 180));
    lowlight.highlight = original;
    lowlight.highlightAuto = originalAuto;
    e.setOptions = setOptions;
    return {
      duringTyping,
      optionUpdates,
      known,
      final: { calls, auto },
      text: e.state.doc.textContent,
    };
  });
  expect(counts.duringTyping).toBe(0);
  expect(counts.optionUpdates).toBe(0);
  expect(counts.known).toEqual({ calls: 1, auto: 0 });
  expect(counts.final).toEqual(counts.known);
  expect(counts.text).toContain('yconst unlabelled');
  await expect(page.locator('.article-editor pre')).toHaveCount(2);
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
