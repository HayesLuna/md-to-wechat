import { Extension } from '@tiptap/core';
import { Mark, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const key = new PluginKey('mojian-mark-boundaries');

function boundaryMarks(node: PMNode | null) {
  return (node?.isText ? node.marks : []).filter(
    (mark) => mark.type.spec.inclusive !== false,
  );
}

function activeMarks(state: EditorState) {
  return (state.storedMarks ?? state.selection.$from.marks()).filter(
    (mark) => mark.type.spec.inclusive !== false,
  );
}

function boundaryAt($pos: ResolvedPos) {
  if ($pos.parent.type.spec.code) return null;
  const before = boundaryMarks($pos.nodeBefore);
  const after = boundaryMarks($pos.nodeAfter);
  if (Mark.sameSet(before, after)) return null;
  return { before, after };
}

function isCodeBoundary(
  state: EditorState,
  before: readonly Mark[],
  after: readonly Mark[],
) {
  const code = state.schema.marks.code;
  return !!code && !!code.isInSet(before) !== !!code.isInSet(after);
}

function codeRectAtBoundary(
  view: EditorView,
  $pos: ResolvedPos,
  side: -1 | 1,
): DOMRect | null {
  const adjacent = side === 1 ? $pos.nodeAfter : $pos.nodeBefore;
  if (!adjacent?.isText) return null;
  const step =
    side === 1 ? charStepAfter(adjacent.text!) : charStepBefore(adjacent.text!);
  const inside = view.domAtPos($pos.pos + side * step, -side);
  const el =
    inside.node instanceof Element
      ? inside.node.closest('code')
      : inside.node.parentElement?.closest('code');
  if (!el || !view.dom.contains(el)) return null;
  const rects = Array.from(el.getClientRects()).filter((r) => r.width > 0);
  if (!rects.length) return null;
  return side === 1 ? rects[0] : rects[rects.length - 1];
}

function resolvePointerMarks(
  view: EditorView,
  pos: number,
  clientX: number | null,
  target: Element | null,
  before: readonly Mark[],
  after: readonly Mark[],
): readonly Mark[] | null {
  // Non-code text styles (bold/italic/strike/highlight/underline) have no box
  // margin, so both sides of an edge share the exact same pixel. Keep them
  // deterministic: left edge stays plain (outside), right edge continues the
  // mark (inside), matching standard rich-text editors.
  if (!isCodeBoundary(view.state, before, after)) return before;

  const $pos = view.state.doc.resolve(pos);
  const code = view.state.schema.marks.code!;
  const enteringCode = !!code.isInSet(after) && !code.isInSet(before);
  const side: -1 | 1 = enteringCode ? 1 : -1;

  let hitCode = false;
  if (target) {
    const el = target.closest('code');
    if (el && view.dom.contains(el)) {
      const start = view.posAtDOM(el, 0);
      const end = view.posAtDOM(el, el.childNodes.length);
      if (pos >= start && pos <= end) hitCode = true;
    }
  }
  if (!hitCode && clientX !== null) {
    const rect = codeRectAtBoundary(view, $pos, side);
    hitCode = !!rect && clientX >= rect.left && clientX <= rect.right;
  }

  return enteringCode ? (hitCode ? after : before) : hitCode ? before : after;
}

function charStepBefore(text: string) {
  if (text.length < 2) return text.length;
  const code = text.charCodeAt(text.length - 1);
  return code >= 0xdc00 && code <= 0xdfff ? 2 : 1;
}

function charStepAfter(text: string) {
  if (text.length < 2) return text.length;
  const code = text.charCodeAt(0);
  return code >= 0xd800 && code <= 0xdbff ? 2 : 1;
}

function resolveEffectivePos(view: EditorView) {
  const { state } = view;
  const { selection } = state;
  if (!selection.empty || !(selection instanceof TextSelection)) return null;
  const native = view.dom.ownerDocument.getSelection();
  if (native?.isCollapsed && native.anchorNode) {
    try {
      const domPos = view.posAtDOM(native.anchorNode, native.anchorOffset);
      if (domPos !== selection.from) {
        const $dom = state.doc.resolve(domPos);
        if ($dom.parent.inlineContent && !$dom.parent.type.spec.code)
          return { $from: $dom, synced: false };
      }
    } catch {
      // Fall back to ProseMirror selection.
    }
  }
  return { $from: selection.$from, synced: true };
}

function stepBoundary(view: EditorView, direction: -1 | 1) {
  const { state } = view;
  const resolved = resolveEffectivePos(view);
  if (!resolved) return null;
  const { $from, synced } = resolved;
  if ($from.parent.type.spec.code) return null;

  const currentBoundary = boundaryAt($from);
  if (
    currentBoundary &&
    isCodeBoundary(state, currentBoundary.before, currentBoundary.after)
  ) {
    const target =
      direction === 1 ? currentBoundary.after : currentBoundary.before;
    const current = synced
      ? activeMarks(state)
      : $from.marks().filter((mark) => mark.type.spec.inclusive !== false);
    if (!Mark.sameSet(current, target)) {
      const tr = state.tr;
      if (!synced) tr.setSelection(TextSelection.create(state.doc, $from.pos));
      return tr.setStoredMarks(target);
    }
  }

  // Step synchronously onto an adjacent inline code boundary so rapid arrow
  // keys never race with async browser selectionchange updates.
  if (direction === -1 && $from.nodeBefore?.isText) {
    const step = charStepBefore($from.nodeBefore.text!);
    const prevPos = $from.pos - step;
    const prevBoundary = boundaryAt(state.doc.resolve(prevPos));
    if (
      prevBoundary &&
      isCodeBoundary(state, prevBoundary.before, prevBoundary.after)
    )
      return state.tr
        .setSelection(TextSelection.create(state.doc, prevPos))
        .setStoredMarks(prevBoundary.after);
  }

  if (direction === 1 && $from.nodeAfter?.isText) {
    const step = charStepAfter($from.nodeAfter.text!);
    const nextPos = $from.pos + step;
    const nextBoundary = boundaryAt(state.doc.resolve(nextPos));
    if (
      nextBoundary &&
      isCodeBoundary(state, nextBoundary.before, nextBoundary.after)
    )
      return state.tr
        .setSelection(TextSelection.create(state.doc, nextPos))
        .setStoredMarks(nextBoundary.before);
  }

  return null;
}

/**
 * Resolves the exact DOM `(node, offset)` on the requested side of a mark
 * boundary. Stepping strictly into `nodeBefore` / `nodeAfter` guarantees the
 * caret sits inside the intended DOM element rather than on the outer parent.
 */
function boundaryDomPoint(
  view: EditorView,
  $from: ResolvedPos,
  side: -1 | 1,
): { node: Node; offset: number } | null {
  if (side === 1) {
    if ($from.nodeAfter?.isText) {
      const step = charStepAfter($from.nodeAfter.text!);
      const inside = view.domAtPos($from.pos + step, -1);
      if (inside.node.nodeType === Node.TEXT_NODE)
        return {
          node: inside.node,
          offset: Math.max(0, inside.offset - step),
        };
    }
    const block = view.nodeDOM($from.before());
    if (block) return { node: block, offset: block.childNodes.length };
    return null;
  }

  if ($from.nodeBefore?.isText) {
    const step = charStepBefore($from.nodeBefore.text!);
    const inside = view.domAtPos($from.pos - step, 1);
    if (inside.node.nodeType === Node.TEXT_NODE)
      return {
        node: inside.node,
        offset: Math.min(
          (inside.node as Text).data.length,
          inside.offset + step,
        ),
      };
  }
  const block = view.nodeDOM($from.before());
  if (block) return { node: block, offset: 0 };
  return null;
}

/**
 * Aligns the native DOM caret to the exact side of a mark boundary that
 * matches `storedMarks`, so inline elements with padding/margin (like `<code>`)
 * draw the blinking caret physically inside when typing goes inside and outside
 * when typing goes outside.
 */
function syncBoundaryCaret(view: EditorView) {
  if (!view.editable || !view.hasFocus() || view.composing) return;
  const { selection } = view.state;
  if (!selection.empty || !(selection instanceof TextSelection)) return;
  const $from = selection.$from;
  const boundary = boundaryAt($from);
  if (!boundary || !isCodeBoundary(view.state, boundary.before, boundary.after))
    return;

  const current = activeMarks(view.state);
  const side: -1 | 1 | 0 = Mark.sameSet(current, boundary.after)
    ? 1
    : Mark.sameSet(current, boundary.before)
      ? -1
      : 0;
  if (!side) return;

  const point = boundaryDomPoint(view, $from, side);
  if (!point) return;

  const native = view.dom.ownerDocument.getSelection();
  if (!native) return;
  if (
    native.isCollapsed &&
    native.anchorNode === point.node &&
    native.anchorOffset === point.offset
  )
    return;
  native.collapse(point.node, point.offset);
}

/**
 * Blink canonicalizes `(nodeAfter, 0)` upstream onto `(nodeBefore, end)` when
 * painting the native caret, so stepping across an inline `<code>` box edge
 * looks visually stuck on the upstream side. Compute viewport coordinates for
 * an external overlay caret (outside `view.dom`, so `<code>`'s DOM is never
 * mutated during clicks or drags) only for the stops where Blink snaps wrong.
 */
function boundaryCaretRect(
  view: EditorView,
): { left: number; top: number; height: number } | null {
  if (!view.editable || view.composing) return null;
  const { state } = view;
  const { selection } = state;
  if (!selection.empty || !(selection instanceof TextSelection)) return null;
  const $from = selection.$from;
  const boundary = boundaryAt($from);
  if (!boundary) return null;
  const code = state.schema.marks.code;
  if (!code) return null;
  const beforeCode = code.isInSet(boundary.before);
  const afterCode = code.isInSet(boundary.after);
  if (!!beforeCode === !!afterCode) return null;

  const current = activeMarks(state);
  const side: -1 | 1 | 0 = Mark.sameSet(current, boundary.after)
    ? 1
    : Mark.sameSet(current, boundary.before)
      ? -1
      : 0;
  const needsOverlay =
    (side === 1 && !!$from.nodeBefore) || (side === -1 && !$from.nodeBefore);
  if (!needsOverlay) return null;

  if (side === 1 && $from.nodeAfter?.isText) {
    const point = boundaryDomPoint(view, $from, 1);
    if (point && point.node.nodeType === Node.TEXT_NODE) {
      const text = (point.node as Text).data;
      const step = charStepAfter(text.slice(point.offset));
      if (step > 0) {
        const range = view.dom.ownerDocument.createRange();
        range.setStart(point.node, point.offset);
        range.setEnd(point.node, Math.min(text.length, point.offset + step));
        const rect = range.getBoundingClientRect();
        if (rect.height > 0)
          return { left: rect.left, top: rect.top, height: rect.height };
      }
    }
  }

  const codeSide: -1 | 1 = beforeCode ? -1 : 1;
  const codeRect = codeRectAtBoundary(view, $from, codeSide);
  if (!codeRect) return null;
  const left = side === 1 ? codeRect.right + 4 : codeRect.left - 4;
  return {
    left,
    top: codeRect.top + 1,
    height: Math.max(12, codeRect.height - 2),
  };
}

/**
 * Gives inline mark edges two logical stops via `storedMarks` (outside vs.
 * inside) so users can insert before the first character or after the last
 * character of formatted spans using either arrow keys or mouse clicks,
 * without showing raw Markdown syntax delimiters.
 */
export const MarkBoundaries = Extension.create({
  name: 'markBoundaries',
  addKeyboardShortcuts() {
    return {
      ArrowRight: () => {
        const tr = stepBoundary(this.editor.view, 1);
        if (!tr) {
          this.editor.view.dom
            .closest('.editor-host')
            ?.classList.remove('has-boundary-caret');
          return false;
        }
        this.editor.view.dispatch(tr);
        return true;
      },
      ArrowLeft: () => {
        const tr = stepBoundary(this.editor.view, -1);
        if (!tr) {
          this.editor.view.dom
            .closest('.editor-host')
            ?.classList.remove('has-boundary-caret');
          return false;
        }
        this.editor.view.dispatch(tr);
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    let pointerTarget: Element | null = null;
    let pointerX: number | null = null;
    let pointerDown = false;
    let editorView: EditorView | null = null;

    let syncOverlayRef: ((view: EditorView) => void) | null = null;

    return [
      new Plugin({
        key,
        view(view) {
          editorView = view;
          const surface =
            view.dom.closest<HTMLElement>('.writing-scroll') ?? view.dom;
          const host =
            view.dom.closest<HTMLElement>('.editor-host') ??
            view.dom.parentElement;
          const doc = view.dom.ownerDocument;
          const overlay = doc.createElement('div');
          overlay.className = 'mark-boundary-caret';
          overlay.setAttribute('aria-hidden', 'true');
          host?.appendChild(overlay);

          const syncOverlay = (currentView: EditorView) => {
            if (!host) return;
            const rect = boundaryCaretRect(currentView);
            if (!rect) {
              host.classList.remove('has-boundary-caret');
              return;
            }
            const hostRect = host.getBoundingClientRect();
            overlay.style.left = `${rect.left - hostRect.left}px`;
            overlay.style.top = `${rect.top - hostRect.top}px`;
            overlay.style.height = `${rect.height}px`;
            host.classList.add('has-boundary-caret');
          };
          syncOverlayRef = syncOverlay;
          const resizeObserver = new ResizeObserver(() => syncOverlay(view));
          resizeObserver.observe(view.dom);
          const onMouseDown = (event: MouseEvent) => {
            pointerDown = true;
            const target =
              event.target instanceof Element ? event.target : null;
            pointerTarget = target;
            pointerX = event.clientX;
            if (
              !target ||
              !view.editable ||
              event.button !== 0 ||
              event.detail > 1 ||
              event.shiftKey ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              target.closest('button,input,select,textarea,[role="separator"]')
            )
              return;
            let pos: number | null = null;
            if (event.defaultPrevented) {
              if (
                view.state.selection.empty &&
                view.state.selection instanceof TextSelection
              )
                pos = view.state.selection.from;
            } else if (view.dom.contains(target)) {
              const hit = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });
              if (hit) pos = hit.pos;
            }
            if (pos === null) return;
            const boundary = boundaryAt(view.state.doc.resolve(pos));
            if (
              !boundary ||
              !isCodeBoundary(view.state, boundary.before, boundary.after)
            )
              return;
            const desired = resolvePointerMarks(
              view,
              pos,
              event.clientX,
              target,
              boundary.before,
              boundary.after,
            );
            if (!desired) return;
            const samePos =
              view.state.selection.empty && view.state.selection.from === pos;
            if (!samePos || !Mark.sameSet(activeMarks(view.state), desired)) {
              const tr = view.state.tr;
              if (!samePos)
                tr.setSelection(TextSelection.create(view.state.doc, pos));
              tr.setStoredMarks(desired);
              view.dispatch(tr);
            }
          };
          const onMouseUp = () => {
            pointerDown = false;
          };
          const onClick = (event: MouseEvent) => {
            pointerDown = false;
            const target =
              event.target instanceof Element ? event.target : null;
            if (
              !target ||
              !view.editable ||
              target.closest('button,input,select,textarea,[role="separator"]')
            )
              return;
            let pos: number | null = null;
            if (view.dom.contains(target)) {
              const native = doc.getSelection();
              if (!native?.isCollapsed || !native.anchorNode) return;
              try {
                pos = view.posAtDOM(native.anchorNode, native.anchorOffset);
              } catch {
                return;
              }
            } else if (
              view.state.selection.empty &&
              view.state.selection instanceof TextSelection
            ) {
              pos = view.state.selection.from;
            }
            if (pos === null) return;
            const boundary = boundaryAt(view.state.doc.resolve(pos));
            if (!boundary) return;
            const desired = resolvePointerMarks(
              view,
              pos,
              event.clientX,
              target,
              boundary.before,
              boundary.after,
            );
            if (!desired) return;
            const samePos =
              view.state.selection.empty && view.state.selection.from === pos;
            if (!samePos || !Mark.sameSet(activeMarks(view.state), desired)) {
              const tr = view.state.tr;
              if (!samePos)
                tr.setSelection(TextSelection.create(view.state.doc, pos));
              tr.setStoredMarks(desired);
              view.dispatch(tr);
            } else {
              syncBoundaryCaret(view);
            }
          };
          const onSelectionChange = () => {
            if (!host || !host.classList.contains('has-boundary-caret')) return;
            const native = doc.getSelection();
            if (!native || !native.isCollapsed || !native.anchorNode) {
              host.classList.remove('has-boundary-caret');
              return;
            }
            try {
              if (
                view.posAtDOM(native.anchorNode, native.anchorOffset) !==
                view.state.selection.from
              )
                host.classList.remove('has-boundary-caret');
            } catch {
              host.classList.remove('has-boundary-caret');
            }
          };
          surface.addEventListener('mousedown', onMouseDown, true);
          surface.addEventListener('click', onClick);
          doc.addEventListener('mouseup', onMouseUp, true);
          doc.addEventListener('selectionchange', onSelectionChange);
          return {
            update(currentView) {
              if (!pointerDown) syncBoundaryCaret(currentView);
              syncOverlay(currentView);
            },
            destroy() {
              resizeObserver.disconnect();
              host?.classList.remove('has-boundary-caret');
              overlay.remove();
              surface.removeEventListener('mousedown', onMouseDown, true);
              surface.removeEventListener('click', onClick);
              doc.removeEventListener('mouseup', onMouseUp, true);
              doc.removeEventListener('selectionchange', onSelectionChange);
              if (editorView === view) editorView = null;
              if (syncOverlayRef === syncOverlay) syncOverlayRef = null;
            },
          };
        },
        appendTransaction(transactions, _oldState, newState) {
          const moved = transactions.some(
            (tr) => tr.selectionSet && !tr.docChanged && !tr.storedMarksSet,
          );
          const target = pointerTarget;
          const clientX = pointerX;
          if (moved || transactions.some((tr) => tr.docChanged)) {
            pointerTarget = null;
            pointerX = null;
          }
          if (!moved) return null;
          const { selection } = newState;
          if (!selection.empty || !(selection instanceof TextSelection))
            return null;
          const boundary = boundaryAt(selection.$from);
          if (!boundary) return null;
          if (!isCodeBoundary(newState, boundary.before, boundary.after)) {
            return Mark.sameSet(activeMarks(newState), boundary.before)
              ? null
              : newState.tr.setStoredMarks(boundary.before);
          }
          if (!target || !editorView) return null;
          const desired = resolvePointerMarks(
            editorView,
            selection.from,
            clientX,
            target,
            boundary.before,
            boundary.after,
          );
          if (desired && !Mark.sameSet(activeMarks(newState), desired))
            return newState.tr.setStoredMarks(desired);
          return null;
        },
        props: {
          handleKeyDown() {
            pointerTarget = null;
            pointerX = null;
            return false;
          },
          handleDOMEvents: {
            compositionstart(view) {
              syncOverlayRef?.(view);
              return false;
            },
            compositionend(view) {
              syncOverlayRef?.(view);
              return false;
            },
          },
        },
      }),
    ];
  },
});
