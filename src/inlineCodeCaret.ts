import { getMarkRange } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import type {
  Mark,
  Node as ProseMirrorNode,
  ResolvedPos,
} from '@tiptap/pm/model';
import {
  Plugin,
  TextSelection,
  type Selection,
  type Transaction,
} from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import {
  hasInlineSyntaxSelection,
  materializeInlineSyntaxCaret,
  revealedInlineMarks,
} from './inlineSyntaxSelection';
import {
  closingSyntaxAttribute,
  codeFence,
  inlineMarkBoundary,
  inlineMarkElement,
  inlineSyntaxMarkNames,
  inlineSyntaxMarks,
  inlineSyntaxSelector,
  isInlineSyntaxClick,
  openingSyntaxAttribute,
  type InlineMarkBoundary,
} from './inlineSyntaxEdges';
import {
  delimiterStops,
  firstGrapheme,
  inlineTextEdge,
  type DelimiterSide,
} from './inlineDelimiterGeometry';

function hasCode(marks: readonly Mark[] | null | undefined) {
  return marks?.some((mark) => mark.type.name === 'code') ?? false;
}

function codeStartMarks($pos: ResolvedPos) {
  if ($pos.textOffset || hasCode($pos.nodeBefore?.marks)) return undefined;
  const next = $pos.nodeAfter;
  return next?.isText && hasCode(next.marks) ? next.marks : undefined;
}

type Side = DelimiterSide;
export type BoundaryClick = {
  pos: number;
  side: Side;
  boundary: InlineMarkBoundary;
  syntaxOffset?: number;
};
const codeStart: InlineMarkBoundary = { mark: 'code', outside: -1 };

function opposite(side: Side): Side {
  return side === -1 ? 1 : -1;
}

function revealedMarkAtElement(
  view: EditorView,
  target: EventTarget | null,
  point: { left: number; top: number },
): BoundaryClick | null {
  const selector = `[${openingSyntaxAttribute}], [${closingSyntaxAttribute}]`;
  const element = target instanceof Element ? target.closest(selector) : null;
  if (!element || !view.dom.contains(element)) return null;
  const mark = inlineSyntaxMarkNames.find(
    (name) => inlineSyntaxMarks[name].tag === element.localName,
  );
  if (!mark) return null;

  for (const outside of [-1, 1] as const) {
    const geometry = delimiterStops(element, outside);
    if (!geometry) continue;
    const { caret, glyph, stops, box } = geometry;
    if (
      point.top < Math.min(box.top, caret.top) ||
      point.top > Math.max(box.bottom, caret.bottom)
    )
      continue;
    const outerX =
      outside === -1
        ? Math.min(box.left, stops[0])
        : Math.max(box.right, stops[stops.length - 1]);
    const innerX = outside === -1 ? stops[stops.length - 1] : stops[0];
    const width = outside * (outerX - innerX);
    const distance = outside * (point.left - innerX);
    // The inner stop owns the adjacent half of the text glyph, just as a
    // normal caret does. The delimiter width says nothing about that glyph.
    const tolerance =
      glyph && Math.abs(caret.x - innerX) <= 2
        ? Math.max(0, outside * (innerX - (glyph.left + glyph.width / 2)))
        : 0;
    if (width <= 0 || distance < -tolerance || distance > width + 1) continue;
    const pos = view.posAtDOM(
      element,
      outside === -1 ? 0 : element.childNodes.length,
    );
    const boundary = { mark, outside };
    if (!atBoundary(view.state.doc.resolve(pos), boundary)) continue;
    let closest = 0;
    for (let index = 1; index < stops.length; index++)
      if (
        Math.abs(point.left - stops[index]) <
        Math.abs(point.left - stops[closest])
      )
        closest = index;
    return delimiterSelection(pos, boundary, closest, stops.length - 1);
  }
  return revealedMarkAtElement(
    view,
    element.parentElement?.closest(selector) ?? null,
    point,
  );
}

