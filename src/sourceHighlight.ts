import { Mark, type Editor } from '@tiptap/core';
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
import {
  highlightPairs,
  matchHighlight,
  type HighlightPair,
} from './highlight';

export const HighlightLiteral = Mark.create({
  name: 'highlightLiteral',
  inclusive: false,
  parseHTML: () => [{ tag: 'span[data-highlight-literal]' }],
  renderHTML: () => ['span', { 'data-highlight-literal': '' }, 0],
  renderMarkdown: (node, helpers) => helpers.renderChildren(node),
});

const key = new PluginKey<{
  base: DecorationSet;
  visible: DecorationSet;
  focused: boolean;
}>('mojian-source-highlight');

function pairFromDecoration(decoration: Decoration): HighlightPair {
  return { from: decoration.from - 2, to: decoration.to + 2 };
}

function activePairs(
  state: EditorState,
  base = key.getState(state)?.base,
  includeClosingEdge = false,
) {
  const { from, to, empty } = state.selection;
  return (
    base?.find(
      Math.max(0, from - 2),
      Math.min(state.doc.content.size, to + 2),
      (spec) => !!spec.highlight,
    ) || []
  )
    .map(pairFromDecoration)
    .filter((pair) =>
      empty
        ? from > pair.from &&
          (from < pair.to || (includeClosingEdge && from === pair.to))
        : from < pair.to && to > pair.from,
    );
}

function emptyPair(state: EditorState) {
  const { $from, empty } = state.selection;
  return (
    empty &&
    !$from.parent.type.spec.code &&
    $from.parent.textBetween(
      Math.max(0, $from.parentOffset - 2),
      $from.parentOffset,
    ) === '==' &&
    $from.parent.textBetween(
      $from.parentOffset,
      Math.min($from.parent.content.size, $from.parentOffset + 2),
    ) === '=='
  );
}

export function highlightActive(editor: Editor | null) {
  return (
    !!editor && (!!activePairs(editor.state).length || emptyPair(editor.state))
  );
}

