import { Extension, type Editor } from '@tiptap/core';
import { GapCursor, gapCursor } from '@tiptap/pm/gapcursor';
import type { Node, ResolvedPos } from '@tiptap/pm/model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type EditorState,
} from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import {
  ordinaryTextAtCoords,
  beginTextSelection,
  endTextSelection,
  textPointMatches,
} from './textHitTesting';
import { placeCodeCaret } from './codeFolding';
import { closeHistory } from '@tiptap/pm/history';
import { imageIndent, isImageName } from './outputUtils';

const blockTypes = new Set(['codeBlock', 'horizontalRule', 'table']);
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

function inputBoundary(selection: Selection) {
  return selection instanceof GapCursor ? selection.from : null;
}

function sideSelection(doc: Node, pos: number, edge: 'left' | 'right') {
  return new BlockCursor(doc.resolve(pos), edge);
}

type BoundaryState = { paragraph: number | null; images: DecorationSet };
const key = new PluginKey<BoundaryState>('blockBoundaries');

function selectedImages(state: EditorState) {
  const { selection, doc } = state;
  if (
    selection.empty ||
    (selection instanceof NodeSelection &&
      isImageName(selection.node.type.name))
  )
    return DecorationSet.empty;
  const images: Decoration[] = [];
  const seen = new Set<number>();
  for (const { $from, $to } of selection.ranges) {
    doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (
        isImageName(node.type.name) &&
        pos >= $from.pos &&
        pos + node.nodeSize <= $to.pos &&
        !seen.has(pos)
      ) {
        seen.add(pos);
        images.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: 'image-range-selected',
          }),
        );
      }
    });
  }
  return DecorationSet.create(doc, images);
}

function inlineImageBoundary(selection: Selection) {
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  if (
    selection.$from.nodeAfter?.type.name === 'inlineImage' &&
    !selection.$from.nodeBefore?.isText
  )
    return { pos: selection.from, edge: 'left' as const };
  if (
    selection.$from.nodeBefore?.type.name === 'inlineImage' &&
    !selection.$from.nodeAfter?.isText
  )
    return {
      pos: selection.from - selection.$from.nodeBefore.nodeSize,
      edge: 'right' as const,
    };
  return null;
}

function paintedBlock(view: EditorView, pos: number) {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  const type = view.state.doc.nodeAt(pos)?.type.name;
  const selector =
    type === 'codeBlock'
      ? '.code-node'
      : isImageName(type)
        ? '.image-box'
        : null;
  return (selector && dom.querySelector<HTMLElement>(selector)) || dom;
}

function paintedBlockRect(block: HTMLElement) {
  const rect = block.getBoundingClientRect();
  const scroller = block.classList.contains('image-box')
    ? block.closest<HTMLElement>('.image-scroll')
    : null;
  if (!scroller) return rect;
  const viewport = scroller.getBoundingClientRect();
  const style = getComputedStyle(scroller);
  const left = Math.max(
    rect.left,
    viewport.left + parseFloat(style.paddingLeft),
  );
  const right = Math.min(
    rect.right,
    viewport.right - parseFloat(style.paddingRight),
  );
  return new DOMRect(left, rect.top, Math.max(0, right - left), rect.height);
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
    if (!isBlock(node) && node?.type.name !== 'inlineImage') continue;
    const block = paintedBlock(view, pos);
    const rect = block && paintedBlockRect(block);
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
    if (node!.type.name === 'inlineImage')
      return TextSelection.create(
        view.state.doc,
        pos + (edge === 'right' ? node!.nodeSize : 0),
      );
    const $pos = view.state.doc.resolve(
      edge === 'left' ? pos : pos + node!.nodeSize,
    );
    if (isBoundary($pos)) return sideSelection(view.state.doc, $pos.pos, edge);
  }
  return null;
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

