import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function expectVisibleText(page: Page, text: string) {
  await expect
    .poll(() =>
      page.locator('.article-editor').evaluate((element) => {
        const clone = element.cloneNode(true) as HTMLElement;
        const original = element.querySelectorAll('.highlight-delimiter');
        clone
          .querySelectorAll('.highlight-delimiter')
          .forEach((delimiter, index) => {
            // Collapsed text can retain a subpixel width with Linux font metrics.
            if (
              original[index].getBoundingClientRect().width < 1 &&
              getComputedStyle(original[index]).color === 'rgba(0, 0, 0, 0)'
            )
              delimiter.remove();
          });
        return clone.textContent;
      }),
    )
    .toBe(text);
}

test('Typora highlights survive Markdown round trips and publication output', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const markdown =
    '正文==重点==，==**加粗**与*斜体*==。\n\n`==行内代码==`\n\n```js\nconst text = "==代码块==";\n```\n\n\\=\\=字面等号\\=\\=，== 未闭合';
  await page.evaluate(
    (text) => (window as any).__mojian.setMarkdown(text),
    markdown,
  );
  expect(await page.locator('.article-editor mark').allTextContents()).toEqual([
    '重点',
    '加粗',
    '与',
    '斜体',
  ]);
  await expect(
    page.locator('.article-editor mark strong, .article-editor strong mark'),
  ).toHaveText('加粗');
  await expect(
    page.locator('.article-editor mark em, .article-editor em mark'),
  ).toHaveText('斜体');
  await expect(page.locator('.article-editor code mark')).toHaveCount(0);
  await expect(page.locator('.article-editor')).toContainText('==字面等号==');
  await page
    .getByRole('button', { name: 'Markdown 源码', exact: true })
    .click();
  const source = page.getByRole('textbox', { name: 'Markdown 源码正文' });
  expect(await source.inputValue()).toContain('==重点==');
  await page.getByRole('button', { name: '所见即所得', exact: true }).click();
  await page.evaluate(() => {
    const m = (window as any).__mojian;
    m.setMarkdown(m.editor.getMarkdown());
  });
  expect(await page.locator('.article-editor mark').allTextContents()).toEqual([
    '重点',
    '加粗',
    '与',
    '斜体',
  ]);
  await page.waitForFunction(() => {
    const m = (window as any).__mojian;
    return (
      m.getOutput()?.key === JSON.stringify([m.getMarkdown(), m.getSettings()])
    );
  });
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('.preview-paper mark')).toHaveText([
    '重点',
    '加粗与斜体',
  ]);
  await expect(page.locator('.preview-paper mark').first()).toHaveCSS(
    'background-color',
    'rgb(255, 243, 163)',
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, 'write', {
      configurable: true,
      value: async (items: ClipboardItem[]) => {
        (window as any).__highlightClipboard = await (
          await items[0].getType('text/html')
        ).text();
      },
    }),
  );
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('已复制排版内容');
  const html = await page.evaluate(
    () => (window as any).__highlightClipboard as string,
  );
  const copied = await page.evaluate((html) => {
    const root = new DOMParser().parseFromString(html, 'text/html');
    const mark = root.querySelector('mark')!;
    return { text: mark.textContent, color: mark.style.backgroundColor };
  }, html);
  expect(copied).toEqual({ text: '重点', color: 'rgb(255, 243, 163)' });
});

test('equals in a link URL do not hide later editor and publication highlights', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const markdown = '[链接](https://example.com/?q==x) ==重点==';
  await page.evaluate(
    (text) => (window as any).__mojian.setMarkdown(text),
    markdown,
  );
  await expect(page.locator('.article-editor mark')).toHaveText('重点');
  await page.waitForFunction(() => {
    const app = (window as any).__mojian;
    return (
      app.getOutput()?.key ===
      JSON.stringify([app.getMarkdown(), app.getSettings()])
    );
  });
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('.preview-paper mark')).toHaveText('重点');
  expect(
    await page.evaluate(() => (window as any).__mojian.getOutput().html),
  ).toContain('<mark');
});

