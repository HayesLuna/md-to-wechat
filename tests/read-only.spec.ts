import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__mojian?.editor);
}
const markdown = (page: Page) =>
  page.evaluate(() => window.__mojian!.getMarkdown());

test('read-only protects content and node controls, preserves copy and unlocks without recreating the editor', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await page.evaluate(() =>
    window.__mojian!.setMarkdown(
      '# 固定文章\n\n正文\n\n- [ ] 待办\n\n```json\n{"a":1}\n```\n\n| A | B |\n| --- | --- |\n| 内容 | 内容 |\n\n![图片](https://example.com/read-only.png)',
    ),
  );
  const before = await markdown(page);
  await page.evaluate(() => {
    (window as any).__originalEditor = window.__mojian!.editor;
  });
  const toggle = page.getByRole('switch', { name: '只读模式' });
  const editor = page.locator('.article-editor');
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await expect(
    page.getByRole('button', { name: '粗体', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '导入 Markdown', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '格式化 JSON', exact: true }),
  ).toBeDisabled();
  await page.locator('.article-editor td').first().click({ button: 'right' });
  await expect(page.locator('.context-menu')).toHaveCount(0);
  // Commands from custom node views and keyboard shortcuts must also be blocked.
  await page.evaluate(() => {
    const e = window.__mojian!.editor!;
    e.commands.selectAll();
    e.commands.insertContent('误改');
    e.commands.deleteSelection();
    e.commands.undo();
    e.commands.redo();
    e.commands.toggleBold();
    e.view.dom.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      }),
    );
  });
  expect(await markdown(page)).toBe(before);
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '清空草稿', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  const source = page.getByRole('textbox', {
    name: 'Markdown 源码正文',
    exact: true,
  });
  await expect(source).toHaveJSProperty('readOnly', true);
  await source.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('误改');
  await page.keyboard.press('Backspace');
  await expect(source).toHaveValue(before);
  await page
    .getByRole('button', { name: '复制 Markdown 源码', exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    before,
  );
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  await page.getByRole('button', { name: '全屏写作', exact: true }).click();
  await expect(toggle).toBeChecked();
  await page.keyboard.press('Escape');
  await toggle.click();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(
    page.getByRole('button', { name: '格式化 JSON', exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => window.__mojian!.editor === (window as any).__originalEditor,
    ),
  ).toBe(true);
  await page.evaluate(() =>
    window.__mojian!.editor!.commands.insertContent('恢复编辑'),
  );
  await expect.poll(() => markdown(page)).toContain('恢复编辑');
  expect(errors).toEqual([]);
});

test('read-only is saved per article across reload, draft switching and renaming', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() =>
    window.__mojian!.setMarkdown('# 锁定文章\n\n固定正文'),
  );
  const toggle = page.getByRole('switch', { name: '只读模式' });
  await toggle.click();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.reload();
  await page.waitForFunction(() => !!window.__mojian?.editor);
  await expect(toggle).toBeChecked();
  await expect(page.locator('.article-editor')).toHaveAttribute(
    'contenteditable',
    'false',
  );
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换到草稿', exact: true }).click();
  await page
    .getByRole('button', { name: '重命名 锁定文章', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: '文章标题', exact: true })
    .fill('锁定的新标题');
  await page.getByRole('button', { name: '保存标题', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.article-editor')).toHaveAttribute(
    'contenteditable',
    'false',
  );
  await page.getByRole('button', { name: '新建文章', exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('.article-editor')).toHaveAttribute(
    'contenteditable',
    'true',
  );
  await page
    .locator('.draft-select')
    .filter({ hasText: '锁定的新标题' })
    .click();
  await expect(toggle).toBeChecked();
  await expect(page.locator('.article-editor')).toHaveAttribute(
    'contenteditable',
    'false',
  );
  await expect.poll(() => markdown(page)).toContain('固定正文');
  await toggle.click();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.reload();
  await page.waitForFunction(() => !!window.__mojian?.editor);
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('.article-editor')).toHaveAttribute(
    'contenteditable',
    'true',
  );
});

for (const width of [320, 390])
  for (const fullscreen of [false, true])
    test(`read-only switch remains usable without overlapping mode tabs at ${width}px, fullscreen=${fullscreen}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await ready(page);
      const toggle = page.getByRole('switch', { name: '只读模式' });
      const sourceTab = page.getByRole('button', {
        name: 'Markdown 源码',
        exact: true,
      });
      if (fullscreen)
        await page
          .getByRole('button', { name: '全屏写作', exact: true })
          .click();
      const left = (await sourceTab.boundingBox())!;
      const right = (await toggle.boundingBox())!;
      expect(left.x + left.width).toBeLessThanOrEqual(right.x);
      expect(right.width).toBeGreaterThanOrEqual(30);
      await toggle.click();
      await expect(toggle).toBeChecked();
      await expect(page.locator('.article-editor')).toHaveAttribute(
        'contenteditable',
        'false',
      );
      // The tab edge previously overlapped the switch in narrow fullscreen mode.
      await sourceTab.click({
        position: { x: left.width - 2, y: left.height / 2 },
      });
      await expect(toggle).toBeChecked();
      await expect(
        page.getByRole('textbox', { name: 'Markdown 源码正文', exact: true }),
      ).toHaveJSProperty('readOnly', true);
    });
