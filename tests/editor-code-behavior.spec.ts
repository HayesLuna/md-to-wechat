import { editorTest as test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function ready(page: Page, content = '') {
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate((text) => {
    const m = (window as any).__mojian;
    m.setMarkdown(text);
    m.editor.commands.focus('end');
  }, content);
}

for (const [tag, opening, closing, expectedMarkdown] of [
  ['strong', '**', '**', '前文**到发水**后文'],
  ['em', '*', '*', '前文*到发水*后文'],
  ['s', '~~', '~~', '前文~~到发水~~后文'],
  ['mark', '==', '==', '前文==到发水==后文'],
  ['u', '++', '++', '前文<u>到发水</u>后文'],
  ['u', '<u>', '</u>', '前文<u>到发水</u>后文'],
  ['code', '`', '`', '前文`到发水`后文'],
] as const) {
  test(`${tag} (${opening}...${closing}) can be typed adjacent to Chinese without showing syntax delimiters`, async ({
    page,
  }) => {
    await ready(page, '');
    await page.locator('.article-editor').click();
    await page.keyboard.type(`前文${opening}到发水${closing}后文`);
    await expect(page.locator('.article-editor ' + tag)).toHaveText('到发水');
    await expect(page.locator('.article-editor')).toHaveText('前文到发水后文');
    await expect(page.locator('.highlight-delimiter')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
    ).toBe(expectedMarkdown);
  });
}

test('underline round-trips as Typora syntax and is rendered in publication preview', async ({
  page,
}) => {
  await ready(page, '前文 <u>**下划线**</u> 与 ++旧下划线++ 后文');
  const editor = page.locator('.article-editor');
  await expect(editor.locator('u').filter({ hasText: '下划线' })).toHaveText([
    '下划线',
    '旧下划线',
  ]);
  await expect(
    editor.locator('strong').filter({ hasText: '下划线' }),
  ).toHaveText('下划线');
  const canonical = await page.evaluate(() => {
    const { editor } = (window as any).__mojian;
    const markdown = editor.getMarkdown();
    editor.commands.setContent(editor.markdown.parse(markdown));
    return { markdown, again: editor.getMarkdown() };
  });
  expect(canonical.again).toBe(canonical.markdown);
  expect(canonical.markdown).toContain('<u>旧下划线</u>');
  expect(canonical.markdown).toMatch(
    /(\*\*<u>下划线<\/u>\*\*|<u>\*\*下划线\*\*<\/u>)/,
  );
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('.preview-paper u')).toHaveText([
    '下划线',
    '旧下划线',
  ]);
  await page.getByRole('button', { name: '关闭预览', exact: true }).click();
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setContent(e.markdown.parse('普通文字'));
    e.commands.setTextSelection({ from: 1, to: 5 });
    e.commands.focus();
  });
  const underlineBtn = page.getByRole('button', {
    name: '下划线',
    exact: true,
  });
  await expect(underlineBtn).toHaveAttribute('aria-pressed', 'false');
  await underlineBtn.click();
  await expect(underlineBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.locator('u')).toHaveText('普通文字');
  await underlineBtn.click();
  await expect(underlineBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(editor.locator('u')).toHaveCount(0);
});

test('an underlined link round-trips when its title contains a closing underline tag', async ({
  page,
}) => {
  const title = '标题 </u> 仍是标题';
  const source = '[甲](https://example.com "' + title + '")乙';
  await ready(page, source);
  const saved = await page.evaluate(() => {
    const { editor } = (window as any).__mojian;
    editor.commands.setTextSelection({ from: 1, to: 3 });
    editor.commands.setUnderline();
    return editor.getMarkdown();
  });
  await ready(page, saved);
  const link = page.locator('.article-editor a');
  await expect(link).toHaveAttribute('title', title);
  await expect(link.locator('u')).toHaveText('甲');
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  const preview = page.locator('.preview-paper u a');
  await expect(preview).toHaveAttribute('title', title);
  await expect(preview).toHaveText('甲');
});

