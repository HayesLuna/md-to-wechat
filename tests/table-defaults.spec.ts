import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

for (const format of ['markdown', 'html'])
  test(`pasted ${format} tables default to centered header and body with undo and persistence`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    await setDoc(page, '粘贴前正文');
    await page.evaluate((format) => {
      const editor = (window as any).__mojian.editor;
      editor.commands.focus('end');
      const data = new DataTransfer();
      data.setData(
        'text/plain',
        '\n\n| 标题一 | 标题二 |\n| --- | --- |\n| 内容一 | 内容二 |',
      );
      if (format === 'html')
        data.setData(
          'text/html',
          '<table><tr><th>标题一</th><th>标题二</th></tr><tr><td>内容一</td><td>内容二</td></tr></table>',
        );
      editor.view.dom.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, format);
    const cells = page.locator('.article-editor th,.article-editor td');
    await expect(cells).toHaveCount(4);
    expect(
      await cells.evaluateAll((nodes) =>
        nodes.map((n) => getComputedStyle(n).textAlign),
      ),
    ).toEqual(['center', 'center', 'center', 'center']);
    expect((await raw(page)).match(/:---:/g)).toHaveLength(2);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(cells).toHaveCount(0);
    await expect(page.locator('.article-editor')).toContainText('粘贴前正文');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(cells).toHaveCount(4);
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    await page.reload();
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    expect(
      await cells.evaluateAll((nodes) =>
        nodes.every((n) => getComputedStyle(n).textAlign === 'center'),
      ),
    ).toBe(true);
    await page.getByRole('button', { name: '公众号预览', exact: true }).click();
    const preview = page.locator('.preview-paper th,.preview-paper td');
    await expect(preview).toHaveCount(4);
    expect(
      await preview.evaluateAll((nodes) =>
        nodes.every((n) => getComputedStyle(n).textAlign === 'center'),
      ),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/mojian-pasted-table-${format}.png` });
  });

test('pasted explicit column alignment is preserved and existing tables are unchanged', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  for (const html of [
    '',
    '<table><tr><th style="text-align:left">左</th><th align="right">右</th></tr><tr><td style="text-align:left">甲</td><td align="right">乙</td></tr></table>',
  ]) {
    await setDoc(page, '| 旧表 |\n| ---: |\n| 原文 |\n\n分隔正文');
    await page.evaluate((html) => {
      const editor = (window as any).__mojian.editor;
      editor.commands.focus('end');
      const data = new DataTransfer();
      data.setData(
        'text/plain',
        '\n\n| 左 | 右 |\n| :--- | ---: |\n| 甲 | 乙 |',
      );
      if (html) data.setData('text/html', html);
      editor.view.dom.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, html);
    const tables = page.locator('.article-editor table');
    await expect(tables).toHaveCount(2);
    expect(
      await tables
        .first()
        .locator('th,td')
        .evaluateAll((nodes) =>
          nodes.map((n) => getComputedStyle(n).textAlign),
        ),
    ).toEqual(['right', 'right']);
    expect(
      await tables
        .last()
        .locator('th,td')
        .evaluateAll((nodes) =>
          nodes.map((n) => getComputedStyle(n).textAlign),
        ),
    ).toEqual(['left', 'right', 'left', 'right']);
  }
});
const raw = (page: Page) =>
  page.evaluate(() => (window as any).__mojian.getMarkdown());
async function setDoc(page: Page, text: string) {
  await page.evaluate(
    (text: string) => (window as any).__mojian.setMarkdown(text),
    text,
  );
}
test('new tables, added rows and columns default to center with undo and Markdown persistence', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await setDoc(page, '');
  const cells = page.locator('.article-editor th,.article-editor td');
  const centered = async () =>
    expect(
      await cells.evaluateAll((nodes) =>
        nodes.every((n) => getComputedStyle(n).textAlign === 'center'),
      ),
    ).toBe(true);
  await page.getByRole('button', { name: '插入表格', exact: true }).click();
  await expect(cells).toHaveCount(9);
  await centered();
  await cells.nth(3).click();
  await page.getByRole('button', { name: '下方添加行', exact: true }).click();
  await expect(cells).toHaveCount(12);
  await centered();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(cells).toHaveCount(9);
  await setDoc(page, '| 左 | 右 |\n| :--- | ---: |\n| 甲 | 乙 |');
  await page.locator('.article-editor td').first().click();
  await page.getByRole('button', { name: '右侧添加列', exact: true }).click();
  await expect(cells).toHaveCount(6);
  expect(
    await cells.evaluateAll((nodes) =>
      nodes.map((n) => getComputedStyle(n).textAlign),
    ),
  ).toEqual(['left', 'center', 'right', 'left', 'center', 'right']);
  expect(await raw(page)).toContain(':---:');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(cells).toHaveCount(4);
  await expect(page.locator('.article-editor th').last()).toHaveCSS(
    'text-align',
    'right',
  );
  await page.locator('.article-editor td').first().click();
  await page.getByRole('button', { name: '下方添加行', exact: true }).click();
  await expect(cells).toHaveCount(6);
  await centered();
  expect((await raw(page)).match(/:---:/g)).toHaveLength(2);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(cells).toHaveCount(4);
  await expect(page.locator('.article-editor th').last()).toHaveCSS(
    'text-align',
    'right',
  );
  await page.locator('.article-editor td').first().click();
  await page.getByRole('button', { name: '下方添加行', exact: true }).click();
  const markdown = await raw(page);
  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  expect(await raw(page)).toBe(markdown);
  await centered();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await centered();
  await expect(cells).toHaveCount(6);
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('.preview-paper th').first()).toHaveCSS(
    'text-align',
    'center',
  );
  await expect(page.locator('.preview-paper td').first()).toHaveCSS(
    'text-align',
    'center',
  );
});
test('Tab at the last table cell creates a centered row in one undoable edit', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await setDoc(page, '| 标题 |\n| --- |\n| 正文 |');
  const before = await page.evaluate(() =>
    (window as any).__mojian.editor.state.doc.firstChild.toJSON(),
  );
  await page.locator('.article-editor td').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  await expect(page.locator('.article-editor tr')).toHaveCount(3);
  expect(
    await page
      .locator('.article-editor th,.article-editor td')
      .evaluateAll((nodes) =>
        nodes.every((n) => getComputedStyle(n).textAlign === 'center'),
      ),
  ).toBe(true);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor tr')).toHaveCount(2);
  expect(
    await page.evaluate(() =>
      (window as any).__mojian.editor.state.doc.firstChild.toJSON(),
    ),
  ).toEqual(before);
});