test('typing and pasting double equals creates highlights; code and rich HTML remain intact', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => (window as any).__mojian.setMarkdown(''));
  await page.locator('.article-editor').click();
  await page.keyboard.type('正文==important a=b==');
  await expect(page.locator('.article-editor mark')).toHaveText(
    'important a=b',
  );
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor mark')).toHaveCount(0);
  for (const html of ['', '<p><mark>粘贴高亮</mark></p>']) {
    await page.evaluate(() => {
      const m = (window as any).__mojian;
      m.setMarkdown('');
      m.editor.commands.focus();
    });
    await page.evaluate((html) => {
      const data = new DataTransfer();
      data.setData('text/plain', html ? '粘贴高亮' : '==粘贴高亮==');
      if (html) data.setData('text/html', html);
      (window as any).__mojian.editor.view.dom.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, html);
    await expect(page.locator('.article-editor mark')).toHaveText('粘贴高亮');
  }
  await page.evaluate(() => {
    const m = (window as any).__mojian;
    m.setMarkdown('```txt\n\n```');
    m.editor.commands.focus(1);
  });
  await page.keyboard.type('==code==');
  await expect(page.locator('.article-editor code mark')).toHaveCount(0);
  await expect(page.locator('.article-editor pre')).toHaveText('==code==');
});

test('highlights work in headings, lists and tables on mobile without leaking into labels', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown(
      '# ==高亮标题==\n\n- ==列表重点==\n\n| 内容 |\n| --- |\n| ==表格重点== |',
    ),
  );
  await expect(page.locator('.article-editor mark')).toHaveText([
    '高亮标题',
    '列表重点',
    '表格重点',
  ]);
  const roundtrip = await page.evaluate(() => {
    const editor = (window as any).__mojian.editor;
    const before = editor.getJSON();
    editor.commands.setContent(editor.markdown.parse(editor.getMarkdown()));
    return { before, after: editor.getJSON() };
  });
  expect(roundtrip.after).toEqual(roundtrip.before);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await expect(page.locator('.sidebar-outline>button')).toHaveText('高亮标题');
  await page.getByRole('button', { name: '折叠侧栏', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );

  expect(errors).toEqual([]);
});

test('adding opening equals after closing equals highlights existing text and supports undo', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown('前面 **重点** 后面'),
  );
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus(6));
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.type('==');
  await expect(page.locator('.article-editor')).toContainText('重点==');
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus(4));
  await page.keyboard.type('==');
  await expect(page.locator('.article-editor mark')).toHaveText('重点');
  await expect(page.locator('.article-editor strong mark')).toHaveText('重点');
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
  ).toBe('前面 ==**重点**== 后面');
  await page.evaluate(() =>
    (window as any).__mojian.editor.commands.focus('end'),
  );
  await expectVisibleText(page, '前面 重点 后面');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor mark')).toHaveCount(0);
  await expect(page.locator('.article-editor')).toContainText('重点==');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.article-editor mark')).toHaveText('重点');
});

for (const native of [false, true])
  test(`pasted equals in rich HTML highlight while preserving formatting (${native ? 'internal' : 'external'})`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    await page.evaluate(() => {
      const m = (window as any).__mojian;
      m.setMarkdown('');
      m.editor.commands.focus();
    });
    await page.evaluate((native) => {
      const data = new DataTransfer();
      data.setData('text/plain', '前面 ==重点== 和 ==另一处== 后面 ==代码==');
      data.setData(
        'text/html',
        `<p${native ? ' data-pm-slice="1 1 []"' : ''}>前面 ==<strong>重点</strong>== 和 ==另一处== 后面 <code>==代码==</code></p>`,
      );
      (window as any).__mojian.editor.view.dom.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, native);
    await expect(page.locator('.article-editor mark')).toHaveText([
      '重点',
      '另一处',
    ]);
    await expect(page.locator('.article-editor strong')).toHaveText('重点');
    await expect(page.locator('.article-editor code')).toHaveText('==代码==');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.article-editor mark')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.locator('.article-editor mark')).toHaveText([
      '重点',
      '另一处',
    ]);
  });

