import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const blue = 'rgb(200, 225, 255)';
const border = 'rgb(121, 170, 240)';
async function ready(page: Page, markdown: string) {
  if (page.url() === 'about:blank') await page.goto('/');
  await page.waitForFunction(() => !!window.__mojian?.editor);
  await page.evaluate((text) => window.__mojian!.setMarkdown(text), markdown);
}
async function caret(page: Page, text: string) {
  await page.evaluate((text) => {
    const editor = window.__mojian!.editor!;
    let pos = 1;
    editor.state.doc.descendants((node, at) => {
      if (node.isText && node.text?.includes(text)) pos = at + 1;
    });
    editor.chain().setTextSelection(pos).focus().run();
  }, text);
  await expect(page.locator('.article-editor')).toBeFocused();
}
const selectedText = (page: Page) =>
  page.evaluate(() => {
    const editor = window.__mojian!.editor!;
    const current = editor.state.selection as {
      forEachCell?: (fn: (node: { textContent: string }) => void) => void;
    };
    if (current.forEachCell) {
      const texts: string[] = [];
      current.forEachCell((node) => texts.push(node.textContent));
      return texts.join('\n');
    }
    return editor.state.doc.textBetween(
      editor.state.selection.from,
      editor.state.selection.to,
      '\n',
    );
  });
const nodeName = (page: Page) =>
  page.evaluate(() => {
    const current = window.__mojian!.editor!.state.selection as {
      node?: { type: { name: string } };
    };
    return current.node?.type.name ?? '';
  });
const selectionType = (page: Page) =>
  page.evaluate(
    () => window.__mojian!.editor!.state.selection.toJSON().type as string,
  );
const pseudo = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element, '::after');
      return {
        background: style.backgroundColor,
        opacity: style.opacity,
        shadow: style.boxShadow,
      };
    });