export function revealedMarkAtCoords(
  view: EditorView,
  target: EventTarget | null,
  point: { left: number; top: number },
) {
  const direct = revealedMarkAtElement(view, target, point);
  if (direct) return direct;
  // Mouse events round to whole CSS pixels on some browsers. At the seam
  // with a normal text run this can target the neighbor of a visible symbol.
  const doc = view.dom.ownerDocument;
  for (const dx of [1, -1]) {
    const neighbor = doc.elementFromPoint(point.left + dx, point.top);
    if (neighbor === target) continue;
    const hit = revealedMarkAtElement(view, neighbor, point);
    if (hit) return hit;
  }
  return null;
}

export function revealedMarkClick(view: EditorView, event: MouseEvent) {
  const point = {
    left: event.clientX,
    top: event.clientY,
  };
  const direct = revealedMarkAtCoords(view, event.target, point);
  if (direct) return direct;
  // Just outside a delimiter, the pointer can belong to the neighboring
  // text even though its caret stop is the edge of the revealed symbol.
  const pos = view.posAtCoords(point)?.pos;
  if (pos === undefined) return null;
  const boundary = inlineMarkBoundary(view.state, pos);
  if (!boundary) return null;
  const { mark, outside } = boundary;
  const element = inlineMarkElement(view, pos, opposite(outside), mark);
  const geometry = element && delimiterStops(element, outside);
  if (!geometry) return null;
  const { caret, stops } = geometry;
  const offset = outside === -1 ? 0 : stops.length - 1;
  return point.top >= caret.top &&
    point.top <= caret.bottom &&
    outside * (point.left - stops[offset]) >= -1
    ? delimiterSelection(pos, boundary, offset, stops.length - 1)
    : null;
}

function delimiterSelection(
  pos: number,
  boundary: InlineMarkBoundary,
  offset: number,
  length: number,
): BoundaryClick {
  const inside = offset === (boundary.outside === -1 ? length : 0);
  return {
    pos,
    side: inside ? opposite(boundary.outside) : boundary.outside,
    boundary,
    syntaxOffset: offset > 0 && offset < length ? offset : undefined,
  };
}

function boundaryMarks($pos: ResolvedPos, side: Side) {
  return (side === -1 ? $pos.nodeBefore : $pos.nodeAfter)?.marks ?? [];
}

function atBoundary($pos: ResolvedPos, boundary: InlineMarkBoundary) {
  if ($pos.textOffset) return false;
  const outside = boundaryMarks($pos, boundary.outside);
  const inside = boundaryMarks($pos, opposite(boundary.outside));
  return (
    inside.some((mark) => mark.type.name === boundary.mark) &&
    !outside.some((mark) => mark.type.name === boundary.mark)
  );
}

class InlineBoundaryBookmark {
  constructor(
    readonly anchor: number,
    readonly side: Side,
    readonly boundary: InlineMarkBoundary,
    readonly syntaxOffset?: number,
  ) {}

  get head() {
    return this.anchor;
  }

  map(mapping: Mappable) {
    return new InlineBoundaryBookmark(
      mapping.map(this.anchor),
      this.side,
      this.boundary,
      this.syntaxOffset,
    );
  }

  resolve(doc: ProseMirrorNode): Selection {
    const $pos = doc.resolve(this.anchor);
    return atBoundary($pos, this.boundary)
      ? new InlineBoundarySelection(
          $pos,
          this.side,
          this.boundary,
          this.syntaxOffset,
        )
      : TextSelection.between($pos, $pos);
  }
}

class InlineBoundarySelection extends TextSelection {
  constructor(
    $pos: ResolvedPos,
    readonly side: Side,
    readonly boundary: InlineMarkBoundary,
    readonly syntaxOffset?: number,
  ) {
    super($pos);
  }

