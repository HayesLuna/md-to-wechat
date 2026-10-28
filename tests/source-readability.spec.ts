import { test, expect } from './fixtures';

test('source soft-wraps long paragraphs and URLs without changing text; outline follows visual lines', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const text =
    '# 开始\n\n' +
    '这是一段很长的正文。'.repeat(240) +
    '\n\n## 目标标题\n\nhttps://example.com/' +
    'a'.repeat(800) +
    '\n\n' +
    '末尾内容。'.repeat(250);
  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  const source = page.getByRole('textbox', { name: 'Markdown 源码正文' });
  await source.fill(text);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await source.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await expect(source).toHaveValue(text);
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
    await page
      .locator('.sidebar-outline button')
      .filter({ hasText: '目标标题' })
      .click();
    const position = await source.evaluate((el: HTMLTextAreaElement) => ({
      at: el.selectionStart,
      scroll: el.scrollTop,
    }));
    expect(position.at).toBe(text.indexOf('## 目标标题'));
    expect(position.scroll).toBeGreaterThan(300);
  }
  await page.screenshot({ path: '/tmp/mojian-source-wrap-mobile.png' });
  expect(
    await page.evaluate(() => (window as any).__mojian.getMarkdown()),
  ).toBe(text);
});

test('empty paragraphs serialize as blank lines while explicit breaks and code entities survive', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const result = await page.evaluate(() => {
    const editor = (window as any).__mojian.editor;
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '第一段' }] },
        { type: 'paragraph' },
        { type: 'paragraph' },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '第二段' },
            { type: 'hardBreak' },
            { type: 'text', text: '下一行' },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'html' },
          content: [{ type: 'text', text: '<p>&nbsp;</p>' }],
        },
      ],
    });
    const markdown = editor.getMarkdown();
    const parsed = editor.markdown.parse(markdown);
    return {
      markdown,
      originalEmpty: editor
        .getJSON()
        .content.filter(
          (node: any) => node.type === 'paragraph' && !node.content?.length,
        ).length,
      empty: parsed.content.filter(
        (node: any) => node.type === 'paragraph' && !node.content?.length,
      ).length,
    };
  });
  expect(result.markdown).toContain('第一段\n\n\n\n\n\n第二段  \n下一行');
  expect(result.markdown.match(/&nbsp;/g)).toHaveLength(1);
  expect(result.markdown).toContain('<p>&nbsp;</p>');
  expect(result.originalEmpty).toBeGreaterThanOrEqual(2);
  expect(result.empty).toBe(result.originalEmpty);
  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Markdown 源码正文' }),
  ).toHaveValue(result.markdown);
});

test('Mermaid uses blue in editor, previews and SVG export while preserving source-defined colors', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown(
      '```mermaid\nflowchart LR\nsubgraph 准备\nA[开始] --> B[编辑]\nend\nB --> C[发布]\nstyle C fill:#123456,color:#ffffff\n```',
    ),
  );
  const graph = page.locator('.diagram svg');
  await expect(graph).toBeVisible();
  const colors = await graph
    .locator('.node rect')
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fill));
  expect(colors).toContain('rgb(232, 242, 255)');
  expect(colors).toContain('rgb(18, 52, 86)');
  await expect(graph.locator('.node rect').first()).toHaveCSS(
    'stroke',
    'rgb(91, 146, 212)',
  );
  await page
    .getByRole('button', { name: '预览 Mermaid 图表', exact: true })
    .click();
  const enlarged = page
    .getByRole('region', { name: '图表预览' })
    .locator('img');
  await expect(enlarged).toBeVisible();
  const enlargedSVG = await enlarged.evaluate(async (img: HTMLImageElement) =>
    (await fetch(img.src)).text(),
  );
  expect(enlargedSVG.toLowerCase()).toContain('#e8f2ff');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const m = (window as any).__mojian;
    return (
      m.getOutput()?.key === JSON.stringify([m.getMarkdown(), m.getSettings()])
    );
  });
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('.preview-paper .node rect').first()).toHaveCSS(
    'fill',
    'rgb(232, 242, 255)',
  );
  const exported = page.waitForEvent('download');
  await page
    .locator('.mermaid-editor-preview')
    .getByRole('button', { name: 'SVG', exact: true })
    .click();
  const stream = await (await exported).createReadStream();
  let svg = '';
  for await (const chunk of stream!) svg += chunk.toString();
  expect(svg.toLowerCase()).toContain('#e8f2ff');
  expect(svg).toContain('#123456');
  await page.screenshot({ path: '/tmp/mojian-mermaid-colors.png' });
});

test('long sequence diagrams stay compact and sequence numbers are readable in all outputs', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown(
      '```mermaid\nsequenceDiagram\n autonumber\n participant A as 用户\n participant B as 服务\n' +
        Array.from(
          { length: 30 },
          (_, i) => ` A->>B: 请求 ${i + 1}\n B-->>A: 响应 ${i + 1}`,
        ).join('\n') +
        '\n```',
    ),
  );
  const svg = page.locator('.mermaid-editor-preview .diagram>svg');
  await expect(svg).toBeVisible();
  await expect(svg.locator('.sequenceNumber').first()).toHaveCSS(
    'fill',
    'rgb(255, 255, 255)',
  );
  expect((await svg.boundingBox())!.height).toBeLessThanOrEqual(480);
  await page
    .getByRole('button', { name: '预览 Mermaid 图表', exact: true })
    .click();
  const image = page.getByRole('region', { name: '图表预览' }).locator('img');
  await expect(image).toBeVisible();
  const enlarged = await image.evaluate(async (img: HTMLImageElement) =>
    (await fetch(img.src)).text(),
  );
  expect(enlarged).toMatch(/sequenceNumber\{fill:#ffffff;/);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const m = (window as any).__mojian;
    return (
      m.getOutput()?.key === JSON.stringify([m.getMarkdown(), m.getSettings()])
    );
  });
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(
    page.locator('.preview-paper .sequenceNumber').first(),
  ).toHaveCSS('fill', 'rgb(255, 255, 255)');
  const download = page.waitForEvent('download');
  await page
    .locator('.mermaid-editor-preview')
    .getByRole('button', { name: 'SVG', exact: true })
    .click();
  const stream = await (await download).createReadStream();
  let exported = '';
  for await (const chunk of stream!) exported += chunk.toString();
  expect(exported).toMatch(/sequenceNumber\{fill:#ffffff;/);
});
