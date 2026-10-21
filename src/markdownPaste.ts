import type { JSONContent } from '@tiptap/core';

// Prefer structured rich text. Plain-text and plain HTML wrappers may carry
// Markdown source from Typora, which needs the Markdown parser instead.
export function shouldParseMarkdownPaste(text: string, html: string) {
  if (!text) return false;
  if (!html) return true;
  const root = new DOMParser().parseFromString(html, 'text/html');
  // Native editor HTML already describes its nodes and selection context.
  if (root.querySelector('[data-pm-slice]')) return false;
  // Source editors can wrap raw Markdown in syntax-highlighted HTML. Prefer
  // source only when its text matches and no rendered article structure exists.
  const pre = root.querySelector('pre');
  const code = pre?.querySelector('code') || root.querySelector('code');
  const language =
    /(?:language-|lang-)([\w-]+)/i
      .exec(`${pre?.className || ''} ${code?.className || ''}`)?.[1]
      ?.toLowerCase() ||
    (
      code?.getAttribute('data-language') ||
      pre?.getAttribute('data-language') ||
      code?.getAttribute('lang') ||
      pre?.getAttribute('lang')
    )?.toLowerCase();
  const normalized = (value: string) => value.replace(/\r\n?/g, '\n').trim();
  const source = normalized(text);
  const body = root.body.cloneNode(true) as HTMLElement;
  body.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  const rawOnly =
    normalized(body.textContent || '') === source &&
    (!pre ||
      (root.querySelectorAll('pre').length === 1 &&
        normalized(pre.textContent || '') === source)) &&
    !root.querySelector('h1,h2,h3,h4,h5,h6,ul,ol,table,blockquote,img');
  const markdownLanguage = language === 'markdown' || language === 'md';
  const neutralLanguage =
    !language || ['plaintext', 'text', 'txt'].includes(language);
  const markdownBlocks =
    /^(?: {0,3}#{1,6}\s+\S| {0,3}[-+*]\s+\[[ xX]\]\s+\S| {0,3}(?:`{3,}|~{3,})\w*)/m.test(
      source,
    );
  if (
    rawOnly &&
    (markdownLanguage ||
      (neutralLanguage && markdownBlocks && (pre || source.includes('\n'))))
  )
    return true;
  return !root.querySelector(
    '[data-pm-slice],h1,h2,h3,h4,h5,h6,ul,ol,table,blockquote,pre,code,strong,b,em,i,s,del,mark,a,img',
  );
}

// Typora and GFM exporters use checkbox inputs without Tiptap's data-type
// attributes. Normalize only direct checkboxes belonging to each list item.
export function normalizeTaskClipboardHTML(html: string) {
  if (!/checkbox/i.test(html)) return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const list of Array.from(document.querySelectorAll('ul')).reverse()) {
    const groups: { task: boolean; items: HTMLLIElement[] }[] = [];
    for (const item of Array.from(list.children)) {
      if (item.tagName !== 'LI') continue;
      const checkbox = item.querySelector<HTMLInputElement>(
        ':scope > input[type="checkbox"], :scope > label input[type="checkbox"], :scope > p input[type="checkbox"]',
      );
      const task = !!checkbox || item.getAttribute('data-type') === 'taskItem';
      if (checkbox) {
        item.setAttribute('data-type', 'taskItem');
        item.setAttribute('data-checked', String(checkbox.checked));
        const label = checkbox.closest('label');
        checkbox.remove();
        if (label && !label.textContent?.trim() && !label.children.length)
          label.remove();
      }
      const previous = groups.at(-1);
      if (previous?.task === task) previous.items.push(item as HTMLLIElement);
      else groups.push({ task, items: [item as HTMLLIElement] });
    }
    if (!groups.some((group) => group.task)) continue;
    if (groups.length === 1) {
      list.setAttribute('data-type', 'taskList');
      continue;
    }
    const lists = groups.map((group) => {
      const replacement = list.cloneNode(false) as HTMLUListElement;
      if (group.task) replacement.setAttribute('data-type', 'taskList');
      else replacement.removeAttribute('data-type');
      replacement.append(...group.items);
      return replacement;
    });
    list.replaceWith(...lists);
  }
  return document.body.innerHTML;
}
export function centerUnalignedPastedTables(node: JSONContent): JSONContent {
  return {
    ...node,
    ...(['tableCell', 'tableHeader'].includes(node.type || '') &&
    !node.attrs?.align
      ? { attrs: { ...node.attrs, align: 'center' } }
      : {}),
    ...(node.content
      ? { content: node.content.map(centerUnalignedPastedTables) }
      : {}),
  };
}

export function normalizePastedTableHTML(html: string) {
  if (!/<(?:td|th)\b/i.test(html)) return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const cell of document.querySelectorAll<HTMLElement>('td,th')) {
    const align = (cell.style.textAlign || cell.getAttribute('align') || '')
      .trim()
      .toLowerCase();
    // Preserve supported explicit alignment through the style sanitizer.
    cell.setAttribute(
      'align',
      ['left', 'center', 'right'].includes(align) ? align : 'center',
    );
  }
  return document.body.innerHTML;
}
