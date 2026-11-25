import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
async function ready(page: Page, text: string) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(
    (text) => (window as any).__mojian.setMarkdown(text),
    text,
  );
}

const inlineFormats = [
  ['code', '`', '`'],
  ['strong', '**', '**'],
  ['em', '*', '*'],
  ['s', '~~', '~~'],
  ['u', '<u>', '</u>'],
  ['mark', '==', '=='],
] as const;

for (const [tag, opening, closing] of inlineFormats) {
  test(`${tag} clicks put the caret outside either edge and inside between letters`, async ({
    page,
  }) => {
    const markdown = '前文 ' + opening + '测试' + closing + ' 后文';
    const content = page.locator('.article-editor p ' + tag);
    for (const offset of [0, 1, 2]) {
      await ready(page, markdown);
      const point = await content.evaluate((element, offset) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        range.setStart(walker.nextNode()!, offset);
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.x + (offset === 0 ? 2 : offset === 2 ? -2 : 0),
          y: rect.y + rect.height / 2,
        };
      }, offset);
      await page.mouse.click(point.x, point.y);
      if (tag === 'mark') {
        await expect(page.locator('.highlight-delimiter.expanded')).toHaveCount(
          2,
        );
      } else {
        await expect(content).toHaveAttribute('data-md-opening', opening);
        await expect(content).toHaveAttribute('data-md-closing', closing);
      }
      const boundaryCaret = page.locator('.inline-mark-boundary-caret');
      await expect(boundaryCaret).toHaveCount(
        tag === 'mark' || offset === 1 ? 0 : 1,
      );
      if (tag !== 'mark' && offset !== 1) {
        const markBox = (await content.boundingBox())!;
        const caretBox = (await boundaryCaret.boundingBox())!;
        if (offset === 0) expect(caretBox.x).toBeLessThanOrEqual(markBox.x);
        else
          expect(caretBox.x).toBeGreaterThanOrEqual(
            markBox.x + markBox.width - 1,
          );
      }
      await page.keyboard.insertText('新');
      const expected =
        offset === 0
          ? '前文 新' + opening + '测试' + closing + ' 后文'
          : offset === 2
            ? '前文 ' + opening + '测试' + closing + '新 后文'
            : '前文 ' + opening + '测新试' + closing + ' 后文';
      expect(
        await page.evaluate(() =>
          (window as any).__mojian.editor.getMarkdown(),
        ),
      ).toBe(expected);
    }
  });

  test(`the revealed closing delimiter lets the caret enter the end of ${tag}`, async ({
    page,
  }) => {
    for (const suffix of tag === 'code' || tag === 'u'
      ? [' 后文', '']
      : [' 后文']) {
      await ready(page, '前文 ' + opening + '测试' + closing + suffix);
      const content = page.locator('.article-editor p ' + tag);
      const point = (offset: number, dx = 0) =>
        content.evaluate(
          (element, { offset, dx }) => {
            const walker = document.createTreeWalker(
              element,
              NodeFilter.SHOW_TEXT,
            );
            const range = document.createRange();
            range.setStart(walker.nextNode()!, offset);
            range.collapse(true);
            const rect = range.getBoundingClientRect();
            return { x: rect.x + dx, y: rect.y + rect.height / 2 };
          },
          { offset, dx },
        );
      const middle = await point(1);
      await page.mouse.click(middle.x, middle.y);
      if (tag === 'mark')
        await expect(page.locator('.highlight-delimiter.expanded')).toHaveCount(
          2,
        );
      else await expect(content).toHaveAttribute('data-md-closing', closing);
      const end = await point(2, 1);
      await page.mouse.click(end.x, end.y);
      if (tag !== 'mark')
        await expect(
          content.locator('.inline-mark-boundary-caret'),
        ).toHaveCount(1);
      await page.keyboard.insertText('新');
      expect(
        await page.evaluate(() =>
          (window as any).__mojian.editor.getMarkdown(),
        ),
      ).toBe('前文 ' + opening + '测试新' + closing + suffix);
    }
  });
}

