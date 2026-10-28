import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
async function proseTabs(page: Page) {
  return page.evaluate(() => {
    let count = 0;
    (window as any).__mojian.editor.state.doc.descendants((n: any) => {
      if (n.type.spec.code) return false;
      if (n.isText && !n.marks.some((m: any) => m.type.name === 'code'))
        count += (n.text.match(/\t/g) || []).length;
    });
    return count;
  });
}

test('Tab in a bold numbered paragraph keeps focus in the editor before a nested Mermaid block', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => {
    const editor = (window as any).__mojian.editor;
    (window as any).__mojian.setMarkdown(
      '# 新开航线简要需求理解\n\n以下是最新精简稿，仅在对话中输出，供你核对。\n\n**1. 签注与日期**\n\n- 批量添加将舱位行 EI 项写入详情签注，空值保持为空。\n- 批量添加六日期按表单原值落库。\n  ```mermaid\n  gantt\n      title 日期约束\n      dateFormat YYYY-MM-DD\n      section 产品\n      产品有效期 :active, p1, 2024-01-01, 2024-12-31\n  ```\n\n**2. 儿童、婴儿策略**',
    );
    let at = 0;
    editor.state.doc.descendants((node: any, pos: number) => {
      if (node.isText && node.text.includes('1. 签注与日期')) at = pos + 3;
    });
    editor.commands.setTextSelection(at);
    editor.commands.focus();
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.article-editor')).toBeFocused();
  await expect(
    page.getByRole('combobox', { name: '代码语言' }),
  ).not.toBeFocused();
  await expect(page.locator('.article-editor strong').first()).toHaveText(
    '1. \t签注与日期',
  );
});

test('plain paragraphs insert a literal Tab at the caret, preserving marks, undo and Markdown roundtrip', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    (window as any).__mojian.setMarkdown(
      '**1. 签注与日期**\n\n后面的段落\n\n```js\nconst value = 1;\n```',
    );
    e.commands.setTextSelection(4);
    e.commands.focus();
  });
  const title = page.locator('.article-editor p').first();
  const before = await title.textContent();
  await page.keyboard.press('Tab');
  await expect(title.locator('strong')).toHaveText('1. \t签注与日期');
  await expect(
    page.locator('.article-editor [data-paragraph-indent]'),
  ).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await title.textContent()).toBe(before);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(title.locator('strong')).toHaveText('1. \t签注与日期');
  await page.keyboard.press('Shift+Tab');
  expect(await title.textContent()).toBe(before);
  await page.keyboard.press('Tab');
  const raw = await page.evaluate(() => (window as any).__mojian.getMarkdown());
  expect(raw).toContain('**1. \t签注与日期**');
  expect(raw).not.toContain('&emsp;');
  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  await expect(title.locator('strong')).toHaveText('1. \t签注与日期');
  await expect(page.locator('.code-node')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await expect(title.locator('strong')).toHaveText('1. \t签注与日期');
});

test('Tab replaces selected paragraph text and Shift+Tab at the beginning never moves focus', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    (window as any).__mojian.setMarkdown('前面选中后面');
    e.commands.setTextSelection({ from: 3, to: 5 });
    e.commands.focus();
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.article-editor p')).toHaveText('前面\t后面');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor p')).toHaveText('前面选中后面');
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection(1);
    e.commands.focus();
  });
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.article-editor')).toBeFocused();
  await expect(page.locator('.article-editor p')).toHaveText('前面选中后面');
});

for (const [name, markdown, kind, position] of [
  ['bold paragraph start', '**1. 签注与日期**', 'paragraph', 1],
  ['heading start', '## 标题', 'heading', 1],
  ['heading end', '## 标题', 'heading', 3],
  ['plain paragraph start', '普通段落', 'paragraph', 1],
] as const)
  test(`${name}: Tab survives source switching and refresh without changing node type`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    await page.evaluate(
      ({ markdown, position }) => {
        const e = (window as any).__mojian.editor;
        (window as any).__mojian.setMarkdown(markdown);
        e.commands.setTextSelection(position);
        e.commands.focus();
      },
      { markdown, position },
    );
    await expect(page.locator('.article-editor')).toBeFocused();
    await page.keyboard.press('Tab');
    const snapshot = await page.evaluate(() => {
      const e = (window as any).__mojian.editor;
      return {
        node: e.state.doc.firstChild.toJSON(),
        text: e.state.doc.firstChild.textContent,
        markdown: e.getMarkdown(),
      };
    });
    expect(snapshot.text).toContain('\t');
    expect(snapshot.markdown).toContain('&#9;');
    expect(snapshot.node.type).toBe(kind);
    await page
      .getByRole('button', { name: 'Markdown 源码', exact: true })
      .click();
    await page.getByRole('button', { name: '所见即所得', exact: true }).click();
    expect(
      await page.evaluate(() => {
        const node = (window as any).__mojian.editor.state.doc.firstChild;
        return {
          type: node.type.name,
          text: node.textContent,
          level: node.attrs.level,
        };
      }),
    ).toEqual({
      type: kind,
      text: snapshot.text,
      level: snapshot.node.attrs?.level,
    });
    if (name === 'bold paragraph start')
      await expect(page.locator('.article-editor strong')).toHaveText(
        '1. 签注与日期',
      );
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    await page.reload();
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    expect(
      await page.evaluate(() => {
        const node = (window as any).__mojian.editor.state.doc.firstChild;
        return {
          type: node.type.name,
          text: node.textContent,
          level: node.attrs.level,
        };
      }),
    ).toEqual({
      type: kind,
      text: snapshot.text,
      level: snapshot.node.attrs?.level,
    });
    if (name === 'bold paragraph start')
      await expect(page.locator('.article-editor strong')).toHaveText(
        '1. 签注与日期',
      );
  });

