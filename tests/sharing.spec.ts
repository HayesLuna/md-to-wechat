import { test, expect } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { DEFAULT_SETTINGS } from '../src/sample';
import { decodeShareLink, encodeShareLink } from '../src/sharing/service';
import {
  analyzeImageReferences,
  remapImageReferences,
} from '../src/sharing/imageReferences';
import { shareLifetime } from '../src/sharing/config';
import type { StorageProvider } from '../src/sharing/types';

const config = {
  provider: 'oss' as const,
  bucket: 'mojian-test',
  region: 'cn-hangzhou',
  endpoint: '',
  prefix: 'mojian/shares/',
  accessKeyId: 'test-key-id',
  accessKeySecret: 'test-secret-only-sender',
  sessionToken: '',
  credentialExpiresAt: '',
};

async function ready(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__mojian?.editor);
}

async function mockBucket(
  context: BrowserContext,
  objects: Map<string, Buffer>,
  requests: string[] = [],
) {
  await context.route('https://*.share-test.example/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(request.method());
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,PUT,DELETE,HEAD,OPTIONS',
      'access-control-allow-headers': '*',
      'access-control-expose-headers': 'ETag,x-oss-request-id',
      etag: '"test-etag"',
      'x-oss-request-id': 'test-request',
      'x-cos-request-id': 'test-request',
    };
    if (request.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers });
    if (request.method() === 'PUT') {
      objects.set(url.pathname, request.postDataBuffer() || Buffer.alloc(0));
      return route.fulfill({ status: 200, headers, body: '' });
    }
    if (request.method() === 'DELETE') {
      objects.delete(url.pathname);
      return route.fulfill({ status: 204, headers });
    }
    const body = objects.get(url.pathname);
    await route.fulfill({
      status: body ? 200 : 404,
      headers,
      contentType: 'application/octet-stream',
      body: body || Buffer.from('not found'),
    });
  });
}

async function configure(page: Page, provider: StorageProvider) {
  await page.getByRole('button', { name: '分享当前文章', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '分享存储设置' }),
  ).toBeVisible();
  await page.getByLabel('存储类型', { exact: true }).selectOption(provider);
  await page
    .getByLabel('Bucket', { exact: true })
    .fill(provider === 'cos' ? 'mojian-test-123456' : 'mojian-test');
  await page
    .getByLabel('Region', { exact: true })
    .fill(
      provider === 'oss'
        ? 'cn-hangzhou'
        : provider === 'cos'
          ? 'ap-guangzhou'
          : 'us-east-1',
    );
  if (provider !== 'minio')
    await page.getByText('高级设置', { exact: true }).click();
  await page
    .getByLabel(
      provider === 'minio' ? 'S3 API 地址（HTTPS）' : 'Endpoint（可选，HTTPS）',
      { exact: true },
    )
    .fill(`https://${provider}.share-test.example`);
  await page
    .getByLabel(provider === 'cos' ? 'SecretId' : 'AccessKey ID', {
      exact: true,
    })
    .fill(config.accessKeyId);
  await page
    .getByLabel(provider === 'cos' ? 'SecretKey' : 'AccessKey Secret', {
      exact: true,
    })
    .fill(config.accessKeySecret);
}

