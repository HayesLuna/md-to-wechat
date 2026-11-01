import {
  credentialErrorMessage,
  credentialResponseError,
} from './storageErrors';
import {
  createArticlePackage,
  importArticlePackage,
  MAX_PACKAGE_BYTES,
  packageHash,
} from './articlePackage';
import { createShareStorage } from './adapters';
import {
  addShareRecord,
  removeShareRecord,
  sameTarget,
  shareLifetime,
} from './config';
import { importedShareDraft, type Draft } from '../storage';
import type {
  ShareDescriptor,
  ShareRecord,
  ShareStorage,
  ShareStorageConfig,
} from './types';

export function shareError() {
  return '操作未完成，请检查网络、凭证权限、桶的 CORS 配置和本机时间后重试。';
}
export function encodeShareLink(
  descriptor: ShareDescriptor,
  base = location.href,
) {
  const url = new URL(base);
  url.search = '';
  url.hash = 'share=' + encodeURIComponent(JSON.stringify(descriptor));
  return url.href;
}
export function decodeShareLink(hash: string): ShareDescriptor {
  let value: unknown;
  try {
    if (!hash.startsWith('#share=') || hash.length > 24000) throw new Error();
    value = JSON.parse(decodeURIComponent(hash.slice(7)));
  } catch {
    throw new Error('分享链接不完整或格式不正确。');
  }
  const d = value as Partial<ShareDescriptor> | null;
  if (
    !d ||
    d.version !== 1 ||
    typeof d.id !== 'string' ||
    !/^[a-zA-Z0-9-]{16,64}$/.test(d.id) ||
    typeof d.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(d.sha256) ||
    typeof d.url !== 'string' ||
    !Number.isSafeInteger(d.expiresAt) ||
    d.expiresAt! <= 0
  )
    throw new Error('分享链接格式不正确。');
  let url: URL;
  try {
    url = new URL(d.url);
  } catch {
    throw new Error('分享下载地址不正确。');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('分享下载地址必须使用 HTTPS，且不能包含账号信息。');
  return {
    version: 1,
    id: d.id,
    sha256: d.sha256,
    url: url.href,
    expiresAt: d.expiresAt!,
  };
}

function keyFor(config: ShareStorageConfig, name: string) {
  const prefix = config.prefix.replace(/^\/+|\/+$/g, '');
  return `${prefix ? prefix + '/' : ''}${name}`;
}

export async function fetchShareBytes(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const expired = await credentialResponseError(response);
    if (expired) throw expired;
    if ([401, 403, 404, 410].includes(response.status))
      throw new Error('分享已过期、已取消或没有读取权限。');
    throw new Error('下载未完成，请稍后重试。');
  }
  if (Number(response.headers.get('content-length')) > MAX_PACKAGE_BYTES)
    throw new Error('文章包不能超过 50 MB。');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('浏览器无法读取文章包。');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PACKAGE_BYTES) throw new Error('文章包不能超过 50 MB。');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function createShare(
  config: ShareStorageConfig,
  article: Pick<Draft, 'id' | 'title' | 'markdown' | 'settings'>,
  requestedSeconds: number,
  makeStorage: (
    config: ShareStorageConfig,
  ) => Promise<ShareStorage> = createShareStorage,
) {
  shareLifetime(config, requestedSeconds);
  const { blob, sha256 } = await createArticlePackage(article);
  const id = crypto.randomUUID();
  const key = keyFor(config, `${id}.mojian`);
  const storage = await makeStorage(config);
  try {
    await storage.upload(key, blob);
  } catch (error) {
    throw new Error(credentialErrorMessage(error) || shareError(), {
      cause: error,
    });
  }
  let record: ShareRecord;
  try {
    // Validate the configured share duration again after packaging and upload.
    const seconds = shareLifetime(config, requestedSeconds);
    const createdAt = Date.now();
    const expiresAt = createdAt + seconds * 1000;
    const url = await storage.downloadURL(key, seconds);
    const descriptor: ShareDescriptor = {
      version: 1,
      id,
      url,
      expiresAt,
      sha256,
    };
    // Validate even provider-generated URLs before creating a transferable link.
    const link = encodeShareLink(descriptor);
    decodeShareLink(new URL(link).hash);
    record = {
      id,
      draftId: article.id,
      title: article.title,
      key,
      createdAt,
      expiresAt,
      link,
      target: {
        provider: config.provider,
        bucket: config.bucket,
        region: config.region,
        endpoint: config.endpoint,
      },
    };
    addShareRecord(record);
  } catch (error) {
    await storage.remove(key).catch(() => {});
    throw new Error(
      credentialErrorMessage(error) ||
        '分享链接未能生成或保存，请检查凭证和浏览器存储后重试。',
      { cause: error },
    );
  }
  return record;
}

export async function receiveShare(hash: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const descriptor = decodeShareLink(hash);
  const source = `${descriptor.id}:${descriptor.sha256}`;
  const previous = await importedShareDraft(source);
  signal?.throwIfAborted();
  if (previous) return previous;
  if (descriptor.expiresAt <= Date.now())
    throw new Error('分享链接已过期，请联系发送方重新分享。');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await fetchShareBytes(descriptor.url, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      credentialErrorMessage(error, true) ||
        (error instanceof TypeError ||
        (error instanceof DOMException && error.name === 'TimeoutError')
          ? '下载失败，请检查网络和存储服务的 CORS 配置后重试。'
          : error instanceof Error
            ? error.message
            : '下载失败，请重试。'),
      { cause: error },
    );
  }
  if ((await packageHash(bytes)) !== descriptor.sha256)
    throw new Error('文章包校验失败，文件可能已损坏或被替换。');
  signal?.throwIfAborted();
  // Decode completely before the storage transaction; failed imports leave no images.
  return importArticlePackage(bytes, source, signal);
}

export async function cancelShare(
  config: ShareStorageConfig,
  record: ShareRecord,
  makeStorage = createShareStorage,
) {
  if (!sameTarget(config, record))
    throw new Error('请先恢复这条分享所使用的存储配置，再取消分享。');
  const storage = await makeStorage(config);
  try {
    await storage.remove(record.key);
  } catch (error) {
    throw new Error(credentialErrorMessage(error) || shareError(), {
      cause: error,
    });
  }
  removeShareRecord(record.id);
}

export async function testShareStorage(
  config: ShareStorageConfig,
  makeStorage = createShareStorage,
) {
  const seconds = shareLifetime(config, 60);
  const storage = await makeStorage(config);
  const key = keyFor(config, `connection-test-${crypto.randomUUID()}`);
  let uploaded = false;
  let removed = false;
  try {
    await storage.upload(
      key,
      new Blob(['mojian-share-test'], { type: 'application/octet-stream' }),
    );
    uploaded = true;
    const url = await storage.downloadURL(key, seconds);
    const bytes = await fetchShareBytes(url);
    if (new TextDecoder().decode(bytes) !== 'mojian-share-test')
      throw new Error();
    await storage.remove(key);
    removed = true;
  } catch (error) {
    throw new Error(
      credentialErrorMessage(error) ||
        (uploaded
          ? '连接测试未完成：上传成功，请检查下载、删除权限及 CORS。临时测试文件可通过桶的生命周期规则清理。'
          : shareError()),
      { cause: error },
    );
  } finally {
    if (uploaded && !removed) await storage.remove(key).catch(() => {});
  }
}
