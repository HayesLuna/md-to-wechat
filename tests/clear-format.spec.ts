import type { JSONContent } from '@tiptap/core';
import { editorTest as test, expect } from './fixtures';

test('clear format affects only the selected characters and undoes in one step', async ({
  page,
}) => {
  const initial = await page.evaluate(() => {
    const editor = window.__mojian!.editor!;
    const marks = [
      { type: 'bold' },
      { type: 'italic' },
      { type: 'underline' },
      { type: 'strike' },
      { type: 'highlight' },
      { type: 'link', attrs: { href: 'https://example.test/' } },
      { type: 'code' },
    ];
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '甲乙丙丁', marks }],
        },
      ],
    });
    editor.commands.setTextSelection({ from: 2, to: 4 });
    editor.view.focus();
    return {
      doc: editor.getJSON(),
      selection: editor.state.selection.toJSON(),
    };
  });

  const clear = page.getByRole('button', { name: '清除格式', exact: true });
  await expect(clear).toBeEnabled();
  await clear.click();
  await expect(page.locator('.article-editor')).toBeFocused();
  const result = await page.evaluate(() => {
    const { editor } = window.__mojian!;
    return {
      content: editor!.getJSON().content?.[0].content,
      selection: editor!.state.selection.toJSON(),
    };
  });
  const originals = initial.doc.content?.[0].content?.[0].marks;
  expect(originals).toHaveLength(7);
  expect(result.content).toEqual([
    { type: 'text', text: '甲', marks: originals },
    { type: 'text', text: '乙丙' },
    { type: 'text', text: '丁', marks: originals },
  ]);
  expect(result.selection).toEqual(initial.selection);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.__mojian!.editor!.getJSON())).toEqual(
    initial.doc,
  );
});

test('clear format across blocks preserves their structure and linked images', async ({
  page,
}) => {
  await page.route('https://example.test/inline.png', (route) => route.abort());
  const expected = await page.evaluate(() => {
    const { editor, setMarkdown } = window.__mojian!;
    setMarkdown(
      '## **标题**\n\n4. *有序项*\n\n- [x] ~~任务~~\n\n> ==引用==\n\n| 列名 |\n| --- |\n| **单元格** |\n\n```txt\n  const\tvalue\n```\n\n段落',
    );
    const image = editor!.schema.nodes.inlineImage.create(
      { src: 'https://example.test/inline.png', alt: '链接图片' },
      null,
      [editor!.schema.marks.link.create({ href: 'https://example.test/' })],
    );
    const end = editor!.state.doc.content.size - 1;
    editor!.view.dispatch(editor!.state.tr.insert(end, image));
    editor!.commands.selectAll();
    editor!.view.focus();
    const doc = editor!.getJSON();
    function strip(node: JSONContent) {
      if (node.type === 'text') delete node.marks;
      node.content?.forEach(strip);
    }
    strip(doc);
    return doc;
  });
  await page.getByRole('button', { name: '清除格式', exact: true }).click();
  expect(await page.evaluate(() => window.__mojian!.editor!.getJSON())).toEqual(
    expected,
  );
  await expect(page.locator('.article-editor ol')).toHaveAttribute(
    'start',
    '4',
  );
  await expect(
    page.locator('.article-editor input[type=checkbox]'),
  ).toBeChecked();
});

test('clear format handles table cells and is disabled for a caret or read-only editor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => {
    const { editor, setMarkdown } = window.__mojian!;
    setMarkdown(
      '| A | B | C |\n| --- | --- | --- |\n| **选中甲** | *选中乙* | **保留** |',
    );
    editor!.commands.setTextSelection(4);
  });
  const clear = page.getByRole('button', { name: '清除格式', exact: true });
  await expect(clear).toBeDisabled();

  const selection = await page.evaluate(() => {
    const editor = window.__mojian!.editor!;
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos);
    });
    editor.commands.setCellSelection({
      anchorCell: cells[0],
      headCell: cells[1],
    });
    return editor.state.selection.toJSON();
  });
  await expect(clear).toBeEnabled();
  const readOnly = page.getByRole('switch', { name: '只读模式' });
  await readOnly.click();
  await expect(clear).toBeDisabled();
  await readOnly.click();
  await clear.click();

  await expect(page.locator('.article-editor td strong')).toHaveText('保留');
  await expect(page.locator('.article-editor td em')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.__mojian!.editor!.state.selection.toJSON(),
    ),
  ).toEqual(selection);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});

test('cleared literal Markdown and automatic links survive a source roundtrip and reload', async ({
  page,
}) => {
  await page.evaluate(() => {
    const { editor, setMarkdown } = window.__mojian!;
    setMarkdown(
      '`# 字面标题`\n\n`- 字面列表`\n\n`1. 字面编号`\n\n[https://example.com](https://other.test)\n\n`someone@example.com`\n\n`www.example.com`\n\n`      字面空格    `',
    );
    editor!.commands.selectAll();
    editor!.view.focus();
  });
  await page.getByRole('button', { name: '清除格式', exact: true }).click();
  const article = page.locator('.article-editor');
  const texts = [
    '# 字面标题',
    '- 字面列表',
    '1. 字面编号',
    'https://example.com',
    'someone@example.com',
    'www.example.com',
    '字面空格',
  ];
  await expect(article.locator('> p')).toHaveText(texts);
  await expect(article.locator('a, code')).toHaveCount(0);
  const doc = () => page.evaluate(() => window.__mojian!.editor!.getJSON());
  const before = await doc();

  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  await expect(article.locator('> p')).toHaveText(texts);
  await expect(article.locator('a, code')).toHaveCount(0);
  expect(await doc()).toEqual(before);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.toast')).toContainText('草稿已保存');
  await page.reload();
  await expect(article.locator('> p')).toHaveText(texts);
  await expect(article.locator('a, code')).toHaveCount(0);
  expect(await doc()).toEqual(before);
});

test('bulk clear format replaces a text block once regardless of the number of marks', async ({
  page,
}) => {
  await page.evaluate(() => {
    const editor = window.__mojian!.editor!;
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: Array.from({ length: 200 }, (_, index) => ({
            type: 'text',
            text: '文字',
            ...(index % 2 === 0 ? { marks: [{ type: 'bold' }] } : {}),
          })),
        },
      ],
    });
    editor.commands.selectAll();
    editor.view.focus();
    const handler: Parameters<typeof editor.on<'transaction'>>[1] = ({
      transaction,
    }) => {
      if (!transaction.docChanged) return;
      editor.view.dom.setAttribute(
        'data-test-clear-steps',
        String(transaction.steps.length),
      );
      editor.off('transaction', handler);
    };
    editor.on('transaction', handler);
  });
  await page.getByRole('button', { name: '清除格式', exact: true }).click();
  await expect(page.locator('.article-editor')).toHaveAttribute(
    'data-test-clear-steps',
    '1',
  );
  await expect(page.locator('.article-editor > p')).toHaveText(
    '文字'.repeat(200),
  );
  await expect(page.locator('.article-editor strong')).toHaveCount(0);
});