test('share descriptors reject invalid URLs and credentials cap the actual lifetime', () => {
  const descriptor = {
    version: 1 as const,
    id: '12345678-1234-1234-1234-123456789abc',
    url: 'https://bucket.example/article?signature=read-only',
    expiresAt: Date.now() + 86400000,
    sha256: 'a'.repeat(64),
  };
  const link = encodeShareLink(
    descriptor,
    'https://example.com/md-to-wechat/?old=1#old',
  );
  expect(decodeShareLink(new URL(link).hash)).toEqual(descriptor);
  expect(new URL(link).pathname).toBe('/md-to-wechat/');
  expect(new URL(link).search).toBe('');
  for (const url of [
    'javascript:alert(1)',
    'http://bucket.example/file',
    'https://user:pass@example.com/file',
  ]) {
    expect(() =>
      decodeShareLink(
        new URL(encodeShareLink({ ...descriptor, url }, 'https://example.com/'))
          .hash,
      ),
    ).toThrow();
  }
  expect(() => decodeShareLink('#share=%invalid')).toThrow();
  expect(shareLifetime(config, 604800)).toBe(604800);
  const seconds = shareLifetime(
    {
      ...config,
      sessionToken: 'temporary',
      credentialExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    604800,
  );
  expect(seconds).toBeGreaterThan(3500);
  expect(seconds).toBeLessThan(3600);
  expect(() =>
    shareLifetime({ ...config, sessionToken: 'temporary' }, 604800),
  ).toThrow('到期时间');
});

test('image ID remapping preserves source text and code, including nested and reference images', () => {
  const cases = [
    ['![photo](local-image:old)', '![photo](local-image:new)'],
    [
      'text local-image:old `![code](local-image:old)`\n\n![photo](local-image:old "local-image:old")',
      'text local-image:old `![code](local-image:old)`\n\n![photo](local-image:new "local-image:old")',
    ],
    [
      '```md\n![code](local-image:old)\n```\n\n![photo](<local-image:old>)',
      '```md\n![code](local-image:old)\n```\n\n![photo](<local-image:new>)',
    ],
    [
      '> - ![photo](local-image:old)\n> - text',
      '> - ![photo](local-image:new)\n> - text',
    ],
    [
      '![a][photo]\n\n[photo]: local-image:old "title"',
      '![a][photo]\n\n[photo]: local-image:new "title"',
    ],
    [
      '| A | B |\n|---|---|\n| ![a](local-image:old) | ![b](local-image:old) |',
      '| A | B |\n|---|---|\n| ![a](local-image:new) | ![b](local-image:new) |',
    ],
    [
      '# Heading\r\n\r\n![a](local-image:old)\r\n',
      '# Heading\r\n\r\n![a](local-image:new)\r\n',
    ],
  ];
  cases.push(
    ['![a](local-image\\:old)', '![a](local-image:new)'],
    ['![a](local-image&#58;old)', '![a](local-image:new)'],
    ['![a](<local&#45;image&#58;old>)', '![a](<local-image:new>)'],
    [
      '![a][photo]\n\n[photo]: <local-image&#58;old> "title"',
      '![a][photo]\n\n[photo]: <local-image:new> "title"',
    ],
    [
      '> - ![a][photo]\n>\n>   [photo]:\n>     <local-image\\:old> "title"',
      '> - ![a][photo]\n>\n>   [photo]:\n>     <local-image:new> "title"',
    ],
    [
      '# Heading\r\r![a](local-image:old)\r\r![b](local-image&#58;old)\r',
      '# Heading\r\r![a](local-image:new)\r\r![b](local-image:new)\r',
    ],
    [
      '![a][used]\n\n[unused]: local-image:old\n[used]: local-image:old\n[used]: local-image:other',
      '![a][used]\n\n[unused]: local-image:old\n[used]: local-image:new\n[used]: local-image:other',
    ],
    [
      '![a](local-image:old "title ]: local-image:old")\n\n`![code](local-image&#58;old)`',
      '![a](local-image:new "title ]: local-image:old")\n\n`![code](local-image&#58;old)`',
    ],
  );
  for (const [source, expected] of cases) {
    const references = analyzeImageReferences(source);
    expect(references.ids).toEqual(['old']);
    expect(
      remapImageReferences(source, new Map([['old', 'new']]), references),
    ).toBe(expected);
  }
});

for (const provider of ['oss', 'cos', 'minio'] as const) {
  test(`${provider}: real SDK upload/sign/delete, recipient imports local images without sender credentials`, async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(90000);
    const objects = new Map<string, Buffer>();
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockBucket(context, objects, requests);
    await ready(page);
    const original = await page.evaluate(async () => {
      const s = await import('/src/storage.ts');
      const canvas = document.createElement('canvas');
      canvas.width = 12;
      canvas.height = 12;
      canvas.getContext('2d')!.fillRect(0, 0, 12, 12);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!)),
      );
      const src = await s.storeImage(blob);
      const markdown =
        '# 只分享这一篇\n\n朋友可以编辑。\n\n![本地图片](' +
        src +
        ' "width=45%")';
      window.__mojian!.setMarkdown(markdown);
      const unrelated = s.newDraft(
        '# 不要分享的私人草稿',
        (await import('/src/sample.ts')).DEFAULT_SETTINGS,
      );
      await s.saveDraft(unrelated);
      return { markdown, src };
    });
    await configure(page, provider);
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '连接正常' }),
    ).toBeVisible();
    expect(objects.size).toBe(0);
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await page
      .getByRole('button', { name: '生成分享链接', exact: true })
      .click();
    const input = page.locator('.share-record input');
    await expect(input).toHaveCount(1);
    if (provider === 'oss' && process.env.SHARING_QA_SCREENSHOTS) {
      await page.screenshot({ path: '/tmp/mojian-share-desktop.png' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: '/tmp/mojian-share-mobile.png' });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    const link = await input.inputValue();
    expect(link).not.toContain(config.accessKeySecret);
    const descriptor = decodeShareLink(new URL(link).hash);
    expect(new URL(descriptor.url).protocol).toBe('https:');
    if (provider === 'oss')
      expect(
        new URL(descriptor.url).searchParams.get('x-oss-signature-version'),
      ).toBe('OSS4-HMAC-SHA256');
    if (provider === 'cos') expect(descriptor.url).toContain('q-signature=');
    if (provider === 'minio')
      expect(descriptor.url).toContain('X-Amz-Signature=');
    expect(objects.size).toBe(1);
    if (provider === 'oss') {
      await expect(page.getByLabel('有效期', { exact: true })).toHaveCount(0);
      await page
        .getByRole('button', { name: '生成新链接', exact: true })
        .click();
      await page.getByLabel('有效期', { exact: true }).selectOption('3600');
      await expect(
        page.getByRole('button', { name: '复制分享链接', exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole('button', { name: '生成分享链接', exact: true })
        .click();
      await expect(input).toHaveCount(1);
      await expect(input).not.toHaveValue(link);
      const replacement = decodeShareLink(
        new URL(await input.inputValue()).hash,
      );
      expect(replacement.expiresAt - Date.now()).toBeGreaterThan(3500_000);
      expect(replacement.expiresAt - Date.now()).toBeLessThanOrEqual(3600_000);
      // The dialog only offers the latest link for this article. A previously
      // sent snapshot stays available without adding another row to the UI.
      expect(objects.size).toBe(2);
      await expect(
        page.getByRole('button', { name: '取消分享', exact: true }),
      ).toHaveCount(1);
    }
    const local = await page.evaluate(() => ({
      local: localStorage.getItem('mojian-share-config-v1'),
      session: sessionStorage.getItem('mojian-share-credentials-v1'),
    }));
    expect(local.local).not.toContain(config.accessKeySecret);
    expect(local.session).toContain(config.accessKeySecret);
    const recipient = await browser.newContext();
    await mockBucket(recipient, objects);
    const friend = await recipient.newPage();
    friend.on('pageerror', (e) => errors.push(e.message));
    await friend.goto(link);
    await expect(friend.getByRole('dialog')).toHaveCount(0);
    await expect
      .poll(() => friend.evaluate(() => window.__mojian?.getMarkdown()))
      .toContain('# 只分享这一篇');
    const restored = await friend.evaluate(async () => {
      const s = await import('/src/storage.ts');
      const library = await s.loadDrafts();
      const article = library.drafts.find((d) =>
        d.markdown.includes('# 只分享这一篇'),
      )!;
      const src = article.markdown.match(/local-image:[a-zA-Z0-9-]+/)![0];
      const blob = await s.imageBlob(src);
      return {
        markdown: article.markdown,
        src,
        bytes: blob?.size,
        title: article.title,
        settings: article.settings,
        drafts: library.drafts.map((d) => d.markdown),
        config: localStorage.getItem('mojian-share-config-v1'),
      };
    });
    expect(restored.src).not.toBe(original.src);
    expect(restored.bytes).toBeGreaterThan(0);
    expect(restored.markdown).toContain('width=45%');
    expect(restored.drafts.join('\n')).not.toContain('不要分享的私人草稿');
    expect(restored.settings).toEqual(DEFAULT_SETTINGS);
    expect(restored.config).toBeNull();
    await expect(friend.locator('.image-box img')).toBeVisible();
    await expect
      .poll(() =>
        friend
          .locator('.image-box img')
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(12);
    await friend.evaluate(() =>
      window.__mojian!.setMarkdown('# 好友自己的修改'),
    );
    await expect(friend.locator('.save-indicator')).toContainText(
      '已保存到本地',
    );
    // A second visit must reuse the edited local copy even after the remote
    // object disappears or the original link expires.
    objects.clear();
    await friend.goto(link);
    await expect
      .poll(() => friend.evaluate(() => window.__mojian?.getMarkdown()))
      .toBe('# 好友自己的修改');
    await expect(friend.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.__mojian!.getMarkdown())).toBe(
      original.markdown,
    );
    await page.getByRole('button', { name: '取消分享', exact: true }).click();
    await expect(page.locator('.share-record')).toHaveCount(0);
    if (provider === 'oss') {
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await page
        .getByRole('button', { name: '分享当前文章', exact: true })
        .click();
      await expect(page.locator('.share-record')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: '生成分享链接', exact: true }),
      ).toBeVisible();
    }
    expect(requests).toContain('DELETE');
    expect(errors).toEqual([]);
    await recipient.close();
  });
}

