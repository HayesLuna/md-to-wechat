import { test, expect } from './fixtures';

test('Typora highlights survive Markdown round trips and publication output', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const markdown = '正文==重点==，==**加粗**与*斜体*==。\n\n`==行内代码==`\n\n```js\nconst text = "==代码块==";\n```\n\n\\=\\=字面等号\\=\\=，== 未闭合';
  await page.evaluate(text => (window as any).__mojian.setMarkdown(text), markdown);
  expect(await page.locator('.article-editor mark').allTextContents()).toEqual(['重点', '加粗', '与', '斜体']);
  await expect(page.locator('.article-editor mark strong, .article-editor strong mark')).toHaveText('加粗');
  await expect(page.locator('.article-editor mark em, .article-editor em mark')).toHaveText('斜体');
  await expect(page.locator('.article-editor code mark')).toHaveCount(0);
  await expect(page.locator('.article-editor')).toContainText('==字面等号==');
  await page.getByRole('button', { name: 'Markdown 源码', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'Markdown 源码正文' });
  expect(await source.inputValue()).toContain('==重点==');
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  await page.evaluate(() => { const m = (window as any).__mojian; m.setMarkdown(m.editor.getMarkdown()); });
  expect(await page.locator('.article-editor mark').allTextContents()).toEqual(['重点', '加粗', '与', '斜体']);
  await page.waitForFunction(() => { const m = (window as any).__mojian; return m.getOutput()?.key === JSON.stringify([m.getMarkdown(), m.getSettings()]); });
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('.preview-paper mark')).toHaveText(['重点', '加粗与斜体']);
  await expect(page.locator('.preview-paper mark').first()).toHaveCSS('background-color', 'rgb(255, 243, 163)');
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'write', {
    configurable: true,
    value: async (items: ClipboardItem[]) => {
      (window as any).__highlightClipboard = await (await items[0].getType('text/html')).text();
    },
  }));
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('已复制排版内容');
  const html = await page.evaluate(() => (window as any).__highlightClipboard as string);
  const copied = await page.evaluate(html => {
    const root = new DOMParser().parseFromString(html, 'text/html');
    const mark = root.querySelector('mark')!;
    return { text: mark.textContent, color: mark.style.backgroundColor };
  }, html);
  expect(copied).toEqual({ text: '重点', color: 'rgb(255, 243, 163)' });
  await page.screenshot({ path: '/tmp/mojian-highlight-preview.png' });
});

test('typing and pasting double equals creates highlights; code and rich HTML remain intact', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => (window as any).__mojian.setMarkdown(''));
  await page.locator('.article-editor').click();
  await page.keyboard.type('正文==important a=b==');
  await expect(page.locator('.article-editor mark')).toHaveText('important a=b');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor mark')).toHaveCount(0);
  for (const html of ['', '<p><mark>粘贴高亮</mark></p>']) {
    await page.evaluate(() => { const m = (window as any).__mojian; m.setMarkdown(''); m.editor.commands.focus(); });
    await page.evaluate(html => {
      const data = new DataTransfer(); data.setData('text/plain', html ? '粘贴高亮' : '==粘贴高亮==');
      if (html) data.setData('text/html', html);
      (window as any).__mojian.editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, html);
    await expect(page.locator('.article-editor mark')).toHaveText('粘贴高亮');
  }
  await page.evaluate(() => { const m = (window as any).__mojian; m.setMarkdown('```txt\n\n```'); m.editor.commands.focus(1); });
  await page.keyboard.type('==code==');
  await expect(page.locator('.article-editor code mark')).toHaveCount(0);
  await expect(page.locator('.article-editor pre')).toHaveText('==code==');
});

test('highlights work in headings, lists and tables on mobile without leaking into labels', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => (window as any).__mojian.setMarkdown('# ==高亮标题==\n\n- ==列表重点==\n\n| 内容 |\n| --- |\n| ==表格重点== |'));
  await expect(page.locator('.article-editor mark')).toHaveText(['高亮标题', '列表重点', '表格重点']);
  const roundtrip = await page.evaluate(() => {
    const editor = (window as any).__mojian.editor;
    const before = editor.getJSON();
    editor.commands.setContent(editor.markdown.parse(editor.getMarkdown()));
    return { before, after: editor.getJSON() };
  });
  expect(roundtrip.after).toEqual(roundtrip.before);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await expect(page.locator('.sidebar-outline>button')).toHaveText('高亮标题');
  await page.getByRole('button', { name: '折叠侧栏', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: '/tmp/mojian-highlight-mobile.png' });
  expect(errors).toEqual([]);
});