  // History saves a selection bookmark and does not save stored marks.
  getBookmark() {
    return new InlineBoundaryBookmark(
      this.from,
      this.side,
      this.boundary,
      this.syntaxOffset,
    );
  }
}

function setBoundaryCaret(
  tr: Transaction,
  pos: number,
  marks: readonly Mark[],
  side: Side,
  boundary: InlineMarkBoundary,
  syntaxOffset?: number,
) {
  return tr
    .setSelection(
      new InlineBoundarySelection(
        tr.doc.resolve(pos),
        side,
        boundary,
        syntaxOffset,
      ),
    )
    .setStoredMarks(marks);
}

export function setInlineBoundaryClick(tr: Transaction, hit: BoundaryClick) {
  const marks = boundaryMarks(tr.doc.resolve(hit.pos), hit.side);
  return setBoundaryCaret(
    tr,
    hit.pos,
    marks,
    hit.side,
    hit.boundary,
    hit.syntaxOffset,
  );
}

export function setOutsideInlineMark(
  tr: Transaction,
  pos: number,
  boundary: InlineMarkBoundary,
) {
  const marks = boundaryMarks(tr.doc.resolve(pos), boundary.outside);
  return setBoundaryCaret(tr, pos, marks, boundary.outside, boundary);
}

export function setInlineCodeStart(
  tr: Transaction,
  pos: number,
  marks: readonly Mark[],
  side: Side,
) {
  return setBoundaryCaret(tr, pos, marks, side, codeStart);
}

function placeCaret(
  view: EditorView,
  pos: number,
  marks: readonly Mark[],
  side: Side,
  boundary = codeStart,
  syntaxOffset?: number,
) {
  view.dispatch(
    setBoundaryCaret(view.state.tr, pos, marks, side, boundary, syntaxOffset),
  );
  if (!view.hasFocus()) view.focus();
  const { node, offset } = view.domAtPos(pos, side);
  (view.root as Document).getSelection()?.collapse(node, offset);
  return true;
}

function revealedEdges(state: EditorView['state'], pos: number) {
  return revealedInlineMarks(state).filter(
    ({ from, to }) => from === pos || to === pos,
  );
}

function markedCaretRect(view: EditorView, selection: InlineBoundarySelection) {
  const { mark, outside } = selection.boundary;
  const element = inlineMarkElement(
    view,
    selection.from,
    opposite(outside),
    mark,
  );
  const geometry = element && delimiterStops(element, outside);
  if (!geometry) return null;
  const { box, stops } = geometry;
  const offset =
    selection.syntaxOffset ?? (selection.side === -1 ? 0 : stops.length - 1);
  return { left: stops[offset], top: box.top, bottom: box.bottom };
}

function nativeCaretRect(view: EditorView, pos: number) {
  const native = view.dom.ownerDocument.getSelection();
  if (
    !native?.isCollapsed ||
    !native.rangeCount ||
    !native.anchorNode ||
    !view.dom.contains(native.anchorNode) ||
    view.posAtDOM(native.anchorNode, native.anchorOffset) !== pos
  )
    return null;
  const rect = native.getRangeAt(0).getBoundingClientRect();
  return rect.height ? rect : null;
}

function delimiterBesideCaret(view: EditorView, deleteSide: Side) {
  const { state } = view;
  const { selection } = state;
  const pos = selection.head;
  const edges = revealedEdges(state, pos);
  if (!edges.length) return null;
  const rect =
    selection instanceof InlineBoundarySelection
      ? edges.length > 1
        ? markedCaretRect(view, selection)
        : null
      : nativeCaretRect(view, pos);
  if (!rect) return null;
  for (const { mark, from } of edges) {
    const outside = from === pos ? -1 : 1;
    const boundary = { mark, outside } as const;
    if (!atBoundary(selection.$head, boundary)) continue;
    const element = inlineMarkElement(view, pos, opposite(outside), mark);
    const geometry = element && delimiterStops(element, outside);
    if (!geometry) continue;
    const { box, stops } = geometry;
    const offset = deleteSide === -1 ? stops.length - 1 : 0;
    if (
      rect.top < box.bottom &&
      rect.bottom > box.top &&
      Math.abs(rect.left - stops[offset]) <= 1.25
    )
      return delimiterSelection(pos, boundary, offset, stops.length - 1);
  }
  return null;
}