async function delimiterPoint(
  mark: Locator,
  edge: 'opening' | 'closing',
  offset: number,
) {
  return mark.evaluate(
    (element, { edge, offset }) => {
      const opening = edge === 'opening';
      const fragments = element.getClientRects();
      const fragment = opening ? fragments[0] : fragments[fragments.length - 1];
      const layout = getComputedStyle(element);
      const range = document.createRange();
      const syntax = element.getAttribute('data-md-' + edge)!;
      const style = getComputedStyle(
        element,
        edge === 'opening' ? '::before' : '::after',
      );
      const measure = document.createElement('span');
      Object.assign(measure.style, {
        position: 'fixed',
        visibility: 'hidden',
        whiteSpace: 'pre',
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontStyle: style.fontStyle,
        fontWeight: style.fontWeight,
      });
      measure.textContent = syntax;
      document.body.append(measure);
      const box = measure.getBoundingClientRect();
      range.setStart(measure.firstChild!, offset);
      range.collapse(true);
      const distance = range.getBoundingClientRect().x - box.x;
      measure.remove();
      const start = opening
        ? fragment.left +
          parseFloat(layout.paddingLeft) +
          parseFloat(layout.borderLeftWidth)
        : fragment.right -
          parseFloat(layout.paddingRight) -
          parseFloat(layout.borderRightWidth) -
          box.width;
      return {
        x: start + distance,
        y: fragment.top + fragment.height / 2,
      };
    },
    { edge, offset },
  );
}

for (const [tag, opening, closing] of inlineFormats) {
  for (const key of ['Backspace', 'Delete'] as const) {
    test(`${key} deletes the adjacent ${tag} delimiter character at either edge`, async ({
      page,
    }) => {
      const source = '前文 ' + opening + '测试' + closing + ' 后文';
      for (const edge of ['opening', 'closing'] as const) {
        await ready(page, source);
        const editor = page.locator('.article-editor');
        const mark = editor.locator(tag);
        await mark.click();
        const delimiter = edge === 'opening' ? opening : closing;
        const backwards = key === 'Backspace';
        const offset = backwards ? delimiter.length : 0;
        let point: { x: number; y: number };
        if (tag === 'mark') {
          const expanded = editor.locator('.highlight-delimiter.expanded');
          await expect(expanded).toHaveCount(2);
          point = await firstTextPoint(
            edge === 'opening' ? expanded.first() : expanded.last(),
            offset,
          );
        } else {
          await expect(mark).toHaveAttribute('data-md-' + edge, delimiter);
          point = await delimiterPoint(mark, edge, offset);
        }
        await page.mouse.click(point.x + (backwards ? -0.65 : 0.65), point.y);
        await page.keyboard.press(key);
        const remaining = backwards
          ? delimiter.slice(0, -1)
          : delimiter.slice(1);
        await expect(editor).toHaveText(
          '前文 ' +
            (edge === 'opening' ? remaining : opening) +
            '测试' +
            (edge === 'closing' ? remaining : closing) +
            ' 后文',
        );
        await page.keyboard.press('ControlOrMeta+z');
        await expect(mark).toHaveText('测试');
      }
    });
  }
}

test('Backspace after an opening delimiter at the start of a heading keeps the heading', async ({
  page,
}) => {
  await ready(page, '## `测试`');
  const heading = page.locator('.article-editor h2');
  const mark = heading.locator('code');
  await mark.click();
  await expect(mark).toHaveAttribute('data-md-opening', '`');
  const { x, y } = await delimiterPoint(mark, 'opening', 1);
  await page.mouse.click(x - 0.5, y);
  await page.keyboard.press('Backspace');
  await expect(heading).toHaveText('测试`');
});