test('article package validation is atomic; concurrent duplicate imports preserve the winner', async ({
  page,
}) => {
  await page.route('**/package-check', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/package-check');
  const manifest = {
    format: 'mojian-article',
    version: 1,
    title: '坏文章',
    settings: DEFAULT_SETTINGS,
    images: [{ id: 'missing', path: 'images/missing', type: 'image/png' }],
  };
  const fixtures = [
    zipSync({
      'manifest.json': strToU8(JSON.stringify({ ...manifest, version: 99 })),
      'article.md': strToU8('# 未知版本'),
    }),
    zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'article.md': strToU8('![缺失](local-image:missing)'),
    }),
    zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'article.md': strToU8('![损坏](local-image:missing)'),
      'images/missing': strToU8('not-an-image'),
    }),
    zipSync({ '../escape': strToU8('bad') }),
    zipSync({ 'article.md': new Uint8Array(6 * 1024 * 1024) }),
  ];
  const result = await page.evaluate(
    async (malformed) => {
      const p = await import('/src/sharing/articlePackage.ts');
      const s = await import('/src/storage.ts');
      const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
      const original = s.newDraft('# 快照\n\n正文', DEFAULT_SETTINGS);
      const { blob } = await p.createArticlePackage(original);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const imports = await Promise.all([
        p.importArticlePackage(bytes, 'same-source'),
        p.importArticlePackage(bytes, 'same-source'),
      ]);
      const draft = imports[0];
      await s.saveDraft(
        { ...draft, markdown: '# 保留我的修改', version: draft.version + 1 },
        draft.version,
      );
      const repeated = await p.importArticlePackage(bytes, 'same-source');
      let rejected = 0;
      for (const fixture of malformed) {
        const bytes = new Uint8Array(fixture);
        try {
          await p.importArticlePackage(
            bytes as Uint8Array<ArrayBuffer>,
            'invalid',
          );
        } catch {
          rejected++;
        }
      }
      const database = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('mojian-v1');
        r.onsuccess = () => resolve(r.result);
      });
      const imageCount = await new Promise<number>((resolve) => {
        const tx = database.transaction('images');
        const r = tx.objectStore('images').count();
        r.onsuccess = () => resolve(r.result);
      });
      database.close();
      return {
        same: imports[0].id === imports[1].id,
        markdown: repeated.markdown,
        count: (await s.loadDraftLibrary()).drafts.length,
        rejected,
        imageCount,
      };
    },
    fixtures.map((bytes) => Array.from(bytes)),
  );
  expect(result).toEqual({
    same: true,
    markdown: '# 保留我的修改',
    count: 1,
    rejected: 5,
    imageCount: 0,
  });
});

