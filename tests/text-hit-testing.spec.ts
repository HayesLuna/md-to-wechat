import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
async function ready(page: Page, markdown: string) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(
    (text) => (window as any).__mojian.setMarkdown(text),
    markdown,
  );
  await expect(page.locator('.article-editor')).toBeVisible();
}
async function point(page: Page, text: string, offset: number) {
  return page.evaluate(
    ({ text, offset }) => {
      const e = (window as any).__mojian.editor;
      let start = -1;
      e.state.doc.descendants((n: any, p: number) => {
        if (n.isTextblock && n.textContent === text) start = p;
      });
      if (start < 0) throw new Error('missing target text');
      const pos = start + 1 + offset;
      const rect = e.view.coordsAtPos(pos);
      return { pos, x: rect.left + 0.15, top: rect.top, bottom: rect.bottom };
    },
    { text, offset },
  );
}
async function visibleCaret(page: Page) {
  await expect(page.locator('.article-editor')).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = getSelection();
        return (
          !!s &&
          s.isCollapsed &&
          s.rangeCount === 1 &&
          document.activeElement?.classList.contains('article-editor')
        );
      }),
    )
    .toBe(true);
  await expect(page.locator('.editor-text-cursor')).toHaveCount(0);
}
async function insertAt(page: Page, pos: number) {
  await visibleCaret(page);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__mojian.editor.state.selection.from),
    )
    .toBe(pos);
  const before = await page.evaluate(() =>
    (window as any).__mojian.editor.getJSON(),
  );
  await page.keyboard.insertText('X');
  const text = await page.evaluate((pos) => {
    const e = (window as any).__mojian.editor;
    return e.state.doc.textBetween(pos, pos + 1);
  }, pos);
  expect(text).toBe('X');
  await page.keyboard.press('ControlOrMeta+z');
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getJSON()),
  ).toEqual(before);
}

for (const offset of [2, 7, 12])
  test(`blank above a heading retains the clicked character column ${offset}`, async ({
    page,
  }) => {
    const title = '这是可以精确定位的标题文字';
    await ready(page, '上面这一段正文内容\n\n## ' + title + '\n\n下面的正文');
    const target = await point(page, title, offset);
    const a = (await page
        .locator('.article-editor > p')
        .first()
        .boundingBox())!,
      b = (await page.locator('.article-editor > h2').boundingBox())!;
    await page.mouse.click(target.x, (a.y + a.height + b.y) / 2);
    await insertAt(page, target.pos);
  });

test('blank above the first heading retains the horizontal character position', async ({
  page,
}) => {
  const title = '点击标题上方也要落到对应字间';
  await ready(page, '## ' + title);
  const target = await point(page, title, 6),
    box = (await page.locator('.article-editor h2').boundingBox())!;
  await page.mouse.click(target.x, box.y - 12);
  await insertAt(page, target.pos);
});

for (const edge of ['left', 'right'])
  test(`the ${edge} margin at a paragraph-gap midpoint focuses the lower line without losing the caret`, async ({
    page,
  }) => {
    const first = '第一段落的内容',
      second = '第二段落的内容';
    await ready(page, first + '\n\n' + second);
    const a = (await page.locator('.article-editor p').first().boundingBox())!,
      b = (await page.locator('.article-editor p').last().boundingBox())!,
      surface = (await page.locator('.writing-scroll').boundingBox())!;
    const target = await point(
      page,
      second,
      edge === 'left' ? 0 : second.length,
    );
    await page.mouse.click(
      edge === 'left' ? surface.x + 4 : surface.x + surface.width - 4,
      (a.y + a.height + b.y) / 2,
    );
    await insertAt(page, target.pos);
  });

test('a gap inside wrapped prose selects the following visual line at the clicked column', async ({
  page,
}) => {
  const text = '这段文字用于验证两行之间的点击位置。'.repeat(25);
  await ready(page, text);
  const layout = await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    const first = e.view.coordsAtPos(1);
    let start = 2;
    while (e.view.coordsAtPos(start).top < first.bottom) start++;
    const at = start + 5,
      second = e.view.coordsAtPos(at);
    return { at, x: second.left + 0.1, y: (first.bottom + second.top) / 2 };
  });
  await page.mouse.click(layout.x, layout.y);
  await insertAt(page, layout.at);
});