test('an underline closes outside a defined reference-link label', async ({
  page,
}) => {
  await ready(page, '<u>[甲][ref</u>]乙</u>\n\n[ref</u>]: https://example.com');
  const link = page.locator('.article-editor a');
  await expect(link).toHaveAttribute('href', 'https://example.com');
  await expect(link.locator('u')).toHaveText('甲');
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('.preview-paper u a')).toHaveText('甲');
  await expect(page.locator('.preview-paper u')).toHaveText('甲乙');
});

test('typing Markdown markers inside inline code stays literal', async ({
  page,
}) => {
  const editor = page.locator('.article-editor');
  const code = editor.locator('code');
  await ready(page, '前文 `a` 后文');
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus(5));
  await expect(editor).toBeFocused();
  await page.keyboard.type(' **bold** ==mark==');
  await expect(editor.locator('strong')).toHaveCount(0);
  await expect(editor.locator('mark')).toHaveCount(0);
  await expect(code).toHaveText('a **bold** ==mark==');
});

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
        if (n.isText && n.text?.includes('前面后面'))
          at = p + n.text.indexOf('前面后面') + 2;
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

test('arrow keys can insert inside or outside both edges of inline code', async ({
  page,
}) => {
  await ready(page, '前`甲乙`后');
  const editor = page.locator('.article-editor');
  const formatted = editor.locator('code');
  // Start outside left edge (pos 2: 前|甲乙后)
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus(2));
  await expect(editor).toBeFocused();
  // ArrowRight steps inside left edge -> typing inserts before first char
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('A');
  await expect(formatted).toHaveText('A甲乙');
  // ArrowLeft twice: back to inside left edge, then outside left edge
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('B');
  await expect(formatted).toHaveText('A甲乙');
  await expect(editor).toHaveText('前BA甲乙后');
  // Move to after last char inside (pos of '乙' + 1), type inside right edge
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus(6));
  await page.keyboard.type('C');
  await expect(formatted).toHaveText('A甲乙C');
  // ArrowRight exits right edge -> typing inserts outside
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('D');
  await expect(formatted).toHaveText('A甲乙C');
  await expect(editor).toHaveText('前BA甲乙CD后');
  // ArrowLeft from after 'D' back onto outside right edge, then ArrowLeft enters inside right edge
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('E');
  await expect(formatted).toHaveText('A甲乙CE');
});

for (const [tag, opening, closing] of [
  ['strong', '**', '**'],
  ['em', '*', '*'],
  ['s', '~~', '~~'],
  ['mark', '==', '=='],
  ['u', '<u>', '</u>'],
] as const) {
  test(`text-style mark ${tag} stays plain before its left edge and continues formatting after its right edge`, async ({
    page,
  }) => {
    const editor = page.locator('.article-editor');
    const formatted = editor.locator(tag);

    // Surrounded by plain text: clicking slightly inside or outside left edge
    // both insert plain text; clicking slightly inside or outside right edge
    // both continue the mark.
    await ready(page, `前${opening}甲乙${closing}后`);
    const box = (await formatted.boundingBox())!;
    const y = box.y + box.height / 2;

    await page.mouse.click(box.x + 2, y);
    await page.keyboard.type('A');
    await expect(formatted).toHaveText('甲乙');
    await expect(editor).toHaveText('前A甲乙后');

    const boxAfterLeft = (await formatted.boundingBox())!;
    await page.mouse.click(boxAfterLeft.x + boxAfterLeft.width + 2, y);
    await page.keyboard.type('B');
    await expect(formatted).toHaveText('甲乙B');

    // Paragraph-start formatted text: clicking before it still inserts plain.
    await ready(page, `${opening}开头${closing}`);
    const leadBox = (await formatted.boundingBox())!;
    await page.mouse.click(leadBox.x + 2, leadBox.y + leadBox.height / 2);
    await page.keyboard.type('P');
    await expect(formatted).toHaveText('开头');
    await expect(editor).toHaveText('P开头');

    const endBox = (await formatted.boundingBox())!;
    await page.mouse.click(
      endBox.x + endBox.width + 20,
      endBox.y + endBox.height / 2,
    );
    await page.keyboard.type('Q');
    await expect(formatted).toHaveText('开头Q');
  });
}