test('a native caret before the closing delimiter deletes in the requested direction', async ({
  page,
}) => {
  await ready(page, '前文 `测试` 后文');
  const editor = page.locator('.article-editor');
  const mark = editor.locator('code');
  await mark.click();
  const middle = await firstTextPoint(mark, 1);
  await page.mouse.click(middle.x, middle.y);
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__mojian.editor.state.selection.head),
    )
    .toBe(6);
  await page.keyboard.press('Delete');
  await expect(editor).toHaveText('前文 `测试 后文');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(mark).toHaveText('测试');
  await page.keyboard.press('Backspace');
  await expect(mark).toHaveText('测');
});

test('deletion between nested closers follows the displayed caret in either direction', async ({
  page,
}) => {
  for (const key of ['Backspace', 'Delete'] as const) {
    await ready(page, '前文 <u>**下划线**</u> 后文');
    const editor = page.locator('.article-editor');
    const underline = editor.locator('strong u');
    await underline.click();
    await expect(underline).toHaveAttribute('data-md-closing', '</u>');
    const { x, y } = await delimiterPoint(underline, 'closing', 4);
    await page.mouse.click(x - 0.6, y);
    const caret = await editor
      .locator('.inline-mark-boundary-caret')
      .evaluate((element) => {
        const transform = new DOMMatrixReadOnly(
          getComputedStyle(element, '::after').transform,
        );
        return element.getBoundingClientRect().left + transform.m41;
      });
    expect(Math.abs(caret - x)).toBeLessThan(1.5);
    await page.keyboard.press(key);
    await expect(editor).toHaveText(
      key === 'Backspace' ? '前文 <u>下划线</u 后文' : '前文 **下划线* 后文',
    );
    await expect(
      editor.locator(key === 'Backspace' ? 'strong' : 'u'),
    ).toHaveCount(1);
  }
});

