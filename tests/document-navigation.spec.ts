import { test, expect } from './fixtures';

test('desktop shows drafts on the left and outline on the right with independent collapse and heading jumps', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const drafts = page.getByRole('complementary', { name: '草稿箱' });
  const outline = page.getByRole('complementary', { name: '文章大纲' });
  await expect(drafts).toBeVisible();
  await expect(outline).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.locator('.writing-pane .writing-body .drafts-sidebar'),
  ).toHaveCount(1);
  await expect(
    page.locator('.writing-pane .writing-body .outline-sidebar'),
  ).toHaveCount(1);

  const toolbar = await page
    .getByRole('toolbar', { name: '正文格式' })
    .boundingBox();
  const draftsBox = await drafts.boundingBox();
  const outlineBox = await outline.boundingBox();
  expect(draftsBox!.y).toBe(toolbar!.y);
  expect(outlineBox!.y).toBe(toolbar!.y);
  expect((await drafts.locator('.sidebar-header').boundingBox())!.height).toBe(
    toolbar!.height,
  );
  expect((await outline.locator('.sidebar-header').boundingBox())!.height).toBe(
    toolbar!.height,
  );
  expect(toolbar!.x).toBeGreaterThanOrEqual(
    draftsBox!.x + draftsBox!.width - 1,
  );
  expect(outlineBox!.x).toBeGreaterThanOrEqual(toolbar!.x + toolbar!.width - 1);
  await expect(page.locator('.writing-content > .toolbar')).toHaveCount(1);

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
  await expect(
    page.getByRole('button', { name: '搜索大纲', exact: true }),
  ).toHaveCount(0);

  await expect(page.getByRole('button', { name: '新建文章' })).toBeVisible();
  const before = await page.evaluate(() =>
    (window as any).__mojian.getMarkdown(),
  );
  const draftsToggle = page.locator('.drafts-launch');
  const openPosition = await draftsToggle.boundingBox();
  const modePosition = await page
    .getByRole('button', { name: '所见即所得', exact: true })
    .boundingBox();
  await page.getByRole('button', { name: '折叠草稿', exact: true }).click();
  await expect(drafts).toHaveCount(0);
  await expect(outline).toBeVisible();
  expect(await draftsToggle.boundingBox()).toEqual(openPosition);
  expect(
    await page
      .getByRole('button', { name: '所见即所得', exact: true })
      .boundingBox(),
  ).toEqual(modePosition);

  await page.getByRole('button', { name: '收起大纲', exact: true }).click();
  await expect(outline).toHaveCount(0);
  const minimap = page.getByRole('navigation', { name: '大纲缩略导航' });
  await expect(minimap).toBeVisible();
  const nestedBar = minimap.getByRole('button', {
    name: '嵌套标题',
    exact: true,
  });
  await nestedBar.hover();
  await expect(nestedBar.locator('.outline-minimap-tip')).toHaveCSS(
    'opacity',
    '1',
  );
  await expect(outline).toHaveCount(0);
  await nestedBar.click();
  await expect(outline).toHaveCount(0);
  await expect(nestedBar).toHaveAttribute('aria-current', 'location');
  expect(
    await page.evaluate(
      () =>
        (window as any).__mojian.editor.state.selection.$from.parent
          .textContent,
    ),
  ).toBe('嵌套标题');

  await page.getByRole('button', { name: '展开草稿', exact: true }).click();
  await expect(drafts).toBeVisible();
  await page.getByRole('button', { name: '展开大纲', exact: true }).click();
  await expect(outline).toBeVisible();
  await expect(minimap).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).__mojian.getMarkdown()),
  ).toBe(before);

  await page.getByRole('button', { name: '新建文章' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__mojian.getMarkdown()))
    .toBe('');
  await expect(drafts).toBeVisible();
  await expect(page.locator('.draft-list li')).toHaveCount(2);

  await page.getByRole('button', { name: '全屏写作', exact: true }).click();
  await expect(drafts).toHaveCount(0);
  await expect(outline).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drafts).toBeVisible();
  await expect(outline).toBeVisible();
});

test('wechat preview opens as a centered modal dialog and closes via Esc, backdrop, or close button', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown('# 弹窗预览\n\n预览正文段落'),
  );
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '公众号预览', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.preview-paper')).toContainText('弹窗预览');

  // Desktop modal places settings on the left and scrollable preview paper on the right.
  const settingsBox = await dialog
    .locator('.preview-settings-column')
    .boundingBox();
  const paperBox = await dialog.locator('.preview-paper').boundingBox();
  expect(paperBox!.x).toBeGreaterThanOrEqual(
    settingsBox!.x + settingsBox!.width - 1,
  );

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Clicking the backdrop closes the preview modal.
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page
    .locator('.preview-dialog-backdrop')
    .click({ position: { x: 8, y: 8 } });
  await expect(dialog).toHaveCount(0);

  // Close button also closes the preview modal.
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

