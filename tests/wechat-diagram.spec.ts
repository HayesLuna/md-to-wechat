import { test, expect } from './fixtures';

test('publication SVG keeps text, paint and explicit arrow geometry without ID references', async ({
  page,
}) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const { diagram } = await import('/src/mermaid.ts');
    const { wechatDiagram } = await import('/src/wechatDiagram.ts');
    const sources = [
      'flowchart LR\nA[开始] --> B{选择}\nB --> C[完成]',
      'sequenceDiagram\n用户->>服务: 请求\n服务-->>用户: 响应',
      'classDiagram\nAnimal <|-- Duck',
      'stateDiagram-v2\n[*] --> Active\nActive --> [*]',
      'erDiagram\nUSER ||--o{ ORDER : places',
      'pie title 比例\n"写作" : 60\n"排版" : 40',
      'gantt\n dateFormat YYYY-MM-DD\n section 产品\n 生效 :p1, 2024-01-01, 2024-12-31',
    ];
    const results = [];
    for (const source of sources) {
      const element = document.createElement('div');
      element.innerHTML = await diagram(source);
      const original = element.innerHTML;
      const exported = await wechatDiagram(element.querySelector('svg')!);
      document.body.append(exported);
      const svg = exported.querySelector('svg')!;
      results.push({
        text: svg.textContent,
        unsafe: !!svg.querySelector(
          'style,script,foreignObject,defs,marker,[id],[class]',
        ),
        references: exported.innerHTML.includes('url('),
        visible: Array.from(svg.querySelectorAll('text')).every(
          (text) => getComputedStyle(text).visibility === 'visible',
        ),
        paint: svg.querySelector('path,rect')?.getAttribute('style'),
        width: Number(svg.getAttribute('width')),
        unchanged: element.innerHTML === original,
      });
      exported.remove();
    }
    return results;
  });
  for (const result of results) {
    expect(result.text!.length).toBeGreaterThan(0);
    expect(result.unsafe).toBe(false);
    expect(result.references).toBe(false);
    expect(result.visible).toBe(true);
    expect(result.paint).toContain('fill:');
    expect(result.width).toBeGreaterThan(0);
    expect(result.width).toBeLessThanOrEqual(677);
    expect(result.unchanged).toBe(true);
  }
});

test('arrowheads retain their end positions and custom colors after definitions are stripped', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { wechatDiagram } = await import('/src/wechatDiagram.ts');
    const root = document.createElement('div');
    root.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><style>.edge{stroke:#ff0000;fill:none}.head{fill:#00ff00}</style><defs><marker id="arrow" markerWidth="10" markerHeight="10" viewBox="0 0 10 10" refX="10" refY="5" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path class="head" d="M0 0L10 5L0 10z"/></marker></defs><line class="edge" x1="20" y1="50" x2="180" y2="50" marker-start="url(#arrow)" marker-end="url(#arrow)"/></svg>`;
    const exported = await wechatDiagram(root.querySelector('svg')!);
    document.body.append(exported);
    const paths = Array.from(exported.querySelectorAll('path'));
    const result = {
      bounds: paths
        .map((path) => {
          const rect = path.getBoundingClientRect();
          const svg = exported.querySelector('svg')!.getBoundingClientRect();
          return {
            left: Math.round(rect.left - svg.left),
            right: Math.round(rect.right - svg.left),
            top: Math.round(rect.top - svg.top),
            color: getComputedStyle(path).fill,
          };
        })
        .sort((a, b) => a.left - b.left),
      stroke: getComputedStyle(exported.querySelector('line')!).stroke,
    };
    exported.remove();
    return result;
  });
  expect(result.stroke).toBe('rgb(255, 0, 0)');
  expect(result.bounds).toEqual([
    { left: 20, right: 30, top: 45, color: 'rgb(0, 255, 0)' },
    { left: 170, right: 180, top: 45, color: 'rgb(0, 255, 0)' },
  ]);
});

