import type { Output } from './output';

export async function copyRich(output: Output) {
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
  if (!navigator.clipboard?.writeText)
    throw new Error('当前浏览器不支持现代剪贴板 API。');
  await navigator.clipboard.writeText(text);
}