test('blank below the last line stays at the closest character in that line', async ({
  page,
}) => {
  const text = '最后一行下方点击仍按横向位置定位';
  await ready(page, text);
  const target = await point(page, text, 8),
    box = (await page.locator('.article-editor p').boundingBox())!;
  await page.mouse.click(target.x, box.y + box.height + 16);
  await insertAt(page, target.pos);
});

for (const edge of ['left', 'right'])
  test(`the ${edge} margin between wrapped rows chooses the lower row`, async ({
    page,
  }) => {
    const text = '这是用于定位两侧点击的换行正文。'.repeat(30);
    await ready(page, text);
    const layout = await page.evaluate(() => {
      const e = (window as any).__mojian.editor;
      const a = e.view.coordsAtPos(1);
      let start = 2;
      while (e.view.coordsAtPos(start).top < a.bottom) start++;
      const b = e.view.coordsAtPos(start);
      let end = start + 1;
      while (e.view.coordsAtPos(end).top < b.bottom) end++;
      return { start, end, y: (a.bottom + b.top) / 2 };
    });
    const surface = (await page.locator('.writing-scroll').boundingBox())!;
    await page.mouse.click(
      edge === 'left' ? surface.x + 4 : surface.x + surface.width - 4,
      layout.y,
    );
    await insertAt(page, edge === 'left' ? layout.start : layout.end);
  });

for (const [name, text, selector] of [
  ['list', '- 列表第一项的文字\n- 列表第二项的文字', '.article-editor li p'],
  [
    'quote',
    '> 引用第一段的文字\n>\n> 引用第二段的文字',
    '.article-editor blockquote p',
  ],
] as const)
  test(`${name} gaps keep the horizontal position in the lower paragraph`, async ({
    page,
  }) => {
    await ready(page, text);
    const target = page.locator(selector).last(),
      content = await target.innerText(),
      at = await point(page, content, 4);
    const a = (await page.locator(selector).first().boundingBox())!,
      b = (await target.boundingBox())!;
    await page.mouse.click(at.x, (a.y + a.height + b.y) / 2);
    await insertAt(page, at.pos);
  });

test('a click above an inline-formatted heading retains its code mark and insertion point', async ({
  page,
}) => {
  await ready(page, '前面的正文\n\n## 带有**加粗文字**和 `inline` 的标题');
  const text = '带有加粗文字和 inline 的标题',
    at = await point(page, text, text.indexOf('inline') + 3);
  const heading = (await page.locator('.article-editor h2').boundingBox())!;
  await page.mouse.click(at.x, heading.y - 10);
  await insertAt(page, at.pos);
});

test('the gap correction does not collapse a normal dragged text selection', async ({
  page,
}) => {
  const text = '保持原生的文字拖动选择体验';
  await ready(page, text);
  const a = await point(page, text, 2),
    b = await point(page, text, 9);
  await page.mouse.move(a.x, a.top + 5);
  await page.mouse.down();
  await page.mouse.move(b.x, b.top + 5, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (window as any).__mojian.editor.state.selection;
        return [s.from, s.to];
      }),
    )
    .toEqual([a.pos, b.pos]);
});

test.describe('touch gaps', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  test('a tap in the side gap focuses the lower paragraph and accepts typing', async ({
    page,
  }) => {
    const text = '第二段的文字';
    await ready(page, '第一段的文字\n\n' + text);
    const a = (await page.locator('.article-editor p').first().boundingBox())!,
      b = (await page.locator('.article-editor p').last().boundingBox())!,
      surface = (await page.locator('.writing-scroll').boundingBox())!;
    const at = await point(page, text, text.length);
    await page.touchscreen.tap(
      surface.x + surface.width - 3,
      (a.y + a.height + b.y) / 2,
    );
    await insertAt(page, at.pos);
  });
});

test('a stationary side-gap click replaces an old selection with a usable caret', async ({
  page,
}) => {
  const first = '上面的选中文字',
    second = '下面需要输入的文字';
  await ready(page, first + '\n\n' + second);
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection({ from: 1, to: 6 });
    e.view.focus();
  });
  const a = (await page.locator('.article-editor p').first().boundingBox())!,
    b = (await page.locator('.article-editor p').last().boundingBox())!,
    surface = (await page.locator('.writing-scroll').boundingBox())!;
  const target = await point(page, second, 0);
  await page.mouse.click(surface.x + 3, (a.y + a.height + b.y) / 2);
  await insertAt(page, target.pos);
});