function activeDelimiter(view: EditorView, deleteSide?: Side) {
  const { selection, schema, doc } = view.state;
  if (
    !(selection instanceof TextSelection) ||
    !selection.empty ||
    hasInlineSyntaxSelection(view.state)
  )
    return null;
  let hit: BoundaryClick | null = null;
  // An edge and the adjoining text share a document position. Edit the
  // delimiter only when the key points from that edge toward its glyphs.
  if (
    selection instanceof InlineBoundarySelection &&
    (selection.syntaxOffset !== undefined ||
      (deleteSide !== undefined && selection.side !== deleteSide))
  ) {
    hit = {
      pos: selection.from,
      side: selection.side,
      boundary: selection.boundary,
      syntaxOffset: selection.syntaxOffset,
    };
  } else if (deleteSide !== undefined) {
    hit = delimiterBesideCaret(view, deleteSide);
  }
  if (!hit || !atBoundary(selection.$from, hit.boundary)) return null;
  const { boundary } = hit;
  const type = schema.marks[boundary.mark];
  const range = getMarkRange(selection.$from, type);
  if (!range) return null;
  const syntax = inlineSyntaxMarks[boundary.mark];
  const fence =
    boundary.mark === 'code'
      ? codeFence(doc.textBetween(range.from, range.to))
      : null;
  return {
    selection,
    hit,
    range,
    opening: fence ?? syntax.opening,
    closing: fence ?? syntax.closing,
  };
}

function editDelimiter(view: EditorView, text: string, deleteSide?: Side) {
  const active = activeDelimiter(view, deleteSide);
  if (!active) return false;
  const { range, opening, closing, hit } = active;
  const tr = materializeInlineSyntaxCaret(
    closeHistory(view.state.tr),
    { ...range, mark: hit.boundary.mark, opening, closing },
    hit,
  );
  const pos = tr.selection.from;
  const from = pos - Number(deleteSide === -1);
  const to = pos + Number(deleteSide === 1);
  tr.insertText(text, from, to);
  tr.setSelection(TextSelection.create(tr.doc, from + text.length));
  view.dispatch(tr.scrollIntoView());
  return true;
}

