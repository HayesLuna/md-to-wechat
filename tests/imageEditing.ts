import { expect, type Page } from '@playwright/test';

// Exercise the resize handle, including images whose far edge needs horizontal
// scrolling. Several short drags keep each gesture inside the browser viewport.
export async function dragImageWidth(page: Page, percent: number) {
  const currentWidth = () =>
    page.evaluate(() => {
      const editor = window.__mojian!.editor!;
      let width = 0;
      editor.state.doc.descendants((node) => {
        if (['image', 'inlineImage'].includes(node.type.name))
          width = node.attrs.percent;
      });
      return width;
    });
  await page.evaluate(() => {
    const editor = window.__mojian!.editor!;
    editor.state.doc.descendants((node, pos) => {
      if (['image', 'inlineImage'].includes(node.type.name))
        editor.chain().setNodeSelection(pos).focus().run();
    });
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  for (let attempt = 0; attempt < 25; attempt++) {
    const current = await currentWidth();
    if (current === percent) return;
    await page.locator('.image-scroll').evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await page
      .getByRole('button', { name: '拖拽调整图片宽度', exact: true })
      .scrollIntoViewIfNeeded();
    const basis = await page.locator('.image-box').evaluate((box) => {
      const frame = box.parentElement!;
      const style = getComputedStyle(frame);
      return box.closest('.inline-image-node')
        ? box.closest('p,h1,h2,h3,h4,h5,h6')!.clientWidth
        : frame.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight);
    });
    const handle = (await page
      .getByRole('button', { name: '拖拽调整图片宽度', exact: true })
      .boundingBox())!;
    const x = handle.x + handle.width / 2,
      y = handle.y + handle.height / 2;
    const delta = Math.max(
      12 - x,
      Math.min(
        page.viewportSize()!.width - 12 - x,
        Math.max(-240, Math.min(240, ((percent - current) * basis) / 100)),
      ),
    );
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta, y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(currentWidth).not.toBe(current);
  }
  expect(await currentWidth()).toBe(percent);
}