test('dragging from the margin into text preserves the native selection', async ({
  page,
}) => {
  await ready(page, '第一段用于从外侧开始选择\n\n第二段用于结束选择');
  const a = await point(page, '第一段用于从外侧开始选择', 0),
    b = await point(page, '第二段用于结束选择', 6),
    surface = (await page.locator('.writing-scroll').boundingBox())!;
  await page.mouse.move(surface.x + 3, a.top + 5);
  await page.mouse.down();
  await page.mouse.move(b.x, b.top + 5, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => getSelection()?.isCollapsed))
    .toBe(false);
  expect(await page.evaluate(() => getSelection()?.toString())).toContain(
    '第一段',
  );
});

test('a blank-origin drag can shrink back to its original caret', async ({
  page,
}) => {
  const text = '从空白开始拖动再回到起点';
  await ready(page, text + '\n\n下面一段文字');
  const at = await point(page, text, 0),
    end = await point(page, text, 9),
    surface = (await page.locator('.writing-scroll').boundingBox())!;
  const x = surface.x + 3,
    y = at.top + 5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.top + 5, { steps: 8 });
  await expect
    .poll(() => page.evaluate(() => getSelection()?.isCollapsed))
    .toBe(false);
  await page.mouse.move(x, y);
  await page.mouse.up();
  await insertAt(page, at.pos);
});

for (const direction of ['down', 'up'] as const)
  test(`a blank-origin drag continuously scrolls ${direction} at the writing edge and stops on release`, async ({
    page,
  }) => {
    const paragraphs = Array.from(
      { length: 70 },
      (_, i) => `第${i}段用于验证持续拖动选择文字，选择应随滚动自然延伸。`,
    );
    await ready(page, paragraphs.join('\n\n'));
    const surface = page.locator('.writing-scroll');
    if (direction === 'up')
      await surface.evaluate((el) => {
        el.scrollTop = el.scrollHeight / 2;
      });
    const box = (await surface.boundingBox())!;
    const at = await page.evaluate(() => {
      const surface = document
        .querySelector('.writing-scroll')!
        .getBoundingClientRect();
      const p = [...document.querySelectorAll('.article-editor p')].find(
        (el) => {
          const r = el.getBoundingClientRect();
          return r.top > surface.top + 80 && r.bottom < surface.bottom - 80;
        },
      )!;
      return p.getBoundingClientRect().top + 10;
    });
    const initial = await surface.evaluate((el) => el.scrollTop);
    await page.mouse.move(box.x + 3, at);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2,
      direction === 'down' ? box.y + box.height - 2 : box.y + 2,
      { steps: 8 },
    );
    await expect
      .poll(async () => {
        const current = await surface.evaluate((el) => el.scrollTop);
        return direction === 'down'
          ? current > initial + 120
          : current < initial - 120;
      })
      .toBe(true);
    const first = await page.evaluate(
      () => (window as any).__mojian.editor.state.selection.head,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__mojian.editor.state.selection.head,
        ),
      )
      .not.toBe(first);
    await page.mouse.up();
    const stopped = await surface.evaluate((el) => el.scrollTop);
    await page.waitForTimeout(120);
    expect(await surface.evaluate((el) => el.scrollTop)).toBe(stopped);
    expect(await page.evaluate(() => getSelection()?.toString())).toContain(
      '验证',
    );
  });

for (const type of ['heading', 'code'] as const)
  test(`${type} gap sets the final caret on mouse down without a first-line flash`, async ({
    page,
  }) => {
    let target: { pos: number; x: number; y: number };
    if (type === 'heading') {
      const title = '按下鼠标时就应定位到正确字间';
      await ready(page, '先前的正文\n\n## ' + title);
      const at = await point(page, title, 7),
        box = (await page.locator('.article-editor h2').boundingBox())!;
      target = { pos: at.pos, x: at.x, y: box.y - 10 };
    } else {
      const text = 'const first = 1;\nconst second = 2;\nconst third = 3;';
      await ready(page, '```js\n' + text + '\n```');
      target = await page.evaluate(
        (offset) => {
          const e = (window as any).__mojian.editor,
            pre = document.querySelector('.code-node pre')!,
            style = getComputedStyle(pre),
            r = pre.getBoundingClientRect();
          return {
            pos: offset + 1,
            x: e.view.coordsAtPos(offset + 1).left + 0.1,
            y:
              r.top +
              parseFloat(style.paddingTop) +
              parseFloat(style.lineHeight) -
              0.25,
          };
        },
        text.indexOf('second') + 3,
      );
    }
    await page.evaluate(() => {
      const e = (window as any).__mojian.editor;
      e.commands.setTextSelection(1);
      e.view.focus();
      (window as any).__caretSequence = [];
      e.on('selectionUpdate', () => {
        (window as any).__caretSequence.push(e.state.selection.head);
      });
    });
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    const frames = await page.evaluate(async () => {
      const e = (window as any).__mojian.editor,
        result = [];
      for (let i = 0; i < 3; i++) {
        const s = getSelection()!;
        result.push({
          model: e.state.selection.head,
          dom: s.anchorNode
            ? e.view.posAtDOM(s.anchorNode, s.anchorOffset)
            : -1,
        });
        await new Promise((r) => requestAnimationFrame(r));
      }
      return result;
    });
    expect(frames).toEqual(
      Array.from({ length: 3 }, () => ({ model: target.pos, dom: target.pos })),
    );
    await page.mouse.up();
    expect(await page.evaluate(() => (window as any).__caretSequence)).toEqual([
      target.pos,
    ]);
    await insertAt(page, target.pos);
  });