test('clicking inside left or right edge of inline code aligns the visible caret inside, while clicking outside aligns it outside', async ({
  page,
}) => {
  await ready(page, '前文 `测试` 后文');
  const editor = page.locator('.article-editor');
  const code = editor.locator('code');
  const caretInsideCode = () =>
    page.evaluate(() => {
      const code = document.querySelector('.article-editor code')!;
      const box = code.getBoundingClientRect();
      const overlay = document.querySelector<HTMLElement>(
        '.editor-host .mark-boundary-caret',
      );
      if (overlay && getComputedStyle(overlay).display !== 'none') {
        const rect = overlay.getBoundingClientRect();
        return {
          inNode: rect.left > box.left && rect.left < box.right,
          x: rect.left,
          left: box.left,
          right: box.right,
        };
      }
      const sel = window.getSelection()!;
      const caret = sel.getRangeAt(0).getBoundingClientRect();
      return {
        inNode: code.contains(sel.anchorNode),
        x: caret.left,
        left: box.left,
        right: box.right,
      };
    });

  const rects = await code.evaluate((element) => {
    const text = element.firstChild!;
    const startRange = document.createRange();
    startRange.setStart(text, 0);
    startRange.setEnd(text, 1);
    const box = element.getBoundingClientRect();
    const first = startRange.getBoundingClientRect();
    return {
      insideLeft: { x: first.left + 1, y: first.top + first.height / 2 },
      outsideLeft: { x: box.left - 4, y: box.top + box.height / 2 },
    };
  });

  await page.mouse.click(rects.insideLeft.x, rects.insideLeft.y);
  const insideLeftCaret = await caretInsideCode();
  expect(insideLeftCaret.inNode).toBe(true);
  expect(insideLeftCaret.x).toBeGreaterThan(insideLeftCaret.left);
  await page.keyboard.type('头');
  await expect(code).toHaveText('头测试');

  await page.mouse.click(rects.outsideLeft.x, rects.outsideLeft.y);
  const outsideLeftCaret = await caretInsideCode();
  expect(outsideLeftCaret.inNode).toBe(false);
  expect(outsideLeftCaret.x).toBeLessThanOrEqual(outsideLeftCaret.left);
  await page.keyboard.type('外');
  await expect(code).toHaveText('头测试');
  await expect(editor).toHaveText('前文 外头测试 后文');

  // ArrowRight from outside left edge moves the visible caret inside the code box.
  await page.keyboard.press('ArrowRight');
  const arrowInsideCaret = await caretInsideCode();
  expect(arrowInsideCaret.inNode).toBe(true);
  expect(arrowInsideCaret.x).toBeGreaterThan(arrowInsideCaret.left);

  const endRects = await code.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode()!;
    for (let next = walker.nextNode(); next; next = walker.nextNode())
      text = next;
    const len = text.textContent!.length;
    const endRange = document.createRange();
    endRange.setStart(text, len - 1);
    endRange.setEnd(text, len);
    const last = endRange.getBoundingClientRect();
    return {
      insideRight: { x: last.right - 1, y: last.top + last.height / 2 },
    };
  });

  await page.mouse.click(endRects.insideRight.x, endRects.insideRight.y);
  const insideRightCaret = await caretInsideCode();
  expect(insideRightCaret.inNode).toBe(true);
  expect(insideRightCaret.x).toBeLessThan(insideRightCaret.right);
  await page.keyboard.type('尾');
  await expect(code).toHaveText('头测试尾');

  // ArrowRight from inside right edge moves the visible caret outside the code box.
  await page.keyboard.press('ArrowRight');
  const outsideRightCaret = await caretInsideCode();
  expect(outsideRightCaret.inNode).toBe(false);
  expect(outsideRightCaret.x).toBeGreaterThanOrEqual(outsideRightCaret.right);

  // Trailing code at paragraph end: blank click lands outside, ArrowLeft enters
  // inside, and ArrowRight exits cleanly without adding a space.
  await ready(page, '前文 `代码`');
  await editor.click();
  await expect(editor).toBeFocused();
  expect((await caretInsideCode()).inNode).toBe(false);
  await page.keyboard.press('ArrowLeft');
  expect((await caretInsideCode()).inNode).toBe(true);
  await page.keyboard.press('ArrowRight');
  expect((await caretInsideCode()).inNode).toBe(false);
  await page.keyboard.type('后');
  await expect(code).toHaveText('代码');
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
  ).toBe('前文 `代码`后');

  // Leading code: clicking left margin lands outside, and pasting at inside-left
  // preserves the code mark.
  await ready(page, '`head` 开头');
  const leadBox = (await code.boundingBox())!;
  await page.mouse.click(leadBox.x - 40, leadBox.y + leadBox.height / 2);
  expect((await caretInsideCode()).inNode).toBe(false);
  await page.keyboard.type('!');
  await expect(code).toHaveText('head');
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
  ).toBe('!`head` 开头');

  await page.keyboard.press('ArrowRight');
  expect((await caretInsideCode()).inNode).toBe(true);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'PRE_');
    (window as any).__mojian.editor.view.dom.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(code).toHaveText('PRE_head');
});

