import { Extension, type Editor } from '@tiptap/core';
import { GapCursor, gapCursor } from '@tiptap/pm/gapcursor';
import type { Node, ResolvedPos } from '@tiptap/pm/model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

const blockTypes = new Set(['codeBlock', 'image', 'horizontalRule', 'table']);
const isBlock = (node: Node | null | undefined) =>
  !!node && blockTypes.has(node.type.name);
const isCursorBlock = isBlock;
const isBoundary = ($pos: ResolvedPos) =>
  !$pos.parent.inlineContent &&
  (isCursorBlock($pos.nodeBefore) || isCursorBlock($pos.nodeAfter)) &&
  $pos.parent.canReplaceWith(
    $pos.index(),
    $pos.index(),
    $pos.doc.type.schema.nodes.paragraph,
  );

function removableEmptyParagraph(doc: Node, pos: number) {
  const node = doc.nodeAt(pos);
  const $pos = doc.resolve(pos);
  return (
    node?.type.name === 'paragraph' &&
    !node.content.size &&
    $pos.parent.canReplace($pos.index(), $pos.index() + 1)
  );
}

// Unlike the standard gap cursor, these boundaries also include editable code
// blocks and blocks beside ordinary paragraphs. No document node is inserted.
class BlockBookmark {
  constructor(
    readonly pos: number,
    readonly edge: 'left' | 'right' | null = null,
  ) {}
  map(mapping: Mappable) {
    return new BlockBookmark(mapping.map(this.pos), this.edge);
  }
  resolve(doc: Node): Selection {
    const $pos = doc.resolve(Math.min(this.pos, doc.content.size));
    return isBoundary($pos)
      ? new BlockCursor($pos, this.edge)
      : Selection.near($pos);
  }
}
class BlockCursorSelection extends GapCursor {
  constructor(
    $pos: ResolvedPos,
    readonly edge: 'left' | 'right' | null = null,
  ) {
    super($pos);
  }
  eq(other: Selection) {
    return (
      other instanceof BlockCursor &&
      other.head === this.head &&
      other.edge === this.edge
    );
  }
  map(doc: Node, mapping: Mappable): Selection {
    return this.getBookmark().map(mapping).resolve(doc);
  }
  getBookmark() {
    return new BlockBookmark(this.head, this.edge);
  }
  toJSON() {
    return {
      type: 'blockCursor',
      pos: this.head,
      edge: this.edge,
    };
  }
  static fromJSON(
    doc: Node,
    json: { pos: number; edge?: 'left' | 'right' | null },
  ) {
    return new BlockCursor(doc.resolve(json.pos), json.edge);
  }
}
// ProseMirror keeps a global selection registry. Preserve the constructor
// during Vite hot updates so existing selections and history keep their type.
const BlockCursor = (import.meta.hot?.data.BlockCursor ||
  BlockCursorSelection) as typeof BlockCursorSelection;
if (!import.meta.hot?.data.BlockCursor)
  Selection.jsonID('blockCursor', BlockCursor);
if (import.meta.hot) import.meta.hot.data.BlockCursor = BlockCursor;

// Image side cursors retain a real NodeSelection, so the original NodeView
// selection frame, controls and resize handles remain the source of truth.
class ImageSideBookmark {
  constructor(
    readonly anchor: number,
    readonly edge: 'left' | 'right',
    readonly valid = true,
  ) {}
  map(mapping: Mappable) {
    const mapped = mapping.mapResult(this.anchor);
    return new ImageSideBookmark(
      mapped.pos,
      this.edge,
      this.valid && !mapped.deleted,
    );
  }
  resolve(doc: Node): Selection {
    const $pos = doc.resolve(Math.min(this.anchor, doc.content.size));
    return this.valid && $pos.nodeAfter?.type.name === 'image'
      ? new ImageSide($pos, this.edge)
      : Selection.near($pos);
  }
}
class ImageSideSelection extends NodeSelection {
  constructor(
    $pos: ResolvedPos,
    readonly edge: 'left' | 'right',
  ) {
    super($pos);
  }
  eq(other: Selection) {
    return (
      other instanceof ImageSide &&
      other.from === this.from &&
      other.edge === this.edge
    );
  }
  map(doc: Node, mapping: Mappable): Selection {
    return this.getBookmark().map(mapping).resolve(doc);
  }
  getBookmark() {
    return new ImageSideBookmark(this.from, this.edge);
  }
  toJSON() {
    return { type: 'imageSide', anchor: this.from, edge: this.edge };
  }
  static fromJSON(doc: Node, json: { anchor: number; edge: 'left' | 'right' }) {
    return new ImageSide(doc.resolve(json.anchor), json.edge);
  }
}
const ImageSide = (import.meta.hot?.data.ImageSide ||
  ImageSideSelection) as typeof ImageSideSelection;
