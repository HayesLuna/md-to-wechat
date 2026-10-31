import { encodeArticlePackage, decodeArticlePackage } from './packageCodec';
import type { PackageRequest, PackageResponse } from './packageProtocol';

const send = (response: PackageResponse) => self.postMessage(response);
let pendingImages:
  | {
      resolve: (blobs: (Blob | undefined)[]) => void;
      reject: (error: Error) => void;
    }
  | undefined;

self.addEventListener('message', (event: MessageEvent<PackageRequest>) => {
  const request = event.data;
  if (request.type === 'images') {
    pendingImages?.resolve(request.blobs);
    pendingImages = undefined;
    return;
  }
  if (request.type === 'error') {
    pendingImages?.reject(new Error(request.error));
    pendingImages = undefined;
    return;
  }
  void (async () => {
    try {
      if (request.type === 'create') {
        const result = await encodeArticlePackage(
          request.article,
          (sources) => {
            if (!sources.length) return Promise.resolve([]);
            return new Promise((resolve, reject) => {
              pendingImages = { resolve, reject };
              send({ type: 'images', sources });
            });
          },
        );
        send({ type: 'created', result });
      } else {
        const result = await decodeArticlePackage(
          new Uint8Array(await request.blob.arrayBuffer()),
        );
        send({ type: 'read', result });
      }
    } catch (error) {
      send({
        type: 'error',
        error:
          error instanceof Error ? error.message : '文章包处理失败，请重试。',
      });
    }
  })();
});
