import { Extension, type Editor } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ReplaceStep } from '@tiptap/pm/transform';
import { inlineSyntaxEdge, isInlineSyntaxClick } from './inlineSyntaxEdges';
import {
  activeSourcePairs,
  contentRange,
  revealSourceDelimiters,
  sourcePairDecorations,
  type SourcePair,
} from './sourceDelimiter';
import { highlightPairs } from './highlight';
import { sourceInlinePairs } from './sourceInlinePairs';
import {
  materializeSourceInlineMarks,
  parseSourceInlineMarks,
  protectSourceInlineMarkdown,
  sourceMarkNames,
  sourceMarkSyntax,
  type SourceMarkName,
} from './sourceInlineMarkdown';
import { codeFence } from './inlineSyntaxEdges';

const key = new PluginKey<{
  base: DecorationSet;
  visible: DecorationSet;
  focused: boolean;
}>('mojian-source-inline');

// Text blocks are immutable nodes, so a block keeps its pairs until it is
// edited. Caching them by node identity keeps drags and caret moves from
// rescanning a long paragraph on every transaction.
const blockPairCache = new WeakMap<PMNode, SourcePair[]>();

function relativeBlockPairs(node: PMNode) {
  if (node.type.spec.code) return [];
  let pairs = blockPairCache.get(node);
  if (!pairs) {
    let text = '';
    node.forEach((child) => {
      const source = child.isText
        ? child.text!
        : child.type.name === 'hardBreak'
          ? '\n'
          : '\ufffc';
      // Literal equals / highlight content stays scannable; code marks still
      // force a mask so nested source syntax inside a code mark is inert if any
      // residual marks remain after paste conversion.
      text += child.marks.some((mark) => mark.type.spec.code)
        ? source.replace(/[`*~<]/g, '\ufffc')
        : source;
    });
    pairs = sourceInlinePairs(text);
    blockPairCache.set(node, pairs);
  }
  return pairs;
}

function blockPairs(node: PMNode, pos: number): SourcePair[] {
  return relativeBlockPairs(node).map((pair) => ({
    ...pair,
    from: pos + 1 + pair.from,
    to: pos + 1 + pair.to,
  }));
}

function decorateBlock(node: PMNode, pos: number) {
  const pairs = blockPairs(node, pos);
  let text = '';
  node.forEach((child) => {
    text += child.isText
      ? child.text!
      : child.type.name === 'hardBreak'
        ? '\n'
        : '\ufffc';
  });
  // `==` inside a code span or imported highlight content is literal, so mask
  // both before pairing highlights; otherwise the highlight holes would cut the
  // bold wrapper apart and drop the literal equals from it.
  let scannable = '';
  node.forEach((child) => {
    const source = child.isText
      ? child.text!
      : child.type.name === 'hardBreak'
        ? '\n'
        : '\ufffc';
    scannable += child.marks.some(
      (mark) => mark.type.name === 'highlightLiteral',
    )
      ? source.replace(/=/g, '\ufffc')
      : source;
  });
  for (const pair of sourceInlinePairs(text)) {
    if (pair.kind !== 'code') continue;
    scannable =
      scannable.slice(0, pair.from) +
      '\ufffc'.repeat(pair.to - pair.from) +
      scannable.slice(pair.to);
  }
  const highlightHoles = highlightPairs(scannable, false).flatMap((pair) => [
    { from: pos + 1 + pair.from, to: pos + 1 + pair.from + 2 },
    { from: pos + 1 + pair.to - 2, to: pos + 1 + pair.to },
  ]);
  return sourcePairDecorations(pairs, highlightHoles);
}

function decorate(doc: PMNode) {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    decorations.push(...sourcePairDecorations(blockPairs(node, pos)));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

function collectPairs(doc: PMNode) {
  const pairs: SourcePair[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    pairs.push(...blockPairs(node, pos));
    return false;
  });
  return pairs;
}

function textblockAt(doc: PMNode, pos: number) {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.isTextblock) return { node, pos: $pos.before(depth) };
  }
  return null;
}

// Caret work only ever needs the pairs of the touched textblocks; scanning the
// whole document on every transaction made long drafts quadratic.
function pairsAt(doc: PMNode, pos: number) {
  const block = textblockAt(doc, pos);
  return block ? blockPairs(block.node, block.pos) : [];
}

function selectionPairs(state: EditorState) {
  const { from, to } = state.selection;
  if (from === to) return pairsAt(state.doc, from);
  // A selection can cover several blocks; both revealing and the toolbar state
  // must see every block it touches, not just the two ends.
  const pairs: SourcePair[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return;
    pairs.push(...blockPairs(node, pos));
    return false;
  });
  return pairs;
}

// Blank-space hit testing can land among collapsed closing delimiters.
export function afterSourceClosingSyntax(state: EditorState, pos: number) {
  const pair = pairsAt(state.doc, pos).find(
    (candidate) =>
      pos >= candidate.to - candidate.closeLen && pos <= candidate.to,
  );
  return pair?.to ?? pos;
}

function update(tr: Transaction, previous: DecorationSet) {
  const textOnly = tr.steps.every((step, index) => {
    if (
      !(step instanceof ReplaceStep) ||
      step.slice.openStart ||
      step.slice.openEnd
    )
      return false;
    let inline = true;
    step.slice.content.forEach((node) => {
      inline &&= node.isText;
    });
    const before = tr.docs[index];
    const after = tr.docs[index + 1] || tr.doc;
    if (
      !inline ||
      !before.resolve(step.from).sameParent(before.resolve(step.to))
    )
      return false;
    const context = (doc: PMNode, from: number, to: number) =>
      doc.textBetween(
        Math.max(0, from - 4),
        Math.min(doc.content.size, to + 4),
        '\n',
        '\ufffc',
      );
    return !/[`*~<\\=\r\n\ufffc]/.test(
      context(before, step.from, step.to) +
        context(after, step.from, step.from + step.slice.size),
    );
  });
  if (textOnly) return previous.map(tr.mapping, tr.doc);

  const blocks = new Map<number, PMNode>();
  const visit = (from: number, to: number) =>
    tr.doc.nodesBetween(
      Math.max(0, from - 1),
      Math.min(tr.doc.content.size, to + 1),
      (node, pos) => {
        if (!node.isTextblock) return;
        blocks.set(pos, node);
        return false;
      },
    );
  tr.steps.forEach((step, index) => {
    const after = tr.mapping.slice(index + 1);
    let changed = false;
    step.getMap().forEach((_oldFrom, _oldTo, from, to) => {
      changed = true;
      visit(after.map(from, -1), after.map(to, 1));
    });
    if (!changed) {
      const { from, to, pos } = step.toJSON() as {
        from?: number;
        to?: number;
        pos?: number;
      };
      if (from !== undefined && to !== undefined)
        visit(after.map(from, -1), after.map(to, 1));
      else if (pos !== undefined) visit(after.map(pos), after.map(pos));
      else visit(0, tr.doc.content.size);
    }
  });

  const base = previous.map(tr.mapping, tr.doc);
  const remove: Decoration[] = [];
  const add: Decoration[] = [];
  const identity = (decoration: Decoration) =>
    `${decoration.from}:${decoration.to}:${decoration.spec.sourceInline || ''}:${decoration.spec.delimiter ? 'd' : 'c'}`;
  for (const [pos, node] of blocks) {
    const existing = new Map(
      base
        .find(pos + 1, pos + 1 + node.content.size)
        .filter((decoration) => decoration.spec.sourceInline)
        .map((decoration) => [identity(decoration), decoration]),
    );
    for (const decoration of decorateBlock(node, pos))
      if (!existing.delete(identity(decoration))) add.push(decoration);
    remove.push(...existing.values());
  }
  if (!remove.length && !add.length) return base;
  if (remove.length > 128) {
    const removed = new Set(remove.map(identity));
    return DecorationSet.create(tr.doc, [
      ...base.find().filter((decoration) => !removed.has(identity(decoration))),
      ...add,
    ]);
  }
  return base.remove(remove).add(tr.doc, add);
}

function reveal(state: EditorState, base: DecorationSet, focused: boolean) {
  if (!focused) return base;
  const pairs = activeSourcePairs(state, selectionPairs(state), true);
  return revealSourceDelimiters(state, base, pairs);
}

function pastedSource(node: PMNode): PMNode {
  const json = parseSourceInlineMarks(node.toJSON());
  return node.type.schema.nodeFromJSON(json);
}

function emptyPair(state: EditorState, opening: string, closing: string) {
  const { $from, empty } = state.selection;
  if (empty === false || $from.parent.type.spec.code) return false;
  return (
    $from.parent.textBetween(
      Math.max(0, $from.parentOffset - opening.length),
      $from.parentOffset,
    ) === opening &&
    $from.parent.textBetween(
      $from.parentOffset,
      Math.min($from.parent.content.size, $from.parentOffset + closing.length),
    ) === closing
  );
}

export function sourceInlineActive(
  editor: Editor | null,
  mark: SourceMarkName,
) {
  if (!editor) return false;
  const kind = sourceMarkSyntax[mark].kind;
  // The toolbar reads this for every state change, so keep the scan local to
  // the selection instead of walking long documents on each caret move.
  const pairs = activeSourcePairs(
    editor.state,
    selectionPairs(editor.state).filter((pair) => pair.kind === kind),
  );
  if (pairs.length) return true;
  if (mark === 'code') {
    const fence = '`';
    return emptyPair(editor.state, fence, fence);
  }
  const syntax = sourceMarkSyntax[mark];
  return emptyPair(editor.state, syntax.opening, syntax.closing);
}

export function toggleSourceInline(editor: Editor, mark: SourceMarkName) {
  const { state } = editor;
  const tr = state.tr;
  const kind = sourceMarkSyntax[mark].kind;
  const pairs = activeSourcePairs(
    state,
    collectPairs(state.doc).filter((pair) => pair.kind === kind),
  );
  const syntax = sourceMarkSyntax[mark];
  if (pairs.length || emptyPair(state, syntax.opening, syntax.closing)) {
    const ranges = pairs.length
      ? pairs
      : [
          {
            from: state.selection.from - syntax.opening.length,
            to: state.selection.to + syntax.closing.length,
            openLen: syntax.opening.length,
            closeLen: syntax.closing.length,
            kind,
            tag: 'span',
          } satisfies SourcePair,
        ];
    for (const pair of [...ranges].sort((a, b) => b.from - a.from)) {
      tr.delete(pair.to - pair.closeLen, pair.to).delete(
        pair.from,
        pair.from + pair.openLen,
      );
    }
  } else if (state.selection.empty) {
    if (state.selection.$from.parent.type.spec.code) return false;
    const pos = state.selection.from;
    let opening = syntax.opening;
    let closing = syntax.closing;
    if (mark === 'code') {
      opening = '`';
      closing = '`';
    }
    tr.insertText(opening + closing);
    tr.setSelection(TextSelection.create(tr.doc, pos + opening.length));
  } else {
    const ranges: { from: number; to: number }[] = [];
    state.doc.nodesBetween(
      state.selection.from,
      state.selection.to,
      (node, pos) => {
        if (!node.isTextblock) return;
        if (!node.type.spec.code) {
          let from = Math.max(pos + 1, state.selection.from);
          let to = Math.min(pos + 1 + node.content.size, state.selection.to);
          // Delimiters cannot hug whitespace, so keep edge spaces outside.
          while (from < to && /\s/.test(state.doc.textBetween(from, from + 1)))
            from++;
          while (to > from && /\s/.test(state.doc.textBetween(to - 1, to)))
            to--;
          if (to > from) ranges.push({ from, to });
        }
        return false;
      },
    );
    if (!ranges.length) return false;
    const ordered = [...ranges].sort((a, b) => a.from - b.from);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    for (const range of [...ordered].reverse()) {
      let opening: string = syntax.opening;
      let closing: string = syntax.closing;
      if (mark === 'code') {
        const text = state.doc.textBetween(range.from, range.to);
        opening = closing = codeFence(text);
      }
      tr.insertText(closing, range.to).insertText(opening, range.from);
    }
    // Keep the selection on the wrapped text, not across the delimiters.
    tr.setSelection(
      TextSelection.create(
        tr.doc,
        tr.mapping.map(first.from, 1),
        tr.mapping.map(last.to, -1),
      ),
    );
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
  return true;
}

export const SourceInlineSyntax = Extension.create({
  name: 'sourceInlineSyntax',
  addProseMirrorPlugins() {
    let syntaxClick:
      { pos: number; outside: boolean; pair: SourcePair } | undefined;
    let compositionSelection:
      { from: number; to: number; text: string } | undefined;
    let lastSelection: { from: number; to: number } | undefined;
    return [
      new Plugin({
        key,
        state: {
          init: (_, state) => {
            const decorations = decorate(state.doc);
            return {
              base: decorations,
              visible: decorations,
              focused: false,
            };
          },
          apply: (tr, previous, _oldState, state) => {
            if (!state.selection.empty)
              lastSelection = {
                from: state.selection.from,
                to: state.selection.to,
              };
            const base = tr.docChanged
              ? update(tr, previous.base)
              : previous.base;
            const focused = tr.getMeta(key) ?? previous.focused;
            return tr.docChanged ||
              tr.selectionSet ||
              focused !== previous.focused
              ? {
                  base,
                  focused,
                  visible: reveal(state, base, focused),
                }
              : previous;
          },
        },
        props: {
          decorations: (state) => key.getState(state)?.visible,
          handleClick: (view, pos, event) => {
            const clicked = syntaxClick;
            syntaxClick = undefined;
            if (clicked && isInlineSyntaxClick(view, event)) {
              view.dispatch(
                view.state.tr
                  .setSelection(
                    TextSelection.create(view.state.doc, clicked.pos),
                  )
                  .setMeta(key, true),
              );
              view.focus();
              return true;
            }
            const target =
              event.target instanceof Element
                ? event.target.closest('code, strong, em, s, u')
                : null;
            if (
              !target ||
              !view.dom.contains(target) ||
              !isInlineSyntaxClick(view, event)
            )
              return false;
            const from = view.posAtDOM(target, 0);
            const to = view.posAtDOM(target, target.childNodes.length);
            view.focus();
            view.dispatch(
              view.state.tr
                .setSelection(
                  TextSelection.create(
                    view.state.doc,
                    Math.max(from, Math.min(to, pos)),
                  ),
                )
                .setMeta(key, true),
            );
            return true;
          },
          handleKeyDown: (view, event) => {
            if (
              !view.state.selection.empty ||
              event.shiftKey ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.isComposing
            )
              return false;
            const pos = view.state.selection.from;
            const pair = pairsAt(view.state.doc, pos).find((candidate) =>
              event.key === 'ArrowRight' || event.key === 'Delete'
                ? candidate.from === pos
                : candidate.to === pos,
            );
            if (!pair) return false;
            const tr = view.state.tr;
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft')
              tr.setSelection(
                TextSelection.create(
                  tr.doc,
                  event.key === 'ArrowRight'
                    ? pair.from + pair.openLen
                    : pair.to - 1,
                ),
              );
            else if (event.key === 'Backspace') tr.delete(pos - 1, pos);
            else if (event.key === 'Delete') tr.delete(pos, pos + 1);
            else return false;
            view.dispatch(tr.scrollIntoView());
            return true;
          },
          handleDOMEvents: {
            compositionstart: (view) => {
              // The browser may collapse or move the selection before this
              // event, so rely on the last non-empty selection instead.
              if (lastSelection && lastSelection.from !== lastSelection.to)
                compositionSelection = {
                  ...lastSelection,
                  text: view.state.doc.textBetween(
                    lastSelection.from,
                    lastSelection.to,
                  ),
                };
              return false;
            },
            compositionend: (view, event) => {
              const saved = compositionSelection;
              compositionSelection = undefined;
              // Chrome deletes the selection when a composition is cancelled.
              // Put the text back and restore the selection over it.
              if (!saved || !saved.text || event.data) return false;
              requestAnimationFrame(() => {
                if (view.isDestroyed) return;
                const size = () => view.state.doc.content.size;
                const from = Math.min(saved.from, size());
                if (
                  view.state.doc.textBetween(
                    from,
                    Math.min(from + saved.text.length, size()),
                  ) !== saved.text
                )
                  view.dispatch(view.state.tr.insertText(saved.text, from));
                const end = Math.min(from + saved.text.length, size());
                view.dispatch(
                  view.state.tr.setSelection(
                    TextSelection.create(view.state.doc, from, end),
                  ),
                );
              });
              return false;
            },
            mousedown: (view, event) => {
              syntaxClick = undefined;
              if (!isInlineSyntaxClick(view, event) || event.detail > 1)
                return false;
              const pos = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              })?.pos;
              if (pos === undefined) return false;
              const pair = pairsAt(view.state.doc, pos).find(
                (candidate) => pos >= candidate.from && pos <= candidate.to,
              );
              if (!pair) return false;
              const content = contentRange(pair);
              const edge = inlineSyntaxEdge(pos, content.from, content.to);
              const plugin = key.getState(view.state);
              const collapsed = plugin?.visible
                .find(pair.from, content.from, (spec) => !!spec.delimiter)
                .some((delimiter) => delimiter.from === pair.from);
              syntaxClick = {
                pos: !collapsed
                  ? pos
                  : edge === -1
                    ? pair.from
                    : edge === 1
                      ? pair.to
                      : pos,
                outside: collapsed
                  ? edge !== null
                  : pos === pair.from || pos === pair.to,
                pair,
              };
              return false;
            },
            focus: (view) => {
              view.dispatch(view.state.tr.setMeta(key, true));
              return false;
            },
            blur: (view) => {
              view.dispatch(view.state.tr.setMeta(key, false));
              return false;
            },
          },
          transformPasted: (slice, view) => {
            if (view.state.selection.$from.parent.type.spec.code) return slice;
            return new Slice(
              Fragment.fromArray(
                Array.from(slice.content.content, (node) => pastedSource(node)),
              ),
              slice.openStart,
              slice.openEnd,
            );
          },
        },
      }),
    ];
  },
});

export function prepareSourceInlineSerialize(document: {
  type?: string;
  content?: unknown;
}) {
  return materializeSourceInlineMarks(document as never);
}

export function serializeSourceInlineMarkdown(
  document: { type?: string; content?: unknown },
  serialize: (document: { type?: string; content?: unknown }) => string,
) {
  return protectSourceInlineMarkdown(
    prepareSourceInlineSerialize(document),
    serialize,
  );
}

export { parseSourceInlineMarks, sourceMarkNames };