async function dragBetween(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function selectUnderlineTagLetter(page: Page, mark: Locator) {
  await mark.click();
  await expect(mark).toHaveAttribute('data-md-opening', '<u>');
  await dragBetween(
    page,
    await delimiterPoint(mark, 'opening', 1),
    await delimiterPoint(mark, 'opening', 2),
  );
  await expect(mark).toHaveAttribute('data-md-opening-partial');
}

function copiedSelection(editor: Locator) {
  return editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    element.dispatchEvent(
      new ClipboardEvent('copy', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
    return {
      text: clipboardData.getData('text/plain'),
      html: clipboardData.getData('text/html'),
    };
  });
}

function paragraphEnd(paragraph: Locator) {
  return paragraph.evaluate((element) => {
    const text = document
      .createTreeWalker(element, NodeFilter.SHOW_TEXT)
      .lastChild()!;
    const range = document.createRange();
    range.setEnd(text, text.textContent!.length);
    range.collapse(false);
    const { right, top, height } = range.getBoundingClientRect();
    return { x: right + 8, y: top + height / 2 };
  });
}

function firstTextPoint(element: Locator, offset: number) {
  return element.evaluate((element, offset) => {
    const text = document
      .createTreeWalker(element, NodeFilter.SHOW_TEXT)
      .firstChild()!;
    const range = document.createRange();
    range.setStart(text, offset);
    range.collapse(true);
    const { left, top, height } = range.getBoundingClientRect();
    return { x: left + 0.2, y: top + height / 2 };
  }, offset);
}

test('a crossed delimiter is copied and deleted with the selected text', async ({
  page,
}) => {
  await ready(page, '前文<u>下划线</u>后文');
  const editor = page.locator('.article-editor');
  const mark = editor.locator('u');
  await mark.click();
  await expect(mark).toHaveAttribute('data-md-closing', '</u>');
  const start = await mark.evaluate((element) => {
    const range = document.createRange();
    range.setStart(element.firstChild!, 2);
    range.collapse(true);
    const { x, y, height } = range.getBoundingClientRect();
    return { x: x + 0.2, y: y + height / 2 };
  });
  await dragBetween(page, start, await paragraphEnd(editor.locator('p')));
  await expect(mark).toHaveAttribute('data-md-closing-selected');
  expect((await copiedSelection(editor)).text).toBe('线</u>后文');
  await page.keyboard.press('Backspace');
  await expect(editor).toHaveText('前文<u>下划');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(mark).toHaveText('下划线');
});

test('a drag starting in adjacent prose can cross the already revealed opening delimiter', async ({
  page,
}) => {
  await ready(page, '前文<u>下划线</u>后文');
  const editor = page.locator('.article-editor');
  const mark = editor.locator('u');
  await mark.click();
  await expect(mark).toHaveAttribute('data-md-opening', '<u>');
  const [start, end] = await mark.evaluate((element) => {
    const range = document.createRange();
    return [element.previousSibling!, element.firstChild!].map((text) => {
      range.setStart(text, 1);
      range.collapse(true);
      const { x, y, height } = range.getBoundingClientRect();
      return { x: x + 0.2, y: y + height / 2 };
    });
  });
  await dragBetween(page, start, end);
  await expect(mark).toHaveAttribute('data-md-opening-selected');
  expect((await copiedSelection(editor)).text).toBe('文<u>下');
});

test('copying an explicit delimiter with rich text preserves the remaining markup', async ({
  page,
}) => {
  await ready(page, '前文<u>下划线</u>和**粗体**后文');
  const editor = page.locator('.article-editor');
  const mark = editor.locator('u');
  await mark.click();
  await expect(mark).toHaveAttribute('data-md-opening', '<u>');
  const start = await delimiterPoint(mark, 'opening', 0);
  await dragBetween(
    page,
    { x: start.x + 0.5, y: start.y },
    await paragraphEnd(editor.locator('p')),
  );
  await expect(mark).toHaveAttribute('data-md-opening-selected');
  const { text, html } = await copiedSelection(editor);
  expect(text).toBe('<u>下划线</u>和**粗体**后文');
  expect(html).toContain('<strong>粗体</strong>');
});

test('Markdown paste replaces the selected delimiter character in one undo step', async ({
  page,
}) => {
  await ready(page, '前文<u>下划线</u>后文');
  const editor = page.locator('.article-editor');
  const mark = editor.locator('u');
  await selectUnderlineTagLetter(page, mark);
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '**新**');
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor).toHaveText('前文<新>下划线</u>后文');
  await expect(editor.locator('strong')).toHaveText('新');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(mark).toHaveText('下划线');
});

test('IME cancellation restores the selection and commit replaces the delimiter character', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Native composition is driven by CDP.');
  await ready(page, '前文<u>下划线</u>后文');
  const editor = page.locator('.article-editor');
  const mark = editor.locator('u');
  await selectUnderlineTagLetter(page, mark);
  const session = await context.newCDPSession(page);
  await session.send('Input.imeSetComposition', {
    text: 'n',
    selectionStart: 1,
    selectionEnd: 1,
  });
  await session.send('Input.imeSetComposition', {
    text: '',
    selectionStart: 0,
    selectionEnd: 0,
  });
  await expect(mark).toHaveAttribute('data-md-opening-partial');
  await expect(editor).toHaveText('前文下划线后文');
  await session.send('Input.imeSetComposition', {
    text: '你',
    selectionStart: 1,
    selectionEnd: 1,
  });
  await session.send('Input.insertText', { text: '你' });
  await expect(editor).toHaveText('前文<你>下划线</u>后文');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(mark).toHaveText('下划线');
});

test('a delimiter alone can be selected and copied in a table cell', async ({
  page,
}) => {
  await ready(page, '| 标题 |\n| --- |\n| 前文<u>下划线</u>后文 |');
  const editor = page.locator('.article-editor');
  const mark = editor.locator('td u');
  await selectUnderlineTagLetter(page, mark);
  expect((await copiedSelection(editor)).text).toBe('u');
  await page.keyboard.press('Backspace');
  await expect(editor.locator('td')).toHaveText('前文<>下划线</u>后文');
});

