import { test, expect } from './fixtures';
import { findCodeFolds } from '../src/codeFolding';
import type { Page } from '@playwright/test';
const source =
  'function outer() {\n  const data = "{ brace in a string }";\n  if (data) {\n    console.log(data);\n  }\n}';
async function ready(page: Page, text = source, language = 'javascript') {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(
    ({ text, language }) =>
      (window as any).__mojian.setMarkdown(
        '```' + language + '\n' + text + '\n```',
      ),
    { text, language },
  );
  await expect(page.locator('.code-node')).toBeVisible();
}
const json = (page: Page) =>
  page.evaluate(() => (window as any).__mojian.editor.getJSON());
const markdown = (page: Page) =>
  page.evaluate(() => (window as any).__mojian.editor.getMarkdown());

test('fold analysis ignores braces in quoted strings and supports comments, JSON, indentation and tags', () => {
  const regions = findCodeFolds(source, 'javascript');
  expect(regions).toHaveLength(2);
  expect(regions.map((r) => source.slice(r.from, r.to))).toContain(
    '\n    console.log(data);\n  ',
  );
  expect(
    findCodeFolds(
      '/* comment\nsecond line */\nconst text = "{\\"}";',
      'javascript',
    ),
  ).toHaveLength(1);
  expect(
    findCodeFolds('{\n  "key": [\n    "}",\n    "value"\n  ]\n}', 'json'),
  ).toHaveLength(2);
  expect(
    findCodeFolds(
      'def outer():\n    if value:\n        return value\n    return None\nnext_value = 1',
      'python',
    ),
  ).toHaveLength(2);
  expect(
    findCodeFolds(
      '<div>\n  <section>\n    <br>\n    text\n  </section>\n</div>',
      'html',
    ),
  ).toHaveLength(2);
  expect(findCodeFolds('const unfinished = {\n', 'javascript')).toEqual([]);
  expect(findCodeFolds('x'.repeat(200001), 'javascript')).toEqual([]);
});

test('line numbers update with editing, use larger traffic lights and keep the native caret', async ({
  page,
}) => {
  await ready(page, 'first\nsecond\nthird');
  await expect(page.locator('.code-traffic-lights i').first()).toHaveCSS(
    'width',
    '12px',
  );
  await expect(page.locator('.code-gutter-row')).toHaveCount(3);
  expect(
    await page
      .locator('.code-gutter-row')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-line'))),
  ).toEqual(['1', '2', '3']);
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection(1);
    e.view.focus();
  });
  await page.keyboard.press('Enter');
  await expect(page.locator('.code-gutter-row')).toHaveCount(4);
  await expect(page.locator('.editor-text-cursor')).toHaveCount(0);
  await expect(page.locator('.code-node pre')).toHaveCSS(
    'caret-color',
    'rgb(36, 41, 46)',
  );
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.code-gutter-row')).toHaveCount(3);
});

test('nested folds preserve complete source, raw copy, download and undo', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page);
  const original = await json(page),
    originalMarkdown = await markdown(page);
  const inner = page.getByRole('button', {
    name: '折叠第 3–5 行代码',
    exact: true,
  });
  await inner.click();
  await expect(page.locator('.code-fold-placeholder')).toHaveCount(1);
  const frame = (await page.locator('.code-node').boundingBox())!;
  await page.screenshot({
    path: '/tmp/mojian-code-final-detail.png',
    clip: {
      x: frame.x - 10,
      y: frame.y - 10,
      width: frame.width + 20,
      height: frame.height + 20,
    },
    caret: 'initial',
  });
  expect(
    await page
      .locator('.code-gutter-row')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-line'))),
  ).toEqual(['1', '2', '3', '6']);
  await page
    .getByRole('button', { name: '折叠第 1–6 行代码', exact: true })
    .click();
  await expect(page.locator('.code-gutter-row')).toHaveCount(1);
  expect(await json(page)).toEqual(original);
  expect(await markdown(page)).toBe(originalMarkdown);
  await page.getByRole('button', { name: '复制代码', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    source,
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载源码', exact: true }).click();
  let text = '';
  for await (const chunk of (await (await download).createReadStream())!)
    text += chunk.toString();
  expect(text).toBe(source);
  await page
    .getByRole('button', { name: '展开第 1–6 行代码', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '展开第 3–5 行代码', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '展开此处代码', exact: true }).click();
  await expect(page.locator('.code-fold-placeholder')).toHaveCount(0);
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection(1);
    e.view.focus();
  });
  await page.keyboard.type('prefix');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await json(page)).toEqual(original);
});

