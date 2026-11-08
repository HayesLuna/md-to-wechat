import { test, expect } from './fixtures';

test('storage reuses connections, deduplicates image loads and releases connections for upgrades', async ({
  page,
}) => {
  await page.route('**/storage-check', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/storage-check');
  const result = await page.evaluate(async () => {
    const storage = await import('/src/storage.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const open = indexedDB.open.bind(indexedDB);
    let opens = 0;
    indexedDB.open = ((...args: Parameters<typeof open>) => {
      if (args[0] === 'mojian-v1') opens++;
      return open(...args);
    }) as typeof open;
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const src = await storage.storeImage(blob);
    let reads = 0;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === 'images') reads++;
      return get.call(this, key);
    };
    const draft = storage.newDraft(
      '# Test\n\n![image](' + src + ')',
      DEFAULT_SETTINGS,
    );
    await storage.saveDraft(draft);
    await storage.saveDraft({ ...draft, version: draft.version + 1 });
    const saveImageReads = reads;
    const urls = await Promise.all(
      Array.from({ length: 8 }, () => storage.imageURL(src)),
    );
    const imageReads = reads;
    const loaded = await (await fetch(urls[0])).blob();
    const restored = await storage.loadDrafts();
    // A missing image must be retried if the resource becomes available later.
    const missing = await storage.imageURL('local-image:restored');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = open('mojian-v1', 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('images', 'readwrite');
      tx.objectStore('images').put(blob, 'restored');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
    const recovered = await storage.imageURL('local-image:restored');
    // This upgrade would hang if the app kept any old connections open.
    await new Promise<void>((resolve, reject) => {
      const request = open('mojian-v1', 5);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    return {
      opens,
      saveImageReads,
      imageReads,
      uniqueURLs: new Set(urls).size,
      bytes: loaded.size,
      expectedBytes: blob.size,
      markdown: restored.drafts[0].markdown,
      expectedMarkdown: draft.markdown,
      missing,
      recovered,
    };
  });
  expect(result.opens).toBe(1);
  expect(result.saveImageReads).toBe(0);
  expect(result.imageReads).toBe(1);
  expect(result.uniqueURLs).toBe(1);
  expect(result.bytes).toBe(result.expectedBytes);
  expect(result.markdown).toBe(result.expectedMarkdown);
  expect(result.missing).toBe('');
  expect(result.recovered).toMatch(/^blob:/);
});

test('conflicting writes reject without changing content or active draft; deletion keeps the latest retained draft', async ({
  page,
}) => {
  await page.route('**/storage-conflicts', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/storage-conflicts');
  const result = await page.evaluate(async () => {
    const s = await import('/src/storage.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const original = { ...s.newDraft('# 原稿', DEFAULT_SETTINGS), version: 10 };
    const other = {
      ...s.newDraft('# 其他文章', DEFAULT_SETTINGS),
      version: 10,
    };
    await s.saveDraft(original);
    await s.saveDraft(other);
    const latest = {
      ...original,
      markdown: '# 新内容',
      title: '新内容',
      version: 20,
    };
    await s.saveDraft(latest, 10);
    await s.saveDraft(other, 10);
    const conflicts: boolean[] = [];
    for (const [draft, expected] of [
      [{ ...original, markdown: '# 旧版本修改', version: 11 }, undefined],
      [{ ...original, markdown: '# 相同版本修改', version: 20 }, undefined],
      [{ ...original, markdown: '# 基于旧快照的新版本', version: 30 }, 10],
      [{ ...latest, readOnly: true }, 20],
    ] as const) {
      try {
        await s.saveDraft(draft, expected);
        conflicts.push(false);
      } catch (e) {
        conflicts.push(e instanceof s.DraftConflictError);
      }
    }
    const before = await s.loadDrafts();
    const retained = await s.removeDraft(other.id, original);
    const after = await s.loadDrafts();
    await s.removeDraft(original.id, s.newDraft('', DEFAULT_SETTINGS));
    let deletedConflict = false;
    try {
      await s.saveDraft({ ...original, version: 40 }, 20);
    } catch (e) {
      deletedConflict = e instanceof s.DraftConflictError;
    }
    return {
      conflicts,
      activeUnchanged: before.activeId === other.id,
      retained: retained.markdown,
      content: after.drafts[0].markdown,
      count: after.drafts.length,
      deletedConflict,
    };
  });
  expect(result).toEqual({
    conflicts: [true, true, true, true],
    activeUnchanged: true,
    retained: '# 新内容',
    content: '# 新内容',
    count: 1,
    deletedConflict: true,
  });
});

test('local image URLs stay valid while owned and are released after all views close', async ({
  page,
}) => {
  await page.route('**/image-lifecycle', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/image-lifecycle');
  await page.clock.install();
  await page.evaluate(async () => {
    const s = await import('/src/storage.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const src = await s.storeImage(blob);
    const first = await s.acquireImageURL(src);
    const second = await s.acquireImageURL(src);
    const fullscreen = s.retainImageURL(first.url);
    const revoked: string[] = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      revoked.push(url);
      revoke(url);
    };
    Object.assign(window, {
      imageLifecycle: { src, first, second, fullscreen, revoked },
    });
  });
  await page.clock.fastForward(31_000);
  expect(
    await page.evaluate(() => (window as any).imageLifecycle.revoked),
  ).toEqual([]);
  await page.evaluate(() => {
    const t = (window as any).imageLifecycle;
    t.first.release();
    t.first.release();
    t.second.release();
  });
  await page.clock.fastForward(31_000);
  expect(
    await page.evaluate(() => (window as any).imageLifecycle.revoked),
  ).toEqual([]);
  await page.evaluate(() => (window as any).imageLifecycle.fullscreen());
  await page.clock.fastForward(31_000);
  const result = await page.evaluate(async () => {
    const t = (window as any).imageLifecycle;
    const s = await import('/src/storage.ts');
    const renewed = await s.acquireImageURL(t.src);
    const bytes = (await (await fetch(renewed.url)).blob()).size;
    renewed.release();
    return {
      same: t.first.url === t.second.url,
      revoked: t.revoked,
      old: t.first.url,
      newURL: renewed.url,
      bytes,
    };
  });
  expect(result.same).toBe(true);
  expect(result.revoked).toEqual([result.old]);
  expect(result.newURL).not.toBe(result.old);
  expect(result.bytes).toBeGreaterThan(0);
});

test('current draft library and image collection never reread article bodies', async ({
  page,
}) => {
  await page.route('**/metadata-library', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/metadata-library');
  const result = await page.evaluate(async () => {
    const s = await import('/src/storage.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 10;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const src = await s.storeImage(blob);
    for (let i = 0; i < 40; i++) {
      const draft = s.newDraft(
        '# **文章 ' +
          i +
          '**\n\n' +
          '内容'.repeat(2000) +
          (i === 0 ? '\n![共享图片](' + src + ')' : ''),
        DEFAULT_SETTINGS,
      );
      await s.saveDraft({ ...draft, id: String(i) });
    }
    let reads = 0;
    const getAll = IDBObjectStore.prototype.getAll,
      get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.getAll = function (...args) {
      if (this.name === 'draft') reads++;
      return getAll.apply(this, args);
    };
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name === 'draft') reads++;
      return get.apply(this, args);
    };
    const library = await s.loadDraftLibrary();
    const release = await s.beginImageSession();
    release();
    const libraryReads = reads;
    const selected = await s.loadDraft('0');
    const image = await s.imageBlob(src);
    return {
      count: library.drafts.length,
      title: library.drafts.find((d) => d.id === '0')?.title,
      hasBody: 'markdown' in library.drafts[0],
      libraryReads,
      selectedReads: reads - libraryReads,
      body: selected?.markdown.includes(src),
      image: image?.size === blob.size,
    };
  });
  expect(result).toEqual({
    count: 40,
    title: '文章 0',
    hasBody: false,
    libraryReads: 0,
    selectedReads: 1,
    body: true,
    image: true,
  });
});

test('disk usage counts saved text and separates unreferenced images', async ({
  page,
}) => {
  await page.route('**/storage-usage', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/storage-usage');
  const result = await page.evaluate(async () => {
    const storage = await import('/src/storage.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const used = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    canvas.width = 12;
    const unused = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const src = await storage.storeImage(used);
    await storage.storeImage(unused);
    const markdown = '# 占用\n\n![图](' + src + ')';
    await storage.saveDraft(storage.newDraft(markdown, DEFAULT_SETTINGS));
    await storage.saveDraft(storage.newDraft('没有图片', DEFAULT_SETTINGS));
    const usage = await storage.measureDraftDiskUsage();
    return {
      usage,
      textBytes: new TextEncoder().encode(markdown + '没有图片').length,
      used: used.size,
      unused: unused.size,
    };
  });
  expect(result.usage.draftCount).toBe(2);
  expect(result.usage.textBytes).toBe(result.textBytes);
  expect(result.usage.imageCount).toBe(2);
  expect(result.usage.imageBytes).toBe(result.used + result.unused);
  expect(result.usage.unusedCount).toBe(1);
  expect(result.usage.unusedBytes).toBe(result.unused);
  expect(result.usage.items.map((item) => item.title)).toEqual([
    '占用',
    '未命名文章',
  ]);
  expect(result.usage.items[0]?.imageBytes).toBe(result.used);
  expect(result.usage.items[1]?.imageBytes).toBe(0);
});

test('clearing unused images keeps saved drafts and the open article', async ({
  page,
}) => {
  await page.route('**/clear-unused', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/clear-unused');
  const result = await page.evaluate(async () => {
    const storage = await import('/src/storage.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const savedBlob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    canvas.width = 12;
    const orphanBlob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    canvas.width = 16;
    const pendingBlob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const saved = await storage.storeImage(savedBlob);
    const orphan = await storage.storeImage(orphanBlob);
    const pending = await storage.storeImage(pendingBlob);
    await storage.saveDraft(
      storage.newDraft('# 占用\n\n![图](' + saved + ')', DEFAULT_SETTINGS),
    );
    let imageReads = 0;
    const get = IDBObjectStore.prototype.get;
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name === 'images') imageReads++;
      return get.apply(this, args);
    };
    IDBObjectStore.prototype.getAll = function (...args) {
      if (this.name === 'images') imageReads++;
      return getAll.apply(this, args);
    };
    const cleared = await storage.clearUnreferencedImages(
      '还在写 ![图](' + pending + ')',
    );
    const readsDuringClear = imageReads;
    IDBObjectStore.prototype.get = get;
    IDBObjectStore.prototype.getAll = getAll;
    return {
      cleared,
      imageReads: readsDuringClear,
      orphanBytes: orphanBlob.size,
      saved: !!(await storage.imageBlob(saved)),
      pending: !!(await storage.imageBlob(pending)),
      orphan: await storage.imageBlob(orphan),
    };
  });
  expect(result.cleared).toEqual({
    status: 'cleared',
    count: 1,
    bytes: result.orphanBytes,
  });
  expect(result.imageReads).toBe(0);
  expect(result.saved).toBe(true);
  expect(result.pending).toBe(true);
  expect(result.orphan).toBeUndefined();
});

test('the open page can clear images and another page cannot', async ({
  page,
  context,
}) => {
  await page.route('**/clear-session', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/clear-session');
  const src = await page.evaluate(async () => {
    const storage = await import('/src/storage.ts');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    (window as any).__releaseImages = await storage.beginImageSession();
    await storage.storeImage(blob);
    const removed = await storage.clearUnreferencedImages('');
    return { removed, size: blob.size };
  });
  expect(src.removed).toEqual({
    status: 'cleared',
    count: 1,
    bytes: src.size,
  });
  const other = await context.newPage();
  await other.route('**/clear-session', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await other.goto('/clear-session');
  const blocked = await other.evaluate(async () => {
    const storage = await import('/src/storage.ts');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 9;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const orphan = await storage.storeImage(blob);
    const result = await storage.clearUnreferencedImages('');
    return { result, orphan: !!(await storage.imageBlob(orphan)) };
  });
  expect(blocked.result).toEqual({ status: 'busy' });
  expect(blocked.orphan).toBe(true);
  await page.evaluate(() => (window as any).__releaseImages());
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.locks.query()).held?.length || 0,
      ),
    )
    .toBe(0);
  const cleared = await other.evaluate(async () => {
    const storage = await import('/src/storage.ts');
    const result = await storage.clearUnreferencedImages('');
    return {
      status: result.status,
      images: (await storage.measureDraftDiskUsage()).imageCount,
    };
  });
  expect(cleared).toEqual({ status: 'cleared', images: 0 });
});

test('cleanup waits when the browser cannot check other pages', async ({
  page,
}) => {
  await page.route('**/clear-without-locks', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/clear-without-locks');
  const result = await page.evaluate(async () => {
    const storage = await import('/src/storage.ts');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const src = await storage.storeImage(blob);
    Object.defineProperty(navigator, 'locks', { value: undefined });
    const cleared = await storage.clearUnreferencedImages('');
    return { cleared, remains: !!(await storage.imageBlob(src)) };
  });
  expect(result.cleared).toEqual({ status: 'unknown' });
  expect(result.remains).toBe(true);
});

test('the storage dialog clears images left behind in this visit', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '查看本地草稿占用' }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const storage = await import('/src/storage.ts');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    await storage.storeImage(blob);
  });
  await page.getByRole('button', { name: '展开侧栏' }).click();
  await page.getByRole('button', { name: '切换到草稿' }).click();
  await page.getByRole('button', { name: '新建文章' }).click();
  await page.getByRole('button', { name: '查看本地草稿占用' }).click();
  await expect(page.locator('.storage-usage')).toContainText('未引用');
  await page.getByRole('button', { name: '清理未引用图片' }).click();
  await expect(page.locator('.storage-usage')).not.toContainText('未引用');
  await expect(page.locator('.app-footer')).toContainText('本地');
});

test('a share import that exceeds browser quota leaves no draft and still allows another save', async ({
  page,
}) => {
  const quota = 160 * 1024;
  await page
    .context()
    .route('**/quota-import', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
    );
  await page.goto('/quota-import');
  const origin = new URL(page.url()).origin;
  const limit = async (target: typeof page) => {
    const client = await target.context().newCDPSession(target);
    await client.send('Storage.overrideQuotaForOrigin', {
      origin,
      quotaSize: quota,
    });
  };
  await limit(page);
  const result = await page.evaluate(async () => {
    const storage = await import('/src/storage.ts');
    const { DEFAULT_SETTINGS } = await import('/src/sample.ts');
    const existing = storage.newDraft('# 原来的文章\n\n正文', DEFAULT_SETTINGS);
    await storage.saveDraft(existing);
    const imageId = crypto.randomUUID();
    const incoming = storage.newDraft(
      '# 导入的大文章\n\n![图](local-image:' + imageId + ')',
      DEFAULT_SETTINGS,
    );
    let errorName = '';
    try {
      await storage.importSharedDraft(
        incoming,
        [{ id: imageId, blob: new Blob([new Uint8Array(256 * 1024)]) }],
        'quota-share',
      );
    } catch (error) {
      errorName = error instanceof DOMException ? error.name : 'Error';
    }
    const saved = await storage.loadDraft(existing.id);
    let saveError = '';
    try {
      await storage.saveDraft(
        {
          ...saved!,
          markdown: '# 原来的文章\n\n改过了',
          version: saved!.version + 1,
          savedAt: Date.now(),
        },
        saved!.version,
      );
    } catch (error) {
      saveError = error instanceof DOMException ? error.name : 'Error';
    }
    const usage = await storage.measureDraftDiskUsage();
    return {
      errorName,
      saveError,
      imported: !!(await storage.loadDraft(incoming.id)),
      marked: !!(await storage.importedShareDraft('quota-share')),
      image: !!(await storage.imageBlob('local-image:' + imageId)),
      drafts: usage.draftCount,
      images: usage.imageCount,
      markdown: (await storage.loadDraft(existing.id))?.markdown,
      bytes: (await navigator.storage.estimate()).usage ?? 0,
    };
  });
  expect(result.errorName).toBe('QuotaExceededError');
  expect(result.imported).toBe(false);
  expect(result.marked).toBe(false);
  expect(result.image).toBe(false);
  expect(result.drafts).toBe(1);
  expect(result.images).toBe(0);
  expect(result.markdown).toBe('# 原来的文章\n\n改过了');
  expect(result.saveError).toBe('');
  expect(result.bytes).toBeLessThan(quota);
});