test('dragging a delimiter across cells uses a cell selection before deleting', async ({
  page,
}) => {
  await ready(
    page,
    '| 表头一 | 表头二 |\n| --- | --- |\n| 前文<u>下划线</u>后文 | 第二格 |',
  );
  const cells = page.locator('.article-editor td');
  const mark = cells.first().locator('u');
  await mark.click();
  await expect(mark).toHaveAttribute('data-md-opening', '<u>');
  await dragBetween(
    page,
    await delimiterPoint(mark, 'opening', 1),
    await firstTextPoint(cells.last(), 2),
  );
  await expect(page.locator('.article-editor td.selectedCell')).toHaveCount(2);
  await page.keyboard.press('Backspace');
  await expect(cells).toHaveText(['', '']);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(cells).toHaveText(['前文下划线后文', '第二格']);
});

test('copying a complete code span preserves the literal source and its rich format', async ({
  page,
}) => {
  await ready(page, '前文 `` `a*b<q> `` 后文');
  const editor = page.locator('.article-editor');
  const code = editor.locator('code');
  await code.click();
  await expect(code).toHaveAttribute('data-md-opening', '``');
  const paragraph = editor.locator('p');
  await dragBetween(
    page,
    await firstTextPoint(paragraph, 1),
    await paragraphEnd(paragraph),
  );
  const copied = await copiedSelection(editor);
  expect(copied.text).toBe('文 `` `a*b<q> `` 后文');
  expect(copied.html).toContain('<code>`a*b&lt;q&gt;</code>');
  await ready(page, copied.text);
  await expect(code).toHaveText('`a*b<q>');
});

test('nested delimiter copies preserve opening order and balanced markup', async ({
  page,
}) => {
  await ready(page, '前文 <u>**下划线**</u> 后文');
  const editor = page.locator('.article-editor');
  const mark = editor.locator('strong u');
  const paragraph = editor.locator('p');
  await mark.click();
  await expect(mark).toHaveAttribute('data-md-opening', '<u>');
  await dragBetween(
    page,
    await firstTextPoint(paragraph, 1),
    await firstTextPoint(mark, 1),
  );
  expect((await copiedSelection(editor)).text).toBe('文 **<u>下');
  await mark.click();
  await dragBetween(
    page,
    await firstTextPoint(paragraph, 1),
    await paragraphEnd(paragraph),
  );
  const copied = await copiedSelection(editor);
  expect(copied.text).toBe('文 **<u>下划线</u>** 后文');
  expect(copied.html).toContain('<strong><u>下划线</u></strong>');
});

test('the outer delimiter of nested formatting can be hit between its characters', async ({
  page,
}) => {
  await ready(page, '前文 <u>**下划线**</u> 后文');
  const editor = page.locator('.article-editor');
  const bold = editor.locator('strong');
  await bold.locator('u').click();
  await expect(bold).toHaveAttribute('data-md-opening', '**');
  const middle = await delimiterPoint(bold, 'opening', 1);
  await page.mouse.click(middle.x, middle.y);
  await expect(editor.locator('.inline-mark-boundary-caret')).toHaveAttribute(
    'data-syntax-offset',
    '1',
  );
  await page.keyboard.insertText('X');
  await expect(editor).toHaveText('前文 *X*下划线** 后文');
  await expect(editor.locator('u')).toHaveText('下划线');
});

test('an underline delimiter inside a link can be dragged without selecting the link text', async ({
  page,
}) => {
  await ready(page, '前文 <u>[下划线](https://example.com)</u> 后文');
  const editor = page.locator('.article-editor');
  const mark = editor.locator('a u');
  await selectUnderlineTagLetter(page, mark);
  expect((await copiedSelection(editor)).text).toBe('u');
  await expect(editor.locator('a')).toHaveAttribute(
    'href',
    'https://example.com',
  );
});

