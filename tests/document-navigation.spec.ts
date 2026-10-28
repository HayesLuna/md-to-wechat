import { test, expect } from './fixtures';

test('left navigation shares drafts and outline, preserves collapse and supports indexed heading jumps', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const sidebar = page.getByRole('complementary', { name: '文章导航' });
  await expect(sidebar).toHaveCount(0);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator('.sidebar-title')).toHaveText('大纲');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.locator('.writing-pane .writing-body .document-sidebar'),
  ).toHaveCount(1);
  const toolbar = await page
    .getByRole('toolbar', { name: '正文格式' })
    .boundingBox();
  const navigation = await sidebar.boundingBox();
  expect(navigation!.y).toBe(toolbar!.y);
  expect((await sidebar.locator('.sidebar-header').boundingBox())!.height).toBe(
    toolbar!.height,
  );
  expect(toolbar!.x).toBeGreaterThanOrEqual(
    navigation!.x + navigation!.width - 1,
  );
  await expect(page.locator('.writing-content > .toolbar')).toHaveCount(1);
  await page.getByRole('button', { name: '切换到草稿' }).focus();
  await page.keyboard.press('Enter');
  await expect(sidebar.locator('.sidebar-title')).toHaveText('草稿');
  await page.keyboard.press('Space');
  await expect(sidebar.locator('.sidebar-title')).toHaveText('大纲');
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown(
      '# 文章标题\n\n开头正文\n\n## 重复标题\n\n中间正文\n\n### 嵌套标题\n\n更多正文\n\n## 重复标题\n\n末尾正文',
    ),
  );
  const headings = page.locator('.sidebar-outline>button');
  await expect(headings).toHaveText([
    '文章标题',
    '重复标题',
    '嵌套标题',
    '重复标题',
  ]);
  const indents = await headings.evaluateAll((nodes) =>
    nodes.map((n) => parseFloat(getComputedStyle(n).paddingLeft)),
  );
  expect(indents[2]).toBeGreaterThan(indents[1]);
  expect(indents[1]).toBeGreaterThan(indents[0]);
  await headings.nth(3).click();
  await expect(headings.nth(3)).toHaveAttribute('aria-current', 'location');
  expect(
    await page.evaluate(
      () => (window as any).__mojian.editor.state.selection.from,
    ),
  ).toBeGreaterThan(35);
  await page.getByRole('button', { name: '搜索大纲', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索大纲标题' }).fill('嵌套');
  await expect(headings).toHaveText(['嵌套标题']);
  await headings.click();
  await expect(headings).toHaveAttribute('aria-current', 'location');
  await page.getByRole('button', { name: '切换到草稿', exact: true }).click();
  await expect(page.getByRole('region', { name: '草稿箱' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建文章' })).toBeVisible();
  const before = await page.evaluate(() =>
    (window as any).__mojian.getMarkdown(),
  );
  const toggle = page.locator('.sidebar-launch');
  const openPosition = await toggle.boundingBox();
  const modePosition = await page
    .getByRole('button', { name: '所见即所得', exact: true })
    .boundingBox();
  await page.getByRole('button', { name: '折叠侧栏' }).click();
  await expect(sidebar).toHaveCount(0);
  expect(await toggle.boundingBox()).toEqual(openPosition);
  expect(
    await page
      .getByRole('button', { name: '所见即所得', exact: true })
      .boundingBox(),
  ).toEqual(modePosition);
  await page.getByRole('button', { name: '展开侧栏' }).click();
  expect(await toggle.boundingBox()).toEqual(openPosition);
  await expect(sidebar.locator('.sidebar-title')).toHaveText('草稿');
  expect(
    await page.evaluate(() => (window as any).__mojian.getMarkdown()),
  ).toBe(before);
  await page.getByRole('button', { name: '新建文章' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__mojian.getMarkdown()))
    .toBe('');
  await expect(sidebar).toBeVisible();
  await expect(page.locator('.draft-list li')).toHaveCount(2);
  await page.getByRole('button', { name: '全屏写作', exact: true }).click();
  await expect(sidebar).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeVisible();
});

for (const width of [390, 546, 586])
  test(`narrow ${width}px navigation keeps its toggle fixed and returns to the article`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 546 ? 666 : 844 });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    const copyBounds = await page.locator('.copy-main').boundingBox();
    expect(copyBounds!.width).toBe(144);
    expect(copyBounds!.x + copyBounds!.width).toBe(width - 14);
    await page.evaluate(() =>
      (window as any).__mojian.setMarkdown(
        '# 标题\n\n正文\n\n## 目标标题\n\n更多正文',
      ),
    );
    const sidebar = page.getByRole('complementary', { name: '文章导航' });
    const toggle = page.locator('.sidebar-launch');
    const position = await toggle.boundingBox();
    await expect(sidebar).toHaveCount(0);
    await page.getByRole('button', { name: '展开侧栏' }).click();
    await expect(sidebar).toBeVisible();
    expect(await toggle.boundingBox()).toEqual(position);
    const bounds = await sidebar.boundingBox();
    const body = await page.locator('.writing-body').boundingBox();
    expect(bounds!.x).toBe(body!.x);
    expect(bounds!.y).toBe(body!.y);
    expect(bounds!.width).toBeLessThan(width);
    expect(
      (await sidebar.locator('.sidebar-header').boundingBox())!.height,
    ).toBe(
      (await page.getByRole('toolbar', { name: '正文格式' }).boundingBox())!
        .height,
    );
    await page
      .getByRole('region', { name: '文章大纲' })
      .getByRole('button', { name: '目标标题', exact: true })
      .click();
    await expect(sidebar).toHaveCount(0);
    await expect(page.locator('.article-editor')).toBeFocused();
    await page.getByRole('button', { name: '展开侧栏' }).click();
    await page.keyboard.press('Escape');
    await expect(sidebar).toHaveCount(0);
    expect(await toggle.boundingBox()).toEqual(position);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });

