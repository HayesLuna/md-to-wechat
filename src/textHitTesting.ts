import type { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';

export type TextLine = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
export function textPointMatches(
  view: EditorView,
  point: { left: number; top: number },
) {
  const hit = view.posAtCoords(point);
  if (!hit || !view.state.doc.resolve(hit.pos).parent.inlineContent)
    return false;
  const rect = view.coordsAtPos(hit.pos);
  return (
    rect.bottom > rect.top &&
    rect.top <= point.top &&
    rect.bottom >= point.top &&
    Math.abs(rect.left - point.left) <= 16
  );
}
// Model positions are ordered by visual row inside an ordinary textblock.
// Binary search measures O(log n) carets, never all glyph/token rectangles.
export function textLineAt(
  view: EditorView,
  from: number,
  to: number,
  y: number,
): TextLine & { from: number; to: number } {
  const measured = new Map<number, ReturnType<EditorView['coordsAtPos']>>();
  const at = (pos: number) => {
    let rect = measured.get(pos);
    if (!rect) {
      rect = view.coordsAtPos(pos);
      measured.set(pos, rect);
    }
    return rect;
  };
  const first = (predicate: (pos: number) => boolean) => {
    let lo = from,
      hi = to;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (predicate(mid)) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  const caret = at(first((pos) => at(pos).bottom >= y));
  const center = (caret.top + caret.bottom) / 2;
  const start = first((pos) => at(pos).bottom > center);
  const after = first((pos) => at(pos).top > center);
  const left = at(start),
    right = view.coordsAtPos(after, after > start ? -1 : 1);
  return {
    from: start,
    to: after,
    left: Math.min(left.left, right.left),
    right: Math.max(left.right, right.right),
    top: caret.top,
    bottom: caret.bottom,
  };
}

export function ordinaryTextAtCoords(
  view: EditorView,
  point: { left: number; top: number },
) {
  const bounds = view.dom.getBoundingClientRect();
  const candidates = new Set<number>();
  const barriers = new Set<number>();
  const skip = new Set(['codeBlock', 'image', 'table', 'horizontalRule']);
  const add = (pos: number, direction: 1 | -1 = 1, depth = 0) => {
    const node = view.state.doc.nodeAt(pos);
    if (!node || depth > 32) return;
    if (skip.has(node.type.name)) {
      barriers.add(pos);
      return;
    }
    if (node.isTextblock) {
      candidates.add(pos);
      return;
    }
    const child = direction === 1 ? node.firstChild : node.lastChild;
    if (child)
      add(
        direction === 1 ? pos + 1 : pos + node.nodeSize - 1 - child.nodeSize,
        direction,
        depth + 1,
      );
  };
  const near = (pos: number) => {
    if (pos < 0 || pos > view.state.doc.content.size) return;
    const $pos = view.state.doc.resolve(pos),
      node = $pos.nodeAfter;
    if (node) {
      add(pos);
      add(pos, -1);
    }
    if ($pos.nodeBefore) add(pos - $pos.nodeBefore.nodeSize, -1);
    if (node) {
      const next = pos + node.nodeSize;
      if (next < view.state.doc.content.size) add(next);
    }
  };
  const top = Math.max(bounds.top + 1, Math.min(bounds.bottom - 1, point.top));
  for (const left of [
    Math.max(bounds.left + 1, Math.min(bounds.right - 1, point.left)),
    (bounds.left + bounds.right) / 2,
  ]) {
    const hit = view.posAtCoords({ left, top });
    if (!hit) continue;
    const $hit = view.state.doc.resolve(hit.pos);
    if (hit.inside >= 0) near(hit.inside);
    if ($hit.nodeAfter || $hit.nodeBefore) near($hit.pos);
    for (let depth = $hit.depth; depth > 0; depth--) near($hit.before(depth));
  }
  let chosen: { pos: number; line: ReturnType<typeof textLineAt> } | null =
    null;
  const obstacles = [...barriers].flatMap((pos) => {
    const dom = view.nodeDOM(pos);
    return dom instanceof HTMLElement ? [dom.getBoundingClientRect()] : [];
  });
  const rank = (line: TextLine) =>
    line.top <= point.top && line.bottom >= point.top
      ? 0
      : line.top > point.top
        ? 1
        : 2;
  for (const pos of candidates) {
    const element = view.nodeDOM(pos);
    if (!(element instanceof HTMLElement)) continue;
    const node = view.state.doc.nodeAt(pos)!;
    const line = textLineAt(
      view,
      pos + 1,
      pos + 1 + node.content.size,
      point.top,
    );
    if (
      obstacles.some(
        (rect) =>
          (line.top > point.top &&
            rect.top >= point.top &&
            rect.bottom <= line.top) ||
          (line.bottom < point.top &&
            rect.bottom <= point.top &&
            rect.top >= line.bottom),
      )
    )
      continue;
    const priority = rank(line),
      previous = chosen && rank(chosen.line);
    if (
      !chosen ||
      priority < previous! ||
      (priority === previous &&
        (priority === 2
          ? line.bottom > chosen.line.bottom
          : line.top < chosen.line.top))
    )
      chosen = { pos, line };
  }
  if (!chosen) return null;
  const { pos, line } = chosen,
    node = view.state.doc.nodeAt(pos)!;
  const left = Math.max(
    line.left + 0.1,
    Math.min(Math.max(line.left + 0.1, line.right - 0.1), point.left),
  );
  const glyphY = (line.top + line.bottom) / 2;
  const doc = view.dom.ownerDocument;
  // A partly clipped row can have its center outside the scroll viewport.
  // Do not invoke PM's linear DOM fallback there. Prefer the browser caret API,
  // then binary search only this visual row if no native caret is available.
  const native = doc.caretPositionFromPoint?.(left, glyphY);
  const range = native ? null : doc.caretRangeFromPoint?.(left, glyphY);
  const dom = native?.offsetNode ?? range?.startContainer;
  let hit: number | null =
    dom && view.dom.contains(dom)
      ? view.posAtDOM(dom, native?.offset ?? range!.startOffset)
      : null;
  const row = line;
  if (hit === null || hit < row.from || hit > row.to) {
    let lo = row.from,
      hi = row.to;
    const x = (pos: number) =>
      view.coordsAtPos(pos, pos === row.to && pos > row.from ? -1 : 1).left;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (x(mid) >= left) hi = mid;
      else lo = mid + 1;
    }
    hit =
      lo > row.from && Math.abs(x(lo - 1) - left) < Math.abs(x(lo) - left)
        ? lo - 1
        : lo;
  }
  const start = pos + 1,
    end = start + node.content.size;
  const selection = TextSelection.create(
    view.state.doc,
    Math.max(start, Math.min(end, hit)),
  );
  return { selection, line };
}

export function retainLineAffinity(
  view: EditorView,
  selection: TextSelection,
  line: TextLine,
) {
  const top = (line.top + line.bottom) / 2;
  if (view.coordsAtPos(selection.head).top <= top) return;
  const start = view.posAtCoords({ left: line.left + 0.1, top });
  const native = view.dom.ownerDocument.getSelection();
  if (!start || !native?.modify) return;
  const first = view.domAtPos(start.pos);
  native.collapse(first.node, first.offset);
  native.modify('move', 'forward', 'lineboundary');
  if (
    !native.anchorNode ||
    view.posAtDOM(native.anchorNode, native.anchorOffset) !== selection.head
  ) {
    const end = view.domAtPos(selection.head);
    native.collapse(end.node, end.offset);
  }
}

export type TextHit = { selection: TextSelection; line: TextLine };
const gestures = new WeakMap<EditorView, () => void>();
export function endTextSelection(view: EditorView) {
  gestures.get(view)?.();
}
export function beginTextSelection(
  view: EditorView,
  event: MouseEvent,
  target: TextHit,
  resolve: (point: { left: number; top: number }) => TextHit | null,
) {
  endTextSelection(view);
  event.preventDefault();
  const doc = view.dom.ownerDocument,
    source = view.state.doc,
    anchor = target.selection.head;
  const surface = view.dom.closest('.writing-scroll')!;
  const inner =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>('.code-viewport')
      : null;
  const apply = (hit: TextHit, drag = false) => {
    const rect = surface.getBoundingClientRect();
    const selection = drag
      ? TextSelection.create(view.state.doc, anchor, hit.selection.head)
      : hit.selection;
    const tr = view.state.tr.setSelection(selection);
    if (!drag && (hit.line.top < rect.top || hit.line.bottom > rect.bottom))
      tr.scrollIntoView();
    if (!selection.eq(view.state.selection)) view.dispatch(tr);
    view.focus();
    if (selection.empty) retainLineAffinity(view, selection, hit.line);
  };
  apply(target);
  let frame = 0,
    pending: MouseEvent | null = null,
    dragging = false,
    lastFrame = 0;
  const moved = (event: MouseEvent) =>
    (event.clientX - targetPoint.left) ** 2 +
      (event.clientY - targetPoint.top) ** 2 >
    16;
  const targetPoint = { left: event.clientX, top: event.clientY };
  const update = (event: MouseEvent) => {
    if (view.isDestroyed || view.state.doc !== source) {
      cleanup();
      return;
    }
    dragging ||= moved(event);
    if (!dragging) return;
    const bounds = surface.getBoundingClientRect();
    const point = {
      left: event.clientX,
      top: Math.max(bounds.top + 1, Math.min(bounds.bottom - 1, event.clientY)),
    };
    const raw = view.posAtCoords(point);
    const inCode =
      raw && view.state.doc.resolve(raw.pos).parent.type.name === 'codeBlock';
    const resolved = resolve(point);
    const hit =
      inCode && resolved?.selection.$head.parent.type.name !== 'codeBlock'
        ? null
        : resolved;
    if (hit) apply(hit, true);
    else if (raw && view.state.doc.resolve(raw.pos).parent.inlineContent) {
      const selection = TextSelection.create(view.state.doc, anchor, raw.pos);
      if (!selection.eq(view.state.selection))
        view.dispatch(view.state.tr.setSelection(selection));
      view.focus();
    }
  };
  // Native dragging already scrolls itself. Only gestures whose blank-space
  // mouse down was prevented need this loop; it ends as soon as the mouse is up.
  const tick = (time: number) => {
    frame = 0;
    if (!pending) return;
    if (view.isDestroyed || view.state.doc !== source) {
      cleanup();
      return;
    }
    const elapsed = lastFrame ? Math.min(32, time - lastFrame) : 16;
    lastFrame = time;
    let scrolled = false;
    if (dragging || moved(pending)) {
      const outerBounds = surface.getBoundingClientRect();
      const innerBounds = inner?.getBoundingClientRect();
      const withinCode =
        innerBounds &&
        pending.clientX >= innerBounds.left &&
        pending.clientX <= innerBounds.right &&
        pending.clientY >= Math.max(innerBounds.top, outerBounds.top) &&
        pending.clientY <= Math.min(innerBounds.bottom, outerBounds.bottom);
      const bounds = withinCode
        ? {
            top: Math.max(innerBounds.top, outerBounds.top),
            bottom: Math.min(innerBounds.bottom, outerBounds.bottom),
          }
        : outerBounds;
      const distance =
        pending.clientY < bounds.top + 32
          ? pending.clientY - bounds.top - 32
          : pending.clientY > bounds.bottom - 32
            ? pending.clientY - bounds.bottom + 32
            : 0;
      if (distance) {
        const delta =
          (Math.sign(distance) *
            Math.min(900, Math.abs(distance) * 18) *
            elapsed) /
          1000;
        const scroll = (element: Element) => {
          const before = element.scrollTop;
          element.scrollTop += delta;
          return element.scrollTop !== before;
        };
        // Scroll code first. Once it is exhausted, allow the containing article
        // to move so selection can continue into the surrounding prose.
        scrolled = !!(withinCode && inner && scroll(inner));
        if (!scrolled) scrolled = scroll(surface);
      }
    }
    update(pending);
    if (scrolled && gestures.has(view)) frame = requestAnimationFrame(tick);
  };
  const move = (event: MouseEvent) => {
    if (event.buttons !== 1) {
      cleanup();
      return;
    }
    pending = event;
    if (!frame) {
      lastFrame = 0;
      frame = requestAnimationFrame(tick);
    }
  };
  const up = (event: MouseEvent) => {
    cancelAnimationFrame(frame);
    update(event);
    cleanup();
  };
  const cleanup = () => {
    cancelAnimationFrame(frame);
    pending = null;
    doc.removeEventListener('mousemove', move, true);
    doc.removeEventListener('mouseup', up, true);
    doc.defaultView?.removeEventListener('blur', cleanup);
    gestures.delete(view);
  };
  gestures.set(view, cleanup);
  doc.addEventListener('mousemove', move, true);
  doc.addEventListener('mouseup', up, true);
  doc.defaultView?.addEventListener('blur', cleanup);
}
