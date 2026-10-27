import { Extension, type Editor } from '@tiptap/core';
import { GapCursor } from '@tiptap/pm/gapcursor';
import type { Node, ResolvedPos } from '@tiptap/pm/model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from '@tiptap/pm/state';
import { ReplaceStep, type Mappable } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

const blockTypes = new Set(['codeBlock', 'image', 'horizontalRule', 'table']);
const isBlock = (node: Node | null | undefined) =>
  !!node && blockTypes.has(node.type.name);
const isBoundary = ($pos: ResolvedPos) =>
  !$pos.parent.inlineContent &&
  (isBlock($pos.nodeBefore) || isBlock($pos.nodeAfter)) &&
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
    readonly ratio = 0.5,
  ) {}
  map(mapping: Mappable) {
    return new BlockBookmark(mapping.map(this.pos), this.edge, this.ratio);
  }
  resolve(doc: Node): Selection {
    const $pos = doc.resolve(Math.min(this.pos, doc.content.size));
    return isBoundary($pos)
      ? new BlockCursor($pos, this.edge, this.ratio)
      : Selection.near($pos);
  }
}
class BlockCursorSelection extends GapCursor {
  constructor(
    $pos: ResolvedPos,
    readonly edge: 'left' | 'right' | null = null,
    readonly ratio = 0.5,
  ) {
    super($pos);
  }
  eq(other: Selection) {
    return (
      other instanceof BlockCursor &&
      other.head === this.head &&
      other.edge === this.edge &&
      other.ratio === this.ratio
    );
  }
  map(doc: Node, mapping: Mappable): Selection {
    return this.getBookmark().map(mapping).resolve(doc);
  }
  getBookmark() {
    return new BlockBookmark(this.head, this.edge, this.ratio);
  }
  toJSON() {
    return {
      type: 'blockCursor',
      pos: this.head,
      edge: this.edge,
      ratio: this.ratio,
    };
  }
  static fromJSON(
    doc: Node,
    json: { pos: number; edge?: 'left' | 'right' | null; ratio?: number },
  ) {
    return new BlockCursor(doc.resolve(json.pos), json.edge, json.ratio);
  }
}
// ProseMirror keeps a global selection registry. Preserve the constructor
// during Vite hot updates so existing selections and history keep their type.
const BlockCursor = (import.meta.hot?.data.BlockCursor ||
  BlockCursorSelection) as typeof BlockCursorSelection;
if (!import.meta.hot?.data.BlockCursor)
  Selection.jsonID('blockCursor', BlockCursor);
if (import.meta.hot) import.meta.hot.data.BlockCursor = BlockCursor;

type BoundaryState = { points: DecorationSet; paragraph: number | null };
const key = new PluginKey<BoundaryState>('blockBoundaries');

function insertionPoints(doc: Node) {
  const positions = new Set<number>();
  doc.descendants((node, pos) => {
    if (isBlock(node)) {
      for (const at of [pos, pos + node.nodeSize]) {
        if (isBoundary(doc.resolve(at))) positions.add(at);
      }
    }
  });
  return DecorationSet.create(
    doc,
    [...positions].map((pos) =>
      Decoration.widget(
        pos,
        (view, getPos) => {
          const point = document.createElement('span');
          point.className = 'block-insertion-point';
          point.contentEditable = 'false';
          point.setAttribute('aria-hidden', 'true');
          const hit = document.createElement('span');
          hit.className = 'block-insertion-hit';
          point.append(hit);
          hit.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || !view.editable) return;
            event.preventDefault();
            const at = getPos();
            if (at === undefined) return;
            const $pos = view.state.doc.resolve(at);
            if (!isBoundary($pos)) return;
            view.dispatch(view.state.tr.setSelection(new BlockCursor($pos)));
            view.focus();
          });
          return point;
        },
        { side: -1, key: `block-insertion-${pos}`, ignoreSelection: true },
      ),
    ),
  );
}

function paintedBlock(view: EditorView, pos: number) {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  return view.state.doc.nodeAt(pos)?.type.name === 'image'
    ? dom.querySelector<HTMLElement>('.image-box') || dom
    : dom;
}

function lateralCursor(view: EditorView, event: MouseEvent) {
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
  for (const pos of candidates) {
    const node = view.state.doc.nodeAt(pos);
    if (!isBlock(node)) continue;
    const rect = paintedBlock(view, pos)?.getBoundingClientRect();
    if (!rect || event.clientY < rect.top || event.clientY > rect.bottom)
      continue;
    const edge =
      event.clientX < rect.left
        ? 'left'
        : event.clientX > rect.right
          ? 'right'
          : null;
    if (!edge) continue;
    const $pos = view.state.doc.resolve(
      edge === 'left' ? pos : pos + node!.nodeSize,
    );
    if (isBoundary($pos))
      return new BlockCursor(
        $pos,
        edge,
        Math.max(
          0,
          Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)),
        ),
      );
  }
  return null;
}

