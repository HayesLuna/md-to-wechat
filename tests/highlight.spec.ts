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