if (!import.meta.hot?.data.ImageSide) Selection.jsonID('imageSide', ImageSide);
if (import.meta.hot) import.meta.hot.data.ImageSide = ImageSide;

function inputBoundary(selection: Selection) {
  if (selection instanceof BlockCursor) return selection.from;
  if (selection instanceof ImageSide)
    return selection.edge === 'left' ? selection.from : selection.to;
  return null;
}

function sideSelection(doc: Node, pos: number, edge: 'left' | 'right') {
  const $pos = doc.resolve(pos);
  const node = edge === 'left' ? $pos.nodeAfter : $pos.nodeBefore;
  return node?.type.name === 'image'
    ? new ImageSide(
        doc.resolve(edge === 'left' ? pos : pos - node.nodeSize),
        edge,
      )
    : new BlockCursor($pos, edge);
}

type BoundaryState = { paragraph: number | null; textSide: -1 | 1 };
const key = new PluginKey<BoundaryState>('blockBoundaries');

function paintedBlock(view: EditorView, pos: number) {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  return dom;
}

function blockSelectionAtCoords(view: EditorView, event: MouseEvent) {
  const bounds = view.dom.getBoundingClientRect();
  const hit = view.posAtCoords({
    left: Math.max(bounds.left + 1, Math.min(bounds.right - 1, event.clientX)),
    top: event.clientY,
  });
  if (!hit) return null;
  const $hit = view.state.doc.resolve(hit.pos);
  const candidates = new Set<number>();
  if (hit.inside >= 0) candidates.add(hit.inside);
  if ($hit.nodeAfter) candidates.add($hit.pos);
  if ($hit.nodeBefore) candidates.add($hit.pos - $hit.nodeBefore.nodeSize);
  for (let depth = $hit.depth; depth > 0; depth--)
    candidates.add($hit.before(depth));
  for (const pos of [...candidates].sort(
    (a, b) =>
      Number(isBlock(view.state.doc.nodeAt(b))) -
      Number(isBlock(view.state.doc.nodeAt(a))),
  )) {
    const node = view.state.doc.nodeAt(pos);
    if (!isBlock(node) && !node?.isTextblock) continue;
    const rect = paintedBlock(view, pos)?.getBoundingClientRect();
    if (!rect || event.clientY < rect.top || event.clientY > rect.bottom)
      continue;
    if (node!.type.name === 'horizontalRule') {
      if (event.clientX >= rect.left && event.clientX <= rect.right)
        return NodeSelection.create(view.state.doc, pos);
    }
    const edge =
      event.clientX < rect.left
        ? 'left'
        : event.clientX > rect.right
          ? 'right'
          : null;
    if (!edge) continue;
    if (!isBlock(node)) {
      // Hit-test at the textblock's edge so wrapped paragraphs and list items
      // keep the clicked visual line, rather than jumping to the block's end.
      const line = view.posAtCoords({
        left: edge === 'left' ? rect.left + 1 : rect.right - 1,
        top: event.clientY,
      });
      if (line && view.state.doc.resolve(line.pos).parent.inlineContent)
        return TextSelection.create(view.state.doc, line.pos);
      continue;
    }
    const $pos = view.state.doc.resolve(
      edge === 'left' ? pos : pos + node!.nodeSize,
    );
    if (isBoundary($pos)) return sideSelection(view.state.doc, $pos.pos, edge);
  }
  return null;
}