// The toolbar edits the same delimiters as the keyboard, rather than keeping a
// second, sticky formatting state which can diverge from the Markdown source.
export function toggleSourceHighlight(editor: Editor) {
  const { state } = editor;
  const tr = state.tr;
  const pairs = activePairs(state);
  if (pairs.length || emptyPair(state)) {
    const ranges = pairs.length
      ? pairs
      : [{ from: state.selection.from - 2, to: state.selection.to + 2 }];
    for (const pair of ranges.sort((a, b) => b.from - a.from)) {
      tr.delete(pair.to - 2, pair.to).delete(pair.from, pair.from + 2);
    }
  } else if (state.selection.empty) {
    if (state.selection.$from.parent.type.spec.code || editor.isActive('code'))
      return false;
    const pos = state.selection.from;
    tr.insertText('====');
    tr.setSelection(TextSelection.create(tr.doc, pos + 2));
  } else {
    const ranges: HighlightPair[] = [];
    state.doc.nodesBetween(
      state.selection.from,
      state.selection.to,
      (node, pos) => {
        if (!node.isTextblock) return;
        if (!node.type.spec.code) {
          const from = Math.max(pos + 1, state.selection.from);
          const to = Math.min(pos + 1 + node.content.size, state.selection.to);
          if (to > from) ranges.push({ from, to });
        }
        return false;
      },
    );
    if (!ranges.length) return false;
    for (const range of ranges.reverse())
      tr.insertText('==', range.to).insertText('==', range.from);
    tr.setSelection(
      TextSelection.create(
        tr.doc,
        tr.mapping.map(state.selection.from, 1),
        tr.mapping.map(state.selection.to, -1),
      ),
    );
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
  return true;
}

// Convert imported <mark> runs to editable source once. Raw == text needs no
// conversion, and a plain-text paste retains its literal meaning.
function pastedSource(node: PMNode, literal: boolean): PMNode {
  if (node.isLeaf || node.type.spec.code) return node;
  const children: PMNode[] = [];
  let highlighted = false;
  node.forEach((child) => {
    if (!node.isTextblock) {
      children.push(pastedSource(child, literal));
      return;
    }
    const mark = child.marks.find((m) => m.type.name === 'highlight');
    const active = !!mark && !literal;
    const marks = child.marks.filter((m) => m.type.name !== 'highlight');
    if (active !== highlighted) {
      children.push(node.type.schema.text('=='));
      highlighted = active;
    }
    const literalType = node.type.schema.marks.highlightLiteral;
    children.push(
      child.mark(
        (literal || active) && child.isText && child.text?.includes('=')
          ? literalType.create().addToSet(marks)
          : marks,
      ),
    );
  });
  if (highlighted) children.push(node.type.schema.text('=='));
  return node.copy(Fragment.fromArray(children));
}

export const TyporaHighlight = Mark.create({
  name: 'highlight',
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: ({ HTMLAttributes }) => ['mark', HTMLAttributes, 0],
  markdownTokenName: 'highlight',
  markdownTokenizer: {
    name: 'highlight',
    level: 'inline',
    start: (source) => source.indexOf('=='),
    tokenize(source, _tokens, lexer) {
      const match = matchHighlight(source);
      return match
        ? {
            type: 'highlight',
            ...match,
            tokens: lexer.inlineTokens(match.text),
          }
        : undefined;
    },
  },
  parseMarkdown: (token, helpers) => [
    helpers.createTextNode('=='),
    ...helpers.parseInline(token.tokens || []),
    helpers.createTextNode('=='),
  ],
  renderMarkdown: (node, helpers) => `==${helpers.renderChildren(node)}==`,
  addProseMirrorPlugins() {
    // Immutable text blocks retain their parsed pairs through edits elsewhere,
    // cursor moves and undo. Selection changes only reveal nearby delimiters.
    const cache = new WeakMap<PMNode, HighlightPair[]>();
    const decorateBlock = (node: PMNode, pos: number) => {
      if (node.type.spec.code) return [];
      let pairs = cache.get(node);
      if (!pairs) {
        let text = '';
        node.forEach((child) => {
          const source = child.isText
            ? child.text!
            : child.type.name === 'hardBreak'
              ? '\n'
              : '\ufffc';
          text += child.marks.some(
            (mark) =>
              mark.type.spec.code || mark.type.name === 'highlightLiteral',
          )
            ? source.replace(/=/g, '\ufffc')
            : source;
        });
        pairs = highlightPairs(text, false);
        cache.set(node, pairs);
      }
      return pairs.flatMap((relative) => {
        const from = pos + 1 + relative.from,
          to = pos + 1 + relative.to;
        return [
          Decoration.inline(
            from + 2,
            to - 2,
            { nodeName: 'mark' },
            { highlight: true },
          ),
          Decoration.inline(
            from,
            from + 2,
            { class: 'highlight-delimiter', 'aria-hidden': 'true' },
            { delimiter: true },
          ),
          Decoration.inline(
            to - 2,
            to,
            { class: 'highlight-delimiter', 'aria-hidden': 'true' },
            { delimiter: true },
          ),
        ];
      });
    };
    const decorate = (doc: PMNode) => {
      const decorations: Decoration[] = [];
      doc.descendants((node, pos) => {
        if (!node.isTextblock) return;
        decorations.push(...decorateBlock(node, pos));
        return false;
      });
      return DecorationSet.create(doc, decorations);
    };
    const update = (tr: Transaction, previous: DecorationSet) => {
      // Ordinary text edits away from delimiters cannot change pairing. Keep
      // mapped decorations directly, including within very dense paragraphs.
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
        const before = tr.docs[index],
          after = tr.docs[index + 1] || tr.doc;
        if (
          !inline ||
          !before.resolve(step.from).sameParent(before.resolve(step.to))
        )
          return false;
        const context = (doc: PMNode, from: number, to: number) =>
          doc.textBetween(
            Math.max(0, from - 2),
            Math.min(doc.content.size, to + 2),
            '\n',
            '\ufffc',
          );
        return !/[=\\\r\n\ufffc]/.test(
          context(before, step.from, step.to) +
            context(after, step.from, step.from + step.slice.size),
        );
      });
      if (textOnly) return previous.map(tr.mapping, tr.doc);
      // Map untouched blocks and rescan only text blocks touched by a step.
      // Mark/attribute steps have empty maps but still affect code exclusions.
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
      const remove: Decoration[] = [],
        add: Decoration[] = [];
      const identity = (decoration: Decoration) =>
        `${decoration.from}:${decoration.to}:${decoration.spec.highlight ? 'content' : 'delimiter'}`;
      for (const [pos, node] of blocks) {
        const existing = new Map(
          base
            .find(pos + 1, pos + 1 + node.content.size)
            .map((decoration) => [identity(decoration), decoration]),
        );
        for (const decoration of decorateBlock(node, pos))
          if (!existing.delete(identity(decoration))) add.push(decoration);
        remove.push(...existing.values());
      }
      if (!remove.length && !add.length) return base;
      // DecorationSet.remove compares each local decoration with every removal.
      // Rebuild once for dense paragraphs instead of doing quadratic work.
      if (remove.length > 128) {
        const removed = new Set(remove.map(identity));
        return DecorationSet.create(tr.doc, [
          ...base
            .find()
            .filter((decoration) => !removed.has(identity(decoration))),
          ...add,
        ]);
      }
      return base.remove(remove).add(tr.doc, add);
    };
    const reveal = (
      state: EditorState,
      base: DecorationSet,
      focused: boolean,
    ) => {
      if (!focused) return base;
      const hidden: Decoration[] = [],
        visible: Decoration[] = [];
      // Keep the closing syntax visible while the caret rests just after it.
      // Formatting commands still treat that position as outside the pair.
      for (const pair of activePairs(state, base, true)) {
        for (const decoration of base.find(
          pair.from,
          pair.to,
          (spec) => !!spec.delimiter,
        )) {
          if (decoration.from !== pair.from && decoration.to !== pair.to)
            continue;
          hidden.push(decoration);
          visible.push(
            Decoration.inline(decoration.from, decoration.to, {
              class: 'highlight-delimiter expanded',
            }),
          );
        }
      }
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
    };
    return [
      new Plugin({
        key,
        state: {
          init: (_, state) => {
            const base = decorate(state.doc);
            return { base, visible: base, focused: false };
          },
          apply: (tr, previous, _oldState, state) => {
            const base = tr.docChanged
              ? update(tr, previous.base)
              : previous.base;
            const focused = tr.getMeta(key) ?? previous.focused;
            return tr.docChanged ||
              tr.selectionSet ||
              focused !== previous.focused
              ? { base, focused, visible: reveal(state, base, focused) }
              : previous;
          },
        },
        props: {
          decorations: (state) => key.getState(state)?.visible,
          handleClick: (view, pos, event) => {
            const mark =
              event.target instanceof Element
                ? event.target.closest('mark')
                : null;
            if (!mark || !view.dom.contains(mark) || event.shiftKey)
              return false;
            const from = view.posAtDOM(mark, 0);
            const to = view.posAtDOM(mark, mark.childNodes.length);
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
            const pairs =
              key
                .getState(view.state)
                ?.base.find(
                  Math.max(0, pos - 2),
                  Math.min(view.state.doc.content.size, pos + 2),
                  (spec) => !!spec.highlight,
                )
                .map(pairFromDecoration) || [];
            const pair = pairs.find((pair) =>
              event.key === 'ArrowRight' || event.key === 'Delete'
                ? pair.from === pos
                : pair.to === pos,
            );
            if (!pair) return false;
            const tr = view.state.tr;
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft')
              tr.setSelection(
                TextSelection.create(
                  tr.doc,
                  event.key === 'ArrowRight' ? pair.from + 2 : pair.to - 1,
                ),
              );
            else if (event.key === 'Backspace') tr.delete(pos - 1, pos);
            else if (event.key === 'Delete') tr.delete(pos, pos + 1);
            else return false;
            view.dispatch(tr.scrollIntoView());
            return true;
          },
          handleDOMEvents: {
            focus: (view) => {
              view.dispatch(view.state.tr.setMeta(key, true));
              return false;
            },
            blur: (view) => {
              view.dispatch(view.state.tr.setMeta(key, false));
              return false;
            },
          },
          transformPasted: (slice, view, plain) => {
            const code =
              view.state.selection.$from.parent.type.spec.code ||
              view.state.selection.$from
                .marks()
                .some((mark) => mark.type.spec.code);
            if (view.state.selection.$from.parent.type.spec.code) return slice;
            return new Slice(
              Fragment.fromArray(
                Array.from(slice.content.content, (node) =>
                  pastedSource(node, plain || code),
                ),
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
