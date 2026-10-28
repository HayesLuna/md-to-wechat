import { test, expect } from './fixtures';

test('article headings, rules, links and quotes follow the selected theme color in preview and clipboard', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await expect(page).toHaveTitle('墨笺 · Markdown 公众号排版');
  const markdown =
    Array.from(
      { length: 6 },
      (_, i) => `${'#'.repeat(i + 1)} 标题 ${i + 1}`,
    ).join('\n\n') + '\n\n正文\n\n[链接](https://example.com)\n\n> 引用';
  await page.evaluate(
    (markdown) => (window as any).__mojian.setMarkdown(markdown),
    markdown,
  );
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  const paper = page.getByLabel('公众号排版正文', { exact: true });
  await expect(page.getByLabel('自定义主题色')).toHaveValue('#2864a8');
  const checkColor = async (color: string) => {
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__mojian.getOutput()?.key),
      )
      .not.toBeUndefined();
    await expect
      .poll(() =>
        page.evaluate((color) => {
          const output = (window as any).__mojian.getOutput();
          if (!output) return false;
          const probe = document.createElement('span');
          probe.style.color = color;
          const expected = probe.style.color;
          return [output.previewHTML, output.html].every((html) => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const headings = [
              ...doc.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'),
            ];
            return (
              headings.length === 6 &&
              headings.every(
                (h) =>
                  h.style.color === expected &&
                  h.style.borderBottomColor === expected &&
                  h.style.borderBottomWidth === '1px',
              ) &&
              doc.querySelector<HTMLElement>('a')?.style.color === expected &&
              doc.querySelector<HTMLElement>('blockquote')?.style
                .borderLeftColor === expected
            );
          });
        }, color),
      )
      .toBe(true);
  };
  await checkColor('#2864a8');
  for (const theme of ['默认', '简约', '雅致']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    for (const color of ['#a6493d', '#2864a8']) {
      await page
        .getByRole('button', { name: `使用主题色 ${color}`, exact: true })
        .click();
      await checkColor(color);
    }
  }
  await page.getByLabel('自定义主题色').fill('#237a57');
  await checkColor('#237a57');
  await expect(paper.locator('h1')).toHaveCSS('color', 'rgb(35, 122, 87)');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__mojian.getSettings().color),
    )
    .toBe('#237a57');
});