test('empty space in an enlarged code viewport directly selects the closest position on its last line', async ({
  page,
}) => {
  const text = 'const first = 1;\nconst second = 2;\nconst third = 3;';
  await ready(page, '```js\n' + text + '\n```');
  const handle = page.getByRole('separator', { name: '调整代码块高度' });
  await handle.focus();
  await page.keyboard.press('End');
  const at = await point(page, text, text.indexOf('third') + 2),
    viewport = (await page.locator('.code-viewport').boundingBox())!;
  await page.mouse.move(at.x, viewport.y + 200);
  await page.mouse.down();
  expect(
    await page.evaluate(
      () => (window as any).__mojian.editor.state.selection.head,
    ),
  ).toBe(at.pos);
  await page.mouse.up();
  await insertAt(page, at.pos);
});

test('code gap hit testing uses visible folded rows and refreshes after edits and undo', async ({
  page,
}) => {
  const code =
    'function outer() {\n  first();\n  second();\n}\nconst outside = 42;\n';
  await ready(page, '```js\n' + code + '\n```');
  await page
    .getByRole('button', { name: '折叠第 1–4 行代码', exact: true })
    .click();
  const target = await page.evaluate(
    (offset) => {
      const e = (window as any).__mojian.editor;
      const first = e.view.coordsAtPos(1),
        next = e.view.coordsAtPos(offset + 1);
      return {
        pos: offset + 1,
        x: next.left + 0.1,
        y: (first.bottom + next.top) / 2,
      };
    },
    code.indexOf('outside') + 3,
  );
  await page.mouse.click(target.x, target.y);
  await insertAt(page, target.pos);
  await expect(page.locator('.code-fold-placeholder')).toHaveCount(1);
  // A changed immutable code node must not reuse the old source line index.
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection(1);
    e.commands.insertContent('new first row\n');
  });
  const next = await page.evaluate(() => {
    const e = (window as any).__mojian.editor,
      offset = e.state.doc.firstChild.textContent.indexOf('outside') + 3;
    const pos = offset + 1,
      r = e.view.coordsAtPos(pos),
      before = e.view.coordsAtPos(
        e.state.doc.firstChild.textContent.indexOf('}\n') + 1,
      );
    return { pos, x: r.left + 0.1, y: (before.bottom + r.top) / 2 };
  });
  await page.mouse.click(next.x, next.y);
  await insertAt(page, next.pos);
  await page.keyboard.press('ControlOrMeta+z');
  expect(
    await page.evaluate(
      () => (window as any).__mojian.editor.state.doc.firstChild.textContent,
    ),
  ).toBe(code);
});

for (const offset of [0, 1, 2])
  test(`empty code row ${offset} accepts a side-space caret without selecting the previous row`, async ({
    page,
  }) => {
    const text = 'first\n\n\nlast';
    await ready(page, '```text\n' + text + '\n```');
    const row = await page.evaluate((offset) => {
      const e = (window as any).__mojian.editor,
        pos = offset === 0 ? 1 : offset === 1 ? 7 : 8;
      const r = e.view.coordsAtPos(pos);
      return { pos, x: r.left + 100, y: (r.top + r.bottom) / 2 };
    }, offset);
    await page.mouse.click(row.x, row.y);
    // On the nonempty first row the far right whitespace belongs to its end.
    await insertAt(page, offset === 0 ? 6 : row.pos);
  });
