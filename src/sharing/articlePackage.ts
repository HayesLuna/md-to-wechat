import { imageBlob, importSharedDraft } from '../storage';
import type { Draft } from '../storage';
import {
  MAX_PACKAGE_BYTES,
  type ShareArticle,
  type PackageRequest,
  type PackageResponse,
  type DecodedArticle,
} from './packageProtocol';

export { MAX_PACKAGE_BYTES } from './packageProtocol';

export { packageHash } from './packageHash';

function packageTask<T>(
  request: PackageRequest,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./articlePackage.worker.ts', import.meta.url),
      { type: 'module' },
    );
    let settled = false;
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () =>
      finish(signal?.reason || new DOMException('操作已取消', 'AbortError'));
    const timer = setTimeout(
      () => finish(new Error('文章包处理超时，请重试。')),
      120_000,
    );
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      finish(new Error('文章包处理模块加载失败，请联网后重试。'));
    };
    worker.onmessageerror = () => finish(new Error('文章包处理失败，请重试。'));
    worker.onmessage = (event: MessageEvent<PackageResponse>) => {
      const response = event.data;
      if (response.type === 'error') finish(new Error(response.error));
      else if (response.type === 'images') {
        void (async () => {
          try {
            const blobs: (Blob | undefined)[] = [];
            let size = 0;
            for (const source of response.sources) {
              if (settled) return;
              const blob = await imageBlob(source);
              size += blob?.size || 0;
              if (size > MAX_PACKAGE_BYTES)
                throw new Error('文章和图片合计不能超过 50 MB。');
              blobs.push(blob);
            }
            if (!settled)
              worker.postMessage({
                type: 'images',
                blobs,
              } satisfies PackageRequest);
          } catch (error) {
            finish(error);
          }
        })();
      } else finish(undefined, response.result as T);
    };
    try {
      worker.postMessage(request);
    } catch (error) {
      finish(error);
    }
  });
}

export function createArticlePackage(article: ShareArticle) {
  return packageTask<{ blob: Blob; sha256: string }>({
    type: 'create',
    article: {
      title: article.title,
      markdown: article.markdown,
      settings: article.settings,
    },
  });
}

export async function readArticlePackage(
  bytes: Uint8Array<ArrayBuffer>,
  signal?: AbortSignal,
) {
  if (bytes.length > MAX_PACKAGE_BYTES)
    throw new Error('文章包不能超过 50 MB。');
  const decoded = await packageTask<DecodedArticle>(
    { type: 'read', blob: new Blob([bytes]) },
    signal,
  );
  const now = Date.now();
  const draft: Draft = {
    id: crypto.randomUUID(),
    title: decoded.title,
    markdown: decoded.markdown,
    settings: decoded.settings,
    customTitle: true,
    readOnly: false,
    createdAt: now,
    savedAt: now,
    version: now,
  };
  return { draft, images: decoded.images };
}

export async function importArticlePackage(
  bytes: Uint8Array<ArrayBuffer>,
  source: string,
  signal?: AbortSignal,
) {
  const { draft, images } = await readArticlePackage(bytes, signal);
  signal?.throwIfAborted();
  return importSharedDraft(draft, images, source);
}