export function inlineMarkCaretPlugin() {
  let pointer: BoundaryClick | null = null;
  const click = (
    view: EditorView,
    pos: number,
    event: MouseEvent,
    onlySwitching = false,
  ) => {
    const hit = pointer;
    pointer = null;
    if (!isInlineSyntaxClick(view, event)) return false;
    const target =
      event.target instanceof Element
        ? event.target.closest(inlineSyntaxSelector)
        : null;
    const position = hit?.pos ?? pos;
    const boundary =
      hit?.boundary ?? inlineMarkBoundary(view.state, position, target);
    if (!boundary) return false;
    const side = hit?.side ?? boundary.outside;
    const syntaxOffset = hit?.syntaxOffset;
    const selection = view.state.selection;
    if (
      onlySwitching &&
      (!(selection instanceof InlineBoundarySelection) ||
        selection.from !== position ||
        (selection.side === side && selection.syntaxOffset === syntaxOffset))
    )
      return false;
    const marks = boundaryMarks(view.state.doc.resolve(position), side);
    return placeCaret(view, position, marks, side, boundary, syntaxOffset);
  };

  return new Plugin({
    appendTransaction(_transactions, _oldState, state) {
      const { selection, storedMarks } = state;
      if (!(selection instanceof InlineBoundarySelection)) return null;
      const { $from, boundary } = selection;
      if (!atBoundary($from, boundary)) return null;

      if (!storedMarks)
        return state.tr.setStoredMarks(boundaryMarks($from, selection.side));

      // Formatting commands can change the typing marks at the same position.
      const inside = storedMarks.some(
        (mark) => mark.type.name === boundary.mark,
      );
      const side = inside ? opposite(boundary.outside) : boundary.outside;
      return side === selection.side
        ? null
        : setBoundaryCaret(
            state.tr,
            selection.from,
            storedMarks,
            side,
            boundary,
          );
    },
    view(view) {
      const doc = view.dom.ownerDocument;
      const clearPending = () =>
        view.dom.classList.remove('inline-mark-click-pending');
      const alignCaret = () => {
        const { selection } = view.state;
        if (!(selection instanceof InlineBoundarySelection)) return;
        const sharedEdge = revealedEdges(view.state, selection.from).length > 1;
        if (
          !sharedEdge &&
          selection.side === selection.boundary.outside &&
          selection.syntaxOffset === undefined
        )
          return;
        const { mark, outside } = selection.boundary;
        const element = inlineMarkElement(
          view,
          selection.from,
          opposite(outside),
          mark,
        );
        const caret = view.dom.querySelector<HTMLElement>(
          '.inline-mark-boundary-caret',
        );
        if (!caret || !element) return;
        const target =
          sharedEdge || selection.syntaxOffset !== undefined
            ? markedCaretRect(view, selection)?.left
            : inlineTextEdge(element, outside)?.caret.left;
        if (target === undefined) return;

        // A collapsed range gives the visual start of the text run, which
        // can be on the opposite end of the code in bidirectional text.
        const offset = target - caret.getBoundingClientRect().left;
        caret.style.setProperty('--inline-mark-caret-offset', `${offset}px`);
      };
      const resizeObserver = new ResizeObserver(alignCaret);
      resizeObserver.observe(view.dom);
      doc.addEventListener('mouseup', clearPending, true);
      doc.defaultView?.addEventListener('blur', clearPending);
      return {
        update: alignCaret,
        destroy() {
          clearPending();
          resizeObserver.disconnect();
          doc.removeEventListener('mouseup', clearPending, true);
          doc.defaultView?.removeEventListener('blur', clearPending);
        },
      };
    },
    props: {
      decorations(state) {
        const { selection, storedMarks } = state;
        if (
          !(selection instanceof InlineBoundarySelection) ||
          !storedMarks ||
          !atBoundary(selection.$from, selection.boundary)
        )
          return null;

        // Browsers can paint a collapsed caret on either side of a mark
        // boundary regardless of which text run owns the DOM selection.
        const { side, boundary, syntaxOffset } = selection;
        return DecorationSet.create(state.doc, [
          Decoration.widget(
            selection.from,
            (view) => {
              const caret = view.dom.ownerDocument.createElement('span');
              caret.className = 'inline-mark-boundary-caret';
              caret.setAttribute('aria-hidden', 'true');
              if (syntaxOffset !== undefined)
                caret.dataset.syntaxOffset = String(syntaxOffset);
              return caret;
            },
            {
              marks: storedMarks,
              side,
              relaxedSide: true,
              key: `inline-mark-boundary-${boundary.mark}-${boundary.outside}-${side}-${syntaxOffset ?? ''}`,
            },
          ),
        ]);
      },
      handleDOMEvents: {
        keydown(view, event) {
          if (
            !view.editable ||
            view.composing ||
            event.isComposing ||
            event.shiftKey ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          )
            return false;
          const side =
            event.key === 'Backspace' ? -1 : event.key === 'Delete' ? 1 : null;
          // Resolve literal syntax before block-level Backspace handling.
          if (side === null || !editDelimiter(view, '', side)) return false;
          event.preventDefault();
          return true;
        },
        beforeinput(view, event) {
          if (!view.editable || view.composing || event.isComposing)
            return false;
          const side =
            event.inputType === 'deleteContentBackward'
              ? -1
              : event.inputType === 'deleteContentForward'
                ? 1
                : null;
          const handled =
            side !== null
              ? editDelimiter(view, '', side)
              : event.inputType === 'insertText' &&
                !!event.data &&
                editDelimiter(view, event.data);
          if (!handled) return false;
          event.preventDefault();
          return true;
        },
        mousedown(view, event) {
          pointer = null;
          if (!isInlineSyntaxClick(view, event)) return false;
          pointer = revealedMarkClick(view, event);
          if (pointer) {
            view.dom.classList.add('inline-mark-click-pending');
            return false;
          }
          const hit = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          const target =
            event.target instanceof Element
              ? event.target.closest(inlineSyntaxSelector)
              : null;
          const boundary =
            hit && inlineMarkBoundary(view.state, hit.pos, target);
          if (hit && boundary) {
            pointer = {
              pos: hit.pos,
              side: boundary.outside,
              boundary,
            };
            view.dom.classList.add('inline-mark-click-pending');
          }
          return false;
        },
        compositionstart(view) {
          view.dom.classList.add('inline-code-composing');
          return false;
        },
        compositionend(view) {
          view.dom.classList.remove('inline-code-composing');
          return false;
        },
        blur(view) {
          view.dom.classList.remove('inline-code-composing');
          return false;
        },
      },
      handleClick: click,
      handleDoubleClick: (view, pos, event) => click(view, pos, event, true),
      handleTripleClick: (view, pos, event) => click(view, pos, event, true),
      handleKeyDown(view, event) {
        if (
          !view.editable ||
          view.composing ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return false;

        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
          return false;

        const active = activeDelimiter(view);
        if (active && active.hit.syntaxOffset !== undefined) {
          const { boundary, syntaxOffset } = active.hit;
          const length = (
            boundary.outside === -1 ? active.opening : active.closing
          ).length;
          const offset = syntaxOffset + (event.key === 'ArrowLeft' ? -1 : 1);
          const hit = delimiterSelection(
            active.selection.from,
            boundary,
            offset,
            length,
          );
          return placeCaret(
            view,
            hit.pos,
            boundaryMarks(active.selection.$from, hit.side),
            hit.side,
            hit.boundary,
            hit.syntaxOffset,
          );
        }

        const native = (view.root as Document).getSelection();
        if (
          !native?.isCollapsed ||
          !native.anchorNode ||
          !view.dom.contains(native.anchorNode)
        )
          return false;

        // A key can arrive before ProseMirror observes a pointer selection.
        const pos = view.posAtDOM(native.anchorNode, native.anchorOffset);
        const { state } = view;
        const $from = state.doc.resolve(pos);
        const marksAtStart = codeStartMarks($from);
        const storedMarks =
          state.selection.empty && state.selection.from === pos
            ? state.storedMarks
            : null;

        if (event.key === 'ArrowRight') {
          if (!marksAtStart) return false;
          const anchor =
            native.anchorNode instanceof Element
              ? native.anchorNode
              : native.anchorNode.parentElement;
          const inside = storedMarks
            ? hasCode(storedMarks)
            : !!anchor?.closest('code');
          return !inside && placeCaret(view, pos, marksAtStart, 1);
        }

        if (marksAtStart)
          return (
            hasCode(storedMarks) &&
            placeCaret(view, pos, $from.nodeBefore?.marks ?? [], -1)
          );

        const textNode = $from.parent.maybeChild(
          $from.textOffset ? $from.index() : $from.index() - 1,
        );
        if (!textNode?.text || !hasCode(textNode.marks)) return false;
        const offset = $from.textOffset || textNode.nodeSize;
        const firstCharacter = firstGrapheme(textNode.text);
        if (offset !== firstCharacter?.length) return false;

        const start = $from.pos - offset;
        const marks = codeStartMarks(state.doc.resolve(start));
        return !!marks && placeCaret(view, start, marks, 1);
      },
    },
  });
}
