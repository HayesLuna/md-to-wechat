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
import { Decoration, DecorationSet } from '@tiptap/pm/view';

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
  constructor(readonly pos: number) {}
  map(mapping: Mappable) {
    return new BlockBookmark(mapping.map(this.pos));
  }
  resolve(doc: Node): Selection {
    const $pos = doc.resolve(Math.min(this.pos, doc.content.size));
    return isBoundary($pos) ? new BlockCursor($pos) : Selection.near($pos);
  }
}
class BlockCursor extends GapCursor {
  map(doc: Node, mapping: Mappable): Selection {
    return this.getBookmark().map(mapping).resolve(doc);
  }
  getBookmark() {
    return new BlockBookmark(this.head);
  }
  toJSON() {
    return { type: 'blockCursor', pos: this.head };
  }
  static fromJSON(doc: Node, json: { pos: number }) {
    return new BlockCursor(doc.resolve(json.pos));
  }
}
Selection.jsonID('blockCursor', BlockCursor);

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
        props: {
          decorations: (state) => key.getState(state)?.points,
          handleDOMEvents: {
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