function insertBoundaryText(view: EditorView, text: string) {
  const { selection, schema } = view.state;
  if (!(selection instanceof BlockCursor) || !text) return false;
  const pos = selection.from;
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
    return [
      new Plugin<BoundaryState>({
        key,
        state: {
          init: (_, state) => ({
            points: insertionPoints(state.doc),
            paragraph: null,
          }),
          apply(tr, value, oldState) {
            const mapped =
              value.paragraph === null
                ? null
                : tr.mapping.mapResult(value.paragraph, 1);
            let paragraph = mapped && !mapped.deleted ? mapped.pos : null;
            if (tr.docChanged && oldState.selection instanceof BlockCursor) {
              const pos = tr.mapping.map(oldState.selection.from, -1);
              if (
                tr.doc.nodeAt(pos)?.type.name === 'paragraph' &&
                tr.doc.nodeAt(pos) !==
                  oldState.doc.nodeAt(oldState.selection.from)
              )
                paragraph = pos;
            }
            if (
              paragraph !== null &&
              tr.doc.nodeAt(paragraph)?.type.name !== 'paragraph'
            )
              paragraph = null;
            return {
              // Typing maps existing hit areas; only structural edits rescan nodes.
              points: !tr.docChanged
                ? value.points
                : tr.steps.every((step, i) => {
                      if (!(step instanceof ReplaceStep)) return false;
                      const $from = tr.docs[i].resolve(step.from);
                      const $to = tr.docs[i].resolve(step.to);
                      let inline = true;
                      step.slice.content.forEach((node) => {
                        if (!node.isInline) inline = false;
                      });
                      return (
                        $from.sameParent($to) &&
                        $from.parent.inlineContent &&
                        inline
                      );
                    })
                  ? value.points.map(tr.mapping, tr.doc)
                  : insertionPoints(tr.doc),
              paragraph,
            };
          },
        },
        view(view) {
          const doc = view.dom.ownerDocument;
          let frame = 0;
          const update = () => {
            if (!(view.state.selection instanceof GapCursor)) return;
            const caret = view.dom.querySelector<HTMLElement>(
              '.ProseMirror-gapcursor',
            );
            if (!caret) return;
            const selection = view.state.selection;
            const lateral =
              selection instanceof BlockCursor && !!selection.edge;
            caret.classList.toggle('block-side-cursor', lateral);
            if (!lateral || !(selection instanceof BlockCursor)) {
              caret.style.removeProperty('left');
              caret.style.removeProperty('top');
              caret.style.removeProperty('visibility');
              return;
            }
            const pos =
              selection.edge === 'left'
                ? selection.from
                : selection.from - (selection.$from.nodeBefore?.nodeSize || 0);
            const rect = paintedBlock(view, pos)?.getBoundingClientRect();
            const scroll = view.dom
              .closest('.writing-scroll')
              ?.getBoundingClientRect();
            if (!rect) return;
            const inset = Math.min(9, rect.height / 2);
            const y = Math.max(
              rect.top + inset,
              Math.min(
                rect.bottom - inset,
                rect.top + rect.height * selection.ratio,
              ),
            );
            caret.style.visibility =
              scroll && (y < scroll.top || y > scroll.bottom) ? 'hidden' : '';
            caret.style.left = `${selection.edge === 'left' ? rect.left - 8 : rect.right + 7}px`;
            caret.style.top = `${y - 9}px`;
          };
          const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(update);
          };
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
            const selection = lateralCursor(view, event);
            if (!selection) return;
            event.preventDefault();
            const scrollTop = surface.scrollTop;
            const scrollLeft = surface.scrollLeft;
            view.dispatch(view.state.tr.setSelection(selection));
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
          window.addEventListener('resize', schedule);
          return {
            update,
            destroy() {
              cancelAnimationFrame(frame);
              doc.removeEventListener('pointerdown', pointerDown, true);
              doc.removeEventListener('click', touchClick, true);
              doc.removeEventListener('scroll', schedule, true);
              window.removeEventListener('resize', schedule);
            },
          };
        },
        props: {
          decorations: (state) => key.getState(state)?.points,
          handleTextInput: (view, _from, _to, text) =>
            insertBoundaryText(view, text),
          handleDOMEvents: {
            beforeinput(view, event) {
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
              const tr = state.tr.deleteSelection();
              const $pos = tr.doc.resolve(
                Math.min(selection.from, tr.doc.content.size),
              );
              if (isBoundary($pos)) tr.setSelection(new BlockCursor($pos));
              view.dispatch(tr.scrollIntoView());
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
            if (removableEmptyParagraph(state.doc, $from.before())) {
              const start = $from.before();
              tr.delete(start, $from.after());
              tr.setSelection(new BlockCursor(tr.doc.resolve(start)));
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
    ];
  },
});
