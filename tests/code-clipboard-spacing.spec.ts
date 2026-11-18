import { test, expect } from './fixtures';

test('consecutive code cards retain a paragraph boundary and spacing when container margins are removed', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderArticle } = await import('/src/output.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const markdown =
      '```java\nclass First {}\n```\n\n```java\nclass Second {}\n```\n\n```json\n{"third": true}\n```';
    const result = [];
    for (const dark of [false, true]) {
      const output = await renderArticle(markdown, {
        ...DEFAULT_SETTINGS,
        codeTheme: dark ? 'dark' : 'light',
      });
      for (const html of [output.previewHTML, output.html]) {
        const root = document.createElement('div');
        root.style.width = '360px';
        root.innerHTML = html;
        document.body.append(root);
        const blocks = Array.from(
          root.querySelectorAll<HTMLElement>('[data-code-block]'),
        );
        const separators = Array.from(
          root.querySelectorAll<HTMLElement>('[data-code-separator]'),
        );
        const originalGaps = blocks
          .slice(1)
          .map(
            (b, i) =>
              b.getBoundingClientRect().top -
              blocks[i].getBoundingClientRect().bottom,
          );
        // Exercise the failure condition without pretending to emulate WeChat:
        // external editors can unwrap DIVs and discard margins.
        for (const block of blocks) {
          block.style.margin = '0';
          block.replaceWith(...Array.from(block.childNodes));
        }
        const pres = Array.from(root.querySelectorAll('pre'));
        result.push({
          originalGaps,
          typography: pres.map((pre) => {
            const style = getComputedStyle(pre.querySelector('code')!);
            return { fontSize: style.fontSize, lineHeight: style.lineHeight };
          }),
          normalizedGaps: pres
            .slice(1)
            .map(
              (p, i) =>
                p.getBoundingClientRect().top -
                pres[i].getBoundingClientRect().bottom,
            ),
          boundaries: pres
            .slice(1)
            .map((p) => p.previousElementSibling?.tagName),
          separatorCount: separators.length,
          separatorText: separators.map((p) => p.textContent),
          borders: pres.map((p) => getComputedStyle(p).borderTopWidth),
          text: output.text,
        });
        root.remove();
      }
      output.dispose();
    }
    return result;
  });
  for (const sample of result) {
    expect(sample.separatorCount).toBe(2);
    expect(sample.typography).toEqual(
      Array(3).fill({ fontSize: '14px', lineHeight: '24px' }),
    );
    expect(sample.boundaries).toEqual(['P', 'P']);
    expect(sample.separatorText.every((text) => !!text?.trim())).toBe(true);
    sample.originalGaps.forEach((gap) => expect(gap).toBeCloseTo(20, 0));
    sample.normalizedGaps.forEach((gap) => expect(gap).toBeCloseTo(20, 0));
    expect(sample.borders).toEqual(['1px', '1px', '1px']);
    expect(sample.text).not.toContain('\u200b');
    expect(sample.text).toContain('class First {}');
    expect(sample.text).toContain('class Second {}');
  }
});

test('paragraphs between code cards remain intact and quote-local code gaps stay inside the quote', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderArticle } = await import('/src/output.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const output = await renderArticle(
      '```js\nfirst()\n```\n\n中间正文\n\n```js\nsecond()\n```\n\n> ```js\n> third()\n> ```\n>\n> ```js\n> fourth()\n> ```',
      DEFAULT_SETTINGS,
    );
    const root = document.createElement('div');
    root.innerHTML = output.html;
    const result = {
      separators: root.querySelectorAll('[data-code-separator]').length,
      insideQuote: root.querySelectorAll('blockquote [data-code-separator]')
        .length,
      paragraphs: Array.from(root.querySelectorAll('p')).map(
        (p) => p.textContent,
      ),
    };
    output.dispose();
    return result;
  });
  expect(result.separators).toBe(1);
  expect(result.insideQuote).toBe(1);
  expect(result.paragraphs).toContain('中间正文');
});

