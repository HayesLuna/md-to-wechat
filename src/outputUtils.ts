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

export function widthFromTitle(title: string, fallback = 100) {
  const m = /^width=(\d{1,3})%(?: indent=\d+)?$/.exec(title || '');
  return m ? Math.min(200, Math.max(1, Number(m[1]))) : fallback;
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

export const isImageName = (name: string | undefined) => name === 'inlineImage';

export function codeInfo(info: string) {
  const match = /(?:^|\s)indent=(\d+)$/.exec(info.trim());
  return {
    language: (match ? info.trim().slice(0, match.index) : info).trim(),
    indent: imageIndent(match?.[1]),
  };
}

// Cap the visual offset at 40% of a narrow cell/list/quote. Image callers apply
// this as a margin so indentation never consumes the image's percentage width.
export function imageIndentPadding(value: unknown) {
  const pixels = imageIndent(value) * IMAGE_INDENT_STEP;
  return pixels ? `min(${pixels}px, 40%)` : '0px';
}

// An inline image reserves its width plus the indentation, capped at one line.
// Resolve the inner offset against that reserved width, so the image keeps the
// same percentage of the original paragraph even when the wrapper is capped.
export function inlineImageLayout(percent: number, indent: unknown) {
  const level = imageIndent(indent);
  if (!level)
    return {
      width: `${Math.min(100, percent)}%`,
      imageWidth: `${Math.max(100, percent)}%`,
      offset: '0px',
    };
  const offset = `min(${level * IMAGE_INDENT_STEP}px, ${Math.max(40, 40 / (percent / 100 + 0.4))}%)`;
  return {
    width: `min(100%, calc(${percent}% + ${imageIndentPadding(level)}))`,
    imageWidth: `max(calc(100% - ${offset}), ${percent}%)`,
    offset,
  };
}