test('highlight paste respects code destinations and the plain-text shortcut', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  for (const mode of ['codeBlock', 'code', 'plain']) {
    await page.evaluate((mode) => {
      const m = (window as any).__mojian;
      m.setMarkdown(
        mode === 'codeBlock'
          ? '```txt\n内容\n```'
          : mode === 'code'
            ? '`内容`'
            : '',
      );
      m.editor.commands.focus(mode === 'plain' ? 1 : 2);
      if (mode === 'plain')
        m.editor.view.dom.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'v',
            ctrlKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      const data = new DataTransfer();
      data.setData('text/plain', '==字面文本==');
      data.setData('text/html', '<p><strong>==字面文本==</strong></p>');
      m.editor.view.dom.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, mode);
    await expect(page.locator('.article-editor mark')).toHaveCount(0);
    await expect(page.locator('.article-editor')).toContainText('==字面文本==');
  }
});

for (const width of [1440, 390])
  test(`toolbar highlight toggles selection, reflects caret state and supports typing at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    await page.evaluate(() => {
      const m = (window as any).__mojian;
      m.setMarkdown('前面 重点 后面');
      m.editor.commands.setTextSelection({ from: 4, to: 6 });
      m.editor.commands.focus();
    });
    const button = page
      .getByRole('toolbar', { name: '正文格式' })
      .getByRole('button', { name: '高亮', exact: true });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await button.click();
    await expect(page.locator('.article-editor mark')).toHaveText('重点');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(
      await page.evaluate(() => {
        const s = (window as any).__mojian.editor.state.selection;
        return { from: s.from, to: s.to };
      }),
    ).toEqual({ from: 6, to: 8 });
    expect(
      await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
    ).toContain('==重点==');
    await button.click();
    await expect(page.locator('.article-editor mark')).toHaveCount(0);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.article-editor mark')).toHaveText('重点');
    await page.evaluate(() =>
      (window as any).__mojian.editor.commands.focus(2),
    );
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() =>
      (window as any).__mojian.editor.commands.focus(7),
    );
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() =>
      (window as any).__mojian.editor.commands.focus('end'),
    );
    await button.click();
    await page.keyboard.type('new');
    await expect(page.locator('.article-editor mark')).toHaveText([
      '重点',
      'new',
    ]);
    await page.evaluate(() =>
      (window as any).__mojian.editor.commands.focus(1),
    );
    await expectVisibleText(page, '前面 重点 后面new');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    expect(errors).toEqual([]);
  });

for (const width of [1440, 390])
  test(`entering a highlight reveals editable delimiters without changing source or undo at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    const markdown = '前==第一处==中==第二处==后';
    await page.evaluate((text) => {
      const m = (window as any).__mojian;
      m.setMarkdown(text);
      (window as any).__highlightUpdates = 0;
      m.editor.on('update', () => (window as any).__highlightUpdates++);
    }, markdown);
    await expectVisibleText(page, '前第一处中第二处后');
    await page.locator('.article-editor mark').first().click();
    await expect(page.locator('.highlight-delimiter.expanded')).toHaveCount(2);
    await expectVisibleText(page, '前==第一处==中第二处后');
    await expect(
      page.locator('.highlight-delimiter.expanded').first(),
    ).toHaveText('==');
    // The equals are real editable characters, rather than CSS-generated text.
    await page.evaluate(() => {
      const e = (window as any).__mojian.editor;
      e.commands.setTextSelection({ from: 2, to: 4 });
    });
    await page.keyboard.press('Backspace');
    await expect(page.locator('.article-editor mark')).toHaveText('中');
    expect(
      await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
    ).toBe('前第一处==中==第二处==后');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.article-editor mark')).toHaveText([
      '第一处',
      '第二处',
    ]);
    expect(
      await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
    ).toBe(markdown);
    expect(await page.evaluate(() => (window as any).__highlightUpdates)).toBe(
      2,
    );
    await page.locator('.article-editor mark').last().click();
    await expectVisibleText(page, '前第一处中==第二处==后');
    await page
      .getByRole('button', { name: 'Markdown 源码', exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: 'Markdown 源码正文' }),
    ).toHaveValue(markdown);
    await page.getByRole('button', { name: '所见即所得', exact: true }).click();
    await expect(page.locator('.highlight-delimiter.expanded')).toHaveCount(0);
    await expectVisibleText(page, '前第一处中第二处后');
    expect(errors).toEqual([]);

    await page.locator('.article-editor mark').first().click();
  });

