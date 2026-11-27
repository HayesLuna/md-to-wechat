import { expect, test } from './fixtures';

test('rerender button next to read-only re-renders whole document inline and block markdown, protects code, and supports undo', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);

  const rerenderBtn = page
    .locator('.pane-actions')
    .getByRole('button', { name: '重新渲染', exact: true });
  const readOnlyBtn = page
    .locator('.pane-actions')
    .getByRole('switch', { name: '只读模式', exact: true });
  await expect(rerenderBtn).toBeVisible();
  const rerenderBox = await rerenderBtn.boundingBox();
  const readOnlyBox = await readOnlyBtn.boundingBox();
  expect(rerenderBox!.x + rerenderBox!.width).toBeLessThanOrEqual(
    readOnlyBox!.x + 2,
  );

  // Build a document containing plain-text unrendered Markdown syntax alongside
  // existing inline code, fenced code blocks, and literal HTML/entities.
  await page.evaluate(() => {
    const editor = (window as any).__mojian.editor;
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '# 未渲染标题' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '格式：**粗体** *斜体* ~~删除~~ ==高亮== ++下划线++ <u>标签下划线</u> `行内代码` [链接](https://example.com) ',
            },
            {
              type: 'text',
              marks: [{ type: 'code' }],
              text: '**保持代码**',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '- 列表一' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '- 列表二' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '- [x] 已完成任务' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '> 引用内容' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '| 列A | 列B |' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '| --- | --- |' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '| 1 | 2 |' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '字面 <div>原样保留</div> &nbsp;' }],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'js' },
          content: [{ type: 'text', text: '# 代码块内不渲染\n**不是粗体**' }],
        },
      ],
    });
    editor.commands.setTextSelection(1);
  });

  await rerenderBtn.click();
  await expect(page.locator('.toast')).toContainText('已重新渲染整篇文档');

  await expect(page.locator('.article-editor h1')).toHaveText('未渲染标题');
  await expect(page.locator('.article-editor strong')).toHaveText('粗体');
  await expect(page.locator('.article-editor em')).toHaveText('斜体');
  await expect(page.locator('.article-editor s')).toHaveText('删除');
  await expect(page.locator('.article-editor mark')).toHaveText('高亮');
  await expect(page.locator('.article-editor u')).toHaveText([
    '下划线',
    '标签下划线',
  ]);
  await expect(page.locator('.article-editor p code')).toHaveText([
    '行内代码',
    '**保持代码**',
  ]);
  await expect(page.locator('.article-editor a')).toHaveAttribute(
    'href',
    'https://example.com',
  );
  await expect(
    page.locator('.article-editor ul:not([data-type="taskList"]) li'),
  ).toHaveText(['列表一', '列表二']);
  await expect(
    page.locator('.article-editor ul[data-type="taskList"] li'),
  ).toHaveCount(1);
  await expect(page.locator('.article-editor blockquote')).toContainText(
    '引用内容',
  );
  await expect(page.locator('.article-editor table th')).toHaveText([
    '列A',
    '列B',
  ]);
  await expect(page.locator('.article-editor table td')).toHaveText(['1', '2']);
  await expect(page.locator('.article-editor')).toContainText(
    '字面 <div>原样保留</div> &nbsp;',
  );
  await expect(page.locator('.article-editor pre')).toContainText(
    '# 代码块内不渲染\n**不是粗体**',
  );

  // Clicking again with no remaining raw syntax is a clean no-op.
  await rerenderBtn.click();
  await expect(page.locator('.toast')).toContainText('没有需要重新渲染');

  // Ctrl/Cmd+Z undoes the whole re-render in a single step.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor h1')).toHaveCount(0);
  await expect(page.locator('.article-editor strong')).toHaveCount(0);
  await expect(page.locator('.article-editor')).toContainText('# 未渲染标题');
});

