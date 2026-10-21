import { test, expect } from './fixtures';

test('image collection preserves shared draft references and removes only unused files between sessions', async ({ page }) => {
  await page.route('**/optimization-storage', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('/optimization-storage');
  const result = await page.evaluate(async () => {
    const s = await import('/src/storage.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
    const shared = await s.storeImage(blob), orphan = await s.storeImage(blob);
    const first = s.newDraft(`![共享图片](${shared})`, DEFAULT_SETTINGS);
    const second = s.newDraft(`![共享图片](${shared})`, DEFAULT_SETTINGS);
    await s.saveDraft(first); await s.saveDraft(second);
    const release = await s.beginImageSession();
    const orphanRemoved = !(await s.imageBlob(orphan));
    await s.removeDraft(first.id, second);
    const sharedRetained = !!(await s.imageBlob(shared));
    release();
    return { orphanRemoved, sharedRetained };
  });
  expect(result).toEqual({ orphanRemoved: true, sharedRetained: true });
});

test('another tab cannot collect images used by unsaved edits or undo history', async ({ page, context }) => {
  await page.route('**/optimization-session', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('/optimization-session');
  const src = await page.evaluate(async () => {
    const s = await import('/src/storage.ts');
    (window as any).__releaseImages = await s.beginImageSession();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
    return s.storeImage(blob);
  });
  const other = await context.newPage();
  await other.route('**/optimization-session', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await other.goto('/optimization-session');
  expect(await other.evaluate(async src => {
    const s = await import('/src/storage.ts'); const release = await s.beginImageSession();
    const retained = !!(await s.imageBlob(src)); release(); return retained;
  }, src)).toBe(true);
  await page.evaluate(() => (window as any).__releaseImages());
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held?.length || 0)).toBe(0);
  expect(await other.evaluate(async src => {
    const s = await import('/src/storage.ts'); const release = await s.beginImageSession();
    const removed = !(await s.imageBlob(src)); release(); return removed;
  }, src)).toBe(true);
});

test('browsers without Web Locks retain image data', async ({ page }) => {
  await page.route('**/optimization-no-locks', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('/optimization-no-locks');
  expect(await page.evaluate(async () => {
    const s = await import('/src/storage.ts');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
    const src = await s.storeImage(blob);
    Object.defineProperty(navigator, 'locks', { value: undefined });
    const release = await s.beginImageSession(); release();
    return !!(await s.imageBlob(src));
  })).toBe(true);
});

test('cancelling obsolete output releases local image ownership', async ({ page }) => {
  await page.route('**/optimization-abort', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('/optimization-abort'); await page.clock.install();
  const name = await page.evaluate(async () => {
    const s = await import('/src/storage.ts'); const { renderArticle } = await import('/src/output.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
    const src = await s.storeImage(blob);
    const revoked: string[] = []; const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = url => { revoked.push(url); revoke.call(URL, url); };
    (window as any).__revokedImages = revoked;
    const controller = new AbortController();
    const pending = renderArticle(`![本地图片](${src})`, DEFAULT_SETTINGS, controller.signal);
    controller.abort();
    try { await pending; return 'not aborted'; } catch (error) { return (error as Error).name; }
  });
  expect(name).toBe('AbortError');
  await page.clock.fastForward(31_000);
  expect(await page.evaluate(() => (window as any).__revokedImages.length)).toBe(1);
});

test('cached code cards keep indexes, themes, raw code and consumer mutations independent', async ({ page }) => {
  await page.route('**/optimization-code', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('/optimization-code');
  const result = await page.evaluate(async () => {
    const { codeCard } = await import('/src/codeOutput.ts');
    const source = { text: 'const message = "你好";\n\n  console.log(message);', language: 'js' };
    const first = codeCard(source, 0, false); const html = first.innerHTML;
    first.querySelector('code')!.textContent = 'mutated';
    const next = codeCard(source, 4, false); const dark = codeCard(source, 1, true);
    const changed = codeCard({ ...source, text: 'const changed = 2;' }, 2, false);
    return {
      unchanged: next.innerHTML === html, index: next.dataset.codeIndex,
      differentTheme: dark.innerHTML !== next.innerHTML,
      changed: changed.textContent?.includes('changed'),
      lines: next.querySelectorAll('[data-code-line]').length,
    };
  });
  expect(result).toEqual({ unchanged: true, index: '4', differentTheme: true, changed: true, lines: 3 });
});

test('opening preview reuses current output and edits still prepare the newest snapshot', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => (window as any).__mojian.setMarkdown('# 初稿\n\n```js\nconst value = 1;\n```'));
  await page.waitForFunction(() => { const m = (window as any).__mojian; return m.getOutput()?.key === JSON.stringify([m.getMarkdown(), m.getSettings()]); });
  await page.evaluate(() => { (window as any).__preparedOutput = (window as any).__mojian.getOutput(); });
  await page.clock.install();
  await page.getByRole('button', { name: '公众号预览', exact: true }).click();
  await page.clock.fastForward(1000);
  expect(await page.evaluate(() => (window as any).__preparedOutput === (window as any).__mojian.getOutput())).toBe(true);
  await page.evaluate(() => { const m = (window as any).__mojian; m.setMarkdown('# 过期稿'); m.setMarkdown('# 最新稿'); });
  await page.clock.fastForward(1000);
  await expect(page.locator('.preview-paper h1')).toHaveText('最新稿');
  await page.screenshot({ path: '/tmp/mojian-optimized-preview.png' });
});
