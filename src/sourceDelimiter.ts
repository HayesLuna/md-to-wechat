import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { showsInlineSyntax } from './inlineSyntaxEdges';

export const delimiterClass = 'highlight-delimiter';
export const delimiterExpandedClass = 'highlight-delimiter expanded';

export type SourcePair = {
  from: number;
  to: number;
  openLen: number;
  closeLen: number;
  kind: SourceKind;
  tag: string;
};

export type SourceKind =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'underline'
  | 'highlight';

export function contentRange(pair: SourcePair) {
  return { from: pair.from + pair.openLen, to: pair.to - pair.closeLen };
}

export function openingRange(pair: SourcePair) {
  return { from: pair.from, to: pair.from + pair.openLen };
}

export function closingRange(pair: SourcePair) {
  return { from: pair.to - pair.closeLen, to: pair.to };
}

/** Which absolute pairs should show expanded delimiters for the current selection. */
export function activeSourcePairs(
  state: EditorState,
  pairs: readonly SourcePair[],
  includeEdges = false,
) {
  const { from, to, empty } = state.selection;
  return pairs.filter((pair) =>
    empty
      ? includeEdges
        ? showsInlineSyntax(from, pair.from, pair.to)
        : from > pair.from && from < pair.to
      : from < pair.to && to > pair.from,
  );
}

/** Swap collapsed delimiter decorations for expanded ones for the given pairs. */
export function revealSourceDelimiters(
  state: EditorState,
  base: DecorationSet,
  pairs: readonly SourcePair[],
) {
  if (!pairs.length) return base;
  const starts = new Set(pairs.map((pair) => pair.from));
  const ends = new Set(pairs.map((pair) => pair.to));
  const hidden: Decoration[] = [];
  const visible: Decoration[] = [];
  const lo = Math.min(...pairs.map((pair) => pair.from));
  const hi = Math.max(...pairs.map((pair) => pair.to));
  for (const decoration of base.find(lo, hi, (spec) => !!spec.delimiter)) {
    if (!starts.has(decoration.from) && !ends.has(decoration.to)) continue;
    hidden.push(decoration);
    visible.push(
      Decoration.inline(decoration.from, decoration.to, {
        class: delimiterExpandedClass,
      }),
    );
  }
  if (!hidden.length) return base;
  if (hidden.length > 128) {
    const expanded = new Map(
      visible.map((decoration) => [decoration.from, decoration]),
    );
    return DecorationSet.create(
      state.doc,
      base
        .find()
        .map((decoration) =>
          decoration.spec.delimiter
            ? expanded.get(decoration.from) || decoration
            : decoration,
        ),
    );
  }
  return base.remove(hidden).add(state.doc, visible);
}

export function splitContentDecorations(
  from: number,
  to: number,
  holes: readonly { from: number; to: number }[],
  attrs: { nodeName: string },
  spec: Record<string, unknown>,
) {
  const cuts = new Set([from, to]);
  for (const hole of holes) {
    if (hole.from > from && hole.from < to) cuts.add(hole.from);
    if (hole.to > from && hole.to < to) cuts.add(hole.to);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const decorations: Decoration[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    if (
      start >= end ||
      holes.some((hole) => hole.from <= start && hole.to >= end)
    )
      continue;
    decorations.push(Decoration.inline(start, end, attrs, spec));
  }
  return decorations;
}

export function sourcePairDecorations(
  pairs: readonly SourcePair[],
  extraHoles: readonly { from: number; to: number }[] = [],
) {
  const delimiterRanges = pairs.flatMap((pair) => [
    openingRange(pair),
    closingRange(pair),
  ]);
  const holes = [...delimiterRanges, ...extraHoles];
  const decorations = delimiterRanges.map((range) =>
    Decoration.inline(
      range.from,
      range.to,
      { class: delimiterClass, 'aria-hidden': 'true' },
      { delimiter: true },
    ),
  );
  // Content wrappers must not cover nested delimiter characters. Overlapping
  // inline decorations would otherwise merge nodeName onto the marker spans.
  for (const pair of pairs) {
    const content = contentRange(pair);
    decorations.push(
      ...splitContentDecorations(
        content.from,
        content.to,
        holes,
        { nodeName: pair.tag },
        { sourceInline: pair.kind },
      ),
    );
  }
  return decorations;
}
