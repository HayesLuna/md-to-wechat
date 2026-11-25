import type { JSONContent } from '@tiptap/core';
import { codeFence } from './inlineSyntaxEdges';
import { sourceInlinePairs } from './sourceInlinePairs';
import type { SourceKind } from './sourceDelimiter';

export const sourceMarkSyntax = {
  underline: { opening: '<u>', closing: '</u>', kind: 'underline' as const },
  bold: { opening: '**', closing: '**', kind: 'bold' as const },
  italic: { opening: '*', closing: '*', kind: 'italic' as const },
  strike: { opening: '~~', closing: '~~', kind: 'strike' as const },
  code: { opening: '`', closing: '`', kind: 'code' as const },
} as const;

export type SourceMarkName = keyof typeof sourceMarkSyntax;
export const sourceMarkNames = Object.keys(
  sourceMarkSyntax,
) as SourceMarkName[];

const markOrder: Record<SourceMarkName, number> = {
  underline: 0,
  bold: 1,
  italic: 2,
  strike: 3,
  code: 4,
};

function isSourceMark(name: string): name is SourceMarkName {
  return Object.hasOwn(sourceMarkSyntax, name);
}

function sortedSourceMarks(
  marks: readonly { type: string }[] | undefined,
): SourceMarkName[] {
  return (marks || [])
    .map((mark) => mark.type)
    .filter(isSourceMark)
    .sort((a, b) => markOrder[a] - markOrder[b]);
}

function withoutSourceMarks(
  marks:
    readonly { type: string; attrs?: Record<string, unknown> }[] | undefined,
) {
  return (marks || []).filter((mark) => !isSourceMark(mark.type));
}

function delimiterFor(
  name: SourceMarkName,
  edge: 'opening' | 'closing',
  codeText: string,
) {
  if (name === 'code') {
    const fence = codeFence(codeText);
    return fence;
  }
  return sourceMarkSyntax[name][edge];
}

function codeContentFrom(children: JSONContent[], start: number): string {
  let text = '';
  for (let index = start; index < children.length; index++) {
    const child = children[index];
    if (!child.marks?.some((mark) => mark.type === 'code')) break;
    text +=
      child.text ??
      (child.type === 'hardBreak' ? '\n' : child.type ? '\ufffc' : '');
  }
  return text;
}

/** Turn TipTap marks into editable source delimiters inside the document. */
export function parseSourceInlineMarks(document: JSONContent): JSONContent {
  const restore = (node: JSONContent, inCode = false): JSONContent => {
    const code =
      inCode ||
      node.type === 'codeBlock' ||
      !!node.marks?.some((mark) => mark.type === 'code');
    if (!node.content) return node;
    if (!node.type || node.type === 'text') return node;

    const children = node.content.map((child) => restore(child, code));
    if (
      code ||
      !children.some((child) => child.marks?.some((m) => isSourceMark(m.type)))
    )
      return { ...node, content: children };

    // Only rewrite textblock-like content that actually carries marks on leaves.
    const hasLeafMarks = children.some(
      (child) => child.type === 'text' || child.type === 'hardBreak',
    );
    if (!hasLeafMarks) return { ...node, content: children };

    const editable: JSONContent[] = [];
    let open: SourceMarkName[] = [];
    // A code span's closing fence must match the one chosen for its content,
    // otherwise multi-backtick spans serialize into unrunnable source.
    const fences: Partial<Record<SourceMarkName, string>> = {};
    const closingText = (name: SourceMarkName) =>
      name === 'code' && fences.code
        ? fences.code
        : delimiterFor(name, 'closing', '');
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      const next = sortedSourceMarks(child.marks);
      for (const name of [...open].reverse()) {
        if (next.includes(name)) continue;
        editable.push({ type: 'text', text: closingText(name) });
      }
      for (const name of next) {
        if (open.includes(name)) continue;
        const text = name === 'code' ? codeContentFrom(children, index) : '';
        const opening = delimiterFor(name, 'opening', text);
        if (name === 'code') fences.code = opening;
        editable.push({
          type: 'text',
          text: opening,
        });
      }
      open = next;
      editable.push({
        ...child,
        ...(child.marks ? { marks: withoutSourceMarks(child.marks) } : {}),
      });
    }
    for (const name of [...open].reverse()) {
      editable.push({ type: 'text', text: closingText(name) });
    }
    return { ...node, content: editable };
  };
  return restore(document);
}

type Piece = {
  start: number;
  end: number;
  node: JSONContent;
};

function flattenTextblock(node: JSONContent) {
  let source = '';
  const pieces: Piece[] = [];
  for (const child of node.content || []) {
    const start = source.length;
    const text =
      child.text ??
      (child.type === 'hardBreak' ? '\n' : child.type ? '\ufffc' : '');
    source += text;
    pieces.push({ start, end: source.length, node: child });
  }
  return { source, pieces };
}