test('text, lists, tables, code, images, mermaid and source share one blue selection', async ({
  page,
}) => {
  await ready(page, '普通段落 ==高亮== 结尾');
  await caret(page, '普通段落');
  await page.keyboard.press('Shift+ArrowRight');
  expect(await nodeName(page)).toBe('');
  await expect(page.locator('.article-editor mark')).toHaveCSS(
    'background-color',
    'rgb(255, 243, 163)',
  );
  await expect(page.locator('.ProseMirror-selectednode')).toHaveCount(0);

  await ready(page, '- 当前项\n- 另一项');
  await caret(page, '当前项');
  const beforeList = await page.evaluate(() =>
    window.__mojian!.editor!.getJSON(),
  );
  await page.keyboard.press('ControlOrMeta+a');
  expect(await nodeName(page)).toBe('listItem');
  expect(await selectedText(page)).toContain('当前项');
  expect(await selectedText(page)).not.toContain('另一项');
  const item = page.locator('.article-editor li.ProseMirror-selectednode');
  await expect(item).toHaveCSS('background-color', blue);
  await expect(item).toHaveCSS('border-radius', '9px');
  await expect(item).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('ControlOrMeta+a');
  expect(await nodeName(page)).toBe('bulletList');
  expect(await selectedText(page)).toContain('另一项');
  const list = page.locator('.article-editor ul.ProseMirror-selectednode');
  await expect(list).toHaveCSS('background-color', blue);
  await expect(list).toHaveCSS('outline-style', 'none');
  await expect(item).toHaveCount(0);
  expect(await page.evaluate(() => window.__mojian!.editor!.getJSON())).toEqual(
    beforeList,
  );

  await ready(
    page,
    '| 表头A | 表头B |\n| --- | --- |\n| 行一 | 单元格 |\n| 行二 | 单元格二 |',
  );
  await caret(page, '行一');
  await page.keyboard.press('ControlOrMeta+a');
  expect(await selectionType(page)).toBe('cell');
  expect(await selectedText(page)).toContain('行一');
  expect(await selectedText(page)).not.toContain('行二');
  await expect(page.locator('.selectedCell')).toHaveCount(2);
  await expect(page.locator('[aria-label="表格操作"]')).toBeVisible();
  expect(await pseudo(page, '.selectedCell')).toMatchObject({
    background: 'rgba(200, 225, 255, 0.65)',
    opacity: '1',
  });
  expect(
    await page
      .locator('.selectedCell')
      .first()
      .evaluate((element) => {
        const overlay = getComputedStyle(element, '::after');
        return [overlay.top, overlay.right, overlay.bottom, overlay.left].join(
          ' ',
        );
      }),
  ).toBe('0px -1px -1px -1px');
  await expect(page.locator('.article-editor .tableWrapper')).toHaveCSS(
    'border-top-left-radius',
    '0px',
  );
  await page.keyboard.press('ControlOrMeta+a');
  expect(await selectedText(page)).toContain('行二');
  await expect(page.locator('.selectedCell')).toHaveCount(6);
  expect(await pseudo(page, '.selectedCell')).toMatchObject({
    background: 'rgba(200, 225, 255, 0.65)',
    opacity: '1',
  });
  await expect(page.locator('.article-editor table')).toHaveCSS(
    'outline-style',
    'none',
  );

  await ready(page, '> 引用内容');
  await expect(page.locator('.article-editor blockquote')).toHaveCSS(
    'border-radius',
    '9px',
  );
  await caret(page, '引用内容');
  await page.keyboard.press('ControlOrMeta+a');
  await expect(
    page.locator('.article-editor blockquote.ProseMirror-selectednode'),
  ).toHaveCSS('border-radius', '9px');

  await ready(page, '前文\n\n```js\nconst value = 1;\n```\n\n后文');
  const keyword = page.locator('.hljs-keyword');
  await expect(keyword).toBeVisible();
  const keywordColor = await keyword.evaluate(
    (element) => getComputedStyle(element).color,
  );
  await caret(page, 'const');
  await page.keyboard.press('ControlOrMeta+a');
  expect(await selectionType(page)).toBe('text');
  expect(await selectedText(page)).toBe('const value = 1;');
  await expect(
    page.locator('.node-codeBlock.ProseMirror-selectednode'),
  ).toHaveCount(0);
  expect(
    await page
      .locator('.code-theme-github pre')
      .evaluate(
        (element) => getComputedStyle(element, '::selection').backgroundColor,
      ),
  ).toBe(blue);
  await page.keyboard.press('ControlOrMeta+a');
  expect(await nodeName(page)).toBe('codeBlock');
  const code = page.locator(
    '.node-codeBlock.ProseMirror-selectednode > .code-node',
  );
  expect(
    await code.evaluate((element) => {
      const overlay = getComputedStyle(element, '::after');
      const box = getComputedStyle(element);
      return (
        overlay.top === '-1px' &&
        overlay.borderTopLeftRadius === box.borderTopLeftRadius &&
        box.borderTopLeftRadius === '9px'
      );
    }),
  ).toBe(true);
  expect(
    await code
      .locator('pre')
      .evaluate(
        (element) => getComputedStyle(element, '::selection').backgroundColor,
      ),
  ).toBe('rgba(0, 0, 0, 0)');
  expect(
    await keyword.evaluate((element) => getComputedStyle(element).color),
  ).toBe(keywordColor);

  await page.route('**/selection.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#96b5cd"/></svg>',
    }),
  );
  await ready(
    page,
    '前文 ![甲](https://example.test/selection.svg "width=40%") 后文',
  );
  await expect(page.locator('.image-box img')).toBeVisible();
  await caret(page, '前文');
  await page.keyboard.press('ControlOrMeta+a');
  expect(await pseudo(page, '.image-range-selected .image-box')).toEqual({
    background: blue,
    opacity: '0.65',
    shadow: 'none',
  });
  await page.locator('.image-box').click();
  await expect(page.locator('.image-node.selected .image-box')).toHaveCSS(
    'outline-color',
    border,
  );
  await expect(page.locator('.image-node.selected .image-box')).toHaveCSS(
    'outline-width',
    '1px',
  );
  await expect(page.locator('.image-node.selected .image-box')).toHaveCSS(
    'border-radius',
    '2px',
  );
  await expect(
    page.getByRole('button', { name: '拖拽调整图片宽度' }),
  ).toBeVisible();

  await ready(page, '前文\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n后文');
  await page.getByRole('button', { name: '展示代码', exact: true }).click();
  await caret(page, 'flowchart');
  await page.keyboard.press('ControlOrMeta+a');
  expect(await selectionType(page)).toBe('text');
  expect(await selectedText(page)).toContain('flowchart LR');
  await page.keyboard.press('ControlOrMeta+a');
  expect(await nodeName(page)).toBe('codeBlock');
  expect(
    await page
      .locator('.node-codeBlock.ProseMirror-selectednode > .code-node')
      .evaluate((element) => {
        const overlay = getComputedStyle(element, '::after');
        return (
          overlay.top === '-1px' &&
          overlay.borderTopLeftRadius ===
            getComputedStyle(element).borderTopLeftRadius
        );
      }),
  ).toBe(true);
  expect(
    await page
      .locator('.node-codeBlock.ProseMirror-selectednode pre')
      .evaluate(
        (element) => getComputedStyle(element, '::selection').backgroundColor,
      ),
  ).toBe('rgba(0, 0, 0, 0)');

  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  const source = page.getByRole('textbox', { name: 'Markdown 源码正文' });
  await source.press('ControlOrMeta+a');
  expect(
    await source.evaluate((element) => {
      const input = element as HTMLTextAreaElement;
      return input.selectionEnd - input.selectionStart;
    }),
  ).toBe((await page.evaluate(() => window.__mojian!.getMarkdown())).length);
  await expect(page.locator('.editor-host')).toBeHidden();
});