test('moving into folded text reveals it and deletion at a fold expands before removing source', async ({
  page,
}) => {
  await ready(page);
  const original = await json(page);
  await page
    .getByRole('button', { name: '折叠第 1–6 行代码', exact: true })
    .click();
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection(30);
    e.view.focus();
  });
  await expect(page.locator('.code-fold-placeholder')).toHaveCount(0);
  await page
    .getByRole('button', { name: '折叠第 1–6 行代码', exact: true })
    .click();
  await page.evaluate(
    (pos) => {
      const e = (window as any).__mojian.editor;
      e.commands.setTextSelection(pos);
      e.view.focus();
    },
    source.indexOf('{') + 2,
  );
  await page.keyboard.press('Delete');
  await expect(page.locator('.code-fold-placeholder')).toHaveCount(0);
  expect(await json(page)).toEqual(original);
});

test('folds map across edits in earlier code and collapse all does not replace local folding', async ({
  page,
}) => {
  await ready(page, '// first\n' + source);
  await page
    .getByRole('button', { name: '折叠第 2–7 行代码', exact: true })
    .click();
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection(1);
    e.commands.insertContent('\n');
  });
  await expect(
    page.getByRole('button', { name: '展开第 3–8 行代码', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '折叠代码', exact: true }).click();
  await expect(page.locator('.code-viewport')).toBeHidden();
  await page.getByRole('button', { name: '展开代码', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '展开第 3–8 行代码', exact: true }),
  ).toBeVisible();
});

test('long code has bounded height, a virtual gutter, and supports pointer and keyboard resizing', async ({
  page,
}) => {
  await ready(
    page,
    Array.from({ length: 2000 }, (_, i) => `const value_${i} = ${i};`).join(
      '\n',
    ),
  );
  const viewport = page.locator('.code-viewport'),
    handle = page.getByRole('separator', { name: '调整代码块高度' });
  await expect
    .poll(async () => Math.round((await viewport.boundingBox())!.height))
    .toBe(360);
  expect(await page.locator('.code-gutter-row').count()).toBeLessThan(30);
  await viewport.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    page.locator('.code-gutter-row[data-line="2000"]'),
  ).toBeVisible();
  expect(await page.locator('.code-gutter-row').count()).toBeLessThan(30);
  const before = await json(page);
  await handle.focus();
  await page.keyboard.press('Home');
  await expect
    .poll(async () => Math.round((await viewport.boundingBox())!.height))
    .toBe(96);
  await page.keyboard.press('End');
  const maximum = Math.floor(1000 * 0.7);
  await expect
    .poll(async () => Math.round((await viewport.boundingBox())!.height))
    .toBe(maximum);
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 200, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await viewport.boundingBox())!.height)
    .toBeLessThan(maximum - 100);
  expect(await json(page)).toEqual(before);
  await handle.dblclick();
  await expect
    .poll(async () => Math.round((await viewport.boundingBox())!.height))
    .toBe(360);
  await page.screenshot({
    path: '/tmp/mojian-code-tools-desktop.png',
    caret: 'initial',
  });
});

test('language dropdown selects common syntax and keeps custom language input', async ({
  page,
}) => {
  await ready(page);
  const dropdown = page.getByRole('combobox', { name: '代码语言' });
  await dropdown.focus();
  await dropdown.fill('python');
  await dropdown.press('Enter');
  await expect(page.getByRole('combobox', { name: '代码语言' })).toHaveValue(
    'python',
  );
  expect(await markdown(page)).toContain('```python');
  await page.getByRole('combobox', { name: '代码语言' }).fill('custom-lang');
  await dropdown.press('Enter');
  await expect(dropdown).toHaveValue('custom-lang');
  await dropdown.fill('json');
  await dropdown.press('Enter');
  await expect(
    page.getByRole('button', { name: '格式化 JSON', exact: true }),
  ).toBeVisible();
});

