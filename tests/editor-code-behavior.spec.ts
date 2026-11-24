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

for (const [position, prefix] of [
  ['paragraph start', ''],
  ['after a space', '前文 '],
  ['directly after text', '前文'],
]) {
  for (const inside of [true, false]) {
    test(`clicking ${inside ? 'inside' : 'outside'} the inline code start | ${position}`, async ({
      page,
    }) => {
      await ready(page, prefix + '`hello` 后文');
      const paragraph = page.locator('.article-editor p');
      const code = paragraph.locator('code');
      const box = (await code.boundingBox())!;
      await page.mouse.move(box.x + (inside ? 2 : -2), box.y + box.height / 2);
      await page.mouse.down();
      await expect(page.locator('.article-editor')).toHaveCSS(
        'caret-color',
        'rgba(0, 0, 0, 0)',
      );
      await page.mouse.up();

      const caret = paragraph.locator('.inline-code-start-caret');
      await expect(caret).toHaveCount(1);
      const caretX = await caret.evaluate(
        (element) => element.getBoundingClientRect().left,
      );
      if (inside) {
        expect(caretX).toBeGreaterThan(box.x);
        expect(caretX).toBeLessThan(box.x + box.width);
      } else {
        expect(caretX).toBeLessThan(box.x);
      }

      await page.keyboard.type('x');
      await expect(code).toHaveText(inside ? 'xhello' : 'hello');
      await expect(paragraph).toHaveText(prefix + 'xhello 后文');
      await expect(caret).toHaveCount(0);
    });
  }
}

test('quick clicks on opposite sides of the inline code start use the last side', async ({
  page,
}) => {
  await ready(page, '前文`hello`后文');
  const paragraph = page.locator('.article-editor p');
  const code = paragraph.locator('code');
  const box = (await code.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.click(box.x + 2, y);
  await page.mouse.click(box.x - 2, y);
  await page.keyboard.type('x');
  await expect(code).toHaveText('hello');
  await expect(paragraph).toHaveText('前文xhello后文');
});

test('Right enters the inline code start from the clicked outside position', async ({
  page,
}) => {
  await ready(page, '`hello` 后文');
  const code = page.locator('.article-editor p code');
  const insideCaret = code.locator('.inline-code-start-caret');
  const box = (await code.boundingBox())!;
  await page.mouse.click(box.x - 2, box.y + box.height / 2);

  await page.keyboard.press('ArrowRight');
  await expect(insideCaret).toHaveCount(1);
  await page.keyboard.press('ArrowLeft');
  await expect(insideCaret).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('x');
  await expect(code).toHaveText('xhello');
});

test('Right enters the inline code start from prose, then moves past the first character', async ({
  page,
}) => {
  await ready(page, '正文`hello`后文');
  const code = page.locator('.article-editor p code');
  await page.evaluate(() => {
    const { editor } = (window as any).__mojian;
    editor.commands.setTextSelection(2);
    editor.view.focus();
  });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(code.locator('.inline-code-start-caret')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('x');
  await expect(code).toHaveText('hxello');
});

for (const inside of [true, false]) {
  test(`undo restores typing ${inside ? 'inside' : 'outside'} the inline code start`, async ({
    page,
  }) => {
    const prefix = inside ? '前文 ' : '';
    await ready(page, prefix + '`hello` 后文');
    const paragraph = page.locator('.article-editor p');
    const code = paragraph.locator('code');
    const box = (await code.boundingBox())!;
    await page.mouse.click(box.x + (inside ? 2 : -2), box.y + box.height / 2);
    await page.keyboard.type('x');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(paragraph).toHaveText(prefix + 'hello 后文');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(paragraph).toHaveText(prefix + 'xhello 后文');
    await page.keyboard.press('ControlOrMeta+z');

    await page.keyboard.type('y');
    await expect(paragraph).toHaveText(prefix + 'yhello 后文');
    await expect(code).toHaveText(inside ? 'yhello' : 'hello');
  });
}

test('the inline code start caret follows the first character of right-to-left text', async ({
  page,
}) => {
  await ready(page, '前文 `שלום` 后文');
  const code = page.locator('.article-editor p code');
  const box = (await code.boundingBox())!;
  await page.mouse.click(box.x - 2, box.y + box.height / 2);
  await page.keyboard.press('ArrowRight');

  const caret = code.locator('.inline-code-start-caret');
  const { caretX, firstCharacterRight } = await caret.evaluate((element) => {
    const range = document.createRange();
    range.setStart(element.nextSibling!, 0);
    range.setEnd(element.nextSibling!, 1);
    const transform = getComputedStyle(element, '::after').transform;
    return {
      caretX:
        element.getBoundingClientRect().left +
        new DOMMatrixReadOnly(transform === 'none' ? undefined : transform).m41,
      firstCharacterRight: range.getBoundingClientRect().right,
    };
  });
  expect(Math.abs(caretX - firstCharacterRight)).toBeLessThan(1);
  await page.keyboard.insertText('א');
  await expect(code).toHaveText('אשלום');
});

for (const [first, rest] of [
  ['h', 'ello'],
  ['h', ''],
  ['🧑‍💻', 'ello'],
]) {
  const source = first + rest;
  test(`Left visits both sides of the inline code start for "${source}"`, async ({
    page,
  }) => {
    await ready(page, '前文 `' + source + '` 后文');
    const code = page.locator('.article-editor p code');
    const clickAfterFirstCharacter = async (firstLength: number) => {
      const { x, y } = await code.evaluate((element, offset) => {
        const range = document.createRange();
        range.setStart(element.firstChild!, offset);
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y + rect.height / 2 };
      }, firstLength);
      await page.mouse.click(x, y);
    };
    const caretInsideCode = () =>
      code.evaluate((element) =>
        element.contains(window.getSelection()?.anchorNode ?? null),
      );

    await clickAfterFirstCharacter(first.length);
    await page.keyboard.press('ArrowLeft');
    expect(await caretInsideCode()).toBe(true);
    await page.keyboard.type('x');
    await expect(code).toHaveText('x' + source);

    await clickAfterFirstCharacter(1);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await caretInsideCode()).toBe(false);
    await page.keyboard.type('y');
    await expect(code).toHaveText('x' + source);
    await expect(page.locator('.article-editor p')).toHaveText(
      '前文 yx' + source + ' 后文',
    );
  });
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

test('GitHub colors agree in editor and preview, preview omits editor line numbers, and Mermaid stays light', async ({
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
  await expect(code.locator('.code-gutter-row')).toHaveCount(3);
  await expect(card.locator('[data-code-line-number]')).toHaveCount(0);
  expect(
    await card
      .locator('[data-code-line]')
      .first()
      .evaluate((el) => getComputedStyle(el, '::before').content),
  ).toBe('none');
});
test('preview keeps long code horizontally scrollable in both themes', async ({
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
        scroll
          .locator('[data-code-line]')
          .first()
          .evaluate((line) => line.getBoundingClientRect().left);
      const before = await textLeft();
      for (const offset of [100, 5000, 0]) {
        await scroll.evaluate((el, x) => (el.scrollLeft = x), offset);
        const actual = await scroll.evaluate((el) => el.scrollLeft);
        if (offset) expect(actual).toBeGreaterThan(0);
        expect(await textLeft()).toBeCloseTo(before - actual, 0);
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
