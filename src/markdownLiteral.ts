import type { JSONContent } from '@tiptap/core';

// Interrupt GFM's automatic links without changing how the text is displayed.
const automaticLink = /\b(?:https?|ftp):\/\/|\bwww\./gi;
const emailAt = /([\w.+-])@(?=[\w-]+\.[\w-]*[a-z0-9])/gi;
const blockMarker =
  /^(\s*)(?:(\d{1,9})[.)](?=[ \t]|$)|(?:#{1,6}|[+-])(?=[ \t]|$)|[-=](?=(?:[ \t]*[-=])+[ \t]*$))/;

export function preserveLiteralMarkdown(
  encoded: string,
  node: JSONContent,
  parent?: JSONContent,
) {
  if (
    parent?.type === 'codeBlock' ||
    node.marks?.some((mark) => mark.type === 'code')
  )
    return encoded;
  if (!node.marks?.some((mark) => mark.type === 'link')) {
    encoded = encoded
      .replace(automaticLink, (link) =>
        link.endsWith('.')
          ? link.replace('.', '\\.')
          : link.replace(':', '\\:'),
      )
      .replace(emailAt, '$1\\@');
  }
  if (parent?.type !== 'paragraph' || node.marks?.length) return encoded;

  const index = parent.content?.indexOf(node) ?? -1;
  const previous = parent.content?.[index - 1];
  const following = parent.content?.[index + 1];
  const startsLine =
    index === 0 ||
    previous?.type === 'hardBreak' ||
    previous?.text?.endsWith('\n');
  const endsLine = !following || following.type === 'hardBreak';
  const spacesAsEntities = (spaces: string) => '&#32;'.repeat(spaces.length);
  return encoded
    .split('\n')
    .map((line, i, lines) => {
      if (startsLine || i > 0)
        line = line
          .replace(blockMarker, (match, spaces: string, number?: string) => {
            const marker = match.slice(spaces.length + (number?.length ?? 0));
            return spaces + (number ?? '') + '\\' + marker;
          })
          .replace(/^ +/, spacesAsEntities);
      return endsLine || i < lines.length - 1
        ? line.replace(/ +$/, spacesAsEntities)
        : line;
    })
    .join('\n');
}