test('pasting a PNG replaces the saved delimiter selection in one undo step', async ({
  page,
}) => {
  await ready(page, '前文<u>下划线</u>后文');
  const editor = page.locator('.article-editor');
  const mark = editor.locator('u');
  await selectUnderlineTagLetter(page, mark);
  await editor.evaluate(async (element) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), 'image/png'),
    );
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File([blob], 'delimiter.png', { type: 'image/png' }),
    );
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const image = editor.locator('.node-inlineImage');
  await expect(image.locator('img')).toHaveAttribute('alt', 'delimiter.png');
  expect(
    await image.evaluate((element) => [
      element.previousSibling?.textContent,
      element.nextSibling?.textContent,
    ]),
  ).toEqual(['前文<', '>下划线</u>后文']);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(image).toHaveCount(0);
  await expect(mark).toHaveText('下划线');
});

for (const [tag, opening, closing, edge, offset] of [
  ['u', '<u>', '</u>', 'opening', 1],
  ['u', '<u>', '</u>', 'closing', 2],
  ['strong', '**', '**', 'closing', 1],
] as const) {
  test(`the caret can click and edit character ${offset} in the revealed ${tag} ${edge}`, async ({
    page,
  }) => {
    await ready(page, '前文 ' + opening + '测试' + closing + ' 后文');
    const editor = page.locator('.article-editor');
    const mark = editor.locator(tag);
    await mark.click();
    await expect(mark).toHaveAttribute(
      'data-md-' + edge,
      edge === 'opening' ? opening : closing,
    );
    const point = await delimiterPoint(mark, edge, offset);
    await page.mouse.click(point.x, point.y);
    const caret = editor.locator('.inline-mark-boundary-caret');
    await expect(caret).toHaveAttribute('data-syntax-offset', String(offset));
    const caretX = await caret.evaluate((element) => {
      const transform = new DOMMatrixReadOnly(
        getComputedStyle(element, '::after').transform,
      );
      return element.getBoundingClientRect().left + transform.m41;
    });
    expect(Math.abs(caretX - point.x)).toBeLessThan(1.5);
    await page.keyboard.insertText('X');
    const edited = (syntax: string) =>
      syntax.slice(0, offset) + 'X' + syntax.slice(offset);
    await expect(editor).toHaveText(
      '前文 ' +
        (edge === 'opening' ? edited(opening) : opening) +
        '测试' +
        (edge === 'closing' ? edited(closing) : closing) +
        ' 后文',
    );
    await page.keyboard.press('ControlOrMeta+z');
    await expect(mark).toHaveText('测试');
    await expect(caret).toHaveAttribute('data-syntax-offset', String(offset));
  });
}

for (const [tag, opening, closing, lo, hi] of [
  ['u', '<u>', '</u>', 1, 2],
  ['code', '`', '`', 0, 1],
] as const) {
  test(`dragging over only the revealed ${tag} opening characters selects and edits those characters`, async ({
    page,
  }) => {
    const source = '前文' + opening + '测试' + closing + '后文';
    await ready(page, source);
    const editor = page.locator('.article-editor');
    const mark = editor.locator(tag);
    await mark.click();
    await expect(mark).toHaveAttribute('data-md-opening', opening);
    const start = await delimiterPoint(mark, 'opening', lo);
    const end = await delimiterPoint(mark, 'opening', hi);
    await page.mouse.move(start.x + 0.5, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x - 0.5, end.y, { steps: 5 });
    await expect(mark).toHaveAttribute('data-md-opening-selected');
    await page.mouse.up();
    await expect(mark).toHaveAttribute('data-md-opening-selected');
    await expect(mark).not.toHaveAttribute('data-md-closing-selected');
    if (lo > 0) await expect(mark).toHaveAttribute('data-md-opening-partial');
    const copy = await editor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      element.dispatchEvent(
        new ClipboardEvent('copy', {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
      return clipboardData.getData('text/plain');
    });
    expect(copy).toBe(opening.slice(lo, hi));
    await expect(mark).toHaveText('测试');
    await page.keyboard.press('Backspace');
    await expect(editor).toHaveText(
      '前文' +
        opening.slice(0, lo) +
        opening.slice(hi) +
        '测试' +
        closing +
        '后文',
    );
    await page.keyboard.press('ControlOrMeta+z');
    await expect(mark).toHaveText('测试');
  });
}

test('dragging backwards from marked text selects the opening delimiter', async ({
  page,
}) => {
  await ready(page, '前文<u>下划线</u>后文');
  const mark = page.locator('.article-editor u');
  await mark.click();
  await expect(mark).toHaveAttribute('data-md-opening', '<u>');
  const start = await mark.evaluate((element) => {
    const r = document.createRange();
    r.setStart(element.firstChild!, 1);
    r.collapse(true);
    const { x, y, height } = r.getBoundingClientRect();
    return { x, y: y + height / 2 };
  });
  const end = await delimiterPoint(mark, 'opening', 0);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x + 0.4, end.y, { steps: 8 });
  await page.mouse.up();
  await expect(mark).toHaveAttribute('data-md-opening-selected');
  await expect(mark).not.toHaveAttribute('data-md-opening-partial');
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe('下');
});