test('inline code boundary caret overlay visually distinguishes inside-left and outside-right stops', async ({
  page,
}) => {
  await ready(page, '12`345`67');
  const editor = page.locator('.article-editor');
  const code = editor.locator('code');
  const overlay = page.locator('.editor-host .mark-boundary-caret');
  await editor.click();
  await expect(editor).toBeFocused();
  await page.evaluate(() =>
    (window as any).__mojian.editor.commands.setTextSelection(1),
  );

  // Press 1 (1|2), Press 2 (12|[345]67 outside-left): native caret outside code
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(overlay).toBeHidden();

  // Press 3 (12[|345]67 inside-left): overlay renders inside code before '3'
  await page.keyboard.press('ArrowRight');
  await expect(overlay).toBeVisible();
  const insideLeft = await page.evaluate(() => {
    const c = document.querySelector('.article-editor code')!;
    const w = document.querySelector('.editor-host .mark-boundary-caret')!;
    const cb = c.getBoundingClientRect();
    const wb = w.getBoundingClientRect();
    return { wx: wb.left, left: cb.left, right: cb.right };
  });
  expect(insideLeft.wx).toBeGreaterThan(insideLeft.left);
  expect(insideLeft.wx).toBeLessThan(insideLeft.right);

  // Press 4 (3|45), Press 5 (34|5), Press 6 (345| inside-right): native caret inside code
  await page.keyboard.press('ArrowRight');
  await expect(overlay).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(overlay).toBeHidden();

  // Press 7 (12[345]|67 outside-right): overlay renders outside code before '6'
  await page.keyboard.press('ArrowRight');
  await expect(overlay).toBeVisible();
  const outsideRight = await page.evaluate(() => {
    const c = document.querySelector('.article-editor code')!;
    const w = document.querySelector('.editor-host .mark-boundary-caret')!;
    const cb = c.getBoundingClientRect();
    const wb = w.getBoundingClientRect();
    return { wx: wb.left, right: cb.right };
  });
  expect(outsideRight.wx).toBeGreaterThanOrEqual(outsideRight.right);

  // Typing at Press 7 inserts outside code; ArrowLeft returns inside right edge.
  await page.keyboard.type('X');
  await expect(code).toHaveText('345');
  await expect(editor).toHaveText('12345X67');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ArrowLeft');
  await expect(overlay).toBeHidden();
  await page.keyboard.type('Y');
  await expect(code).toHaveText('345Y');
});