test('adding opening equals after closing equals highlights existing text and supports undo', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => (window as any).__mojian.setMarkdown('前面 **重点** 后面'));
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus(6));
  await page.keyboard.type('==');
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus(4));
  await page.keyboard.type('==');
  await expect(page.locator('.article-editor mark')).toHaveText('重点');
  await expect(page.locator('.article-editor strong')).toHaveText('重点');
  await expect(page.locator('.article-editor')).toHaveText('前面 重点 后面');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor mark')).toHaveCount(0);
  await expect(page.locator('.article-editor')).toContainText('==重点==');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.article-editor mark')).toHaveText('重点');
});

for (const native of [false, true]) test(`pasted equals in rich HTML highlight while preserving formatting (${native ? 'internal' : 'external'})`, async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => { const m = (window as any).__mojian; m.setMarkdown(''); m.editor.commands.focus(); });
  await page.evaluate(native => {
    const data = new DataTransfer();
    data.setData('text/plain', '前面 ==重点== 和 ==另一处== 后面 ==代码==');
    data.setData('text/html', `<p${native ? ' data-pm-slice="1 1 []"' : ''}>前面 ==<strong>重点</strong>== 和 ==另一处== 后面 <code>==代码==</code></p>`);
    (window as any).__mojian.editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, native);
  await expect(page.locator('.article-editor mark')).toHaveText(['重点', '另一处']);
  await expect(page.locator('.article-editor strong')).toHaveText('重点');
  await expect(page.locator('.article-editor code')).toHaveText('==代码==');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor mark')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.article-editor mark')).toHaveText(['重点', '另一处']);
});

test('highlight paste respects code destinations and the plain-text shortcut', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  for (const mode of ['codeBlock', 'code', 'plain']) {
    await page.evaluate(mode => {
      const m = (window as any).__mojian;
      m.setMarkdown(mode === 'codeBlock' ? '```txt\n内容\n```' : mode === 'code' ? '`内容`' : '');
      m.editor.commands.focus(mode === 'plain' ? 1 : 2);
      if (mode === 'plain') m.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      const data = new DataTransfer();
      data.setData('text/plain', '==字面文本==');
      data.setData('text/html', '<p><strong>==字面文本==</strong></p>');
      m.editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, mode);
    await expect(page.locator('.article-editor mark')).toHaveCount(0);
    await expect(page.locator('.article-editor')).toContainText('==字面文本==');
  }
});

for (const width of [1440, 390]) test(`toolbar highlight toggles selection, reflects caret state and supports typing at ${width}px`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => {
    const m = (window as any).__mojian;
    m.setMarkdown('前面 重点 后面');
    m.editor.commands.setTextSelection({from: 4, to: 6});
    m.editor.commands.focus();
  });
  const button = page.getByRole('toolbar', {name:'正文格式'}).getByRole('button', {name:'高亮', exact:true});
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(page.locator('.article-editor mark')).toHaveText('重点');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => { const s = (window as any).__mojian.editor.state.selection; return {from:s.from,to:s.to}; })).toEqual({from:4,to:6});
  expect(await page.evaluate(() => (window as any).__mojian.editor.getMarkdown())).toContain('==重点==');
  await button.click();
  await expect(page.locator('.article-editor mark')).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor mark')).toHaveText('重点');
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus(2));
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus(5));
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus('end'));
  await button.click();
  await page.keyboard.type('new');
  await expect(page.locator('.article-editor mark')).toHaveText(['重点', 'new']);
  await expect(page.locator('.article-editor')).toHaveText('前面 重点 后面new');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  expect(errors).toEqual([]);
  await page.screenshot({path:`/tmp/mojian-highlight-toolbar-${width}.png`});
});