for (const [tag, delimiter, source] of [
  ['strong', '**', '**hello**'],
  ['code', '`', '`hello`'],
]) {
  test(`the ${tag} delimiters show at both edges and inside the text`, async ({
    page,
  }) => {
    const markdown = '前文 ' + source + ' 后文';
    await ready(page, markdown);
    const mark = page.locator('.article-editor p ' + tag);
    await expect(mark).not.toHaveAttribute('data-md-opening');
    for (const position of [4, 6, 9, 10]) {
      await page.evaluate((pos) => {
        const { editor } = (window as any).__mojian;
        editor.commands.setTextSelection(pos);
        editor.view.focus();
      }, position);
      if (position === 10) {
        await expect(mark).not.toHaveAttribute('data-md-opening');
        await expect(mark).not.toHaveAttribute('data-md-closing');
      } else {
        await expect(mark).toHaveAttribute('data-md-opening', delimiter);
        await expect(mark).toHaveAttribute('data-md-closing', delimiter);
        const visible = await mark.evaluate((element) =>
          ['::before', '::after'].map(
            (part) => getComputedStyle(element, part).content,
          ),
        );
        expect(visible).toEqual([
          JSON.stringify(delimiter),
          JSON.stringify(delimiter),
        ]);
      }
    }
    expect(
      await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
    ).toBe(markdown);
  });
}

for (const [tag, opening, closing] of [
  ['strong', '**', '**'],
  ['em', '*', '*'],
  ['s', '~~', '~~'],
  ['u', '<u>', '</u>'],
]) {
  for (const closingFirst of [true, false]) {
    test(`${tag} can be typed adjacent to Chinese with ${closingFirst ? 'the closing' : 'the opening'} delimiter first`, async ({
      page,
    }) => {
      await ready(page, '前文到发水后文');
      const focus = (pos: number) =>
        page.evaluate((position) => {
          const { editor } = (window as any).__mojian;
          editor.commands.setTextSelection(position);
          editor.view.focus();
        }, pos);
      await focus(closingFirst ? 6 : 3);
      await page.keyboard.type(closingFirst ? closing : opening);
      await focus(closingFirst ? 3 : 6 + opening.length);
      await page.keyboard.type(closingFirst ? opening : closing);
      const formatted = page.locator('.article-editor ' + tag);
      await expect(formatted).toHaveText('到发水');
      await expect(formatted).toHaveAttribute('data-md-opening', opening);
      await expect(formatted).toHaveAttribute('data-md-closing', closing);
      expect(
        await page.evaluate(() =>
          (window as any).__mojian.editor.getMarkdown(),
        ),
      ).toBe('前文' + opening + '到发水' + closing + '后文');
    });
  }
}