test('clicking either side of inline code edges settles on mousedown without jumping on mouseup', async ({
  page,
}) => {
  await ready(page, '12`345`67');
  const code = page.locator('.article-editor code');
  const box = (await code.boundingBox())!;
  const y = box.y + box.height / 2;

  const snapshot = () =>
    page.evaluate(() => {
      const e = (window as any).__mojian.editor;
      const c = document.querySelector('.article-editor code')!;
      const cb = c.getBoundingClientRect();
      const w = document.querySelector<HTMLElement>(
        '.editor-host .mark-boundary-caret',
      );
      const visible = !!w && getComputedStyle(w).display !== 'none';
      const wb = visible ? w!.getBoundingClientRect() : null;
      return {
        pos: e.state.selection.from,
        codeActive: e.isActive('code'),
        overlayInCode: wb ? wb.left > cb.left && wb.left < cb.right : null,
      };
    });

  const cases = [
    {
      x: box.x - 2,
      expected: { pos: 3, codeActive: false, overlayInCode: null },
    },
    {
      x: box.x + 2,
      expected: { pos: 3, codeActive: true, overlayInCode: true },
    },
    {
      x: box.x + box.width - 2,
      expected: { pos: 6, codeActive: true, overlayInCode: null },
    },
    {
      x: box.x + box.width + 2,
      expected: { pos: 6, codeActive: false, overlayInCode: false },
    },
  ];

  for (const { x, expected } of cases) {
    await page.evaluate(() =>
      (window as any).__mojian.editor.commands.focus(8),
    );
    await page.mouse.move(x, y);
    await page.mouse.down();
    const onDown = await snapshot();
    await page.mouse.up();
    const onUp = await snapshot();
    expect(onDown).toEqual(expected);
    expect(onUp).toEqual(expected);
  }
});

test('dragging across inline code selects text smoothly from any starting edge or character', async ({
  page,
}) => {
  await ready(page, '121112`12334521123`213aa67');
  const code = page.locator('.article-editor code');
  const box = (await code.boundingBox())!;
  const y = Math.round(box.y + box.height / 2);

  for (const [x1, x2] of [
    [Math.round(box.x + 2), Math.round(box.x + box.width - 2)],
    [Math.round(box.x + 6), Math.round(box.x + box.width - 2)],
    [Math.round(box.x + box.width - 2), Math.round(box.x + 2)],
    [Math.round(box.x + 24), Math.round(box.x + 60)],
  ]) {
    await page.evaluate(() =>
      (window as any).__mojian.editor.commands.setTextSelection(1),
    );
    await page.mouse.move(x1, y);
    await page.mouse.down();
    await page.mouse.move(x2, y, { steps: 20 });
    await page.mouse.up();
    const selected = await page.evaluate(() =>
      window.getSelection()!.toString(),
    );
    expect(selected.length).toBeGreaterThanOrEqual(4);
  }
});

test('inline code boundary overlay stays hidden in read-only mode and adjacent bold gap exits code', async ({
  page,
}) => {
  await ready(page, '`代码`**粗体**');
  const code = page.locator('.article-editor code');
  const strong = page.locator('.article-editor strong');
  const overlay = page.locator('.editor-host .mark-boundary-caret');
  const box = (await code.boundingBox())!;

  // Click the 4px margin gap right after inline code before adjacent bold.
  await page.mouse.click(box.x + box.width + 2, box.y + box.height / 2);
  await expect(overlay).toBeVisible();
  await page.keyboard.type('X');
  await expect(code).toHaveText('代码');
  await expect(strong).toHaveText('X粗体');

  // Switching to read-only hides the boundary overlay even at an inline code edge.
  await page.mouse.click(box.x + 2, box.y + box.height / 2);
  await page.getByRole('switch', { name: '只读模式' }).click();
  await expect(overlay).toBeHidden();
});