test('rerender only converts the selected range when text is selected, keeping unselected text and mid-line prefixes intact', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);

  const rerenderBtn = page
    .locator('.pane-actions')
    .getByRole('button', { name: '重新渲染', exact: true });

  await page.evaluate(() => {
    const editor = (window as any).__mojian.editor;
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '前面 **不变** 中间 - 50 ==要高亮== 和 **要加粗** 后面 *不变*',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '## 下段未选中标题' }],
        },
      ],
    });
    const text = editor.state.doc.firstChild.textContent as string;
    const start = 1 + text.indexOf('- 50 ==要高亮== 和 **要加粗**');
    const end = start + '- 50 ==要高亮== 和 **要加粗**'.length;
    editor.commands.setTextSelection({ from: start, to: end });
  });

  await rerenderBtn.click();
  await expect(page.locator('.toast')).toContainText('已重新渲染选中内容');

  // Only the selected inline span rendered; unselected syntax and second block stayed literal.
  await expect(page.locator('.article-editor mark')).toHaveText('要高亮');
  await expect(page.locator('.article-editor strong')).toHaveText('要加粗');
  await expect(page.locator('.article-editor em')).toHaveCount(0);
  await expect(page.locator('.article-editor ul')).toHaveCount(0);
  await expect(page.locator('.article-editor h2')).toHaveCount(0);
  await expect(page.locator('.article-editor p').first()).toContainText(
    '前面 **不变** 中间 - 50 要高亮 和 要加粗 后面 *不变*',
  );
  await expect(page.locator('.article-editor p').nth(1)).toHaveText(
    '## 下段未选中标题',
  );

  // Selecting only inside a code block does not alter code content.
  await page.evaluate(() => {
    const editor = (window as any).__mojian.editor;
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'md' },
          content: [{ type: 'text', text: '**code**' }],
        },
      ],
    });
    editor.commands.setTextSelection({ from: 1, to: 9 });
  });
  await rerenderBtn.click();
  await expect(page.locator('.toast')).toContainText('不做重新渲染');
  await expect(page.locator('.article-editor pre')).toContainText('**code**');
});

test('rerender handles multi-block selections and disables in read-only and source modes', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);

  const rerenderBtn = page
    .locator('.pane-actions')
    .getByRole('button', { name: '重新渲染', exact: true });

  await page.evaluate(() => {
    const editor = (window as any).__mojian.editor;
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '前缀 **加粗**' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '## 选中标题' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '**未选中末段**' }],
        },
      ],
    });
    const first = editor.state.doc.child(0);
    const second = editor.state.doc.child(1);
    const from = 1 + first.textContent.indexOf('**加粗**');
    const to = 1 + first.nodeSize + second.content.size;
    editor.commands.setTextSelection({ from, to });
  });

  await rerenderBtn.click();
  await expect(page.locator('.toast')).toContainText('已重新渲染选中内容');
  await expect(page.locator('.article-editor strong')).toHaveText('加粗');
  await expect(page.locator('.article-editor h2')).toHaveText('选中标题');
  // No spurious empty paragraph between heading and third paragraph.
  expect(
    await page.evaluate(
      () => (window as any).__mojian.editor.state.doc.childCount,
    ),
  ).toBe(3);
  await expect(page.locator('.article-editor p').last()).toHaveText(
    '**未选中末段**',
  );

  // Partial selection starting inside a heading must not inject literal `#`
  // into the heading when merging back.
  await page.evaluate(() => {
    const editor = (window as any).__mojian.editor;
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '已有标题 **加粗**' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '==高亮段落==' }],
        },
      ],
    });
    const heading = editor.state.doc.child(0);
    const para = editor.state.doc.child(1);
    const from = 1 + heading.textContent.indexOf('**加粗**');
    const to = 1 + heading.nodeSize + para.content.size;
    editor.commands.setTextSelection({ from, to });
  });
  await rerenderBtn.click();
  await expect(page.locator('.article-editor h2')).toHaveText('已有标题 加粗');
  await expect(page.locator('.article-editor h2 strong')).toHaveText('加粗');
  await expect(page.locator('.article-editor mark')).toHaveText('高亮段落');

  // Disabled in read-only mode.
  await page.getByRole('switch', { name: '只读模式', exact: true }).click();
  await expect(rerenderBtn).toBeDisabled();
  await page.getByRole('switch', { name: '只读模式', exact: true }).click();
  await expect(rerenderBtn).toBeEnabled();

  // Disabled in Markdown source mode.
  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  await expect(rerenderBtn).toBeDisabled();
});

