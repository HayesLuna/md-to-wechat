import MarkdownIt from 'markdown-it';
import imageRule from 'markdown-it/lib/rules_inline/image.mjs';
import referenceRule from 'markdown-it/lib/rules_block/reference.mjs';

type Destination = { start: number; end: number; id: string };
export type ImageReferences = {
  ids: string[];
  destinations: Destination[];
};

// Use Markdown-it's accepted destinations for both collection and rewriting.
// Source offsets refer to the original text, including its original line endings.
export function analyzeImageReferences(markdown: string): ImageReferences {
  const parser = new MarkdownIt({ html: false });
  const validate = parser.validateLink.bind(parser);
  parser.validateLink = (url) =>
    url.startsWith('local-image:') || validate(url);
  Object.defineProperty(parser, 'helpers', { value: { ...parser.helpers } });
  const parseDestination = parser.helpers.parseLinkDestination;
  const normalized = markdown.replace(/\r\n?/g, '\n').replace(/\0/g, '\ufffd');
  const lineStarts = [0];
  const originalStarts = [0];
  for (const match of markdown.matchAll(/\r\n?|\n/g))
    originalStarts.push(match.index + match[0].length);
  for (let i = 0; i < normalized.length; i++)
    if (normalized[i] === '\n') lineStarts.push(i + 1);
  const originalOffset = (at: number) => {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (lineStarts[mid] <= at) low = mid;
      else high = mid;
    }
    return originalStarts[low] + at - lineStarts[low];
  };
  const localId = (href: string) =>
    /^local-image:([a-zA-Z0-9-]+)$/.exec(href)?.[1];
  const destinations = new Map<number, Destination>();
  const add = (start: number, end: number, id: string) => {
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    )
      throw new Error('文章中的图片地址无法定位，请检查 Markdown 源码。');
    const originalStart = originalOffset(start);
    destinations.set(originalStart, {
      start: originalStart,
      end: originalOffset(end),
      id,
    });
  };
  const definitions = new Map<string, Destination>();
  parser.block.ruler.at('reference', (state, start, end, silent) => {
    let captured: { label: string; destination: Destination } | undefined;
    const previous = parser.helpers.parseLinkDestination;
    parser.helpers.parseLinkDestination = (source, from, max) => {
      const result = parseDestination(source, from, max);
      const id = result.ok && localId(parser.normalizeLink(result.str));
      if (id) {
        // Markdown-it >=14.3.3 parses references directly in state.src, so
        // destination offsets already refer to the normalized document.
        // Strip container prefixes only from the label used for lookup.
        const labelEnd = source.lastIndexOf(']:', from);
        const label: string[] = [];
        for (let line = start; line < state.lineMax; line++) {
          const begin =
            state.bMarks[line] + state.tShift[line] + (line === start ? 1 : 0);
          if (begin > labelEnd) break;
          label.push(
            source.slice(begin, Math.min(state.eMarks[line], labelEnd)),
          );
          if (state.eMarks[line] >= labelEnd) break;
        }
        const angled = source[from] === '<';
        captured = {
          label: parser.utils.normalizeReference(label.join('\n')),
          destination: {
            start: from + (angled ? 1 : 0),
            end: result.pos - (angled ? 1 : 0),
            id,
          },
        };
      }
      return result;
    };
    try {
      const accepted = referenceRule(state, start, end, silent);
      if (accepted && !silent && captured && !definitions.has(captured.label))
        definitions.set(captured.label, captured.destination);
      return accepted;
    } finally {
      parser.helpers.parseLinkDestination = previous;
    }
  });
  const ids = new Set<string>();
  const usedDefinitions = new Set<string>();
  let content = '';
  let positions: Int32Array = new Int32Array();
  parser.inline.ruler.at('image', (state, silent) => {
    const start = state.pos;
    let destination: { from: number; to: number } | undefined;
    const previous = parser.helpers.parseLinkDestination;
    parser.helpers.parseLinkDestination = (source, from, max) => {
      const result = parseDestination(source, from, max);
      if (result.ok && source === state.src)
        destination = {
          from: from + (source[from] === '<' ? 1 : 0),
          to: result.pos - (source[from] === '<' ? 1 : 0),
        };
      return result;
    };
    let accepted: boolean;
    try {
      accepted = imageRule(state, silent);
    } finally {
      parser.helpers.parseLinkDestination = previous;
    }
    if (!accepted || silent || state.src !== content) return accepted;
    const image = state.tokens.at(-1)!;
    const id = localId(image.attrGet('src') || '');
    if (!id) return accepted;
    ids.add(id);
    if (destination) {
      add(positions[destination.from], positions[destination.to - 1] + 1, id);
    } else {
      const labelEnd = parser.helpers.parseLinkLabel(state, start + 1, false);
      let label = '';
      if (content[labelEnd + 1] === '[') {
        const end = parser.helpers.parseLinkLabel(state, labelEnd + 1);
        if (end >= 0) label = content.slice(labelEnd + 2, end);
      }
      usedDefinitions.add(
        parser.utils.normalizeReference(
          label || content.slice(start + 2, labelEnd),
        ),
      );
    }
    return accepted;
  });
  const tokens: ReturnType<typeof parser.parse> = [];
  const env = {};
  parser.block.parse(normalized, parser, env, tokens);
  let cursor = 0;
  let limit = normalized.length;
  for (const token of tokens) {
    if (token.map) {
      cursor = Math.max(cursor, lineStarts[token.map[0]]);
      limit = lineStarts[token.map[1]] ?? normalized.length;
    }
    if (token.type !== 'inline') continue;
    content = token.content;
    positions = new Int32Array(content.length).fill(-1);
    const raw = normalized.slice(cursor, limit);
    const base = cursor;
    let offset = 0;
    for (let mapped = 0; mapped < content.length; mapped++) {
      const at = raw.indexOf(content[mapped], offset);
      if (at < 0) break;
      positions[mapped] = base + at;
      offset = at + 1;
    }
    cursor = base + offset;
    parser.inline.parse(content, parser, env, []);
  }
  for (const label of usedDefinitions) {
    const destination = definitions.get(label);
    if (!destination)
      throw new Error('文章中的图片引用无法定位，请检查 Markdown 源码。');
    add(destination.start, destination.end, destination.id);
  }
  return {
    ids: [...ids],
    destinations: [...destinations.values()].sort((a, b) => a.start - b.start),
  };
}

// Keep prose, code, labels, titles and unrelated definitions byte-for-byte intact.
export function remapImageReferences(
  markdown: string,
  replacements: Map<string, string>,
  references = replacements.size ? analyzeImageReferences(markdown) : undefined,
) {
  if (!references || !replacements.size) return markdown;
  const parts: string[] = [];
  let from = 0;
  for (const destination of references.destinations) {
    const next = replacements.get(destination.id);
    if (!next) continue;
    parts.push(markdown.slice(from, destination.start), 'local-image:' + next);
    from = destination.end;
  }
  parts.push(markdown.slice(from));
  return parts.join('');
}