test('code tools fit mobile width and resize without page overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, source.repeat(10));
  await expect(page.locator('.code-traffic-lights i').first()).toHaveCSS(
    'width',
    '10px',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('combobox', { name: '代码语言' }).fill('java');
  await page.getByRole('combobox', { name: '代码语言' }).press('Enter');
  const handle = page.getByRole('separator', { name: '调整代码块高度' });
  await handle.focus();
  await page.keyboard.press('End');
  expect(
    (await page.locator('.code-viewport').boundingBox())!.height,
  ).toBeLessThanOrEqual(844 * 0.7 + 1);
  await page.screenshot({
    path: '/tmp/mojian-code-tools-mobile.png',
    caret: 'initial',
  });
});

test('selecting and copying folded code includes hidden source without line numbers or placeholders', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page);
  await page
    .getByRole('button', { name: '折叠第 1–6 行代码', exact: true })
    .click();
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection(1);
    e.view.focus();
  });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    source,
  );
  await page.keyboard.press('ControlOrMeta+x');
  await expect(page.locator('.code-fold-placeholder')).toHaveCount(0);
  await expect(page.locator('.code-node pre')).toHaveText('');
  await page.keyboard.press('ControlOrMeta+z');
  expect((await json(page)).content[0].content[0].text).toBe(source);
});

test('changing the language reveals folded content and keeps code unchanged', async ({
  page,
}) => {
  await ready(page);
  await page
    .getByRole('button', { name: '折叠第 1–6 行代码', exact: true })
    .click();
  await page.getByRole('combobox', { name: '代码语言' }).fill('python');
  await page.getByRole('combobox', { name: '代码语言' }).press('Enter');
  await expect(page.locator('.code-fold-placeholder')).toHaveCount(0);
  expect((await json(page)).content[0].content[0].text).toBe(source);
});

test('canceling a height drag restores the original viewport height without changing source', async ({
  page,
}) => {
  await ready(page, source.repeat(20));
  const before = await json(page),
    viewport = page.locator('.code-viewport');
  const handle = page.getByRole('separator', { name: '调整代码块高度' });
  const original = (await viewport.boundingBox())!.height;
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 100, { steps: 4 });
  await expect
    .poll(async () => (await viewport.boundingBox())!.height)
    .toBeLessThan(original);
  await handle.dispatchEvent('pointercancel', {
    pointerId: 1,
    pointerType: 'mouse',
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await viewport.boundingBox())!.height)
    .toBe(original);
  expect(await json(page)).toEqual(before);
});

test('focusing language shows searchable choices without an arrow and Escape preserves the selected syntax', async ({
  page,
}) => {
  await ready(page);
  const input = page.getByRole('combobox', { name: '代码语言' });
  await input.focus();
  await expect(
    page.getByRole('listbox', { name: '代码语言候选' }),
  ).toBeVisible();
  await expect(page.locator('.code-language-picker svg')).toHaveCount(0);
  await input.fill('jvscr');
  await expect(
    page.getByRole('listbox', { name: '代码语言候选' }).getByRole('option'),
  ).toHaveCount(1);
  await expect(
    page.getByRole('listbox', { name: '代码语言候选' }).getByRole('option'),
  ).toContainText('JavaScript');
  await input.press('Escape');
  await expect(input).toHaveValue('javascript');
  expect((await json(page)).content[0].attrs.language).toBe('javascript');
  await input.fill('java');
  await input.press('Enter');
  expect((await json(page)).content[0].attrs.language).toBe('java');
  await input.fill('py');
  await page
    .getByRole('listbox', { name: '代码语言候选' })
    .getByRole('option')
    .filter({ hasText: 'Python' })
    .click();
  expect((await json(page)).content[0].attrs.language).toBe('python');
});