test('unsupported SVG export keeps the PNG fallback and article HTML still rejects arbitrary SVG', async ({
  page,
}) => {
  await page.route('**/src/wechatDiagram.ts', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export async function wechatDiagram(){throw new Error("unsupported")}',
    }),
  );
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderArticle } = await import('/src/output.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const output = await renderArticle(
      '<svg onload="alert(1)"><text>UNTRUSTED</text></svg>\n\n```mermaid\nflowchart LR\nA-->B\n```',
      DEFAULT_SETTINGS,
    );
    const result = {
      html: output.html,
      assets: output.assets,
      errors: output.errors,
    };
    output.dispose();
    return result;
  });
  expect(result.html).toContain('请在此处插入 Mermaid 图形 1');
  expect(result.html).not.toContain('<svg');
  expect(result.html).toContain('&lt;svg');
  expect(result.assets[0].embedded).not.toBe(true);
  expect(result.errors).toEqual([]);
});

test('editing and scrolling a long Markdown article do not load publication SVG conversion', async ({
  page,
}) => {
  const exports: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/src/wechatDiagram.ts'))
      exports.push(request.url());
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() =>
    (window as any).__mojian.setMarkdown(
      '# 长文性能\n\n' +
        '普通正文内容，保持编辑和阅读流畅。\n\n'.repeat(3000) +
        '```mermaid\nflowchart LR\nA-->B\n```',
    ),
  );
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.locator('.article-editor h1').click();
  await page.keyboard.type('edit');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.locator('.code-node').scrollIntoViewIfNeeded();
  await expect(page.locator('.diagram svg')).toBeVisible();
  expect(exports).toHaveLength(0);
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await expect(page.locator('[data-mermaid-block] svg')).toBeVisible();
  await expect.poll(() => exports.length).toBe(1);
});

test('Gantt milestones retain rotated geometry after CSS and classes are removed', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { diagram } = await import('/src/mermaid.ts');
    const { wechatDiagram } = await import('/src/wechatDiagram.ts');
    const root = document.createElement('div');
    root.innerHTML = await diagram(
      'gantt\n dateFormat YYYY-MM-DD\n section 发布\n 里程碑 :milestone, m1, 2024-01-03, 0d',
    );
    document.body.append(root);
    const svg = root.querySelector('svg')!;
    const milestone = svg.querySelector<SVGRectElement>('rect.milestone')!;
    const index = Array.from(svg.querySelectorAll('rect')).indexOf(milestone);
    const before = milestone.getCTM()!;
    const exported = await wechatDiagram(svg);
    document.body.append(exported);
    const copy = exported.querySelectorAll('rect')[index];
    const after = copy.getCTM()!;
    // Compare in viewBox coordinates: export can scale the root to 677px.
    const sourceRoot = svg.getCTM()!.inverse();
    const targetRoot = exported.querySelector('svg')!.getCTM()!.inverse();
    const original = sourceRoot.multiply(before);
    const baked = targetRoot.multiply(after);
    const result = {
      before: [
        original.a,
        original.b,
        original.c,
        original.d,
        original.e,
        original.f,
      ],
      after: [baked.a, baked.b, baked.c, baked.d, baked.e, baked.f],
    };
    root.remove();
    exported.remove();
    return result;
  });
  expect(Math.abs(result.before[1])).toBeGreaterThan(0.5);
  result.after.forEach((value, index) =>
    expect(value).toBeCloseTo(result.before[index], 3),
  );
});

test('expanded arrows preserve hidden and semitransparent edge state', async ({
  page,
}) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const { diagram } = await import('/src/mermaid.ts');
    const { wechatDiagram } = await import('/src/wechatDiagram.ts');
    const results = [];
    for (const setting of [
      'opacity:0',
      'opacity:0.4',
      'visibility:hidden',
      'display:none',
    ]) {
      const root = document.createElement('div');
      root.innerHTML = await diagram(
        'flowchart LR\n A --> B\n linkStyle 0 ' + setting,
      );
      const exported = await wechatDiagram(root.querySelector('svg')!);
      const path = exported.querySelector('path')!;
      const arrow = path.nextElementSibling as SVGElement;
      document.body.append(exported);
      results.push({
        setting,
        opacity: arrow.style.opacity,
        visibility: arrow.style.visibility,
        display: arrow.style.display,
        paths: arrow.querySelectorAll('path').length,
        pathVisibility: getComputedStyle(arrow.querySelector('path')!)
          .visibility,
      });
      exported.remove();
    }
    return results;
  });
  for (const result of results) {
    const [property, value] = result.setting.split(':');
    expect(result[property as 'opacity' | 'visibility' | 'display']).toBe(
      value,
    );
    expect(result.paths).toBeGreaterThan(0);
    if (property === 'visibility') expect(result.pathVisibility).toBe(value);
  }
});