test('underline round-trips as Typora syntax and is rendered in publication preview', async ({
  page,
}) => {
  await ready(page, '前文 <u>**下划线**</u> 与 ++旧下划线++ 后文');
  const editor = page.locator('.article-editor');
  await expect(editor.locator('u strong, strong u')).toHaveText('下划线');
  await expect(editor.locator('u')).toHaveText(['下划线', '旧下划线']);
  const canonical = await page.evaluate(() => {
    const { editor } = (window as any).__mojian;
    const before = editor.getJSON();
    const markdown = editor.getMarkdown();
    editor.commands.setContent(editor.markdown.parse(markdown));
    return { before, after: editor.getJSON(), markdown };
  });
  expect(canonical.after).toEqual(canonical.before);
  expect(canonical.markdown).toContain('<u>旧下划线</u>');
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('.preview-paper u')).toHaveText([
    '下划线',
    '旧下划线',
  ]);
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

test('literal stars inside inline code cannot complete a bold delimiter pair', async ({
  page,
}) => {
  const editor = page.locator('.article-editor');
  const code = editor.locator('code');
  await ready(page, '前文hello `a**` 后文');
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus(3));
  await expect(editor).toBeFocused();
  await page.keyboard.type('**');
  await expect(editor.locator('strong')).toHaveCount(0);
  await expect(code).toHaveText('a**');

  await ready(page, '前文`hello**tail`后文');
  await page.evaluate(() =>
    (window as any).__mojian.editor.commands.focus('end'),
  );
  await expect(editor).toBeFocused();
  await page.keyboard.type('**');
  await expect(editor.locator('strong')).toHaveCount(0);
  await expect(code).toHaveText('hello**tail');
});

test('typing the opening backtick last formats existing text as inline code', async ({
  page,
}) => {
  await ready(page, '前文 hello 后文');
  const editor = page.locator('.article-editor');
  const code = editor.locator('p code');
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus(9));
  await expect(editor).toBeFocused();
  await page.keyboard.type('`');
  await expect(editor).toHaveText('前文 hello` 后文');
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus(4));
  await page.keyboard.type('`');

  await expect(code).toHaveText('hello');
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
  ).toBe('前文 `hello` 后文');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(code).toHaveCount(0);
  await expect(editor).toHaveText('前文 `hello` 后文');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(code).toHaveText('hello');
  await expect(code.locator('.inline-mark-boundary-caret')).toHaveCount(1);
  await page.keyboard.type('x');
  await expect(code).toHaveText('xhello');
});

test('an opening backtick run must match the existing closing run', async ({
  page,
}) => {
  await ready(page, 'hello`` 后文');
  const editor = page.locator('.article-editor');
  const code = editor.locator('p code');
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus(1));
  await expect(editor).toBeFocused();
  await page.keyboard.type('`');
  await expect(code).toHaveCount(0);
  await page.keyboard.type('`');
  await expect(code).toHaveText('hello');
});

test('an escaped opening backtick stays literal', async ({ page }) => {
  await ready(page, 'hello` 后文');
  const editor = page.locator('.article-editor');
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus(1));
  await expect(editor).toBeFocused();
  await page.keyboard.type('\\`');
  await expect(editor.locator('p code')).toHaveCount(0);
  await expect(editor).toHaveText('\\`hello` 后文');
});

for (const [position, prefix] of [
  ['paragraph start', ''],
  ['after a space', '前文 '],
  ['directly after text', '前文'],
]) {
  for (const inside of [true, false]) {
    test(`entering ${inside ? 'inside' : 'outside'} the inline code start | ${position}`, async ({
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
      if (inside) await page.keyboard.press('ArrowRight');

      const caret = paragraph.locator('.inline-mark-boundary-caret');
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

test('quick clicks across the inline code opening keep typing outside', async ({
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
  const insideCaret = code.locator('.inline-mark-boundary-caret');
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
  await expect(code.locator('.inline-mark-boundary-caret')).toHaveCount(1);
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
    if (inside) await page.keyboard.press('ArrowRight');
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

  const caret = code.locator('.inline-mark-boundary-caret');
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