test('another tab remembering credentials cannot persist this tab session-only secret', async ({
  page,
  context,
}) => {
  const objects = new Map<string, Buffer>();
  await mockBucket(context, objects);
  await ready(page);
  await expect(page.locator('.save-indicator')).toContainText('已保存到本地');
  const own = {
    ...config,
    endpoint: 'https://oss.share-test.example',
    accessKeySecret: 'session-only-secret-A',
  };
  await page.evaluate(
    async (value) =>
      (await import('/src/sharing/config.ts')).saveShareConfig(value, false),
    own,
  );
  const other = await context.newPage();
  await ready(other);
  await other.evaluate(
    async (value) =>
      (await import('/src/sharing/config.ts')).saveShareConfig(
        { ...value, accessKeySecret: 'remembered-secret-B' },
        true,
      ),
    own,
  );
  await page.bringToFront();
  await page.getByRole('button', { name: '分享当前文章', exact: true }).click();
  await page.getByRole('button', { name: '生成分享链接', exact: true }).click();
  await expect(page.getByLabel('分享链接', { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => ({
    persistent: localStorage.getItem('mojian-share-config-v1'),
    session: sessionStorage.getItem('mojian-share-credentials-v1'),
  }));
  expect(stored.persistent).not.toContain(own.accessKeySecret);
  expect(stored.session).toContain(own.accessKeySecret);
  await page.getByRole('button', { name: '存储设置', exact: true }).click();
  await expect(
    page.getByLabel('在此浏览器记住凭证', { exact: true }),
  ).not.toBeChecked();
  await other.close();
});

test('opening sharing during pending editor serialization reads fresh content without updating state during render', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await ready(page);
  await page.evaluate(async (value) => {
    (await import('/src/sharing/config.ts')).saveShareConfig(value, false);
    window.__mojian!.setMarkdown('# 快速编辑');
  }, config);
  // Warm the lazy dialog, so this also covers subsequent openings within the
  // editor's 100ms serialization window.
  await page.getByRole('button', { name: '分享当前文章', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '分享当前文章' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.evaluate(() => {
    const editor = window.__mojian!.editor!;
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize - 1);
    editor.commands.insertContent('未同步内容');
    document
      .querySelector<HTMLButtonElement>('button[aria-label="分享当前文章"]')!
      .click();
  });
  await expect(page.locator('.share-article-title')).toHaveText(
    '快速编辑未同步内容',
  );
  expect(errors).toEqual([]);
});

test('bad and expired links preserve current drafts; credentials can be forgotten; settings fit mobile', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => window.__mojian!.setMarkdown('# 必须保留的正文'));
  await expect(page.locator('.save-indicator')).toContainText('已保存到本地');
  await page.goto('/#share=broken');
  await expect(page.getByRole('alert')).toContainText('分享链接不完整');
  await page.getByRole('button', { name: '返回编辑器' }).click();
  expect(await page.evaluate(() => window.__mojian!.getMarkdown())).toBe(
    '# 必须保留的正文',
  );
  const expired = encodeShareLink(
    {
      version: 1,
      id: '12345678-1234-1234-1234-123456789abc',
      url: 'https://oss.share-test.example/missing',
      expiresAt: Date.now() - 1000,
      sha256: 'a'.repeat(64),
    },
    page.url(),
  );
  await page.goto(expired);
  await expect(page.getByRole('alert')).toContainText('已过期');
  await page.getByRole('button', { name: '返回编辑器' }).click();
  await page.route('https://oss.share-test.example/tampered', async (route) => {
    expect(await route.request().headerValue('cookie')).toBeNull();
    expect(await route.request().headerValue('referer')).toBeNull();
    await route.fulfill({
      contentType: 'application/octet-stream',
      body: 'tampered',
    });
  });
  const tampered = encodeShareLink(
    {
      version: 1,
      id: '12345678-1234-1234-1234-123456789abc',
      url: 'https://oss.share-test.example/tampered',
      expiresAt: Date.now() + 60000,
      sha256: 'a'.repeat(64),
    },
    page.url(),
  );
  await page.goto(tampered);
  await expect(page.getByRole('alert')).toContainText('校验失败');
  await page.getByRole('button', { name: '返回编辑器' }).click();
  expect(await page.evaluate(() => window.__mojian!.getMarkdown())).toBe(
    '# 必须保留的正文',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await configure(page, 'oss');
  await page.getByLabel('在此浏览器记住凭证', { exact: true }).check();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  expect(
    await page.evaluate(() => localStorage.getItem('mojian-share-config-v1')),
  ).toContain(config.accessKeySecret);
  await page.getByRole('button', { name: '存储设置', exact: true }).click();
  await page.getByLabel('在此浏览器记住凭证', { exact: true }).uncheck();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  expect(
    await page.evaluate(() => localStorage.getItem('mojian-share-config-v1')),
  ).not.toContain(config.accessKeySecret);
  await page.getByRole('button', { name: '存储设置', exact: true }).click();
  if (
    !(await page
      .locator('.share-advanced')
      .evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await page.getByText('高级设置', { exact: true }).click();
  await page.getByRole('button', { name: '清除凭证', exact: true }).click();
  await expect(
    page.getByLabel('AccessKey Secret', { exact: true }),
  ).toHaveValue('');
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('mojian-share-credentials-v1'),
    ),
  ).not.toContain(config.accessKeySecret);
  await expect(page).toHaveTitle('墨笺 · Markdown 公众号排版');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('dialog').evaluate((element) => {
    element.scrollTop = 0;
  });
  if (process.env.SHARING_QA_SCREENSHOTS) {
    if (
      await page
        .locator('.share-advanced')
        .evaluate((element) => (element as HTMLDetailsElement).open)
    )
      await page.getByText('高级设置', { exact: true }).click();
    await page.screenshot({ path: '/tmp/mojian-share-settings-mobile.png' });
  }
});

test('temporary credentials sign GET only; session credentials remain bound to their own target', async ({
  page,
}) => {
  await page.route('**/credential-check', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/credential-check');
  const result = await page.evaluate(async (base) => {
    const { createShareStorage } = await import('/src/sharing/adapters.ts');
    const { loadShareConfig, saveShareConfig } =
      await import('/src/sharing/config.ts');
    const urls: { provider: string; url: string }[] = [];
    for (const provider of ['oss', 'cos', 'minio'] as const) {
      const config = {
        ...base,
        provider,
        bucket: provider === 'cos' ? 'mojian-test-123456' : base.bucket,
        region:
          provider === 'oss'
            ? 'cn-hangzhou'
            : provider === 'cos'
              ? 'ap-guangzhou'
              : 'us-east-1',
        endpoint: `https://${provider}.share-test.example`,
        sessionToken: 'test-temporary-token',
        credentialExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
      const storage = await createShareStorage(config);
      urls.push({
        provider,
        url: await storage.downloadURL('mojian/shares/article.mojian', 1800),
      });
    }
    saveShareConfig(base, false);
    // Model a second tab changing the shared public configuration.
    localStorage.setItem(
      'mojian-share-config-v1',
      JSON.stringify({
        ...base,
        endpoint: 'https://other.example',
        accessKeyId: undefined,
        accessKeySecret: undefined,
      }),
    );
    const isolated = loadShareConfig().config;
    return {
      urls,
      endpoint: isolated.endpoint,
      secret: isolated.accessKeySecret,
    };
  }, config);
  expect(result.endpoint).toBe(config.endpoint);
  expect(result.secret).toBe(config.accessKeySecret);
  for (const { provider, url } of result.urls) {
    const parsed = new URL(url);
    expect(url).not.toContain(config.accessKeySecret);
    if (provider === 'oss')
      expect(parsed.searchParams.get('x-oss-security-token')).toBe(
        'test-temporary-token',
      );
    if (provider === 'cos')
      expect(parsed.searchParams.get('x-cos-security-token')).toBe(
        'test-temporary-token',
      );
    if (provider === 'minio')
      expect(parsed.searchParams.get('X-Amz-Security-Token')).toBe(
        'test-temporary-token',
      );
  }
});

test('changing share links during a download aborts the old import and opens the latest article', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => window.__mojian!.setMarkdown('# 原来的本地文章'));
  await expect(page.locator('.save-indicator')).toContainText('已保存到本地');
  const packages = await page.evaluate(async () => {
    const { createArticlePackage } =
      await import('/src/sharing/articlePackage.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const results = [];
    for (const title of ['旧分享', '新分享']) {
      const { blob, sha256 } = await createArticlePackage({
        title,
        markdown: '# ' + title,
        settings: DEFAULT_SETTINGS,
      });
      results.push({
        sha256,
        bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
      });
    }
    return results;
  });
  let firstRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    firstRequested = resolve;
  });
  let releaseFirst!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route(
    'https://oss.share-test.example/race-first',
    async (route) => {
      firstRequested();
      await release;
      await route
        .fulfill({
          contentType: 'application/octet-stream',
          body: Buffer.from(packages[0].bytes),
        })
        .catch(() => {});
    },
  );
  await page.route('https://oss.share-test.example/race-second', (route) =>
    route.fulfill({
      contentType: 'application/octet-stream',
      body: Buffer.from(packages[1].bytes),
    }),
  );
  const links = packages.map((p, index) =>
    encodeShareLink(
      {
        version: 1,
        id: `race-share-${index}-1234567890`,
        url: `https://oss.share-test.example/race-${index ? 'second' : 'first'}`,
        expiresAt: Date.now() + 60000,
        sha256: p.sha256,
      },
      page.url(),
    ),
  );
  await page.goto(links[0]);
  await requested;
  await page.evaluate((hash) => {
    location.hash = hash;
  }, new URL(links[1]).hash);
  await expect
    .poll(() => page.evaluate(() => window.__mojian?.getMarkdown()))
    .toBe('# 新分享');
  releaseFirst();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const drafts = await page.evaluate(async () =>
    (await (await import('/src/storage.ts')).loadDrafts()).drafts.map(
      (d) => d.markdown,
    ),
  );
  expect(drafts).toContain('# 原来的本地文章');
  expect(drafts).toContain('# 新分享');
  expect(drafts).not.toContain('# 旧分享');
});

