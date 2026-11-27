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
