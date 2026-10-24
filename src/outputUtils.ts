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
  const m = /^width=(\d{1,3})%$/.exec(title || '');
  return m ? Math.min(200, Math.max(1, Number(m[1]))) : 100;
}
