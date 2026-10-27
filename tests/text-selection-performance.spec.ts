import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function ready(page: Page, markdown: string) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(
    (text) => (window as any).__mojian.setMarkdown(text),
    markdown,
  );
  await expect(page.locator('.article-editor')).toBeVisible();
}
const code = (count: number) =>
  Array.from(
    { length: count },
    (_, i) => `const value${i} = ${i}; // sample`,
  ).join('\n');

for (const direction of ['down', 'up'] as const)
  test(`code blank-origin drag scrolls its own viewport ${direction}, extends selection, and stops on release`, async ({
    page,
  }) => {
    const source = code(150);
    await ready(page, '```js\n' + source + '\n```');
    const viewport = page.locator('.code-viewport');
    if (direction === 'up')
      await viewport.evaluate((el) => {
        el.scrollTop = 600;
      });
    const start = await page.evaluate(() => {
      const e = (window as any).__mojian.editor,
        v = document.querySelector('.code-viewport')!;
      const pre = v.querySelector('pre')!,
        height = parseFloat(getComputedStyle(pre).lineHeight);
      const row = Math.ceil(v.scrollTop / height) + 2;
      const starts = e.state.doc.firstChild.textContent
        .split('\n')
        .reduce(
          (out: number[], line: string) => [
            ...out,
            out[out.length - 1] + line.length + 1,
          ],
          [1],
        );
      const a = e.view.coordsAtPos(starts[row - 1]),
        b = e.view.coordsAtPos(starts[row]);
      return { x: b.left + 45, y: (a.bottom + b.top) / 2 };
    });
    const before = await viewport.evaluate((el) => el.scrollTop);
    const box = (await viewport.boundingBox())!;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const anchor = await page.evaluate(
      () => (window as any).__mojian.editor.state.selection.anchor,
    );
    await page.mouse.move(
      start.x + 20,
      direction === 'down' ? box.y + box.height - 3 : box.y + 3,
      { steps: 8 },
    );
    await expect
      .poll(async () => {
        const now = await viewport.evaluate((el) => el.scrollTop);
        return direction === 'down' ? now > before + 100 : now < before - 100;
      })
      .toBe(true);
    const first = await page.evaluate(
      () => (window as any).__mojian.editor.state.selection.head,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__mojian.editor.state.selection.head,
        ),
      )
      .not.toBe(first);
    await page.mouse.up();
    const stopped = await viewport.evaluate((el) => el.scrollTop);
    await page.waitForTimeout(100);
    expect(await viewport.evaluate((el) => el.scrollTop)).toBe(stopped);
    expect(
      await page.evaluate(
        () => (window as any).__mojian.editor.state.selection.anchor,
      ),
    ).toBe(anchor);
    expect(await page.evaluate(() => getSelection()?.toString())).toContain(
      'const',
    );
    expect(
      await page.evaluate(
        () => (window as any).__mojian.editor.state.doc.firstChild.textContent,
      ),
    ).toBe(source);
    expect(
      await page.locator('.writing-scroll').evaluate((el) => el.scrollTop),
    ).toBe(0);
  });