test('an unavailable sharing chunk leaves the editor usable and current content intact', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await page.evaluate(() => window.__mojian!.setMarkdown('# 网络失败也要保留'));
  await page.route('**/src/sharing/ShareDialog.tsx*', (route) =>
    route.abort('failed'),
  );
  await page.getByRole('button', { name: '分享当前文章', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '分享暂不可用' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '返回编辑器', exact: true }).click();
  expect(await page.evaluate(() => window.__mojian!.getMarkdown())).toBe(
    '# 网络失败也要保留',
  );
  await expect(page.locator('.workspace')).toBeVisible();
  expect(errors).toEqual([]);
});

test('blocked browser settings storage does not crash the sharing dialog', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Storage blocked', 'SecurityError');
      },
    });
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new DOMException('Storage blocked', 'SecurityError');
      },
    });
  });
  await page.getByRole('button', { name: '分享当前文章', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '分享存储设置' }),
  ).toBeVisible();
  await expect(
    page.getByLabel('AccessKey Secret', { exact: true }),
  ).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.workspace')).toBeVisible();
});

test('worker packages round-trip escaped image destinations and preserve all other source bytes', async ({
  page,
}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const { createArticlePackage, readArticlePackage } =
      await import('/src/sharing/articlePackage.ts');
    const { storeImage } = await import('/src/storage.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 12;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const src = await storeImage(blob);
    const variants = [
      ['![a](' + src.replace(':', '\\:') + ')', '![a]({image})'],
      ['![a](<' + src.replace(':', '&#58;') + '>)', '![a](<{image}>)'],
      [
        '> - ![a][ref]\r\n>\r\n>   [ref]:\r\n>     <' +
          src.replace(':', '&#58;') +
          '> "title"',
        '> - ![a][ref]\r\n>\r\n>   [ref]:\r\n>     <{image}> "title"',
      ],
      [
        '# Heading\r\r![a](' +
          src +
          ')\r\r![b](' +
          src.replace(':', '&#58;') +
          ')\r',
        '# Heading\r\r![a]({image})\r\r![b]({image})\r',
      ],
    ];
    const results = [];
    for (const [body, expected] of variants) {
      const suffix =
        '\n\nprose ' + src + '\n\n`![code](' + src + ')`\n\n[unused]: ' + src;
      const pkg = await createArticlePackage({
        title: '来源标题',
        markdown: body + suffix,
        settings: DEFAULT_SETTINGS,
      });
      const bytes = new Uint8Array(await pkg.blob.arrayBuffer());
      const { draft, images } = await readArticlePackage(bytes);
      // Reading never detaches a caller's buffer: callers can safely retry it.
      const repeated = await readArticlePackage(bytes);
      const image = 'local-image:' + images[0].id;
      const bitmap = await createImageBitmap(images[0].blob);
      results.push({
        exactSource:
          draft.markdown === expected.replaceAll('{image}', image) + suffix,
        imageCount: images.length,
        width: bitmap.width,
        repeated: repeated.images.length,
        independent: image !== src,
      });
      bitmap.close();
    }
    return results;
  });
  expect(result).toHaveLength(4);
  for (const value of result)
    expect(value).toEqual({
      exactSource: true,
      imageCount: 1,
      width: 12,
      repeated: 1,
      independent: true,
    });
});

