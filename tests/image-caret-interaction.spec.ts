import { test, expect } from './fixtures';

for (const width of [1440, 390]) {
  test(`native image-adjacent text supports placement, arrows and backward selection at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/native-caret.svg', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160"><rect width="120" height="160" fill="teal"/></svg>',
      }),
    );
    await page.goto('/');
    await page.waitForFunction(() => !!window.__mojian?.editor);
    await page.evaluate(() =>
      window.__mojian!.setMarkdown(
        '上方正文\n\n图片前文字![图](https://example.test/native-caret.svg "width=35%")图片后文字\n\n下方正文',
      ),
    );
    await expect(page.locator('.image-box img')).toBeVisible();
    await expect(page.locator('.safari-text-caret')).toHaveCount(0);
    const selected = () =>
      page.evaluate(() => {
        const e = window.__mojian!.editor!;
        const s = e.state.selection;
        return {
          from: s.from,
          to: s.to,
          text: e.state.doc.textBetween(s.from, s.to, '\n'),
        };
      });
    for (const text of ['图片前文字', '图片后文字']) {
      const point = await page.evaluate((text) => {
        const e = window.__mojian!.editor!;
        let pos = -1;
        e.state.doc.descendants((node, at) => {
          if (node.isText && node.text === text) pos = at + 2;
        });
        const d = e.view.domAtPos(pos);
        const range = document.createRange();
        range.setStart(d.node, d.offset);
        range.setEnd(d.node, d.offset + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + 1, y: rect.bottom - 5, pos };
      }, text);
      await page.mouse.click(point.x, point.y);
      await expect.poll(async () => (await selected()).from).toBe(point.pos);
      await page.keyboard.press('ArrowLeft');
      await expect
        .poll(async () => (await selected()).from)
        .toBe(point.pos - 1);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Shift+ArrowLeft');
      await expect.poll(async () => (await selected()).text).toBe(text[1]);
      await page.keyboard.press('ArrowRight');
      const before = await page
        .locator('.article-editor > p')
        .first()
        .evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const rect = range.getBoundingClientRect();
          return { x: rect.left, y: rect.bottom - 5 };
        });
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(before.x + 1, before.y, {
        steps: 12,
      });
      await page.mouse.up();
      await expect
        .poll(async () => (await selected()).text)
        .toContain('上方正文');
    }
    // Clicking the image's left side must still insert before the image.
    const image = (await page.locator('.image-box img').boundingBox())!;
    await page.mouse.click(image.x - 7, image.y + image.height / 2);
    await page.keyboard.insertText('插入');
    await expect
      .poll(() => page.evaluate(() => window.__mojian!.getMarkdown()))
      .toContain('插入![图]');
    expect(
      await page.evaluate(() => window.__mojian!.getMarkdown()),
    ).not.toMatch(/[\u200b\ufeff]/);
  });
}

for (const width of [1440, 390]) {
  for (const mixed of [false, true]) {
    test(`dragging starts at either image side and at its caret anchor at ${width}px/${mixed ? 'mixed' : 'standalone'}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.route('**/native-caret.svg', (route) =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160"><rect width="120" height="160" fill="teal"/></svg>',
        }),
      );
      await page.goto('/');
      await page.waitForFunction(() => !!window.__mojian?.editor);
      await page.evaluate(
        (mixed) =>
          window.__mojian!.setMarkdown(
            '上方正文\n\n' +
              (mixed ? '图片前' : '') +
              '![图](https://example.test/native-caret.svg "width=35%")' +
              (mixed ? '图片后' : '') +
              '\n\n下方正文',
          ),
        mixed,
      );
      await expect(page.locator('.image-box img')).toBeVisible();
      for (const edge of ['left', 'right', 'anchor'] as const) {
        const image = (await page.locator('.image-box img').boundingBox())!;
        let x = edge === 'right' ? image.x + image.width + 2 : image.x - 2;
        let y = image.y + image.height / 2;
        await page.mouse.click(x, y);
        await expect
          .poll(() =>
            page.evaluate(() => {
              const e = window.__mojian!.editor!;
              return {
                type: e.state.selection.toJSON().type,
                position: e.state.selection.from,
              };
            }),
          )
          .toEqual({
            type: 'text',
            position: (edge === 'right' ? 8 : 7) + (mixed ? 3 : 0),
          });
        if (edge === 'anchor') {
          const anchor = (await page
            .locator('.image-caret-left')
            .boundingBox())!;
          x = anchor.x - 1;
          y = anchor.y + anchor.height / 2;
        }
        const end = await page
          .locator('.article-editor > p')
          .first()
          .evaluate((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            const rect = range.getBoundingClientRect();
            return { x: rect.left + 1, y: rect.bottom - 5 };
          });
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 12 });
        await page.mouse.up();
        await expect
          .poll(() =>
            page.evaluate(() => {
              const e = window.__mojian!.editor!;
              return e.state.doc.textBetween(
                e.state.selection.from,
                e.state.selection.to,
              );
            }),
          )
          .toContain('上方正文');
        await expect(page.locator('.image-box img')).toHaveCount(1);
      }
    });
  }
}

for (const width of [1440, 390]) {
  test(`image side drags preserve their anchor and follow both selection directions at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/direction.svg', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160"><rect width="120" height="160" fill="teal"/></svg>',
      }),
    );
    await page.goto('/');
    await page.waitForFunction(() => !!window.__mojian?.editor);
    await page.evaluate(() =>
      window.__mojian!.setMarkdown(
        '前面的文字![图](https://example.test/direction.svg "width=35%")后面的文字',
      ),
    );
    await expect(page.locator('.image-box img')).toBeVisible();
    const point = async (text: string, offset: number) =>
      page.evaluate(
        ({ text, offset }) => {
          const e = window.__mojian!.editor!;
          let pos = 0;
          e.state.doc.descendants((n, p) => {
            if (n.isText && n.text === text) pos = p + offset;
          });
          const d = e.view.domAtPos(pos),
            range = document.createRange();
          range.setStart(d.node, d.offset);
          range.setEnd(d.node, d.offset + 1);
          const r = range.getBoundingClientRect();
          return { pos, x: r.left + 1, y: r.bottom - 5 };
        },
        { text, offset },
      );
    const image = (await page.locator('.image-box img').boundingBox())!;
    const before = await point('前面的文字', 2),
      after = await point('后面的文字', 2);
    for (const forward of [true, false]) {
      const x = forward ? image.x - 2 : image.x + image.width + 2;
      const y = image.y + image.height / 2;
      const end = forward ? after : before;
      await page.mouse.move(x, y);
      await page.mouse.down();
      const anchor = forward ? 6 : 7;
      await expect
        .poll(() =>
          page.evaluate(() => window.__mojian!.editor!.state.selection.anchor),
        )
        .toBe(anchor);
      await page.mouse.move(end.x, end.y, { steps: 12 });
      await page.mouse.up();
      await expect
        .poll(() =>
          page.evaluate(() => {
            const s = window.__mojian!.editor!.state.selection;
            return { anchor: s.anchor, head: s.head };
          }),
        )
        .toEqual({ anchor, head: end.pos });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const e = window.__mojian!.editor!,
              s = getSelection()!;
            return {
              anchor: e.view.posAtDOM(s.anchorNode!, s.anchorOffset),
              head: e.view.posAtDOM(s.focusNode!, s.focusOffset),
            };
          }),
        )
        .toEqual({ anchor, head: end.pos });
      expect(forward ? anchor < end.pos : anchor > end.pos).toBe(true);
    }
  });
}