test('long outlines scroll independently and preserve heading targets after filtering', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown(
      '# 长文章\n\n' +
        Array.from(
          { length: 100 },
          (_, i) =>
            `## 章节 ${i + 1}\n\n正文 ${i + 1}\n\n### 小节 ${i + 1}\n\n小节正文\n\n`,
        ).join(''),
    ),
  );
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  const outline = page.locator('.sidebar-outline');
  await expect(outline.locator('button')).toHaveCount(201);
  expect(
    await outline.evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  await outline.getByRole('button', { name: '小节 100', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__mojian.editor.state.selection.$from.parent
            .textContent,
      ),
    )
    .toBe('小节 100');
  expect(await outline.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '搜索大纲', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索大纲标题' }).fill('章节 99');
  await expect(outline.locator('button')).toHaveText(['章节 99']);
  await outline.getByRole('button', { name: '章节 99', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__mojian.editor.state.selection.$from.parent
            .textContent,
      ),
    )
    .toBe('章节 99');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    1440,
  );
});

test('sidebar dragging shares width between outline and drafts and restores it after reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: '文章导航' });
  const handle = page.getByRole('separator', { name: '调整侧栏宽度' });
  const initial = await sidebar.boundingBox();
  const grip = await handle.boundingBox();
  await page.mouse.move(grip!.x + 3, grip!.y + 80);
  await page.mouse.down();
  await page.mouse.move(grip!.x + 103, grip!.y + 80, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await sidebar.boundingBox())!.width)
    .toBe(initial!.width + 100);
  await page.getByRole('button', { name: '切换到草稿' }).click();
  expect((await sidebar.boundingBox())!.width).toBe(initial!.width + 100);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await expect(sidebar).toHaveCount(0);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  expect((await sidebar.boundingBox())!.width).toBe(initial!.width + 100);
  await handle.focus();
  await page.keyboard.press('Home');
  expect((await sidebar.boundingBox())!.width).toBe(180);
  await page.keyboard.press('End');
  expect((await sidebar.boundingBox())!.width).toBe(480);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebar).toHaveCount(0);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  expect((await sidebar.boundingBox())!.width).toBeLessThanOrEqual(350);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});

test('outline depth is relative to the first heading level when an article starts at H2', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown('## 章节\n\n### 小节\n\n## 下一章'),
  );
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  const headings = page.locator('.sidebar-outline>button');
  await expect(headings).toHaveText(['章节', '小节', '下一章']);
  expect(
    await headings.evaluateAll((nodes) =>
      nodes.map((n) => parseFloat(getComputedStyle(n).paddingLeft)),
    ),
  ).toEqual([16, 30, 16]);
});

for (const width of [390, 1053])
  test(`more actions menu fits its labels at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 726 });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    await page.getByRole('button', { name: '更多操作', exact: true }).click();
    const menu = page.locator('.more-menu');
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box!.width).toBeLessThan(200);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await menu.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await expect(
      menu.getByRole('button', { name: '复制 Markdown 源码', exact: true }),
    ).toBeVisible();
  });
