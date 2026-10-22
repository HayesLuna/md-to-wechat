import { test, expect } from './fixtures';

const codeDocument = (count: number, language = 'javascript') =>
  '# 性能回归\n\n' +
  Array.from(
    { length: count },
    (_, i) =>
      `\`\`\`${language}\nconst value_${i} = ${i};\nconsole.log(value_${i});\n\`\`\`\n\n`,
  ).join('');

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