test('exported line numbers align across three-digit and blank lines without changing raw code', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderArticle } = await import('/src/output.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const source = Array.from({ length: 105 }, (_, i) =>
      i === 2
        ? ''
        : i === 9
          ? '\tconst tenth = 10;'
          : `const value_${i + 1} = ${i + 1};`,
    ).join('\n');
    const result = [];
    for (const codeTheme of ['light', 'dark'] as const) {
      const output = await renderArticle('```js\n' + source + '\n```', {
        ...DEFAULT_SETTINGS,
        codeTheme,
      });
      for (const html of [output.previewHTML, output.html]) {
        const root = document.createElement('div');
        root.style.width = '360px';
        root.innerHTML = html;
        document.body.append(root);
        const gutter = root.querySelector<HTMLElement>(
          '[data-code-line-number]',
        )!;
        const numbers = Array.from(
          root.querySelectorAll('[data-code-line-number]'),
        );
        const lines = Array.from(root.querySelectorAll('[data-code-line]'));
        result.push({
          numbers: numbers.map((number) => number.textContent!.trim()),
          offsets: lines.map((line, i) =>
            Math.abs(
              line.getBoundingClientRect().top -
                numbers[i].getBoundingClientRect().top,
            ),
          ),
          prefixCharacters: gutter.textContent!.length,
          hidden: gutter.getAttribute('aria-hidden'),
          sameRows: numbers.every(
            (number) =>
              number.parentElement?.querySelector('[data-code-line]') ===
              number.nextElementSibling,
          ),
          lines: lines.map((line) => line.textContent!.replace(/\u00a0/g, ' ')),
          raw: output.text,
          source,
        });
        root.remove();
      }
      output.dispose();
    }
    return result;
  });
  for (const sample of result) {
    expect(sample.numbers).toEqual(
      Array.from({ length: 105 }, (_, i) => String(i + 1)),
    );
    expect(Math.max(...sample.offsets)).toBeLessThan(0.5);
    expect(sample.prefixCharacters).toBe(5);
    expect(sample.hidden).toBe('true');
    expect(sample.sameRows).toBe(true);
    expect(sample.lines[2]).toBe(' ');
    expect(sample.lines[9]).toBe('    const tenth = 10;');
    expect(sample.raw.trim()).toBe(sample.source);
  }
});

test('row-local numbers stay aligned after a leading code paragraph is inserted and number widths are discarded', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderArticle, readableText } = await import('/src/output.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const source =
      '@GetMapping("/api/example")\npublic String example() {\n\n    return "ok";\n}';
    const output = await renderArticle(
      '```java\n' + source + '\n```',
      DEFAULT_SETTINGS,
    );
    const root = document.createElement('div');
    root.innerHTML = output.html;
    document.body.append(root);
    const empty = document.createElement('p');
    empty.append(document.createElement('br'));
    root.querySelector('code')!.prepend(empty);
    const numbers = Array.from(
      root.querySelectorAll<HTMLElement>('[data-code-line-number]'),
    );
    for (const number of numbers) {
      number.style.removeProperty('width');
      number.style.removeProperty('padding');
    }
    const lines = Array.from(root.querySelectorAll('[data-code-line]'));
    const result = {
      offsets: lines.map((line, i) =>
        Math.abs(
          line.getBoundingClientRect().top -
            numbers[i].getBoundingClientRect().top,
        ),
      ),
      gaps: lines.map(
        (line, i) =>
          line.getBoundingClientRect().left -
          numbers[i].getBoundingClientRect().left,
      ),
      joined: lines
        .map((line) => line.textContent!.replace(/\u00a0/g, ' '))
        .join('\n'),
      fallback: readableText(root),
      raw: output.text,
    };
    output.dispose();
    root.remove();
    return result;
  });
  expect(Math.max(...result.offsets)).toBeLessThan(0.5);
  expect(Math.min(...result.gaps)).toBeGreaterThan(20);
  expect(result.joined).toBe(
    '@GetMapping("/api/example")\npublic String example() {\n \n    return "ok";\n}',
  );
  expect(result.fallback).not.toContain('1\u00a0');
  expect(result.raw).toContain('public String example()');
});

test('HTML formatting newlines between code rows do not create blank visual lines', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderArticle } = await import('/src/output.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const output = await renderArticle(
      '```java\nclass Demo {\n    void hello() {\n\n        run();\n    }\n}\n```',
      DEFAULT_SETTINGS,
    );
    const root = document.createElement('div');
    root.style.width = '360px';
    root.innerHTML = output.html;
    document.body.append(root);
    const rows = Array.from(root.querySelectorAll('[data-code-row]'));
    for (const row of rows) row.before(document.createTextNode('\n    '));
    const positions = rows.map((row) => row.getBoundingClientRect().top);
    const result = {
      heights: rows.map((row) => row.getBoundingClientRect().height),
      pitch: positions.slice(1).map((y, i) => y - positions[i]),
      lines: root.querySelectorAll('[data-code-line]').length,
    };
    output.dispose();
    root.remove();
    return result;
  });
  expect(result.lines).toBe(6);
  for (const height of [...result.heights, ...result.pitch])
    expect(height).toBeCloseTo(24, 1);
});
