import type { Settings } from './sample';

export const outputKey = (markdown: string, settings: Settings) =>
  JSON.stringify([markdown, settings]);

export function safeURL(url: string) {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function widthFromTitle(title: string) {
  const m = /^width=(\d{1,3})%(?: indent=\d+)?$/.exec(title || '');
  return m ? Math.min(200, Math.max(1, Number(m[1]))) : 100;
}

export const IMAGE_INDENT_STEP = 24;
export const MAX_IMAGE_INDENT = 6;

export function imageIndent(value: unknown) {
  const level = Number(value);
  return Number.isFinite(level)
    ? Math.min(MAX_IMAGE_INDENT, Math.max(0, Math.trunc(level)))
    : 0;
}

export function imageIndentFromTitle(title: string) {
  return imageIndent(/^width=\d{1,3}% indent=(\d+)$/.exec(title)?.[1]);
}

export const isImageName = (name: string | undefined) =>
  name === 'image' || name === 'inlineImage';

export function codeInfo(info: string) {
  const match = /(?:^|\s)indent=(\d+)$/.exec(info.trim());
  return {
    language: (match ? info.trim().slice(0, match.index) : info).trim(),
    indent: imageIndent(match?.[1]),
  };
}

// Keep logical indentation on resize, while leaving at least 60% of a narrow
// cell/list/quote's content width for the image itself.
export function imageIndentPadding(value: unknown) {
  const pixels = imageIndent(value) * IMAGE_INDENT_STEP;
  return pixels ? `min(${pixels}px, 40%)` : '0px';
}
