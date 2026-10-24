import { test, expect } from './fixtures';

test('additional languages load only when needed and highlighting preserves source, selection and undo', async ({ page }) => {
  const loads: string[] = [];
  page.on('request', request => { if (request.url().includes('syntaxExtras')) loads.push(request.url()); });
  await page.goto('/'); await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => (window as any).__mojian.setMarkdown('# 纯文本文章\n\n只写正文。'));
  await page.waitForFunction(() => { const m = (window as any).__mojian; return m.getOutput()?.key === JSON.stringify([m.getMarkdown(), m.getSettings()]); });
  expect(loads).toHaveLength(0);
  const before = await page.evaluate(() => {
    const m = (window as any).__mojian;
    m.setMarkdown('```rust\nfn main() {\n    println!("hello");\n}\n```');
    m.editor.commands.setTextSelection(1); m.editor.commands.focus();
    (window as any).__syntaxUpdates = 0;
    m.editor.on('update', () => (window as any).__syntaxUpdates++);
    return { markdown: m.editor.getMarkdown(), selection: m.editor.state.selection.from };
  });
  await expect(page.locator('.article-editor .hljs-keyword').filter({ hasText: /^fn$/ })).toHaveText('fn');
  expect(loads).toHaveLength(1);
  const after = await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    return { markdown: e.getMarkdown(), selection: e.state.selection.from, updates: (window as any).__syntaxUpdates };
  });
  expect(after).toEqual({ ...before, updates: 0 });
  await page.keyboard.type('x'); await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => (window as any).__mojian.editor.getMarkdown())).toBe(before.markdown);
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('.preview-paper [data-code-line]').first()).toHaveText('fn main() {');
});

test('version and build time remain accessible on desktop and mobile', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const version = page.getByRole('button', { name: '版本与更新信息', exact: true });
    await expect(version).toBeVisible();
    await expect(version).toContainText(/版本 开发版 [a-f0-9]{7}/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await version.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.build-info')).toContainText('当前版本：1.0.0');
    await expect(dialog.locator('.build-info')).toContainText(/构建时间：\d{4}\/\d{2}\/\d{2}/);
    await expect(dialog.locator('.build-info')).toContainText('北京时间');
    await page.screenshot({ path: `/tmp/mojian-build-info-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('a failed optional language download keeps editing and publication available', async ({ page }) => {
  await page.route('**/src/syntaxExtras.ts*', route => route.abort());
  await page.goto('/'); await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => (window as any).__mojian.setMarkdown('```rust\nfn main() {}\n```'));
  await expect(page.locator('.article-editor pre')).toHaveText('fn main() {}');
  await page.waitForFunction(() => { const m = (window as any).__mojian; return m.getOutput()?.key === JSON.stringify([m.getMarkdown(), m.getSettings()]); });
  const output = await page.evaluate(() => {
    const out = (window as any).__mojian.getOutput(); return { text: out.text, errors: out.errors };
  });
  expect(output.text).toContain('fn main() {}'); expect(output.errors).toEqual([]);
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('.preview-paper [data-code-line]')).toHaveText('fn main() {}');
});

test('switching from source mode loads newly added code language without another edit', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.getByRole('button', { name: 'Markdown 源码', exact: true }).click();
  await page.getByRole('textbox', { name: 'Markdown 源码正文' }).fill(
    '# 语言切换\n\n```python\nprint("hello")\n```\n\n' + '正文'.repeat(26_000),
  );
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  expect(await page.evaluate(async () => (await import('/src/syntax.ts')).lowlight.registered('python'))).toBe(false);
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  await expect.poll(() => page.evaluate(async () =>
    (await import('/src/syntax.ts')).lowlight.registered('python'),
  )).toBe(true);
  await expect(page.locator('.article-editor .hljs-built_in')).toContainText('print');
});