function marksForOffset(
  pairs: ReturnType<typeof sourceInlinePairs>,
  offset: number,
) {
  const marks: { type: string }[] = [];
  for (const pair of pairs) {
    if (offset >= pair.from + pair.openLen && offset < pair.to - pair.closeLen)
      marks.push({
        type:
          pair.kind === 'bold'
            ? 'bold'
            : pair.kind === 'italic'
              ? 'italic'
              : pair.kind === 'strike'
                ? 'strike'
                : pair.kind === 'code'
                  ? 'code'
                  : 'underline',
      });
  }
  // Stable nesting order for serializer.
  return marks.sort(
    (a, b) =>
      markOrder[(a.type === 'bold' ? 'bold' : a.type) as SourceMarkName] -
      markOrder[(b.type === 'bold' ? 'bold' : b.type) as SourceMarkName],
  );
}

function kindToMark(kind: SourceKind): SourceMarkName | null {
  switch (kind) {
    case 'bold':
      return 'bold';
    case 'italic':
      return 'italic';
    case 'strike':
      return 'strike';
    case 'code':
      return 'code';
    case 'underline':
      return 'underline';
    default:
      return null;
  }
}

/** Keep editable underline tags literal through the default Markdown serializer. */
export function protectSourceInlineMarkdown(
  document: JSONContent,
  serialize: (document: JSONContent) => string,
) {
  let open = '\uE010';
  let close = '\uE011';
  const json = JSON.stringify(document);
  while (json.includes(open)) open += '\uE010';
  while (json.includes(close) || close === open) close += '\uE011';
  const protect = (node: JSONContent, inCode = false): JSONContent => {
    const code =
      inCode ||
      node.type === 'codeBlock' ||
      !!node.marks?.some((mark) => mark.type === 'code');
    const text =
      node.text && !code
        ? node.text.replace(/<\/?u>/gi, (tag) =>
            tag.toLowerCase() === '<u>' ? open : close,
          )
        : node.text;
    return {
      ...node,
      ...(text !== undefined ? { text } : {}),
      ...(node.content
        ? { content: node.content.map((child) => protect(child, code)) }
        : {}),
    };
  };
  return serialize(protect(document))
    .split(open)
    .join('<u>')
    .split(close)
    .join('</u>');
}

/** Replace source delimiters with TipTap marks so the default serializer emits Markdown. */
export function materializeSourceInlineMarks(
  document: JSONContent,
): JSONContent {
  const visit = (node: JSONContent, inCode = false): JSONContent => {
    const code = inCode || node.type === 'codeBlock';
    if (!node.content) return node;
    const children = node.content.map((child) => visit(child, code));
    if (code) return { ...node, content: children };

    const looksLikeTextblock = children.every(
      (child) =>
        child.type === 'text' ||
        child.type === 'hardBreak' ||
        child.type === 'inlineImage' ||
        !child.content,
    );
    if (!looksLikeTextblock || !children.some((child) => child.text))
      return { ...node, content: children };

    const { source, pieces } = flattenTextblock({ ...node, content: children });
    if (!/[`*~<]/.test(source)) return { ...node, content: children };
    const pairs = sourceInlinePairs(source);
    if (!pairs.length) return { ...node, content: children };

    const delimiter = new Uint8Array(source.length);
    for (const pair of pairs) {
      for (let i = pair.from; i < pair.from + pair.openLen; i++)
        delimiter[i] = 1;
      for (let i = pair.to - pair.closeLen; i < pair.to; i++) delimiter[i] = 1;
    }

    const rebuilt: JSONContent[] = [];
    const pushText = (
      text: string,
      baseMarks: JSONContent['marks'],
      from: number,
    ) => {
      if (!text) return;
      const sourceMarks = pairs
        .map((pair) => {
          const mark = kindToMark(pair.kind);
          if (
            !mark ||
            from < pair.from + pair.openLen ||
            from >= pair.to - pair.closeLen
          )
            return null;
          return { type: mark };
        })
        .filter(Boolean) as { type: string }[];
      const order = [...sourceMarks].sort(
        (a, b) =>
          markOrder[a.type as SourceMarkName] -
          markOrder[b.type as SourceMarkName],
      );
      rebuilt.push({
        type: 'text',
        text,
        marks: [...withoutSourceMarks(baseMarks), ...order],
      });
    };

    for (const piece of pieces) {
      if (!piece.node.text) {
        if (!delimiter[piece.start])
          rebuilt.push({
            ...piece.node,
            marks: [
              ...withoutSourceMarks(piece.node.marks),
              ...pairs
                .filter(
                  (pair) =>
                    piece.start >= pair.from + pair.openLen &&
                    piece.start < pair.to - pair.closeLen,
                )
                .map((pair) => ({ type: kindToMark(pair.kind)! }))
                .filter((mark) => mark.type),
            ],
          });
        continue;
      }
      let offset = piece.start;
      while (offset < piece.end) {
        if (delimiter[offset]) {
          offset++;
          continue;
        }
        let end = offset + 1;
        while (
          end < piece.end &&
          !delimiter[end] &&
          marksEqual(marksForOffset(pairs, offset), marksForOffset(pairs, end))
        )
          end++;
        pushText(
          piece.node.text!.slice(offset - piece.start, end - piece.start),
          piece.node.marks,
          offset,
        );
        offset = end;
      }
    }
    return { ...node, content: rebuilt };
  };
  return visit(document);
}

function marksEqual(
  a: readonly { type: string }[],
  b: readonly { type: string }[],
) {
  if (a.length !== b.length) return false;
  return a.every((mark, index) => mark.type === b[index].type);
}
