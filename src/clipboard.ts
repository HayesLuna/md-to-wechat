import type { Output } from './output';

let pendingImageCopy: AbortController | undefined;

export async function copyRich(output: Output) {
  pendingImageCopy?.abort();
  if (!window.isSecureContext)
    throw new Error(
      '富文本复制需要 HTTPS 独立网页，请在安全页面中打开后重试。',
    );
  if (!navigator.clipboard?.write || !window.ClipboardItem)
    throw new Error(
      '当前浏览器不支持富文本剪贴板写入，请使用支持此功能的 HTTPS 独立网页。',
    );
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([output.html], { type: 'text/html' }),
        'text/plain': new Blob([output.text], { type: 'text/plain' }),
      }),
    ]);
  } catch (e) {
    throw new Error(
      `复制失败：${e instanceof DOMException ? e.name : '写入未完成'}。请允许剪贴板权限，或在 HTTPS 独立网页中打开后点击重试。`,
      { cause: e },
    );
  }
}

export async function copyText(text: string) {
  pendingImageCopy?.abort();
  if (!navigator.clipboard?.writeText)
    throw new Error('当前浏览器不支持现代剪贴板 API。');
  await navigator.clipboard.writeText(text);
}

function imagePNG(image: HTMLImageElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('图片复制失败，请重试。');
  context.drawImage(image, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('图片复制失败，请重试。')),
      'image/png',
    );
  });
}

async function readableImagePNG(image: HTMLImageElement, signal: AbortSignal) {
  try {
    return await imagePNG(image);
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'SecurityError')
      throw error;
    // Displaying an image without crossorigin taints the canvas even when the
    // server permits CORS. Reload only for copying, without altering the view.
    const remote = new Image();
    remote.crossOrigin = 'anonymous';
    remote.referrerPolicy = image.referrerPolicy;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        remote.onload = remote.onerror = null;
      };
      const cancel = () => {
        cleanup();
        remote.src = '';
        reject(new DOMException('Copy superseded', 'AbortError'));
      };
      const timer = setTimeout(() => {
        cleanup();
        remote.src = '';
        reject(new Error('图片读取超时。'));
      }, 15000);
      remote.onload = () => {
        cleanup();
        resolve();
      };
      remote.onerror = () => {
        cleanup();
        reject(new Error('图片服务器未允许跨域读取。'));
      };
      if (signal.aborted) {
        cancel();
        return;
      }
      signal.addEventListener('abort', cancel, { once: true });
      remote.src = image.currentSrc || image.src;
    });
    return imagePNG(remote);
  }
}

// Start the write during the copy gesture; ClipboardItem accepts promises for
// pixels fetched with CORS and for asynchronously encoded local images.
export async function copyImage(
  image: HTMLImageElement,
  markdown?: string,
  { nativeCopied = false }: { nativeCopied?: boolean } = {},
) {
  if (!navigator.clipboard?.write || !window.ClipboardItem)
    throw new Error('当前浏览器不支持图片复制。');
  if (!image.complete || !image.naturalWidth)
    throw new Error('图片尚未加载完成，请稍后重试。');
  pendingImageCopy?.abort();
  const controller = new AbortController();
  pendingImageCopy = controller;
  const cancel = () => controller.abort();
  // Capture observes the next copy, even when it is ordinary text handled by
  // the browser. The current copy has already passed this capture phase.
  document.addEventListener('copy', cancel, true);
  document.addEventListener('cut', cancel, true);
  const cancelled = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => reject(new DOMException('Copy superseded', 'AbortError')),
      { once: true },
    );
  });
  const html = (src: string) => {
    const element = document.createElement('img');
    element.src = src;
    element.alt = image.alt;
    if (markdown) element.setAttribute('data-mojian-image', 'true');
    return new Blob([element.outerHTML], { type: 'text/html' });
  };
  const text = new Blob([markdown ?? image.alt], { type: 'text/plain' });
  let pixelFailure = false;
  const png = Promise.race([
    readableImagePNG(image, controller.signal),
    cancelled,
  ]).catch((error: unknown) => {
    pixelFailure = true;
    throw error;
  });
  const embeddedHTML = png.then(
    (blob) =>
      new Promise<Blob>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(html(String(reader.result)));
        reader.onerror = () => reject(new Error('图片复制失败，请重试。'));
        reader.readAsDataURL(blob);
      }),
  );
  // A denied write may reject before encoding/fetching finishes. Observe these
  // promises too, so later failures cannot become unhandled rejections.
  void png.catch(() => {});
  void embeddedHTML.catch(() => {});
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': text,
        'text/html': embeddedHTML,
        'image/png': png,
      }),
    ]);
  } catch (error) {
    if (controller.signal.aborted) return;
    if (!pixelFailure) throw error;
    // The editor's copy event already wrote this HTML. Avoid replacing it a
    // second time while a paste or clipboard reader may be consuming it.
    if (nativeCopied) return;
    // Servers that actually deny CORS can still be copied as rich HTML.
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': text,
        'text/html': html(image.currentSrc || image.src),
      }),
    ]);
  } finally {
    document.removeEventListener('copy', cancel, true);
    document.removeEventListener('cut', cancel, true);
    if (pendingImageCopy === controller) pendingImageCopy = undefined;
  }
}