function materializeImageText(view: EditorView) {
  if (!(view.state.selection instanceof ImageSide)) return false;
  const pos = inputBoundary(view.state.selection)!;
  const tr = view.state.tr.insert(
    pos,
    view.state.schema.nodes.paragraph.create(),
  );
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)));
  return true;
}

function deleteBlock(view: EditorView, from: number, to: number) {
  const tr = view.state.tr.delete(from, to);
  const $pos = tr.doc.resolve(Math.min(from, tr.doc.content.size));
  if (isBoundary($pos))
    tr.setSelection(
      sideSelection(
        tr.doc,
        $pos.pos,
        isCursorBlock($pos.nodeBefore) ? 'right' : 'left',
      ),
    );
  view.dispatch(tr.scrollIntoView());
}

function insertBoundaryText(view: EditorView, text: string) {
  const { selection, schema } = view.state;
  const pos = inputBoundary(selection);
  if (pos === null || !text) return false;
  const tr = view.state.tr.insert(
    pos,
    schema.nodes.paragraph.create(null, schema.text(text)),
  );
  tr.setSelection(TextSelection.create(tr.doc, pos + 1 + text.length));
  view.dispatch(tr.scrollIntoView());
  return true;
}

export function clearEmptyBlockParagraph(editor: Editor) {
  if (editor.isDestroyed || !editor.isEditable) return;
  const pos = key.getState(editor.state)?.paragraph;
  if (
    pos === null ||
    pos === undefined ||
    !removableEmptyParagraph(editor.state.doc, pos)
  )
    return;
  editor.view.dispatch(
    editor.state.tr.delete(pos, pos + 2).setMeta('addToHistory', false),
  );
}

