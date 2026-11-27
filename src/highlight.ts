import type { JSONContent } from '@tiptap/core';
import type MarkdownIt from 'markdown-it';

export function markdownHighlight(md: MarkdownIt) {
  md.inline.ruler.before('emphasis', 'highlight', (state, silent) => {
    if (
      silent ||
      state.src[state.pos] !== '=' ||
      state.src[state.pos + 1] !== '='
    )
      return false;
    let end = state.pos + 2;
    while (end < state.posMax && state.src[end] === '=') end++;
    // Keep individual characters until pairing. In "=====", the closing pair
    // starts at the fourth character, leaving one literal '=' inside the mark.
    for (let at = state.pos; at < end; at++) {
      const token = state.push('text', '', 0);
      token.content = '=';
      token.meta = {
        highlightDelimiter: true,
        hasNext: at + 1 < end,
        canOpen: at + 2 < state.posMax && !/\s/.test(state.src[at + 2]),
        canClose: at > 0 && !/\s/.test(state.src[at - 1]),
      };
    }
    state.pos = end;
    return true;
  });
  // Link and image destinations never reach the inline token stream. Pair only
  // delimiter tokens the parser actually emitted, so URL query strings cannot
  // consume a later highlight. One pass also handles dense or unclosed pairs.
  md.inline.ruler2.after('emphasis', 'highlight', (state) => {
    // Each concrete tag owns its unmatched opener. Popping the scope discards
    // it, so sibling links/marks cannot accidentally close one another.
    const scopes = [{ opening: -1, hasContent: false }];
    let changed = false;
    for (let index = 0; index < state.tokens.length; index++) {
      const token = state.tokens[index];
      if (token.nesting < 0) {
        scopes.pop();
        continue;
      }
      const scope = scopes[scopes.length - 1];
      if (token.nesting > 0) {
        scope.hasContent = true;
        scopes.push({ opening: -1, hasContent: false });
        continue;
      }
      const marker = token.meta as
        | {
            highlightDelimiter?: boolean;
            hasNext?: boolean;
            canOpen?: boolean;
            canClose?: boolean;
          }
        | undefined;
      if (!marker?.highlightDelimiter || !marker.hasNext) {
        if (token.content || token.type !== 'text') scope.hasContent = true;
        continue;
      }
      if (scope.opening >= 0) {
        if (marker.canClose && scope.hasContent) {
          const start = state.tokens[scope.opening];
          start.type = 'mark_open';
          start.tag = 'mark';
          start.nesting = 1;
          start.content = '';
          state.tokens[scope.opening + 1].content = '';
          token.type = 'mark_close';
          token.tag = 'mark';
          token.nesting = -1;
          token.content = '';
          state.tokens[++index].content = '';
          scope.opening = -1;
          scope.hasContent = false;
          changed = true;
        } else scope.hasContent = true;
      } else if (marker.canOpen) {
        scope.opening = index++;
        scope.hasContent = false;
      }
    }
    if (!changed) return false;
    let level = 0;
    for (const token of state.tokens) {
      if (token.nesting < 0) level--;
      token.level = level;
      if (token.nesting > 0) level++;
    }
    return true;
  });
}

export type HighlightPair = { from: number; to: number };

// Scan a paragraph from left to right. Code and escapes do not contribute
// delimiters; soft line breaks are allowed, paragraph breaks are not.
export function highlightPairs(source: string, limit = Infinity) {
  const pairs: HighlightPair[] = [];
  let opening: number | undefined;
  for (let i = 0; i < source.length; i++) {
    if (
      (source[i] === '\n' || source[i] === '\r') &&
      /^[\r\n][\t ]*[\r\n]/.test(source.slice(i))
    )
      opening = undefined;
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source[i] === '`') {
      const run = /^`+/.exec(source.slice(i))![0];
      const end = source.indexOf(run, i + run.length);
      if (end >= 0) {
        i = end + run.length - 1;
        continue;
      }
    }
    if (!source.startsWith('==', i)) continue;
    if (opening !== undefined) {
      if (i > opening + 2 && !/\s/.test(source[i - 1])) {
        pairs.push({ from: opening, to: i + 2 });
        if (pairs.length === limit) return pairs;
        opening = undefined;
        i++;
      }
    } else if (!/\s/.test(source[i + 2] || ' ')) {
      opening = i;
      i++;
    }
  }
  return pairs;
}

// Shared delimiter handling keeps the editor and publication renderer in sync.
export function matchHighlight(source: string) {
  if (!source.startsWith('==') || /\s/.test(source[2] || ' ')) return null;
  const pair = highlightPairs(source, 1)[0];
  return pair?.from === 0
    ? { raw: source.slice(0, pair.to), text: source.slice(2, pair.to - 2) }
    : null;
}

function hasTextEquals(node: JSONContent): boolean {
  if (node.type === 'codeBlock') return false;
  if (node.text !== undefined) {
    if (node.marks?.some((mark) => mark.type === 'code')) return false;
    return node.text.includes('=');
  }
  return !!node.content?.some(hasTextEquals);
}

function containsString(node: JSONContent, needle: string): boolean {
  if (node.text?.includes(needle)) return true;
  return !!node.content?.some((child) => containsString(child, needle));
}

// The default Markdown serializer does not escape '='. Escape literal '=='
// that would otherwise pair as highlight syntax on re-parse or in preview.
export function escapePlainHighlights(
  document: JSONContent,
  serialize: (document: JSONContent) => string,
) {
  if (!hasTextEquals(document)) return serialize(document);
  let placeholder = '\uE000';
  while (containsString(document, placeholder)) placeholder += '\uE000';

  const protect = (node: JSONContent): JSONContent => {
    if (node.type === 'codeBlock') return node;
    let content = node.content;
    if (content?.some((child) => child.text !== undefined)) {
      const scannable = content
        .map((child) => {
          if (child.text === undefined)
            return child.type === 'hardBreak' ? '\n' : '\ufffc';
          if (
            child.marks?.some(
              (mark) => mark.type === 'code' || mark.type === 'highlight',
            )
          )
            return '\ufffc'.repeat(child.text.length);
          return child.text.replace(/[\\`]/g, '\ufffc');
        })
        .join('');
      const escapeAt = new Set<number>();
      for (const pair of highlightPairs(scannable)) {
        escapeAt.add(pair.from);
        escapeAt.add(pair.to - 2);
      }
      let offset = 0;
      content = content.map((child) => {
        const start = offset;
        offset += child.text?.length ?? 1;
        if (
          child.text === undefined ||
          child.marks?.some((mark) => mark.type === 'code')
        )
          return protect(child);
        if (child.marks?.some((mark) => mark.type === 'highlight')) {
          return child.text.includes('=')
            ? {
                ...child,
                text: child.text.replace(/=(?==)|^=|=$/g, placeholder),
              }
            : child;
        }
        if (!escapeAt.size) return child;
        let text = '';
        let changed = false;
        for (let i = 0; i < child.text.length; i++) {
          if (escapeAt.has(start + i)) {
            text += placeholder;
            changed = true;
          } else {
            text += child.text[i];
          }
        }
        return changed ? { ...child, text } : child;
      });
    } else if (content) {
      content = content.map(protect);
    }
    return content === node.content ? node : { ...node, content };
  };

  return serialize(protect(document)).split(placeholder).join('\\=');
}
