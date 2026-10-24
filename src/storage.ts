import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { headings } from './headings';
import type { Settings } from './sample';
export type Draft = {
  id: string;
  title: string;
  customTitle?: boolean;
  markdown: string;
  settings: Settings;
  version: number;
  createdAt: number;
  savedAt: number;
};
export type DraftSummary = Omit<Draft, 'markdown' | 'settings'>;
type DraftInfo = DraftSummary & { imageIds: string[] };
export function summarizeDraft(draft: DraftSummary): DraftSummary {
  const { id, title, customTitle, version, createdAt, savedAt } = draft;
  return { id, title, customTitle, version, createdAt, savedAt };
}
function draftInfo(draft: Draft): DraftInfo {
  return {
    ...summarizeDraft(draft),
    imageIds: [
      ...new Set(
        Array.from(
          draft.markdown.matchAll(/local-image:([a-zA-Z0-9-]+)/g),
          (match) => match[1],
        ),
      ),
    ],
  };
}
export function compareDraftCreation(a: DraftSummary, b: DraftSummary) {
  return a.createdAt === b.createdAt
    ? a.id.localeCompare(b.id)
    : b.createdAt - a.createdAt;
}
export function draftTitle(markdown: string) {
  return (
    headings(markdown)
      .find((heading) => heading.level === 1)
      ?.text.slice(0, 100) || '未命名文章'
  );
}
export function newDraft(markdown: string, settings: Settings): Draft {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: draftTitle(markdown),
    markdown,
    settings,
    version: now,
    createdAt: now,
    savedAt: now,
  };
}
interface StorageSchema extends DBSchema {
  draft: { key: string; value: Draft };
  images: { key: string; value: Blob };
  draftInfo: { key: string; value: DraftInfo };
  meta: { key: string; value: string };
}
export class DraftConflictError extends Error {
  constructor() {
    super('草稿已在其他页面更新，请先导出当前正文，刷新后再编辑。');
    this.name = 'DraftConflictError';
  }
}
let connection: Promise<IDBPDatabase<StorageSchema>> | undefined;
function db() {
  if (connection) return connection;
  const pending = openDB<StorageSchema>('mojian-v1', 4, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('draft');
        db.createObjectStore('images');
      }
      if (oldVersion < 2) db.createObjectStore('meta');
      if (oldVersion < 4) db.createObjectStore('draftInfo');
      // Keep migration atomic: metadata and legacy bodies commit together.
      void (async () => {
        const store = tx.objectStore('draft');
        if (oldVersion < 2) {
          const legacy = await store.get('current');
          if (legacy) {
            const draft = {
              ...legacy,
              id: crypto.randomUUID(),
              title: draftTitle(legacy.markdown),
              createdAt: Date.now(),
            };
            await store.put(draft, draft.id);
            await tx.objectStore('meta').put(draft.id, 'active');
            await store.delete('current');
          }
        }
        if (oldVersion < 4) {
          // One migration pass; subsequent library loads never read article bodies.
          let cursor = await store.openCursor();
          while (cursor) {
            const draft = cursor.value;
            const normalized = draft.customTitle
              ? draft
              : { ...draft, title: draftTitle(draft.markdown) };
            await cursor.update(normalized);
            await tx
              .objectStore('draftInfo')
              .put(draftInfo(normalized), normalized.id);
            cursor = await cursor.continue();
          }
        }
      })().catch(() => {
        try {
          tx.abort();
        } catch {
          /* The transaction may already be aborted. */
        }
      });
    },
    blocking() {
      // Release the connection when another tab upgrades the database.
      if (connection === pending) connection = undefined;
      void pending.then((database) => database.close());
    },
    terminated() {
      if (connection === pending) connection = undefined;
    },
  });
  connection = pending;
  void pending.catch(() => {
    if (connection === pending) connection = undefined;
  });
  return pending;
}
export async function loadDrafts(): Promise<{
  drafts: Draft[];
  activeId: string | undefined;
}> {
  const d = await db();
  const tx = d.transaction(['draft', 'meta']);
  const [drafts, activeId] = await Promise.all([
    tx.objectStore('draft').getAll(),
    tx.objectStore('meta').get('active'),
  ]);
  await tx.done;
  return {
    drafts: drafts.sort(compareDraftCreation),
    activeId,
  };
}

// UI callers load lightweight summaries, and fetch only the selected body.
export async function loadDraftLibrary() {
  const database = await db();
  const tx = database.transaction(['draftInfo', 'meta']);
  const [items, activeId] = await Promise.all([
    tx.objectStore('draftInfo').getAll(),
    tx.objectStore('meta').get('active'),
  ]);
  await tx.done;
  return {
    drafts: items.map(summarizeDraft).sort(compareDraftCreation),
    activeId,
  };
}
export async function loadDraft(id: string) {
  return (await db()).get('draft', id);
}

const IMAGE_SESSION_LOCK = 'mojian-image-session';

async function collectUnusedImages() {
  const database = await db();
  const tx = database.transaction(['draftInfo', 'images'], 'readwrite');
  const drafts = await tx.objectStore('draftInfo').getAll();
  const referenced = new Set(drafts.flatMap((draft) => draft.imageIds));
  const images = tx.objectStore('images');
  for (const id of await images.getAllKeys())
    if (!referenced.has(id)) await images.delete(id);
  await tx.done;
}

