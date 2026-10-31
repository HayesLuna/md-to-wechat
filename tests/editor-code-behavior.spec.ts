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
for (const [name, text] of [
  ['paragraph', '前面后面'],
  ['bold', '**前面后面**'],
  ['heading', '## 前面后面'],
  ['bullet', '- 前面后面'],
  ['ordered', '1. 前面后面'],
  ['task', '- [ ] 前面后面'],
])
  test(`${name}: Tab moves the visible caret and subsequent typing follows the tab`, async ({
    page,
  }) => {
    await ready(page, text);
    const from = await page.evaluate(() => {
      const e = (window as any).__mojian.editor;
      let at = -1;
      e.state.doc.descendants((n: any, p: number) => {
        if (n.isText && n.text === '前面后面') at = p + 2;
      });
      e.commands.setTextSelection(at);
      e.commands.focus();
      return at;
    });
    await expect(page.locator('.article-editor')).toBeFocused();
    const before = await page.evaluate(
      () => window.getSelection()!.getRangeAt(0).getBoundingClientRect().left,
    );
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => ({
      position: (window as any).__mojian.editor.state.selection.from,
      caret: window.getSelection()!.getRangeAt(0).getBoundingClientRect().left,
    }));
    expect(first.position).toBe(from + 1);
    expect(first.caret).toBeGreaterThan(before);
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(
        () => (window as any).__mojian.editor.state.selection.from,
      ),
    ).toBe(from + 2);
    await page.keyboard.type('X');
    expect(
      await page.evaluate(
        () => (window as any).__mojian.editor.state.doc.textContent,
      ),
    ).toBe('前面\t\tX后面');
    expect(
      await page.evaluate(
        () => (window as any).__mojian.editor.state.selection.from,
      ),
    ).toBe(from + 3);
  });

test('GitHub colors agree in editor and preview, preview has line numbers, and Mermaid stays light', async ({
  page,
}) => {
  await ready(
    page,
    '```js\n// 注释\nconst text = "hello";\nconsole.log(text);\n```\n\n```mermaid\ngraph LR\n  A --> B\n```',
  );
  const code = page.locator('.code-node').first();
  await expect(code).toHaveClass(/code-theme-github/);
  await expect(code.locator('.hljs-keyword')).toHaveCSS(
    'color',
    'rgb(215, 58, 73)',
  );
  const colors = await code.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    text: getComputedStyle(el.querySelector('pre')!).color,
    keyword: getComputedStyle(el.querySelector('.hljs-keyword')!).color,
    string: getComputedStyle(el.querySelector('.hljs-string')!).color,
    header: getComputedStyle(el.querySelector('.code-header')!).backgroundColor,
  }));
  expect(colors).toEqual({
    background: 'rgb(255, 255, 255)',
    text: 'rgb(36, 41, 46)',
    keyword: 'rgb(215, 58, 73)',
    string: 'rgb(3, 47, 98)',
    header: 'rgb(246, 248, 250)',
  });
  const mermaid = page.locator('.code-node').nth(1);
  await expect(mermaid).not.toHaveClass(/code-theme-github/);
  await mermaid.getByRole('button', { name: '展示代码', exact: true }).click();
  await expect(mermaid).toHaveClass(/code-theme-github/);
  await mermaid.getByRole('button', { name: '展示图表', exact: true }).click();
  await expect(mermaid).not.toHaveClass(/code-theme-github/);
  await expect(code.locator('.hljs-comment')).toHaveCSS(
    'color',
    'rgb(106, 115, 125)',
  );
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  const card = page.locator('.preview-paper [data-code-block]');
  await expect(card.getByText('const', { exact: true })).toHaveCSS(
    'color',
    'rgb(215, 58, 73)',
  );
  await expect(card.getByText('"hello"', { exact: true })).toHaveCSS(
    'color',
    'rgb(3, 47, 98)',
  );
  await expect(card.locator('[data-code-line]')).toHaveCount(3);
  await expect(card.locator('[data-code-lines]')).toHaveCSS(
    'counter-reset',
    'code-line 0',
  );
  expect(
    await card
      .locator('[data-code-line]')
      .first()
      .evaluate((el) => {
        const number = getComputedStyle(el, '::before');
        return {
          content: number.content,
          increment: number.counterIncrement,
          visible: number.display !== 'none' && parseFloat(number.width) > 0,
        };
      }),
  ).toEqual({
    content: 'counter(code-line)',
    increment: 'code-line 1',
    visible: true,
  });
});
test('preview line number width follows digit boundaries and shrinks after editing', async ({
  page,
}) => {
  await ready(page, '```text\nline\n```');
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  const card = page.locator('.preview-paper [data-code-block]');
  const widths: number[] = [];
  for (const count of [9, 10, 99, 100, 999, 1000, 9]) {
    await page.evaluate((count) => {
      (window as any).__mojian.setMarkdown(
        '```text\n' + Array(count).fill('line').join('\n') + '\n```',
      );
    }, count);
    await expect(card.locator('[data-code-line]')).toHaveCount(count);
    const geometry = await card.evaluate((el) => {
      const lines = el.querySelectorAll('[data-code-line]');
      const first = lines[0];
      const last = lines[lines.length - 1];
      return {
        width: parseFloat(getComputedStyle(first, '::before').width),
        first: first.firstElementChild!.getBoundingClientRect().left,
        last: last.firstElementChild!.getBoundingClientRect().left,
      };
    });
    expect(geometry.first).toBeCloseTo(geometry.last, 1);
    widths.push(geometry.width);
  }
  const unit = widths[0];
  expect(unit).toBeGreaterThan(0);
  for (const [i, digits] of [1, 2, 2, 3, 3, 4, 1].entries())
    expect(widths[i]).toBeCloseTo(unit * digits, 1);
});

