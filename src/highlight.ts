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
export function highlightPairs(
  source: string,
  markdown = true,
  limit = Infinity,
) {
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
    if (markdown && source[i] === '`') {
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
  const pair = highlightPairs(source, true, 1)[0];
  return pair?.from === 0
    ? { raw: source.slice(0, pair.to), text: source.slice(2, pair.to - 2) }
    : null;
}

// Preserve the distinction between escaped equals and editable delimiters.
// The Markdown parser otherwise turns both into the same plain text nodes.
export function parseHighlightMarkdown(
  markdown: string,
  parse: (markdown: string) => JSONContent,
) {
  let placeholder = '\uE002';
  while (markdown.includes(placeholder)) placeholder += '\uE002';
  const source = markdown.replace(/\\[\\=]/g, (escape) =>
    escape === '\\=' ? placeholder : escape,
  );
  const restore = (node: JSONContent, inCode = false): JSONContent[] => {
    const code =
      inCode ||
      node.type === 'codeBlock' ||
      !!node.marks?.some((mark) => mark.type === 'code');
    if (node.text?.includes(placeholder)) {
      if (code)
        return [{ ...node, text: node.text.split(placeholder).join('\\=') }];
      return node.text.split(placeholder).flatMap((text, index) => [
        ...(index
          ? [
              {
                ...node,
                text: '=',
                marks: [...(node.marks || []), { type: 'highlightLiteral' }],
              },
            ]
          : []),
        ...(text ? [{ ...node, text }] : []),
      ]);
    }
    const content = node.content?.flatMap((child) => restore(child, code));
    const editable: JSONContent[] = [];
    let highlighted = false;
    for (const child of content || []) {
      const active = !!child.marks?.some((mark) => mark.type === 'highlight');
      if (active !== highlighted) {
        editable.push({ type: 'text', text: '==' });
        highlighted = active;
      }
      editable.push({
        ...child,
        ...(child.marks
          ? {
              marks: [
                ...child.marks.filter((mark) => mark.type !== 'highlight'),
                ...(active &&
                child.text?.includes('=') &&
                !child.marks.some((mark) => mark.type === 'highlightLiteral')
                  ? [{ type: 'highlightLiteral' }]
                  : []),
              ],
            }
          : {}),
      });
    }
    if (highlighted) editable.push({ type: 'text', text: '==' });
    return [
      {
        ...node,
        ...(node.attrs
          ? {
              attrs: Object.fromEntries(
                Object.entries(node.attrs).map(([key, value]) => [
                  key,
                  typeof value === 'string'
                    ? value.split(placeholder).join('=')
                    : value,
                ]),
              ),
            }
          : {}),
        ...(node.content ? { content: editable } : {}),
      },
    ];
  };
  return restore(parse(source))[0];
}

// The default serializer escapes standard Markdown punctuation, but not '='.
// Only escaped/plain-pasted equals are literal. Delimiters stay in the document
// so deleting or inserting any one of them re-pairs the remainder naturally.
export function serializeHighlightMarkdown(
  document: JSONContent,
  serialize: (document: JSONContent) => string,
) {
  let placeholder = '\uE000';
  const json = JSON.stringify(document);
  if (!json.includes('=')) return serialize(document);
  while (json.includes(placeholder)) placeholder += '\uE000';
  let escapePlaceholder = '\uE003';
  while (json.includes(escapePlaceholder)) escapePlaceholder += '\uE003';
  const protect = (node: JSONContent, code = false): JSONContent => {
    code ||=
      node.type === 'codeBlock' || !!node.marks?.some((m) => m.type === 'code');
    let content = node.content;
    if (!code && content?.some((child) => child.text?.includes('='))) {
      const source = content
        .map((child) => {
          const text =
            child.text ?? (child.type === 'hardBreak' ? '\n' : '\ufffc');
          return child.marks?.some((mark) =>
            ['code', 'highlightLiteral'].includes(mark.type),
          )
            ? text.replace(/=/g, '\ufffc')
            : text;
        })
        .join('');
      const delimiters = highlightPairs(source, false).flatMap(
        ({ from, to }) => [
          { from, to: from + 2 },
          { from: to - 2, to },
        ],
      );
      if (delimiters.length) {
        let offset = 0;
        let delimiterIndex = 0;
        content = content.flatMap((child) => {
          const start = offset;
          offset += child.text?.length ?? 1;
          if (!child.text || !child.marks?.length) return [child];
          while (
            delimiterIndex < delimiters.length &&
            delimiters[delimiterIndex].to <= start
          )
            delimiterIndex++;
          const overlapping: HighlightPair[] = [];
          for (
            let index = delimiterIndex;
            index < delimiters.length && delimiters[index].from < offset;
            index++
          )
            overlapping.push(delimiters[index]);
          const cuts = new Set([start, offset]);
          for (const range of overlapping) {
            if (range.from > start && range.from < offset) cuts.add(range.from);
            if (range.to > start && range.to < offset) cuts.add(range.to);
          }
          const points = [...cuts].sort((a, b) => a - b);
          let rangeIndex = 0;
          return points.slice(0, -1).map((from, index) => {
            while (
              rangeIndex < overlapping.length &&
              overlapping[rangeIndex].to <= from
            )
              rangeIndex++;
            return {
              ...child,
              text: child.text!.slice(from - start, points[index + 1] - start),
              marks:
                overlapping[rangeIndex] && from >= overlapping[rangeIndex].from
                  ? []
                  : child.marks,
            };
          });
        });
      }
    }
    const text =
      node.text && !code
        ? node.marks?.some((m) => m.type === 'highlightLiteral')
          ? node.text.replace(/=/g, placeholder)
          : node.text.replace(/(\\+)(?==)/g, (slashes) =>
              slashes.length % 2
                ? slashes.slice(0, -1) + escapePlaceholder
                : slashes,
            )
        : node.text;
    return {
      ...node,
      ...(text ? { text } : {}),
      ...(content ? { content: content.map((n) => protect(n, code)) } : {}),
    };
  };
  return serialize(protect(document))
    .split(placeholder)
    .join('\\=')
    .split(escapePlaceholder)
    .join('\\');
}