test('rerendering text within and across existing structures keeps their markers out of the text', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const button = page.getByRole('button', { name: '重新渲染', exact: true });
  const before = await page.evaluate(() => {
    const app = (window as any).__mojian;
    app.setMarkdown(
      '4. 第一项\n5. 第二项\n\n- 无序项\n\n- [x] 任务\n\n> 引用\n\n## 标题\n\n| 列名 |\n| --- |\n| 单元格 |',
    );
    const { editor } = app;
    const raw = new Map([
      ['第一项', '**保留** 第一项 **有序**'],
      ['第二项', '**第二项**'],
      ['无序项', '**无序项**'],
      ['任务', '**任务**'],
      ['引用', '**引用**'],
      ['标题', '**标题**'],
      ['单元格', '**单元格** *保留*'],
    ]);
    const changes: { from: number; to: number; text: string }[] = [];
    editor.state.doc.descendants((node: any, pos: number) => {
      const text = node.isText && raw.get(node.text);
      if (text) changes.push({ from: pos, to: pos + node.nodeSize, text });
    });
    const tr = editor.state.tr;
    for (const change of changes.reverse())
      tr.insertText(change.text, change.from, change.to);
    editor.view.dispatch(tr);
    const second = editor.state.doc.firstChild.child(1).firstChild;
    const secondStart = editor.state.doc.firstChild.firstChild.nodeSize + 3;
    editor.commands.setTextSelection({
      from: secondStart,
      to: secondStart + second.content.size,
    });
    return editor.getJSON();
  });

  await button.click();
  const article = page.locator('.article-editor');
  await expect(article.locator('ol')).toHaveAttribute('start', '4');
  await expect(article.locator('ol > li')).toHaveText([
    '**保留** 第一项 **有序**',
    '第二项',
  ]);
  await expect(article.locator('ol > li').nth(1).locator('strong')).toHaveText(
    '第二项',
  );
  await page.keyboard.press('ControlOrMeta+z');

  await page.evaluate(() => {
    const { editor } = (window as any).__mojian;
    let from = 0;
    let to = 0;
    editor.state.doc.descendants((node: any, pos: number) => {
      if (!node.isText) return;
      if (node.text.includes('**有序**'))
        from = pos + node.text.indexOf('**有序**');
      if (node.text.includes('**单元格**')) to = pos + '**单元格**'.length;
    });
    editor.commands.setTextSelection({ from, to });
  });
  await button.click();
  await expect(article.locator('ol')).toHaveAttribute('start', '4');
  await expect(article.locator('ol > li')).toHaveText([
    '**保留** 第一项 有序',
    '第二项',
  ]);
  await expect(
    article.locator('ul:not([data-type]) > li > p > strong'),
  ).toHaveText('无序项');
  await expect(article.locator('ul[data-type=taskList] input')).toBeChecked();
  await expect(article.locator('ul[data-type=taskList] strong')).toHaveText(
    '任务',
  );
  await expect(article.locator('blockquote strong')).toHaveText('引用');
  await expect(article.locator('h2 strong')).toHaveText('标题');
  await expect(article.locator('td')).toHaveText('单元格 *保留*');
  await expect(article.locator('td strong')).toHaveText('单元格');

  await button.click();
  await expect(page.locator('.toast')).toContainText('没有需要重新渲染');
  await page.keyboard.press('ControlOrMeta+z');
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getJSON()),
  ).toEqual(before);
});