export const BlockBoundaries = Extension.create({
  name: 'blockBoundaries',
  priority: 1100,
  addProseMirrorPlugins() {
    const editor = this.editor;
    const gaps = gapCursor();
    return [
      new Plugin<BoundaryState>({
        key,
        state: {
          init: () => ({ paragraph: null, textSide: 1 }),
          apply(tr, value, oldState) {
            const mapped =
              value.paragraph === null
                ? null
                : tr.mapping.mapResult(value.paragraph, 1);
            let paragraph = mapped && !mapped.deleted ? mapped.pos : null;
            const previousBoundary = inputBoundary(oldState.selection);
            if (tr.docChanged && previousBoundary !== null) {
              const pos = tr.mapping.map(previousBoundary, -1);
              if (
                tr.doc.nodeAt(pos)?.type.name === 'paragraph' &&
                tr.doc.nodeAt(pos) !== oldState.doc.nodeAt(previousBoundary)
              )
                paragraph = pos;
            }
            if (
              paragraph !== null &&
              tr.doc.nodeAt(paragraph)?.type.name !== 'paragraph'
            )
              paragraph = null;
            return {
              paragraph,
              textSide:
                tr.getMeta(key)?.textSide ??
                (tr.selectionSet || tr.docChanged ? 1 : value.textSide),
            };
          },
        },
        view(view) {
          const doc = view.dom.ownerDocument;
          const textCaret = doc.createElement('div');
          textCaret.className = 'editor-text-cursor';
          textCaret.setAttribute('aria-hidden', 'true');
          textCaret.hidden = true;
          view.dom.closest('.writing-scroll')?.append(textCaret);
          view.dom.classList.add('custom-text-cursor');
          let composing = false;
          let frame = 0;
          let observedBlock: HTMLElement | null = null;
          const observe = (block: HTMLElement | null) => {
            if (block === observedBlock) return;
            resizeObserver.disconnect();
            observedBlock = block;
            if (block) {
              resizeObserver.observe(block);
              resizeObserver.observe(view.dom);
            }
          };
          const update = () => {
            const selection = view.state.selection;
            const nativeSelection = doc.getSelection();
            const textVisible =
              view.hasFocus() &&
              view.editable &&
              !composing &&
              !view.composing &&
              selection instanceof TextSelection &&
              selection.empty &&
              !!nativeSelection?.isCollapsed;
            textCaret.hidden = !textVisible;
            if (textVisible) {
              const rect = view.coordsAtPos(
                selection.head,
                key.getState(view.state)?.textSide ?? 1,
              );
              const scroll = view.dom
                .closest('.writing-scroll')!
                .getBoundingClientRect();
              const dom = view.domAtPos(selection.head).node;
              const element = dom instanceof Element ? dom : dom.parentElement;
              const inner = element
                ?.closest('pre, .tableWrapper')
                ?.getBoundingClientRect();
              const top = Math.max(scroll.top, inner?.top ?? scroll.top);
              const bottom = Math.min(
                scroll.bottom,
                inner?.bottom ?? scroll.bottom,
              );
              const left = Math.max(scroll.left, inner?.left ?? scroll.left);
              const right = Math.min(
                scroll.right,
                inner?.right ?? scroll.right,
              );
              textCaret.hidden =
                rect.bottom < top ||
                rect.top > bottom ||
                rect.left < left ||
                rect.left > right;
              textCaret.style.left = `${rect.left}px`;
              textCaret.style.top = `${rect.top}px`;
              textCaret.style.height = `${rect.bottom - rect.top}px`;
              textCaret.style.clipPath = `inset(${Math.max(0, top - rect.top)}px 0 ${Math.max(0, rect.bottom - bottom)}px 0)`;
            }
            if (
              !(view.state.selection instanceof GapCursor) &&
              !(view.state.selection instanceof ImageSide)
            ) {
              observe(textVisible ? view.dom : null);
              return;
            }
            const caret = view.dom.querySelector<HTMLElement>(
              '.ProseMirror-gapcursor',
            );
            if (!caret) return;
            const lateral =
              selection instanceof ImageSide ||
              (selection instanceof BlockCursor && !!selection.edge);
            caret.classList.toggle('block-side-cursor', lateral);
            if (
              !lateral ||
              (!(selection instanceof BlockCursor) &&
                !(selection instanceof ImageSide))
            ) {
              observe(null);
              caret.style.removeProperty('left');
              caret.style.removeProperty('top');
              caret.style.removeProperty('visibility');
              return;
            }
            const pos =
              selection instanceof ImageSide
                ? selection.from
                : selection.edge === 'left'
                  ? selection.from
                  : selection.from -
                    (selection.$from.nodeBefore?.nodeSize || 0);
            const block = paintedBlock(view, pos);
            observe(block);
            const rect = block?.getBoundingClientRect();
            const scroll = view.dom
              .closest('.writing-scroll')
              ?.getBoundingClientRect();
            if (!rect) return;
            // A block has one outside text baseline, at its bottom edge.
            // Clicking higher up selects the same before/after document position.
            const y = rect.bottom - 9;
            caret.style.visibility =
              scroll && (y < scroll.top || y > scroll.bottom) ? 'hidden' : '';
            caret.style.left = `${selection.edge === 'left' ? rect.left - 8 : rect.right + 7}px`;
            caret.style.top = `${y - 9}px`;
          };
          const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(update);
          };
          const compositionStart = () => {
            composing = true;
            view.dom.classList.add('cursor-composing');
            textCaret.hidden = true;
          };
          const compositionEnd = () => {
            composing = false;
            view.dom.classList.remove('cursor-composing');
            schedule();
          };
          const resizeObserver = new ResizeObserver(schedule);
          const activate = (event: MouseEvent) => {
            if (
              event.button !== 0 ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey ||
              event.shiftKey ||
              !view.editable
            )
              return;
            const surface = view.dom.closest('.writing-scroll');
            if (
              !(event.target instanceof Element) ||
              !surface?.contains(event.target) ||
              !view.dom.getClientRects().length ||
              event.target.closest('button, input, select, textarea, a')
            )
              return;
            const selection = blockSelectionAtCoords(view, event);
            if (!selection) return;
            event.preventDefault();
            const scrollTop = surface.scrollTop;
            const scrollLeft = surface.scrollLeft;
            const tr = view.state.tr.setSelection(selection);
            if (selection instanceof TextSelection)
              tr.setMeta(key, {
                textSide:
                  event.clientX > view.coordsAtPos(selection.head).left
                    ? -1
                    : 1,
              });
            view.dispatch(tr);
            view.focus();
            surface.scrollTop = scrollTop;
            surface.scrollLeft = scrollLeft;
            update();
          };
          const pointerDown = (event: PointerEvent) => {
            if (event.pointerType !== 'touch') activate(event);
          };
          const touchClick = (event: MouseEvent) => {
            if (event instanceof PointerEvent && event.pointerType === 'touch')
              activate(event);
          };
          doc.addEventListener('pointerdown', pointerDown, true);
          doc.addEventListener('click', touchClick, true);
          doc.addEventListener('scroll', schedule, true);
          doc.addEventListener('selectionchange', schedule);
          view.dom.addEventListener('focus', schedule);
          view.dom.addEventListener('blur', schedule);
          view.dom.addEventListener('compositionstart', compositionStart);
          view.dom.addEventListener('compositionend', compositionEnd);
          window.addEventListener('resize', schedule);
          return {
            update,
            destroy() {
              cancelAnimationFrame(frame);
              resizeObserver.disconnect();
              textCaret.remove();
              view.dom.classList.remove(
                'custom-text-cursor',
                'cursor-composing',
              );
              doc.removeEventListener('pointerdown', pointerDown, true);
              doc.removeEventListener('click', touchClick, true);
              doc.removeEventListener('scroll', schedule, true);
              doc.removeEventListener('selectionchange', schedule);
              view.dom.removeEventListener('focus', schedule);
              view.dom.removeEventListener('blur', schedule);
              view.dom.removeEventListener(
                'compositionstart',
                compositionStart,
              );
              view.dom.removeEventListener('compositionend', compositionEnd);
              window.removeEventListener('resize', schedule);
            },
          };
        },
        props: {
          decorations(state) {
            const points = DecorationSet.empty;
            const selection = state.selection;
            if (!(selection instanceof ImageSide)) return points;
            const pos = inputBoundary(selection)!;
            return points.add(state.doc, [
              Decoration.widget(
                pos,
                () => {
                  const caret = document.createElement('div');
                  caret.className = 'ProseMirror-gapcursor block-side-cursor';
                  caret.setAttribute('aria-hidden', 'true');
                  return caret;
                },
                {
                  key: 'image-side-caret',
                  side: selection.edge === 'left' ? -1 : 1,
                  ignoreSelection: true,
                },
              ),
            ]);
          },
          handleTextInput: (view, _from, _to, text) =>
            insertBoundaryText(view, text),
          handleDOMEvents: {
            compositionstart(view) {
              materializeImageText(view);
              return false;
            },
            paste(view) {
              // Prepare an insertion position before EditorPane's paste handler.
              materializeImageText(view);
              return false;
            },
            beforeinput(view, event) {
              if (event.inputType === 'insertCompositionText')
                materializeImageText(view);
              if (
                event.inputType === 'insertText' &&
                event.data &&
                insertBoundaryText(view, event.data)
              ) {
                event.preventDefault();
                return true;
              }
              return false;
            },
            blur() {
              clearEmptyBlockParagraph(editor);
              return false;
            },
          },
          handleKeyDown(view, event) {
            if (
              !view.editable ||
              event.isComposing ||
              event.keyCode === 229 ||
              event.metaKey ||
              event.ctrlKey ||
              event.altKey ||
              event.shiftKey
            )
              return false;
            const { state } = view;
            const { selection } = state;
            const backwards = event.key === 'Backspace';
            const deleting = backwards || event.key === 'Delete';
            // A held deletion key must not confirm removal of a whole block.
            if (
              deleting &&
              event.repeat &&
              (selection instanceof BlockCursor ||
                (selection instanceof NodeSelection && isBlock(selection.node)))
            )
              return true;
            if (selection instanceof ImageSide) {
              const pos = inputBoundary(selection)!;
              if (event.key === 'Enter') {
                const tr = state.tr.insert(
                  pos,
                  state.schema.nodes.paragraph.create(),
                );
                view.dispatch(
                  tr
                    .setSelection(TextSelection.create(tr.doc, pos + 1))
                    .scrollIntoView(),
                );
                return true;
              }
              if (deleting) {
                if (
                  backwards
                    ? selection.edge === 'right'
                    : selection.edge === 'left'
                )
                  deleteBlock(view, selection.from, selection.to);
                else {
                  const next = Selection.findFrom(
                    state.doc.resolve(pos),
                    backwards ? -1 : 1,
                    true,
                  );
                  if (next)
                    view.dispatch(state.tr.setSelection(next).scrollIntoView());
                }
                return true;
              }
              if (
                ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                  event.key,
                )
              ) {
                const dir = ['ArrowLeft', 'ArrowUp'].includes(event.key)
                  ? -1
                  : 1;
                const next = Selection.findFrom(
                  state.doc.resolve(pos),
                  dir,
                  true,
                );
                if (next)
                  view.dispatch(state.tr.setSelection(next).scrollIntoView());
                return true;
              }
            }
            if (selection instanceof BlockCursor) {
              const pos = selection.from;
              const $pos = selection.$from;
              if (event.key === 'Enter') {
                const tr = state.tr.insert(
                  pos,
                  state.schema.nodes.paragraph.create(),
                );
                view.dispatch(
                  tr
                    .setSelection(TextSelection.create(tr.doc, pos + 1))
                    .scrollIntoView(),
                );
                return true;
              }
              if (deleting) {
                const node = backwards ? $pos.nodeBefore : $pos.nodeAfter;
                if (node) {
                  const at = backwards ? pos - node.nodeSize : pos;
                  if (
                    selection.edge &&
                    node.type.name === 'image' &&
                    (backwards
                      ? selection.edge === 'right'
                      : selection.edge === 'left')
                  ) {
                    deleteBlock(view, at, at + node.nodeSize);
                    return true;
                  }
                  const next = isBlock(node)
                    ? NodeSelection.create(state.doc, at)
                    : Selection.near(
                        state.doc.resolve(backwards ? pos : at),
                        backwards ? -1 : 1,
                      );
                  view.dispatch(state.tr.setSelection(next).scrollIntoView());
                }
                return true;
              }
              if (
                ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                  event.key,
                )
              ) {
                const dir = ['ArrowLeft', 'ArrowUp'].includes(event.key)
                  ? -1
                  : 1;
                const next = Selection.findFrom($pos, dir);
                if (next)
                  view.dispatch(state.tr.setSelection(next).scrollIntoView());
                return true;
              }
            }
            if (!deleting) return false;
            if (selection instanceof NodeSelection && isBlock(selection.node)) {
              deleteBlock(view, selection.from, selection.to);
              return true;
            }
            if (
              !(selection instanceof TextSelection) ||
              !selection.empty ||
              selection.$from.depth < 1 ||
              selection.$from.parent.type.name !== 'paragraph'
            )
              return false;
            const { $from } = selection;
            if (
              $from.parentOffset !== (backwards ? 0 : $from.parent.content.size)
            )
              return false;
            const pos = backwards ? $from.before() : $from.after();
            const adjacent = backwards
              ? state.doc.resolve(pos).nodeBefore
              : state.doc.resolve(pos).nodeAfter;
            if (!isBlock(adjacent)) return false;
            const tr = state.tr;
            if (
              isCursorBlock(adjacent) &&
              removableEmptyParagraph(state.doc, $from.before())
            ) {
              const start = $from.before();
              tr.delete(start, $from.after());
              tr.setSelection(
                sideSelection(tr.doc, start, backwards ? 'right' : 'left'),
              );
            } else {
              tr.setSelection(
                NodeSelection.create(
                  state.doc,
                  backwards ? pos - adjacent!.nodeSize : pos,
                ),
              );
            }
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
        appendTransaction(transactions, _oldState, state) {
          if (!transactions.some((tr) => tr.selectionSet || tr.docChanged))
            return null;
          const pos = key.getState(state)?.paragraph;
          if (pos === null || pos === undefined) return null;
          if (!removableEmptyParagraph(state.doc, pos)) return null;
          if (state.selection.$from.parent === state.doc.nodeAt(pos))
            return null;
          return state.tr.delete(pos, pos + 2).setMeta('addToHistory', false);
        },
      }),
      new Plugin({
        ...gaps.spec,
        props: {
          ...gaps.props,
          // Side clicks are handled above. Keep keyboard/IME support without
          // creating extra mouse insertion targets between blocks.
          handleClick: () => false,
          createSelectionBetween: () => null,
        },
      }),
    ];
  },
});