test('worker failures and aborts release resources without importing partial drafts', async ({
  page,
}) => {
  await ready(page);
  await page.route('**/articlePackage.worker.ts*', (route) => route.abort());
  const failure = await page.evaluate(async () => {
    const { createArticlePackage } =
      await import('/src/sharing/articlePackage.ts');
    try {
      await createArticlePackage({
        title: '失败',
        markdown: '# 失败',
        settings: window.__mojian!.getSettings(),
      });
      return '';
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(failure).toContain('模块加载失败');
  await page.unroute('**/articlePackage.worker.ts*');
  const cancelled = await page.evaluate(async () => {
    const { createArticlePackage, importArticlePackage } =
      await import('/src/sharing/articlePackage.ts');
    const { loadDraftLibrary } = await import('/src/storage.ts');
    const pkg = await createArticlePackage({
      title: '取消',
      markdown: '# 取消',
      settings: window.__mojian!.getSettings(),
    });
    const NativeWorker = window.Worker;
    let active = 0;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        active++;
      }
      terminate() {
        active--;
        super.terminate();
      }
    };
    try {
      const before = (await loadDraftLibrary()).drafts.length;
      const controller = new AbortController();
      const pending = importArticlePackage(
        new Uint8Array(await pkg.blob.arrayBuffer()),
        'cancelled-worker',
        controller.signal,
      );
      controller.abort();
      let error = '';
      try {
        await pending;
      } catch (value) {
        error = (value as Error).name;
      }
      return {
        error,
        active,
        before,
        after: (await loadDraftLibrary()).drafts.length,
      };
    } finally {
      window.Worker = NativeWorker;
    }
  });
  expect(cancelled.error).toBe('AbortError');
  expect(cancelled.active).toBe(0);
  expect(cancelled.after).toBe(cancelled.before);
  await page.evaluate(() => window.__mojian!.setMarkdown('# 编辑仍然可用'));
  await expect(page.locator('.article-editor')).toContainText('编辑仍然可用');
});