test('rerendering complete nested paragraphs can create blocks without replacing the container', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__mojian?.editor);
  const before = await page.evaluate(() => {
    const editor = window.__mojian!.editor!;
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: ['## 引用内标题', '- 引用内项目一', '- 引用内项目二'].map(
            (text) => ({
              type: 'paragraph',
              content: [{ type: 'text', text }],
            }),
          ),
        },
        { type: 'paragraph', content: [{ type: 'text', text: '引用之外' }] },
      ],
    });
    editor.commands.setTextSelection(2);
    return editor.getJSON();
  });

  const button = page.getByRole('button', { name: '重新渲染', exact: true });
  await button.click();
  const quote = page.locator('.article-editor blockquote');
  await expect(quote.locator('h2')).toHaveText('引用内标题');
  await expect(quote.locator('ul li')).toHaveText([
    '引用内项目一',
    '引用内项目二',
  ]);
  await expect(page.locator('.article-editor > p')).toHaveText('引用之外');
  await button.click();
  await expect(page.locator('.toast')).toContainText('没有需要重新渲染');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.__mojian!.editor!.getJSON())).toEqual(
    before,
  );
});

test('rerendering list items inserts the required paragraph before converted blocks', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__mojian?.editor);
  const before = await page.evaluate(() => {
    const editor = window.__mojian!.editor!;
    const paragraph = (text: string) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    });
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          attrs: { start: 5 },
          content: [
            {
              type: 'listItem',
              content: [paragraph('## 小标题'), paragraph('- 子项目')],
            },
          ],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [paragraph('> 任务引用'), paragraph('## 任务标题')],
            },
          ],
        },
      ],
    });
    editor.commands.setTextSelection(3);
    return editor.getJSON();
  });

  const button = page.getByRole('button', { name: '重新渲染', exact: true });
  const article = page.locator('.article-editor');
  await button.click();
  const list = article.locator('ol[start="5"] > li');
  await expect(list.locator(':scope > p:first-child')).toHaveText('');
  await expect(list.locator('h2')).toHaveText('小标题');
  await expect(list.locator('ul li')).toHaveText('子项目');
  const task = article.locator('ul[data-type="taskList"] > li');
  await expect(task.locator('input')).toBeChecked();
  await expect(task.locator('blockquote')).toHaveText('任务引用');
  await expect(task.locator('h2')).toHaveText('任务标题');

  await button.click();
  await expect(page.locator('.toast')).toContainText('没有需要重新渲染');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.__mojian!.editor!.getJSON())).toEqual(
    before,
  );
});

test('rerendering keeps the viewport when the caret is off screen', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__mojian?.editor);
  await page.evaluate(() => {
    const editor = window.__mojian!.editor!;
    editor.commands.setContent({
      type: 'doc',
      content: Array.from({ length: 90 }, (_, index) => ({
        type: 'paragraph',
        content: [
          { type: 'text', text: index === 0 ? '## 开头标题' : `正文 ${index}` },
        ],
      })),
    });
    editor.commands.focus('end');
  });
  const article = page.locator('.article-editor');
  await expect(article).toBeFocused();
  const button = page.getByRole('button', { name: '重新渲染', exact: true });
  await button.focus();
  const scroller = page.locator('.writing-scroll');
  await scroller.evaluate((element) => {
    element.scrollTop = 90;
  });

  await button.press('Enter');

  await expect(article.locator('h2')).toHaveText('开头标题');
  await expect(article).toBeFocused();
  // Wait for Tiptap's deferred focus and any associated scrolling.
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(90);
});

test('whole-document rerender keeps the caret in the same paragraph after earlier delimiters disappear', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__mojian?.editor);
  await page.evaluate(() => {
    const editor = window.__mojian!.editor!;
    editor.commands.setContent({
      type: 'doc',
      content: Array.from({ length: 80 }, (_, index) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: `**项目 ${index}**` }],
      })),
    });
    editor.state.doc.descendants((node, pos) => {
      if (node.text === '**项目 40**')
        editor.commands.setTextSelection(pos + 4);
    });
    editor.view.focus();
  });
  await page.getByRole('button', { name: '重新渲染', exact: true }).click();
  await expect(page.locator('.article-editor strong')).toHaveCount(80);
  expect(
    await page.evaluate(() => {
      const { $from } = window.__mojian!.editor!.state.selection;
      return {
        paragraph: $from.parent.textContent,
        offset: $from.parentOffset,
      };
    }),
  ).toEqual({ paragraph: '项目 40', offset: 2 });
});
