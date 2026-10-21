import type { JSONContent } from '@tiptap/core';
import type MarkdownIt from 'markdown-it';

export function markdownHighlight(md: MarkdownIt) {
  md.inline.ruler.before('emphasis', 'highlight', (state, silent) => {
    const match = matchHighlight(state.src.slice(state.pos, state.posMax));
    if (!match) return false;
    if (!silent) {
      state.push('mark_open', 'mark', 1);
      md.inline.parse(match.text, md, state.env, state.tokens);
      state.push('mark_close', 'mark', -1);
    }
    state.pos += match.raw.length;
    return true;
  });
}

// Shared delimiter handling keeps the editor and publication renderer in sync.
export function matchHighlight(source: string) {
  if (!source.startsWith('==') || /[=\s]/.test(source[2] || ' ')) return null;
  for (let i = 2; i < source.length; i++) {
    if (source[i] === '\n' || source[i] === '\r') return null;
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source[i] === '`') {
      const run = /^`+/.exec(source.slice(i))![0];
      const end = source.indexOf(run, i + run.length);
      if (end >= 0 && !/[\r\n]/.test(source.slice(i, end))) {
        i = end + run.length - 1;
        continue;
      }
    }
    if (
      source.startsWith('==', i) &&
      source[i - 1] !== '=' &&
      !/\s/.test(source[i - 1]) &&
      source[i + 2] !== '='
    )
      return { raw: source.slice(0, i + 2), text: source.slice(2, i) };
  }
  return null;
}

// The default serializer escapes standard Markdown punctuation, but not '='.
// Protect literal equals separately from delimiters emitted by the mark.
export function serializeHighlightMarkdown(
  document: JSONContent,
  serialize: (document: JSONContent) => string,
) {
  let placeholder = '\uE000';
  const json = JSON.stringify(document);
  if (!json.includes('=')) return serialize(document);
  while (json.includes(placeholder)) placeholder += '\uE000';
  const protect = (node: JSONContent, code = false): JSONContent => {
    code ||=
      node.type === 'codeBlock' || !!node.marks?.some((m) => m.type === 'code');
    return {
      ...node,
      ...(node.text && !code
        ? { text: node.text.replace(/=/g, placeholder) }
        : {}),
      ...(node.content
        ? { content: node.content.map((n) => protect(n, code)) }
        : {}),
    };
  };
  return serialize(protect(document)).split(placeholder).join('\\=');
}
