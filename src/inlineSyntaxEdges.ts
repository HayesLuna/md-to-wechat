import { getMarkRange } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export const inlineSyntaxMarks = {
  code: { tag: 'code', opening: '`', closing: '`' },
  bold: { tag: 'strong', opening: '**', closing: '**' },
  italic: { tag: 'em', opening: '*', closing: '*' },
  strike: { tag: 's', opening: '~~', closing: '~~' },
  underline: { tag: 'u', opening: '<u>', closing: '</u>' },
} as const;

export type InlineSyntaxMark = keyof typeof inlineSyntaxMarks;
export const inlineSyntaxMarkNames = Object.keys(
  inlineSyntaxMarks,
) as InlineSyntaxMark[];
export const inlineSyntaxSelector = inlineSyntaxMarkNames
  .map((name) => inlineSyntaxMarks[name].tag)
  .join(', ');

export const openingSyntaxAttribute = 'data-md-opening';
export const closingSyntaxAttribute = 'data-md-closing';

export type InlineMarkBoundary = { mark: InlineSyntaxMark; outside: -1 | 1 };

export function isInlineSyntaxMark(name: string): name is InlineSyntaxMark {
  return Object.hasOwn(inlineSyntaxMarks, name);
}

export function codeFence(text: string) {
  const used = new Set((text.match(/`+/g) || []).map((run) => run.length));
  let length = 1;
  while (used.has(length)) length++;
  return '`'.repeat(length);
}

export function isInlineSyntaxClick(view: EditorView, event: MouseEvent) {
  return (
    view.editable &&
    !view.composing &&
    event.button === 0 &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}

export function inlineSyntaxEdge(pos: number, from: number, to: number) {
  if (pos <= from) return -1;
  if (pos >= to) return 1;
  return null;
}

export function showsInlineSyntax(pos: number, from: number, to: number) {
  return pos >= from && pos <= to;
}

export function inlineMarkElement(
  view: EditorView,
  pos: number,
  side: -1 | 1,
  mark: InlineSyntaxMark,
) {
  const { node } = view.domAtPos(pos, side);
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(inlineSyntaxMarks[mark].tag);
}

export function inlineMarkBoundary(
  state: EditorState,
  pos: number,
  preferred?: Element | null,
): InlineMarkBoundary | null {
  const $pos = state.doc.resolve(pos);
  if ($pos.textOffset) return null;
  let boundary: InlineMarkBoundary | null = null;
  for (const mark of inlineSyntaxMarkNames) {
    const range = getMarkRange($pos, state.schema.marks[mark]);
    if (!range) continue;
    const outside = inlineSyntaxEdge(pos, range.from, range.to);
    if (outside === null) continue;
    if (preferred?.localName === inlineSyntaxMarks[mark].tag)
      return { mark, outside };
    boundary ??= { mark, outside };
  }
  return boundary;
}