for (const kind of ['code', 'prose'] as const)
  test(`long ${kind} blank-origin dragging keeps DOM measurement bounded under 4x CPU slowdown`, async ({
    page,
    context,
  }) => {
    const source =
      kind === 'code'
        ? '```js\n' + code(5000) + '\n```'
        : '这段文字用于验证长段落拖动的性能。'.repeat(5000);
    await ready(page, source);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const start = await page.evaluate((kind) => {
      const e = (window as any).__mojian.editor;
      const first = e.view.coordsAtPos(1);
      let next = 2;
      while (e.view.coordsAtPos(next).top < first.bottom) next++;
      const second = e.view.coordsAtPos(next + 3),
        surface = document
          .querySelector('.writing-scroll')!
          .getBoundingClientRect();
      const audit = ((window as any).__dragAudit = {
        maxRects: 0,
        calls: 0,
        moves: 0,
        frames: [] as number[],
        active: true,
        last: performance.now(),
      });
      const original = Range.prototype.getClientRects;
      Range.prototype.getClientRects = function () {
        const rects = original.call(this);
        audit.maxRects = Math.max(audit.maxRects, rects.length);
        audit.calls++;
        return rects;
      };
      const view = e.view,
        coords = view.coordsAtPos.bind(view);
      (window as any).__dragCoordinateCalls = 0;
      view.coordsAtPos = (...args: any[]) => {
        (window as any).__dragCoordinateCalls++;
        return coords(...args);
      };
      const frame = (time: number) => {
        if (!audit.active) return;
        audit.frames.push(time - audit.last);
        audit.last = time;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      return {
        x: kind === 'code' ? second.left : surface.left + 4,
        y: kind === 'code' ? (first.bottom + second.top) / 2 : second.top + 5,
        endX: second.left + 50,
        endY: second.top + 70,
      };
    }, kind);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 16; i++) {
      await page.mouse.move(start.endX + i, start.endY + i * 2);
      await page.waitForTimeout(20);
    }
    const scroller = page.locator(
      kind === 'code' ? '.code-viewport' : '.writing-scroll',
    );
    const edge = (await scroller.boundingBox())!;
    await page.mouse.move(start.endX, edge.y + edge.height - 3);
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(30);
    const head = await page.evaluate(
      () => (window as any).__mojian.editor.state.selection.head,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__mojian.editor.state.selection.head,
        ),
      )
      .not.toBe(head);
    await page.mouse.up();
    const stopped = await scroller.evaluate((el) => el.scrollTop);
    await page.waitForTimeout(100);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(stopped);
    const result = await page.evaluate(() => {
      const a = (window as any).__dragAudit;
      a.active = false;
      const frames = a.frames
        .filter((n: number) => n >= 0)
        .sort((a: number, b: number) => a - b);
      return {
        maxRects: a.maxRects,
        calls: a.calls,
        coordinates: (window as any).__dragCoordinateCalls,
        p95: frames[Math.floor(frames.length * 0.95)],
        frames: frames.length,
        selected: getSelection()?.toString(),
      };
    });
    console.log(
      JSON.stringify({ kind, ...result, selected: result.selected?.length }),
    );
    // Budget work per gesture, independent of source length. The native hit
    // test may measure a few adjacent characters; it must not enumerate all rows.
    expect(result.maxRects).toBeLessThan(32);
    expect(result.coordinates).toBeLessThan(kind === 'code' ? 350 : 4500);
    expect(result.frames).toBeGreaterThan(10);
    expect(result.p95).toBeLessThan(100);
    expect(result.selected?.length).toBeGreaterThan(10);
  });

test('an exhausted code viewport hands scrolling to the article and dragging can continue into prose', async ({
  page,
}) => {
  const source = code(150);
  await ready(
    page,
    '```js\n' +
      source +
      '\n```\n\n' +
      Array.from(
        { length: 35 },
        (_, i) => `正文段落${i}，允许从代码块继续选择。`,
      ).join('\n\n'),
  );
  const viewport = page.locator('.code-viewport');
  await viewport.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const start = await page.evaluate(() => {
    const e = (window as any).__mojian.editor,
      v = document.querySelector('.code-viewport')!;
    const lines = e.state.doc.firstChild.textContent.split('\n'),
      offset = lines.slice(0, lines.length - 3).join('\n').length + 1;
    const a = e.view.coordsAtPos(offset + 1),
      b = e.view.coordsAtPos(offset + lines[lines.length - 3].length + 2);
    return { x: b.left + 45, y: (a.bottom + b.top) / 2 };
  });
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, box.y + box.height - 3);
  await expect
    .poll(() => page.locator('.writing-scroll').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  const prose = (await page
    .locator('.article-editor > p')
    .first()
    .boundingBox())!;
  await page.mouse.move(prose.x + 55, prose.y + prose.height / 2, { steps: 8 });
  await page.mouse.up();
  const selected = await page.evaluate(() => {
    const s = (window as any).__mojian.editor.state.selection;
    return {
      anchor: s.$anchor.parent.type.name,
      head: s.$head.parent.type.name,
      text: getSelection()?.toString(),
    };
  });
  expect(selected.anchor).toBe('codeBlock');
  expect(selected.head).toBe('paragraph');
  expect(selected.text).toContain('正文段');
});