function updateBlockIndent(view: EditorView, pos: number, indent: number) {
  const { state } = view;
  const block = state.doc.nodeAt(pos)!;
  const tr = closeHistory(state.tr).setNodeMarkup(pos, undefined, {
    ...block.attrs,
    indent,
  });
  tr.setSelection(Selection.fromJSON(tr.doc, state.selection.toJSON()));
  view.dispatch(tr.scrollIntoView());
  // Keep the next edit in its own undo step.
  view.dispatch(closeHistory(view.state.tr));
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
          init: (_config, state) => ({
            paragraph: null,
            images: selectedImages(state),
          }),
          apply(tr, value, oldState, newState) {
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
              images:
                tr.docChanged || tr.selectionSet
                  ? selectedImages(newState)
                  : value.images,
            };
          },
        },
        view(view) {
          const doc = view.dom.ownerDocument;
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
            if (!(selection instanceof GapCursor)) {
              observe(null);
              return;
            }
            const caret = view.dom.querySelector<HTMLElement>(
              '.ProseMirror-gapcursor',
            );
            if (!caret) return;
            const lateral =
              selection instanceof BlockCursor && !!selection.edge;
            caret.classList.toggle('block-side-cursor', lateral);
            if (!(selection instanceof BlockCursor) || !selection.edge) {
              observe(null);
              caret.style.removeProperty('left');
              caret.style.removeProperty('top');
              caret.style.removeProperty('visibility');
              return;
            }
            const edge = selection.edge;
            const pos =
              edge === 'left'
                ? selection.from
                : selection.from - (selection.$from.nodeBefore?.nodeSize || 0);
            const block = paintedBlock(view, pos);
            observe(block);
            const rect = block && paintedBlockRect(block);
            const scroll = view.dom
              .closest('.writing-scroll')
              ?.getBoundingClientRect();
            if (!rect) return;
            // A block has one outside text baseline, at its bottom edge.
            // Clicking higher up selects the same before/after document position.
            const y = rect.bottom - 9;
            caret.style.visibility =
              scroll && (y < scroll.top || y > scroll.bottom) ? 'hidden' : '';
            const x = edge === 'left' ? rect.left - 8 : rect.right + 7;
            caret.style.left = `${scroll ? Math.max(scroll.left + 2, Math.min(scroll.right - 4, x)) : x}px`;
            caret.style.top = `${y - 9}px`;
          };
          const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(update);
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
            if (event.target.closest('.image-caret-anchor')) {
              event.preventDefault();
              view.focus();
              return true;
            }
            const selection = blockSelectionAtCoords(view, event);
            if (!selection) return;
            event.preventDefault();
            const scrollTop = surface.scrollTop;
            const scrollLeft = surface.scrollLeft;
            view.dispatch(view.state.tr.setSelection(selection));
            view.focus();
            surface.scrollTop = scrollTop;
            surface.scrollLeft = scrollLeft;
            update();
            return true;
          };
          const pointerDown = (event: PointerEvent) => {
            if (event.pointerType !== 'touch') activate(event);
          };
          const mouseDown = (event: MouseEvent) => {
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.detail > 1 ||
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
              event.target.closest(
                'button,input,select,textarea,a,[role="separator"],.image-node,.tableWrapper',
              )
            )
              return;
            if (event.target.closest('.code-node')) {
              // The NodeView stops editor events outside its actual contentDOM.
              // Handle padding/extra viewport space here, before native selection.
              if (!event.target.closest('[data-node-view-content-react]'))
                placeCodeCaret(view, event);
              return;
            }
            if (activate(event)) return;
            const point = { left: event.clientX, top: event.clientY };
            if (textPointMatches(view, point)) return;
            const target = ordinaryTextAtCoords(view, point);
            if (!target) return;
            if (
              point.top >= target.line.top &&
              point.top <= target.line.bottom &&
              point.left >= target.line.left &&
              point.left <= target.line.right
            )
              return;
            beginTextSelection(view, event, target, (point) =>
              ordinaryTextAtCoords(view, point),
            );
          };
          const click = (event: MouseEvent) => {
            if (event instanceof PointerEvent && event.pointerType === 'touch')
              activate(event);
          };
          doc.addEventListener('pointerdown', pointerDown, true);
          doc.addEventListener('click', click, true);
          doc.addEventListener('mousedown', mouseDown, true);
          doc.addEventListener('scroll', schedule, true);
          window.addEventListener('resize', schedule);
          return {
            update() {
              update();
              // React NodeViews can commit new image geometry after this update.
              // Recheck even when quick indent/outdent edits cancel each other
              // before ResizeObserver sees a size change.
              schedule();
            },
            destroy() {
              cancelAnimationFrame(frame);
              resizeObserver.disconnect();
              doc.removeEventListener('pointerdown', pointerDown, true);
              doc.removeEventListener('click', click, true);
              doc.removeEventListener('mousedown', mouseDown, true);
              endTextSelection(view);
              doc.removeEventListener('scroll', schedule, true);
              window.removeEventListener('resize', schedule);
            },
          };
        },
        props: {
          decorations(state) {
            const points = key.getState(state)?.images || DecorationSet.empty;
            const selection = state.selection;
            const inline = inlineImageBoundary(selection);
            if (!inline) return points;
            // Give the browser an ordinary text baseline beside a non-editable
            // inline image. This is view-only; no character enters the document.
            return points.add(state.doc, [
              Decoration.widget(
                selection.from,
                () => {
                  const anchor = document.createElement('span');
                  anchor.className = 'image-caret-anchor';
                  anchor.setAttribute('aria-hidden', 'true');
                  // Non-breaking, so a full-width image cannot strand/trim the
                  // browser's text baseline when the last adjacent letter goes.
                  anchor.textContent = '\ufeff';
                  return anchor;
                },
                {
                  key: `image-anchor-${inline.edge}`,
                  side: inline.edge === 'left' ? 1 : -1,
                },
              ),
            ]);
          },
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
              view.composing ||
              event.isComposing ||
              event.keyCode === 229 ||
              event.metaKey ||
              event.ctrlKey ||
              event.altKey
            )
              return false;
            const { state } = view;
            const { selection } = state;
            if (
              event.key === 'Tab' &&
              selection instanceof NodeSelection &&
              selection.node.isInline
            ) {
              view.dispatch(
                state.tr.setSelection(
                  TextSelection.create(state.doc, selection.from),
                ),
              );
              return false;
            }
            const codePos =
              selection instanceof NodeSelection &&
              selection.node.type.name === 'codeBlock'
                ? selection.from
                : selection instanceof GapCursor &&
                    selection.$from.nodeAfter?.type.name === 'codeBlock'
                  ? selection.from
                  : null;
            const blockPos = codePos;
            if (event.key === 'Tab' && blockPos !== null) {
              event.preventDefault();
              const block = state.doc.nodeAt(blockPos)!;
              const indent = imageIndent(
                imageIndent(block.attrs.indent) + (event.shiftKey ? -1 : 1),
              );
              if (indent !== imageIndent(block.attrs.indent)) {
                updateBlockIndent(view, blockPos, indent);
              }
              return true;
            }
            // Side/gap cursors have no textblock for EditingRules to indent.
            // Insert prose at the boundary, just like typing, keeping the block.
            if (event.key === 'Tab' && inputBoundary(selection) !== null) {
              event.preventDefault();
              if (!event.shiftKey) insertBoundaryText(view, '\t');
              return true;
            }
            if (event.shiftKey) return false;
            const backwards = event.key === 'Backspace';
            const deleting = backwards || event.key === 'Delete';
            // A held deletion key must not confirm removal of a whole block.
            if (
              deleting &&
              event.repeat &&
              (selection instanceof GapCursor ||
                (selection instanceof NodeSelection && isBlock(selection.node)))
            )
              return true;
            const indentPos = selection instanceof GapCursor ? codePos : null;
            if (
              deleting &&
              indentPos !== null &&
              imageIndent(state.doc.nodeAt(indentPos)!.attrs.indent) > 0
            ) {
              event.preventDefault();
              updateBlockIndent(
                view,
                indentPos,
                imageIndent(state.doc.nodeAt(indentPos)!.attrs.indent) - 1,
              );
              return true;
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
