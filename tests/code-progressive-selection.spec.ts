import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
async function ready(page: Page, markdown: string) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(
    (text) => (window as any).__mojian.setMarkdown(text),
    markdown,
  );
}
async function insideCode(page: Page, backward = false) {
  await page.evaluate((backward) => {
    const e = (window as any).__mojian.editor;
    let start = 0,
      end = 0;
    e.state.doc.descendants((n: any, p: number) => {
      if (n.type.name === 'codeBlock') {
        start = p + 1;
        end = p + n.nodeSize - 1;
      }
    });
    e.commands.setTextSelection(backward ? { from: end, to: start } : start);
    e.view.focus();
  }, backward);
}
const selection = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__mojian.editor.state.selection;
    return { type: s.toJSON().type, node: s.node?.type.name };
  });
const copy = async (page: Page) => {
  await page.keyboard.press('ControlOrMeta+c');
  return page.evaluate(() => navigator.clipboard.readText());
};

for (const key of ['Control+a', 'Meta+a'])
  for (const language of ['js', 'mermaid'])
    test(`${key} in ${language} selects raw source, framed fenced block, then article`, async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const source =
        language === 'js'
          ? 'const first = 1;\n\tconst second = 2;'
          : 'flowchart LR\n  A --> B';
      const fenced = '```' + language + '\n' + source + '\n```';
      await ready(page, '前面的正文\n\n' + fenced + '\n\n后面的正文');
      if (language === 'mermaid')
        await page
          .getByRole('button', { name: '展示代码', exact: true })
          .click();
      await insideCode(page, true);
      const original = await page.evaluate(() =>
        (window as any).__mojian.editor.getJSON(),
      );
      await page.keyboard.press(key);
      expect((await selection(page)).type).toBe('text');
      await expect(
        page.locator('.node-codeBlock.ProseMirror-selectednode'),
      ).toHaveCount(0);
      expect(await copy(page)).toBe(source);
      await page.keyboard.press(key);
      expect(await selection(page)).toEqual({
        type: 'node',
        node: 'codeBlock',
      });
      await expect(
        page.locator('.node-codeBlock.ProseMirror-selectednode'),
      ).toHaveCount(1);
      await expect(
        page.locator('.node-codeBlock.ProseMirror-selectednode'),
      ).toHaveCSS('outline-width', '2px');
      expect(await copy(page)).toBe(fenced);
      await page.keyboard.press(key);
      expect((await selection(page)).type).toBe('all');
      const full = await copy(page);
      expect(full).toContain('前面的正文');
      expect(full).toContain('后面的正文');
      expect(full).toContain(fenced);
      await page.keyboard.press(key);
      expect((await selection(page)).type).toBe('all');
      expect(
        await page.evaluate(() => (window as any).__mojian.editor.getJSON()),
      ).toEqual(original);
    });

test('the block stage copies safe fences around literal backticks and cut/undo removes/restores the complete block', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const source = 'first\n\tcode\u00a0space\n```mermaid\nlast';
  const fenced = '````txt\n' + source + '\n````';
  await ready(page, '前文\n\n' + fenced + '\n\n后文');
  await insideCode(page);
  const original = await page.evaluate(() =>
    (window as any).__mojian.editor.getJSON(),
  );
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+a');
  expect(await copy(page)).toBe(fenced);
  await page.keyboard.press('ControlOrMeta+x');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    fenced,
  );
  await expect(page.locator('.code-node')).toHaveCount(0);
  await expect(page.locator('.article-editor')).toContainText('前文');
  await expect(page.locator('.article-editor')).toContainText('后文');
  await page.keyboard.press('ControlOrMeta+z');
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getJSON()),
  ).toEqual(original);
});

test('empty blocks still have distinct text, node and article selection stages', async ({
  page,
}) => {
  await ready(page, '```js\n\n```');
  await insideCode(page);
  await page.keyboard.press('ControlOrMeta+a');
  expect((await selection(page)).type).toBe('text');
  await page.keyboard.press('ControlOrMeta+a');
  expect(await selection(page)).toEqual({ type: 'node', node: 'codeBlock' });
  await page.keyboard.press('ControlOrMeta+a');
  expect((await selection(page)).type).toBe('all');
});

test('folded source remains complete in raw and block copies; a pointer move resets the stages', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const source = 'function outer() {\n  first();\n  second();\n}\nlast();';
  await ready(page, '前文\n\n```js\n' + source + '\n```\n\n后文');
  await page
    .getByRole('button', { name: '折叠第 1–4 行代码', exact: true })
    .click();
  await insideCode(page);
  await page.keyboard.press('ControlOrMeta+a');
  expect(await copy(page)).toBe(source);
  await page.keyboard.press('ControlOrMeta+a');
  expect(await copy(page)).toBe('```js\n' + source + '\n```');
  const point = await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    let pos = 0;
    e.state.doc.descendants((n: any, p: number) => {
      if (n.type.name === 'codeBlock') pos = p + 3;
    });
    const r = e.view.coordsAtPos(pos);
    return { x: r.left, y: (r.top + r.bottom) / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press('ControlOrMeta+a');
  expect((await selection(page)).type).toBe('text');
  expect(await copy(page)).toBe(source);
});

test('inline code and the language input keep their existing native selection behavior', async ({
  page,
}) => {
  await ready(
    page,
    '前面 `行内代码` 后面\n\n```javascript\nconst value = 1;\n```',
  );
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection(5);
    e.view.focus();
  });
  await page.keyboard.press('ControlOrMeta+a');
  expect((await selection(page)).type).toBe('all');
  const input = page.getByRole('combobox', { name: '代码语言', exact: true });
  await input.focus();
  await input.press('ControlOrMeta+a');
  expect(
    await input.evaluate((el) => {
      const i = el as HTMLInputElement;
      return i.selectionEnd! - i.selectionStart!;
    }),
  ).toBe('javascript'.length);
  expect((await selection(page)).type).toBe('all');
});
