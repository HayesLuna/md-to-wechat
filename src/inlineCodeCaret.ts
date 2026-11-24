import type {
  Mark,
  Node as ProseMirrorNode,
  ResolvedPos,
} from '@tiptap/pm/model';
import { Plugin, TextSelection, type Selection } from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

const graphemes =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null;

function hasCode(marks: readonly Mark[] | null | undefined) {
  return marks?.some((mark) => mark.type.name === 'code') ?? false;
}

function codeStartMarks($pos: ResolvedPos) {
  if ($pos.textOffset || hasCode($pos.nodeBefore?.marks)) return undefined;
  const next = $pos.nodeAfter;
  return next?.isText && hasCode(next.marks) ? next.marks : undefined;
}

function codeElementAtStart(view: EditorView, pos: number) {
  const { node } = view.domAtPos(pos, 1);
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest('code');
}

class InlineCodeStartBookmark {
  constructor(
    readonly anchor: number,
    readonly side: -1 | 1,
  ) {}

  get head() {
    return this.anchor;
  }

  map(mapping: Mappable) {
    return new InlineCodeStartBookmark(mapping.map(this.anchor), this.side);
  }

  resolve(doc: ProseMirrorNode): Selection {
    const $pos = doc.resolve(this.anchor);
    return codeStartMarks($pos)
      ? new InlineCodeStartSelection($pos, this.side)
      : TextSelection.between($pos, $pos);
  }
}

class InlineCodeStartSelection extends TextSelection {
  constructor(
    $pos: ResolvedPos,
    readonly side: -1 | 1,
  ) {
    super($pos);
  }

  // History saves a selection bookmark and does not save stored marks.
  getBookmark() {
    return new InlineCodeStartBookmark(this.from, this.side);
  }
}

function placeCaret(
  view: EditorView,
  pos: number,
  marks: readonly Mark[],
  side: -1 | 1,
) {
  const { tr } = view.state;
  // The two sides of an inline mark share a document position. Store
  // the typing marks explicitly and place the DOM caret on the chosen side.
  view.dispatch(
    tr
      .setSelection(new InlineCodeStartSelection(tr.doc.resolve(pos), side))
      .setStoredMarks(marks),
  );
  if (!view.hasFocus()) view.focus();
  const { node, offset } = view.domAtPos(pos, side);
  (view.root as Document).getSelection()?.collapse(node, offset);
  return true;
}

function isPlainClick(view: EditorView, event: MouseEvent) {
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

function selectClickedSide(
  view: EditorView,
  pos: number,
  event: MouseEvent,
  onlyWhenSwitching = false,
) {
  if (!isPlainClick(view, event)) return false;

  const { state } = view;
  const $pos = state.doc.resolve(pos);
  const insideMarks = codeStartMarks($pos);
  if (!insideMarks) return false;

  // Native hit testing can attribute clicks in the margin to the code.
  const start = codeElementAtStart(view, pos)?.getClientRects()[0];
  const inside =
    !!start &&
    event.clientX >= start.left &&
    event.clientX <= start.right &&
    event.clientY >= start.top &&
    event.clientY <= start.bottom;

  // ProseMirror groups nearby clicks. Keep double-click selection when
  // both clicks choose the same side of the boundary.
  if (
    onlyWhenSwitching &&
    (!state.selection.empty ||
      state.selection.from !== pos ||
      !state.storedMarks ||
      hasCode(state.storedMarks) === inside)
  )
    return false;

  return inside
    ? placeCaret(view, pos, insideMarks, 1)
    : placeCaret(view, pos, $pos.nodeBefore?.marks ?? [], -1);
}

export function inlineCodeCaretPlugin() {
  return new Plugin({
    appendTransaction(_transactions, _oldState, state) {
      const { selection, storedMarks } = state;
      if (!(selection instanceof InlineCodeStartSelection)) return null;
      const insideMarks = codeStartMarks(selection.$from);
      if (!insideMarks) return null;

      if (!storedMarks) {
        const marks =
          selection.side === 1
            ? insideMarks
            : (selection.$from.nodeBefore?.marks ?? []);
        return state.tr.setStoredMarks(marks);
      }

      // Formatting commands can change the typing marks at the same position.
      const side = hasCode(storedMarks) ? 1 : -1;
      return side === selection.side
        ? null
        : state.tr
            .setSelection(new InlineCodeStartSelection(selection.$from, side))
            .setStoredMarks(storedMarks);
    },
    view(view) {
      const doc = view.dom.ownerDocument;
      const clearPending = () =>
        view.dom.classList.remove('inline-code-click-pending');
      const alignCaret = () => {
        const { selection, storedMarks } = view.state;
        if (
          !selection.empty ||
          !hasCode(storedMarks) ||
          !codeStartMarks(selection.$from)
        )
          return;
        const code = codeElementAtStart(view, selection.from);
        const caret = code?.querySelector<HTMLElement>(
          '.inline-code-start-caret',
        );
        if (!caret || !code) return;
        const text = doc
          .createTreeWalker(code, NodeFilter.SHOW_TEXT)
          .nextNode();
        if (!text) return;

        // A collapsed range gives the visual start of the text run, which
        // can be on the opposite end of the code in bidirectional text.
        const range = doc.createRange();
        range.setStart(text, 0);
        range.collapse(true);
        const offset =
          range.getBoundingClientRect().left -
          caret.getBoundingClientRect().left;
        caret.style.setProperty('--inline-code-caret-offset', `${offset}px`);
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
          !selection.empty ||
          !(selection instanceof TextSelection) ||
          !storedMarks ||
          !codeStartMarks(selection.$from)
        )
          return null;

        // Browsers can paint a collapsed caret on either side of a mark
        // boundary regardless of which text run owns the DOM selection.
        const side = hasCode(storedMarks) ? 1 : -1;
        return DecorationSet.create(state.doc, [
          Decoration.widget(
            selection.from,
            (view) => {
              const caret = view.dom.ownerDocument.createElement('span');
              caret.className = 'inline-code-start-caret';
              caret.setAttribute('aria-hidden', 'true');
              return caret;
            },
            {
              marks: storedMarks,
              side,
              relaxedSide: true,
              key:
                side === 1
                  ? 'inline-code-start-inside'
                  : 'inline-code-start-outside',
            },
          ),
        ]);
      },
      handleDOMEvents: {
        mousedown(view, event) {
          if (!isPlainClick(view, event)) return false;
          const hit = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (hit && codeStartMarks(view.state.doc.resolve(hit.pos)))
            view.dom.classList.add('inline-code-click-pending');
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
      handleClick: selectClickedSide,
      handleDoubleClick: (view, pos, event) =>
        selectClickedSide(view, pos, event, true),
      handleTripleClick: (view, pos, event) =>
        selectClickedSide(view, pos, event, true),
      handleKeyDown(view, event) {
        if (
          !view.editable ||
          view.composing ||
          (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return false;

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
        const firstCharacter =
          graphemes?.segment(textNode.text).containing(0)?.segment ??
          textNode.text[Symbol.iterator]().next().value;
        if (offset !== firstCharacter?.length) return false;

        const start = $from.pos - offset;
        const marks = codeStartMarks(state.doc.resolve(start));
        return !!marks && placeCaret(view, start, marks, 1);
      },
    },
  });
}