test('highlight pairs match Typora from left to right, including adjacent and repeated equals', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const cases = [
    ['前==甲==中==乙==后', ['甲', '乙'], '前甲中乙后'],
    ['前==甲====乙==后', ['甲', '乙'], '前甲乙后'],
    ['前===甲===后', ['=甲'], '前=甲=后'],
    ['前====甲==后', ['==甲'], '前==甲后'],
    ['前==甲=====乙==后', ['甲', '=乙'], '前甲=乙后'],
    ['前==甲==乙==后', ['甲'], '前甲乙==后'],
    ['空前== 甲==和==乙 ==后', ['和'], '空前== 甲和乙 ==后'],
    ['四个====后', [], '四个====后'],
    ['前=====后', ['='], '前=后'],
    ['======', ['='], '=='],
    ['=====甲==', ['='], '=甲=='],
    ['=======甲==', ['=', '甲'], '=甲'],
  ] as const;
  for (const [markdown, marks, visible] of cases) {
    await page.evaluate(
      (text) => (window as any).__mojian.setMarkdown(text),
      markdown,
    );
    expect(
      await page.locator('.article-editor mark').allTextContents(),
    ).toEqual(marks);
    await expectVisibleText(page, visible);
    expect(
      await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
    ).toBe(markdown);
    await page.waitForFunction(() => {
      const m = (window as any).__mojian;
      return (
        m.getOutput()?.key ===
        JSON.stringify([m.getMarkdown(), m.getSettings()])
      );
    });
    const preview = await page.evaluate(() => {
      const html = (window as any).__mojian.getOutput().previewHTML;
      const root = new DOMParser().parseFromString(html, 'text/html');
      return Array.from(
        root.querySelectorAll('mark'),
        (mark) => mark.textContent,
      );
    });
    expect(preview).toEqual(marks);
    const copied = await page.evaluate(() => {
      const html = (window as any).__mojian.getOutput().html;
      const root = new DOMParser().parseFromString(html, 'text/html');
      return Array.from(
        root.querySelectorAll('mark'),
        (mark) => mark.textContent,
      );
    });
    expect(copied).toEqual(marks);
  }
});

test('arrow entry, deleting a closing delimiter and typing after a pair use the source boundaries', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => {
    const m = (window as any).__mojian;
    m.setMarkdown('前==甲==后');
    m.editor.commands.focus(2);
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.highlight-delimiter.expanded')).toHaveCount(2);
  expect(
    await page.evaluate(
      () => (window as any).__mojian.editor.state.selection.from,
    ),
  ).toBe(4);
  await page.evaluate(() =>
    (window as any).__mojian.editor.commands.setTextSelection(7),
  );
  await page.keyboard.press('ArrowLeft');
  expect(
    await page.evaluate(
      () => (window as any).__mojian.editor.state.selection.from,
    ),
  ).toBe(6);
  await page.evaluate(() =>
    (window as any).__mojian.editor.commands.setTextSelection(7),
  );
  await page.keyboard.type('new');
  await expect(page.locator('.article-editor mark')).toHaveText('甲');
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
  ).toBe('前==甲==new后');
  await page.evaluate(() =>
    (window as any).__mojian.editor.commands.setTextSelection(7),
  );
  await page.keyboard.press('Backspace');
  await expect(page.locator('.article-editor mark')).toHaveCount(0);
  await expectVisibleText(page, '前==甲=new后');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor mark')).toHaveText('甲');
});

test('soft line breaks can be highlighted while paragraphs, escaped equals and code retain their boundaries', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const markdown =
    '前==跨行\n第二行==后\n\n独立==未闭合\n\n下一段==尾部\n\n\\=\\=字面\\=\\=\n\n`==代码==`\n\n```txt\n==代码块==\n\\=代码转义\n```';
  await page.evaluate(
    (text) => (window as any).__mojian.setMarkdown(text),
    markdown,
  );
  await expect(page.locator('.article-editor mark')).toHaveCount(1);
  await expect(page.locator('.article-editor mark')).toContainText('跨行');
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
  ).toContain('\\=\\=字面\\=\\=');
  const before = await page.evaluate(() =>
    (window as any).__mojian.editor.getMarkdown(),
  );
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setContent(e.markdown.parse(e.getMarkdown()));
  });
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
  ).toBe(before);
  await expect(page.locator('.article-editor code mark')).toHaveCount(0);
  await expect(page.locator('.article-editor pre')).toContainText(
    '\\=代码转义',
  );
});