for (const width of [390, 586])
  test(`narrow ${width}px navigation opens drafts on the left and outline on the right as mutually exclusive drawers`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    const actions = page.locator('.header-actions > button:visible');
    await expect(actions).toHaveCount(4);
    const firstBounds = await actions.first().boundingBox();
    let lastBounds = firstBounds;
    for (const action of await actions.all()) {
      const bounds = await action.boundingBox();
      expect(Math.abs(bounds!.width - firstBounds!.width)).toBeLessThan(1);
      expect(bounds!.height).toBe(40);
      await expect(action.locator('span')).toBeHidden();
      lastBounds = bounds;
    }
    expect(lastBounds!.x + lastBounds!.width).toBeCloseTo(width - 14, 0);
    await page.evaluate(() =>
      (window as any).__mojian.setMarkdown(
        '# 标题\n\n正文\n\n## 目标标题\n\n更多正文',
      ),
    );
    const drafts = page.getByRole('complementary', { name: '草稿箱' });
    const outline = page.getByRole('complementary', { name: '文章大纲' });
    const draftsToggle = page.locator('.drafts-launch');
    const position = await draftsToggle.boundingBox();
    await expect(drafts).toHaveCount(0);
    await expect(outline).toHaveCount(0);

    await page.getByRole('button', { name: '展开草稿' }).click();
    await expect(drafts).toBeVisible();
    await expect(outline).toHaveCount(0);
    expect(await draftsToggle.boundingBox()).toEqual(position);
    const draftsBounds = await drafts.boundingBox();
    const body = await page.locator('.writing-body').boundingBox();
    expect(draftsBounds!.x).toBe(body!.x);
    expect(draftsBounds!.y).toBe(body!.y);
    expect(draftsBounds!.width).toBeLessThan(width);
    expect(
      (await drafts.locator('.sidebar-header').boundingBox())!.height,
    ).toBe(
      (await page.getByRole('toolbar', { name: '正文格式' }).boundingBox())!
        .height,
    );

    // Opening outline on narrow screens replaces drafts drawer and anchors right.
    await page.getByRole('button', { name: '展开大纲' }).click();
    await expect(outline).toBeVisible();
    await expect(drafts).toHaveCount(0);
    const outlineBounds = await outline.boundingBox();
    expect(outlineBounds!.x + outlineBounds!.width).toBeCloseTo(
      body!.x + body!.width,
      1,
    );
    expect(outlineBounds!.y).toBe(body!.y);

    await outline
      .getByRole('button', { name: '目标标题', exact: true })
      .click();
    await expect(outline).toHaveCount(0);
    await expect(page.locator('.article-editor')).toBeFocused();

    await page.getByRole('button', { name: '展开大纲' }).click();
    await page.keyboard.press('Escape');
    await expect(outline).toHaveCount(0);
    expect(await draftsToggle.boundingBox()).toEqual(position);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });

test('long outlines scroll independently and jump to distant headings', async ({
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

test('drafts and outline sidebars resize independently and restore widths after reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const drafts = page.getByRole('complementary', { name: '草稿箱' });
  const outline = page.getByRole('complementary', { name: '文章大纲' });
  const draftsHandle = page.getByRole('separator', { name: '调整草稿栏宽度' });
  const outlineHandle = page.getByRole('separator', { name: '调整大纲栏宽度' });

  const initialDrafts = await drafts.boundingBox();
  const draftsGrip = await draftsHandle.boundingBox();
  await page.mouse.move(draftsGrip!.x + 3, draftsGrip!.y + 80);
  await page.mouse.down();
  await page.mouse.move(draftsGrip!.x + 83, draftsGrip!.y + 80, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await drafts.boundingBox())!.width)
    .toBe(initialDrafts!.width + 80);

  const initialOutline = await outline.boundingBox();
  const outlineGrip = await outlineHandle.boundingBox();
  await page.mouse.move(outlineGrip!.x + 3, outlineGrip!.y + 80);
  await page.mouse.down();
  await page.mouse.move(outlineGrip!.x - 67, outlineGrip!.y + 80, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await outline.boundingBox())!.width)
    .toBe(initialOutline!.width + 70);

  await page.reload();
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  expect((await drafts.boundingBox())!.width).toBe(initialDrafts!.width + 80);
  expect((await outline.boundingBox())!.width).toBe(initialOutline!.width + 70);

  await draftsHandle.focus();
  await page.keyboard.press('Home');
  expect((await drafts.boundingBox())!.width).toBe(180);
  await page.keyboard.press('End');
  expect((await drafts.boundingBox())!.width).toBe(480);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(drafts).toHaveCount(0);
  await expect(outline).toHaveCount(0);
  await page.getByRole('button', { name: '展开草稿', exact: true }).click();
  expect((await drafts.boundingBox())!.width).toBeLessThanOrEqual(350);
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