test('preview line numbers stay fixed while long code scrolls in both themes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const line = 'const value = "' + 'long_code_'.repeat(40) + '";';
  await ready(page, `\`\`\`js\n${line}\n\n${line}\n\`\`\``);
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page).toHaveTitle('墨笺 · Markdown 公众号排版');
  const card = page.locator('.preview-paper [data-code-block]');
  for (const [theme, background] of [
    ['浅色', 'rgb(255, 255, 255)'],
    ['深色', 'rgb(13, 17, 23)'],
  ]) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await expect(card.locator('pre')).toHaveCSS('background-color', background);
    await expect(card.locator('[data-code-line]')).toHaveCount(3);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await card.scrollIntoViewIfNeeded();
      const scroll = card.locator('[data-code-scroll]');
      await scroll.evaluate((el) => (el.scrollLeft = 0));
      const textLeft = () =>
        card
          .locator('[data-code-line] > span')
          .first()
          .evaluate((el) => el.getBoundingClientRect().left);
      const before = await textLeft();
      for (const offset of [100, 5000, 0]) {
        await scroll.evaluate((el, x) => (el.scrollLeft = x), offset);
        const actual = await scroll.evaluate((el) => el.scrollLeft);
        if (offset) expect(actual).toBeGreaterThan(0);
        expect(await textLeft()).toBeCloseTo(before - actual, 0);
        const gutter = await scroll.evaluate((el) => {
          const line = el.querySelector('[data-code-line]')!;
          const bounds = line.getBoundingClientRect();
          const style = getComputedStyle(line, '::before');
          return {
            fixed:
              document.elementFromPoint(
                el.getBoundingClientRect().left + 20,
                bounds.top + bounds.height / 2,
              ) === line,
            background: style.backgroundColor,
          };
        });
        expect(gutter).toEqual({ fixed: true, background });
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    }
  }
  expect(errors).toEqual([]);
});

for (const [name, markdown, from, to, expected] of [
  ['empty paragraph', '', 1, 1, '\tX'],
  ['paragraph end', '正文', 3, 3, '正文\tX'],
  ['heading end', '## 标题', 3, 3, '标题\tX'],
  ['selected text', '前面选中后面', 3, 5, '前面\tX后面'],
] as const)
  test(`${name}: Tab collapses the caret after insertion and typing follows it`, async ({
    page,
  }) => {
    await ready(page, markdown);
    await page.evaluate(
      ({ from, to }) => {
        const e = (window as any).__mojian.editor;
        e.commands.setTextSelection({ from, to });
        e.commands.focus();
      },
      { from, to },
    );
    await expect(page.locator('.article-editor')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(
        () => (window as any).__mojian.editor.state.selection.from,
      ),
    ).toBe(from + 1);
    const caret = await page.evaluate(() => {
      const e = (window as any).__mojian.editor;
      const selection = window.getSelection()!;
      return {
        dom: selection.getRangeAt(0).getBoundingClientRect().left,
        model: e.view.coordsAtPos(e.state.selection.from).left,
      };
    });
    expect(Math.abs(caret.dom - caret.model)).toBeLessThan(1);
    await page.keyboard.type('X');
    expect(
      await page.evaluate(
        () => (window as any).__mojian.editor.state.doc.textContent,
      ),
    ).toBe(expected);
  });
test('backward code selection preserves tabs, NBSP and literal Markdown fences in copied text', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const source = 'first\n\tcode\u00a0space\n```mermaid\nlast';
  await ready(page, '````txt\n' + source + '\n````');
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection({
      from: e.state.doc.firstChild.nodeSize - 1,
      to: 1,
    });
    e.commands.focus();
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    source,
  );
});