test('mapped highlights stay editable after earlier blocks shift and inline code formatting changes', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => {
    const m = (window as any).__mojian;
    m.setMarkdown('==第一处==\n\n==第二处==\n\n最后');
    m.editor.commands.setTextSelection(1);
    m.editor.commands.insertContent('前缀');
  });
  await page.locator('.article-editor mark').nth(1).click();
  await expect(page.locator('.highlight-delimiter.expanded')).toHaveCount(2);
  await page.keyboard.insertText('中文');
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
  ).toMatch(/==第?中文/);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor mark')).toHaveText([
    '第一处',
    '第二处',
  ]);
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setTextSelection({ from: 3, to: 10 });
    e.commands.toggleCode();
  });
  await expect(page.locator('.article-editor mark')).toHaveText('第二处');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor mark')).toHaveText([
    '第一处',
    '第二处',
  ]);
});

test('typed escapes and highlight mixed with inherited bold serialize without changing publication meaning', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => {
    const m = (window as any).__mojian;
    m.setMarkdown('');
    m.editor.commands.focus();
  });
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.type('\\==literal\\==');
  await expect(page.locator('.article-editor mark')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
  ).toBe('\\==literal\\==');
  await page.evaluate(() => {
    const m = (window as any).__mojian;
    m.setMarkdown('**==粗体高亮==**');
  });
  expect(
    await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
  ).toBe('==**粗体高亮**==');
  await page.evaluate(() => {
    const e = (window as any).__mojian.editor;
    e.commands.setContent(e.markdown.parse(e.getMarkdown()));
  });
  await expect(
    page.locator('.article-editor strong mark, .article-editor mark strong'),
  ).toHaveText('粗体高亮');
});

test('dense paragraphs preserve every pair when typing, revealing all syntax and deleting a delimiter', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const markdown = Array.from(
    { length: 300 },
    (_, i) => `前==重点${i}==后`,
  ).join('，');
  await page.evaluate(
    (text) => (window as any).__mojian.setMarkdown(text),
    markdown,
  );
  await expect(page.locator('.article-editor mark')).toHaveCount(300);
  await page.locator('.article-editor mark').first().click();
  await page.keyboard.type('new');
  await expect(page.locator('.article-editor mark').first()).toContainText(
    'new',
  );
  await expect(page.locator('.article-editor mark')).toHaveCount(300);
  await page.evaluate(() =>
    (window as any).__mojian.editor.commands.selectAll(),
  );
  await expect(page.locator('.highlight-delimiter.expanded')).toHaveCount(600);
  await page.evaluate(() =>
    (window as any).__mojian.editor.commands.setTextSelection({
      from: 2,
      to: 4,
    }),
  );
  await page.keyboard.press('Backspace');
  await expect(page.locator('.article-editor mark')).toHaveCount(299);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor mark')).toHaveCount(300);
  await page.evaluate(() =>
    (window as any).__mojian.editor.commands.focus('end'),
  );
  await expect(page.locator('.highlight-delimiter.expanded')).toHaveCount(0);
});