test('literal numeric entity text and code tabs are not decoded twice or changed', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown(
      '字面 &amp;#9;\n\n`\tinline\t`\n\n```txt\n\tcode\n```',
    ),
  );
  const before = await page.evaluate(() =>
    (window as any).__mojian.editor.getJSON(),
  );
  const raw = await page.evaluate(() => (window as any).__mojian.getMarkdown());
  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getJSON()),
  ).toEqual(before);
  expect(
    await page.evaluate(() => (window as any).__mojian.getMarkdown()),
  ).toBe(raw);
});
test('prose tabs use native tab stops and survive undo and source switching', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown(
      'a\t文本\n\nab\t文本\n\nabc\t文本\n\n**粗体\t文本**\n\n## 标题\t文字\n\n- &#9;项目文字\n\n- [ ] 任务\t文字\n\n```txt\ncode\ttext\n```',
    ),
  );
  expect(await proseTabs(page)).toBe(7);
  const widths = await page
    .locator('.article-editor > p')
    .evaluateAll((nodes) =>
      nodes.slice(0, 3).map((p) => {
        const text = p.firstChild!;
        const index = text.textContent!.indexOf('\t');
        const range = document.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + 1);
        return range.getBoundingClientRect().width;
      }),
    );
  expect(widths.every((width) => width > 0)).toBe(true);
  expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(1);
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection(2);
    e.commands.focus();
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await proseTabs(page)).toBe(8);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await proseTabs(page)).toBe(7);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await proseTabs(page)).toBe(8);
  const raw = await page.evaluate(() => (window as any).__mojian.getMarkdown());
  expect(raw).toContain('a\t\t文本');
  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  expect(await proseTabs(page)).toBe(8);
});
for (const prefix of ['- ', '1. ', '- [ ] '])
  test(`${prefix.trim()}: interior literal Tab survives source switching, copy and refresh`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    await page.evaluate((prefix) => {
      const e = (window as any).__mojian.editor;
      (window as any).__mojian.setMarkdown(prefix + '前面**加粗后面**');
      let at = -1;
      e.state.doc.descendants((n: any, pos: number) => {
        if (n.isText && n.text === '加粗后面') at = pos + 2;
      });
      e.commands.setTextSelection(at);
      e.commands.focus();
    }, prefix);
    await expect(page.locator('.article-editor')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await proseTabs(page)).toBe(1);
    const expected = await page.evaluate(() =>
      (window as any).__mojian.editor.getJSON(),
    );
    const copied = await page.evaluate(() => {
      const e = (window as any).__mojian.editor;
      e.commands.selectAll();
      const d = new DataTransfer();
      e.view.dom.dispatchEvent(
        new ClipboardEvent('copy', {
          clipboardData: d,
          bubbles: true,
          cancelable: true,
        }),
      );
      return d.getData('text/plain');
    });
    expect(copied).toContain('&#9;');
    expect(copied).not.toContain('literal-tab');
    await page
      .getByRole('button', { name: 'Markdown 源码', exact: true })
      .click();
    await page.getByRole('button', { name: '所见即所得', exact: true }).click();
    expect(
      await page.evaluate(() => (window as any).__mojian.editor.getJSON()),
    ).toEqual(expected);
    expect(await proseTabs(page)).toBe(1);
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    await page.reload();
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    expect(
      await page.evaluate(() => (window as any).__mojian.editor.getJSON()),
    ).toEqual(expected);
  });
test('list Tab serialization preserves adjacent spaces and leaves inline-code text unchanged', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    (window as any).__mojian.setMarkdown('- 初始');
    e.commands.selectAll();
    e.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: ' \t  开头、中间\t文字、结尾 \t ' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });
  const before = await page.evaluate(() =>
    (window as any).__mojian.editor.getJSON(),
  );
  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getJSON()),
  ).toEqual(before);
  const text = await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: '正文\t空白 ' },
                    {
                      type: 'text',
                      text: '代码\t空白',
                      marks: [{ type: 'code' }],
                    },
                    { type: 'text', text: ' 后面\t文字' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    return e.getMarkdown();
  });
  expect(text).toContain('正文&#9;空白');
  expect(text).toContain('`代码\t空白`');
  expect(text).toContain('后面&#9;文字');
});
for (const markdown of ['> 引用文字', '- 项目\n\n  ## 嵌套标题'])
  test(`container prose Tab survives source switching: ${markdown.split('\n')[0]}`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    await page.evaluate((text) => {
      const e = (window as any).__mojian.editor;
      (window as any).__mojian.setMarkdown(text);
      let from = -1;
      e.state.doc.descendants((n: any, p: number) => {
        if (n.isText) from = p + 2;
      });
      e.commands.setTextSelection(from);
      e.commands.focus();
    }, markdown);
    await expect(page.locator('.article-editor')).toBeFocused();
    await page.keyboard.press('Tab');
    const before = await page.evaluate(() =>
      (window as any).__mojian.editor.getJSON(),
    );
    expect(await proseTabs(page)).toBe(1);
    await page
      .getByRole('button', { name: 'Markdown 源码', exact: true })
      .click();
    await page.getByRole('button', { name: '所见即所得', exact: true }).click();
    expect(
      await page.evaluate(() => (window as any).__mojian.editor.getJSON()),
    ).toEqual(before);
    expect(await proseTabs(page)).toBe(1);
  });
