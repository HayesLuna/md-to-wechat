import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const markdown =
  '## 状态（维护人自填）\n\n- [ ] 开发完成\n- [x] 环境 DDL 已同步（若适用）\n- [ ] 自动化测试通过（若适用）\n  - [x] 嵌套任务\n- [ ] 人工验收通过';
// Shape verified from Typora's “复制为 HTML 代码” in a disposable document.
const typoraHTML =
  '<h2>状态（维护人自填）</h2><ul><li><input type="checkbox"/><p>开发完成</p></li><li><input type="checkbox" checked/><p>环境 DDL 已同步（若适用）</p></li><li><input type="checkbox"/><p>自动化测试通过（若适用）</p><ul><li><input type="checkbox" checked/><p>嵌套任务</p></li></ul></li><li><input type="checkbox"/><p>人工验收通过</p></li></ul>';
async function ready(page: Page, text = '') {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(
    (text) => (window as any).__mojian.setMarkdown(text),
    text,
  );
  await page.locator('.article-editor').click();
}
async function paste(page: Page, html: string, text = markdown) {
  await page.evaluate(
    ({ html, text }) => {
      const e = (window as any).__mojian.editor;
      e.commands.focus();
      const data = new DataTransfer();
      data.setData('text/html', html);
      data.setData('text/plain', text);
      e.view.dom.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { html, text },
  );
}
async function checkTasks(page: Page) {
  await expect(
    page.locator('.article-editor input[type=checkbox]'),
  ).toHaveCount(5);
  expect(
    await page
      .locator('.article-editor input[type=checkbox]')
      .evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).checked),
      ),
  ).toEqual([false, true, false, true, false]);
  await expect(
    page.locator('.article-editor > ul[data-type=taskList] > li'),
  ).toHaveCount(4);
  await expect(
    page.locator('.article-editor ul ul[data-type=taskList] > li'),
  ).toHaveCount(1);
  const text = await page.evaluate(() =>
    (window as any).__mojian.getMarkdown(),
  );
  for (const label of ['- [ ] 开发完成', '- [x] 环境 DDL', '- [x] 嵌套任务'])
    expect(text).toContain(label);
}
test('Typora rich task HTML preserves states, nesting and undo on paste', async ({
  page,
}) => {
  await ready(page);
  await paste(page, typoraHTML);
  await checkTasks(page);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor input')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await checkTasks(page);
});
test('native task copy writes Markdown without incompatible HTML; paste roundtrip preserves all tasks', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page, markdown);
  await page.evaluate(() =>
    (window as any).__mojian.editor.commands.selectAll(),
  );
  await page.keyboard.press('ControlOrMeta+c');
  const data = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0];
    return {
      types: item.types,
      text: await (await item.getType('text/plain')).text(),
    };
  });
  expect(data.text).toContain('- [x] 嵌套任务');
  expect(data.types).not.toContain('text/html');
  await page.evaluate(() => (window as any).__mojian.setMarkdown(''));
  await paste(page, '', data.text);
  await checkTasks(page);
});
test('mixed ordinary bullets and tasks remain separate and nested checkboxes do not mark their parent', async ({
  page,
}) => {
  await ready(page);
  await paste(
    page,
    '<ul><li><p>普通项目</p><ul><li><input type="checkbox" checked><p>嵌套完成</p></li></ul></li><li><input type="checkbox"><p>未完成任务</p></li><li><p>另一个普通项目</p></li></ul>',
    '普通项目\n嵌套完成\n未完成任务\n另一个普通项目',
  );
  expect(
    await page.evaluate(() =>
      (window as any).__mojian.editor
        .getJSON()
        .content.filter((n: any) => n.type !== 'paragraph' || n.content?.length)
        .map((n: any) => n.type),
    ),
  ).toEqual(['bulletList', 'taskList', 'bulletList']);
  await expect(
    page.locator('.article-editor > ul:not([data-type=taskList]) > li'),
  ).toHaveCount(2);
  expect(
    await page
      .locator('.article-editor input')
      .evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).checked),
      ),
  ).toEqual([true, false]);
});
test('task cut preserves Markdown clipboard and can be undone', async ({
  page,
}) => {
  await ready(page, markdown);
  const before = await page.evaluate(() =>
    (window as any).__mojian.editor.getJSON(),
  );
  const data = await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.selectAll();
    const data = new DataTransfer();
    e.view.dom.dispatchEvent(
      new ClipboardEvent('cut', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    return {
      text: data.getData('text/plain'),
      html: data.getData('text/html'),
    };
  });
  expect(data.text).toContain('- [x] 嵌套任务');
  expect(data.html).toBe('');
  await expect(page.locator('.article-editor input')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getJSON()),
  ).toEqual(before);
});
test('partial task selection keeps the task marker and inline formatting', async ({
  page,
}) => {
  await ready(page, '- [x] 已完成 **加粗内容**\n- [ ] 未完成');
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    let from = -1;
    e.state.doc.descendants((n: any, p: number) => {
      if (n.isText && n.text === '加粗内容') from = p;
    });
    e.commands.setTextSelection({ from: from + 1, to: from + 3 });
  });
  const data = await page.evaluate(() => {
    const data = new DataTransfer();
    (window as any).__mojian.editor.view.dom.dispatchEvent(
      new ClipboardEvent('copy', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    return {
      text: data.getData('text/plain'),
      html: data.getData('text/html'),
    };
  });
  expect(data.text.trim()).toBe('- [x] **粗内**');
  expect(data.html).toBe('');
});
test('read-only task selection can copy but cannot cut or change clipboard data', async ({
  page,
}) => {
  await ready(page, markdown);
  const result = await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.selectAll();
    e.setEditable(false, false);
    const before = e.getJSON();
    const data = new DataTransfer();
    data.setData('text/plain', '原剪贴板');
    const cut = new ClipboardEvent('cut', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    e.view.dom.dispatchEvent(cut);
    const copied = new DataTransfer();
    e.view.dom.dispatchEvent(
      new ClipboardEvent('copy', {
        clipboardData: copied,
        bubbles: true,
        cancelable: true,
      }),
    );
    const result = {
      before,
      after: e.getJSON(),
      cutPrevented: cut.defaultPrevented,
      clipboard: data.getData('text/plain'),
      copy: copied.getData('text/plain'),
    };
    e.setEditable(true, false);
    return result;
  });
  expect(result.after).toEqual(result.before);
  expect(result.cutPrevented).toBe(true);
  expect(result.clipboard).toBe('原剪贴板');
  expect(result.copy).toContain('- [x] 嵌套任务');
});
for (const nativeWrapper of [false, true])
  test(`nested task HTML preserves parent content with ${nativeWrapper ? 'editor label/div wrappers' : 'a child div only'}`, async ({
    page,
  }) => {
    await ready(page);
    const html = nativeWrapper
      ? '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>父任务 <strong>加粗</strong></p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>子任务</p></div></li></ul><p>父任务补充</p></div></li></ul>'
      : '<ul><li><input type="checkbox"><p>父任务 <strong>加粗</strong></p><ul><li><input type="checkbox" checked><div><p>子任务</p></div></li></ul><p>父任务补充</p></li></ul>';
    await paste(page, html, '父任务 加粗\n子任务\n父任务补充');
    await expect(
      page.locator('.article-editor > ul[data-type=taskList] > li'),
    ).toHaveCount(1);
    await expect(
      page.locator('.article-editor ul ul[data-type=taskList] > li'),
    ).toHaveCount(1);
    await expect(page.locator('.article-editor strong')).toHaveText('加粗');
    expect(
      await page
        .locator('.article-editor input')
        .evaluateAll((inputs) =>
          inputs.map((input) => (input as HTMLInputElement).checked),
        ),
    ).toEqual([false, true]);
    const text = await page.evaluate(() =>
      (window as any).__mojian.getMarkdown(),
    );
    expect(text).toContain('- [ ] 父任务 **加粗**');
    expect(text).toContain('- [x] 子任务');
    expect(text).toContain('父任务补充');
    const before = await page.evaluate(() =>
      (window as any).__mojian.editor.getJSON(),
    );
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.article-editor input')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(
      await page.evaluate(() => (window as any).__mojian.editor.getJSON()),
    ).toEqual(before);
  });