test('imported HTML highlights keep literal equals inside their content', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  for (const via of ['markdown', 'paste']) {
    await page.evaluate((via) => {
      const m = (window as any).__mojian;
      const html = '<p><mark><strong>==字面等号==</strong></mark></p>';
      if (via === 'markdown') m.setMarkdown(html);
      else {
        m.setMarkdown('');
        m.editor.commands.setTextSelection(1);
        const data = new DataTransfer();
        data.setData('text/plain', '==字面等号==');
        data.setData('text/html', html);
        m.editor.view.dom.dispatchEvent(
          new ClipboardEvent('paste', {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    }, via);
    expect(
      (await page.locator('.article-editor mark').allTextContents()).join(''),
    ).toBe('==字面等号==');
    await expect(page.locator('.article-editor strong')).toHaveText(
      '==字面等号==',
    );
    const markdown = await page.evaluate(() =>
      (window as any).__mojian.editor.getMarkdown(),
    );
    expect(markdown).toContain('==**\\=\\=字面等号\\=\\=**==');
    await page.evaluate(() => {
      const e = (window as any).__mojian.editor;
      e.commands.setContent(e.markdown.parse(e.getMarkdown()));
    });
    expect(
      (await page.locator('.article-editor mark').allTextContents()).join(''),
    ).toBe('==字面等号==');
  }
});

for (const width of [1440, 390])
  test(`closing equals stay visible with the caret after them at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page).toHaveTitle('墨笺 · Markdown 公众号排版');
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await page.waitForFunction(() => !!(window as any).__mojian?.editor);
    await page.evaluate(() => {
      const m = (window as any).__mojian;
      m.setMarkdown('');
      m.editor.commands.focus();
    });
    const editor = page.locator('.article-editor');
    await expect(editor).toBeFocused();
    await page.keyboard.type('==');
    await page.keyboard.insertText('测试');
    await page.keyboard.type('=');
    await expect(editor.locator('mark')).toHaveCount(0);
    await page.keyboard.type('=');
    await expect(editor.locator('mark')).toHaveText('测试');
    await expect(editor.locator('.highlight-delimiter.expanded')).toHaveText([
      '==',
      '==',
    ]);
    await expectVisibleText(page, '==测试==');
    const caret = await page.evaluate(() => {
      const e = (window as any).__mojian.editor;
      const selection = window.getSelection()!;
      const range = selection.getRangeAt(0).getBoundingClientRect();
      const delimiters = e.view.dom.querySelectorAll(
        '.highlight-delimiter.expanded',
      );
      const closing = delimiters[delimiters.length - 1].getBoundingClientRect();
      return {
        position: e.state.selection.from,
        empty: e.state.selection.empty,
        nativePosition: e.view.posAtDOM(
          selection.focusNode!,
          selection.focusOffset,
        ),
        height: range.height,
        closingGap: Math.abs(range.left - closing.right),
        markdown: e.getMarkdown(),
      };
    });
    expect(caret).toMatchObject({
      position: 7,
      nativePosition: 7,
      empty: true,
      markdown: '==测试==',
    });
    expect(caret.height).toBeGreaterThan(10);
    expect(caret.closingGap).toBeLessThan(1);
    // The caret is outside the highlight: further input must stay unhighlighted.
    await expect(
      page
        .getByRole('toolbar', { name: '正文格式' })
        .getByRole('button', { name: '高亮', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__mojian.editor.state.selection.from,
        ),
      )
      .toBe(6);
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__mojian.editor.state.selection.from,
        ),
      )
      .toBe(7);
    await page.keyboard.insertText('后');
    await expect(editor.locator('mark')).toHaveText('测试');
    await expect(editor.locator('.highlight-delimiter.expanded')).toHaveCount(
      0,
    );
    await expectVisibleText(page, '测试后');
    expect(
      await page.evaluate(() => (window as any).__mojian.editor.getMarkdown()),
    ).toBe('==测试==后');

    await page.keyboard.press('Backspace');
    await expect(editor.locator('.highlight-delimiter.expanded')).toHaveText([
      '==',
      '==',
    ]);
    await expectVisibleText(page, '==测试==');
    await page
      .getByRole('button', { name: 'Markdown 源码', exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: 'Markdown 源码正文' }),
    ).toHaveValue('==测试==');
    await page.getByRole('button', { name: '所见即所得', exact: true }).click();
    await expect(editor).toBeFocused();
    // Mode switching restores focus asynchronously. At the closing edge the
    // delimiters must still be visible after that focus has actually settled.
    await expect(editor.locator('.highlight-delimiter.expanded')).toHaveText([
      '==',
      '==',
    ]);
    await expectVisibleText(page, '==测试==');
    expect(
      await page.evaluate(
        () => (window as any).__mojian.editor.state.selection.from,
      ),
    ).toBe(7);
    await page
      .getByRole('button', { name: '版本与更新信息', exact: true })
      .click();
    await expect(editor).not.toBeFocused();
    await expect(editor.locator('.highlight-delimiter.expanded')).toHaveCount(
      0,
    );
    await expectVisibleText(page, '测试');
    expect(errors).toEqual([]);
  });