// Every live editor holds a shared lock, including while it has unsaved edits
// or undo history. Collect only before opening the first editor of a session.
// Browsers without Web Locks retain images instead of risking active content.
export async function beginImageSession(): Promise<() => void> {
  if (!navigator.locks) return () => {};
  await navigator.locks
    .request(
      IMAGE_SESSION_LOCK,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (lock) await collectUnusedImages();
      },
    )
    .catch(() => {});
  return new Promise((resolve) => {
    void navigator.locks
      .request(
        IMAGE_SESSION_LOCK,
        { mode: 'shared' },
        () => new Promise<void>((release) => resolve(release)),
      )
      .catch(() => resolve(() => {}));
  });
}
export async function saveDraft(draft: Draft, expectedVersion?: number) {
  const d = await db();
  const tx = d.transaction(['draft', 'draftInfo', 'meta'], 'readwrite');
  const previous = await tx.objectStore('draft').get(draft.id);
  if (
    (expectedVersion !== undefined && previous?.version !== expectedVersion) ||
    (previous &&
      (previous.version > draft.version ||
        (previous.version === draft.version &&
          (previous.markdown !== draft.markdown ||
            previous.title !== draft.title ||
            previous.customTitle !== draft.customTitle ||
            JSON.stringify(previous.settings) !==
              JSON.stringify(draft.settings)))))
  ) {
    await tx.done;
    throw new DraftConflictError();
  }
  const stored = {
    ...draft,
    title: draft.customTitle ? draft.title : draftTitle(draft.markdown),
    createdAt: previous?.createdAt ?? draft.createdAt,
  };
  await tx.objectStore('draft').put(stored, draft.id);
  await tx.objectStore('draftInfo').put(draftInfo(stored), draft.id);
  await tx.objectStore('meta').put(draft.id, 'active');
  await tx.done;
}
export async function removeDraft(id: string, next: Draft) {
  const d = await db();
  const tx = d.transaction(['draft', 'draftInfo', 'meta'], 'readwrite');
  const retained = await tx.objectStore('draft').get(next.id);
  await tx.objectStore('draft').delete(id);
  await tx.objectStore('draftInfo').delete(id);
  if (!retained) {
    await tx.objectStore('draft').put(next, next.id);
    await tx.objectStore('draftInfo').put(draftInfo(next), next.id);
  }
  await tx.objectStore('meta').put(next.id, 'active');
  await tx.done;
  return retained ?? next;
}
export async function storeImage(file: Blob) {
  if (
    !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)
  )
    throw new Error('仅支持 PNG、JPEG、WebP、GIF 图片。');
  if (file.size > 10 * 1024 * 1024)
    throw new Error('图片不能超过 10 MB，请压缩后重试。');
  const bitmap = await createImageBitmap(file);
  bitmap.close();
  const id = crypto.randomUUID();
  await (await db()).put('images', file, id);
  return 'local-image:' + id;
}
type ImageEntry = {
  promise: Promise<string>;
  url: string;
  users: number;
  timer?: ReturnType<typeof setTimeout>;
};
const urls = new Map<string, ImageEntry>();
const IMAGE_IDLE_MS = 30_000;
function scheduleRelease(src: string, entry: ImageEntry) {
  if (entry.users || entry.timer || !entry.url) return;
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    if (entry.users || urls.get(src) !== entry) return;
    urls.delete(src);
    if (entry.url) URL.revokeObjectURL(entry.url);
  }, IMAGE_IDLE_MS);
}
function imageEntry(src: string) {
  const cached = urls.get(src);
  if (cached) return cached;
  const entry: ImageEntry = { promise: Promise.resolve(''), url: '', users: 0 };
  entry.promise = (async () => {
    const blob = await (await db()).get('images', src.slice(12));
    entry.url = blob ? URL.createObjectURL(blob) : '';
    if (!entry.url) urls.delete(src);
    else scheduleRelease(src, entry);
    return entry.url;
  })().catch((error) => {
    if (urls.get(src) === entry) urls.delete(src);
    throw error;
  });
  urls.set(src, entry);
  return entry;
}
function retainEntry(src: string, entry: ImageEntry) {
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = undefined;
  }
  entry.users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.users--;
    scheduleRelease(src, entry);
  };
}
export async function imageURL(src: string) {
  if (!src.startsWith('local-image:'))
    return /^https?:\/\//i.test(src) ? src : '';
  return imageEntry(src).promise;
}
// Owners retain the shared URL until their editor, output or fullscreen view ends.
export async function acquireImageURL(src: string) {
  if (!src.startsWith('local-image:'))
    return { url: await imageURL(src), release: () => {} };
  const entry = imageEntry(src);
  const release = retainEntry(src, entry);
  try {
    return { url: await entry.promise, release };
  } catch (error) {
    release();
    throw error;
  }
}
export function retainImageURL(url: string) {
  for (const [src, entry] of urls)
    if (entry.url === url) return retainEntry(src, entry);
  return () => {};
}
export async function imageBlob(src: string): Promise<Blob | undefined> {
  return (await db()).get('images', src.slice(12));
}
export async function imageExists(src: string) {
  return !!(await db()).getKey('images', src.slice(12));
}
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadImage(src: string, name: string) {
  const blob = await imageBlob(src);
  if (!blob) throw new Error('本地图片资源缺失。');
  const extension =
    (
      {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      } as Record<string, string>
    )[blob.type] || 'png';
  download(blob, name + '.' + extension);
}