for (const index of [0, 1, 2])
  test(`clicking after code line ${index + 1} selects the following line, or stays on the last line`, async ({
    page,
  }) => {
    const text = 'const alpha = 1;\nconst beta = 2;\nconst gamma = 3;';
    await ready(page, text);
    const offset = text.indexOf(['alpha', 'beta', 'gamma'][index]) + 2;
    const expectedOffset =
      text.indexOf(['alpha', 'beta', 'gamma'][Math.min(index + 1, 2)]) + 2;
    const coords = await page.evaluate((offset) => {
      const e = (window as any).__mojian.editor;
      const pre = document.querySelector('.code-node pre')!;
      const style = getComputedStyle(pre),
        rect = pre.getBoundingClientRect();
      return {
        x: e.view.coordsAtPos(offset + 1).left,
        top: rect.top,
        padding: parseFloat(style.paddingTop),
        height: parseFloat(style.lineHeight),
      };
    }, offset);
    await page.mouse.click(
      coords.x + 0.1,
      coords.top + coords.padding + (index + 1) * coords.height - 0.25,
    );
    await page.keyboard.insertText('X');
    expect((await json(page)).content[0].content[0].text).toBe(
      text.slice(0, expectedOffset) + 'X' + text.slice(expectedOffset),
    );
    await page.keyboard.press('ControlOrMeta+z');
    expect((await json(page)).content[0].content[0].text).toBe(text);
  });

test('GitHub light syntax colors agree between the editor and article preview', async ({
  page,
}) => {
  await ready(page, '// comment\nconst text = "hello";\nconst number = 42;');
  await expect(page.locator('.code-node')).toHaveClass(/code-theme-github/);
  await expect(page.locator('.code-node')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await expect(page.locator('.code-node .hljs-keyword').first()).toHaveCSS(
    'color',
    'rgb(215, 58, 73)',
  );
  await expect(page.locator('.code-node .hljs-string')).toHaveCSS(
    'color',
    'rgb(3, 47, 98)',
  );
  await expect(page.locator('.code-node .hljs-comment')).toHaveCSS(
    'color',
    'rgb(106, 115, 125)',
  );
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  const card = page.locator('.preview-paper [data-code-block]');
  await expect(card.getByText('const', { exact: true }).first()).toHaveCSS(
    'color',
    'rgb(215, 58, 73)',
  );
  await expect(card.getByText('"hello"', { exact: true })).toHaveCSS(
    'color',
    'rgb(3, 47, 98)',
  );
});

test('code selection can still be dragged across lines and horizontal scrolling keeps the gutter fixed', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const text =
    'const first = "' +
    'x'.repeat(200) +
    '";\nconst second = 2;\nconst third = 3;';
  await ready(page, text);
  const coords = await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    return {
      from: e.view.coordsAtPos(4),
      to: e.view.coordsAtPos(
        e.state.doc.firstChild.textContent.indexOf('third') + 3,
      ),
    };
  });
  await page.mouse.move(coords.from.left, coords.from.top + 5);
  await page.mouse.down();
  await page.mouse.move(coords.to.left, coords.to.top + 5, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('ControlOrMeta+c');
  const selected = await page.evaluate(() => navigator.clipboard.readText());
  expect(selected).toContain('second');
  expect(selected).not.toContain('…');
  const before = (await page.locator('.code-gutter').boundingBox())!.x;
  await page.locator('.code-viewport').evaluate((el) => {
    el.scrollLeft = 100;
  });
  await expect
    .poll(async () => (await page.locator('.code-gutter').boundingBox())!.x)
    .toBeCloseTo(before, 0);
  await expect(page.locator('.code-viewport')).toHaveCSS(
    'scrollbar-width',
    'thin',
  );
});

test('a filtered selector above the input remains anchored beside the field', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 430 });
  await ready(page);
  const input = page.getByRole('combobox', { name: '代码语言' });
  await input.focus();
  await input.fill('jvscr');
  const menu = page.getByRole('listbox', { name: '代码语言候选' });
  await expect(menu.getByRole('option')).toHaveCount(1);
  const a = (await input.boundingBox())!,
    b = (await menu.boundingBox())!;
  expect(a.y - (b.y + b.height)).toBeGreaterThanOrEqual(4);
  expect(a.y - (b.y + b.height)).toBeLessThan(10);
  await input.press('Escape');
  expect((await json(page)).content[0].attrs.language).toBe('javascript');
});
