import { getMarkRange } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { BoundaryClick } from './inlineCodeCaret';
import { containsTaskItems } from './markdownClipboard';
import {
  codeFence,
  inlineSyntaxMarkNames,
  inlineSyntaxMarks,
  showsInlineSyntax,
  type InlineMarkBoundary,
  type InlineSyntaxMark,
} from './inlineSyntaxEdges';

type Delimiter = Pick<BoundaryClick, 'pos' | 'boundary'>;
type Endpoints = {
  anchor: BoundaryClick | undefined;
  head: BoundaryClick | undefined;
};
type RevealedMark = {
  mark: InlineSyntaxMark;
  from: number;
  to: number;
  opening: string;
  closing: string;
};
type SyntaxSelection = {
  focused: boolean;
  endpoints: Endpoints | null;
  revealed: readonly RevealedMark[];
  selected: ReturnType<typeof selectedMarks>;
};
const key = new PluginKey<SyntaxSelection>('inlineSyntaxSelection');
const focusMeta = 'inlineSyntaxFocus';
const retainMeta = 'retainInlineSyntax';
const hidden: SyntaxSelection = {
  focused: false,
  endpoints: null,
  revealed: [],
  selected: [],
};

function sameDelimiter(hit: BoundaryClick | undefined, delimiter: Delimiter) {
  return (
    hit?.pos === delimiter.pos &&
    hit.boundary.mark === delimiter.boundary.mark &&
    hit.boundary.outside === delimiter.boundary.outside
  );
}

// ProseMirror nests marks in schema order. Closers unwind that order, and a
// span that ends at a shared position closes before the next one opens.
function boundaryOrder(
  a: InlineMarkBoundary,
  b: InlineMarkBoundary,
  marks: readonly string[],
) {
  return (
    b.outside - a.outside ||
    -a.outside * (marks.indexOf(a.mark) - marks.indexOf(b.mark))
  );
}

function offsetAt(
  pos: number,
  hit: BoundaryClick | undefined,
  delimiter: Delimiter,
  length: number,
  samePosition: boolean,
  order: readonly string[],
) {
  if (pos !== delimiter.pos) return pos < delimiter.pos ? 0 : length;
  if (hit && sameDelimiter(hit, delimiter))
    return hit.syntaxOffset ?? (hit.side === -1 ? 0 : length);
  if (hit)
    return boundaryOrder(hit.boundary, delimiter.boundary, order) < 0
      ? 0
      : length;
  // A regular text caret at the same model position sits at the inside
  // character edge. If the entire gesture stays at the delimiter's model
  // position and the pointer leaves it, it has reached the outside instead.
  const outside = delimiter.boundary.outside === -1 ? 0 : length;
  return samePosition ? outside : length - outside;
}

function offsets(
  selection: TextSelection,
  endpoints: Endpoints | null | undefined,
  delimiter: Delimiter,
  length: number,
  order: readonly string[],
) {
  const { pos } = delimiter;
  if (selection.from < pos && pos < selection.to) return [0, length];
  if (
    !endpoints ||
    (endpoints.anchor?.pos !== pos && endpoints.head?.pos !== pos)
  )
    return null;
  const a = offsetAt(
    selection.anchor,
    endpoints.anchor,
    delimiter,
    length,
    selection.empty,
    order,
  );
  const b = offsetAt(
    selection.head,
    endpoints.head,
    delimiter,
    length,
    selection.empty,
    order,
  );
  return a === b ? null : [Math.min(a, b), Math.max(a, b)];
}

export function inlineSyntaxSelectionOffsets(
  state: EditorState,
  delimiter: Delimiter,
) {
  const { mark, outside } = delimiter.boundary;
  const selected = key
    .getState(state)
    ?.selected.find(
      (range) =>
        range.mark === mark &&
        (outside === -1 ? range.from : range.to) === delimiter.pos,
    );
  return outside === -1 ? selected?.openingOffsets : selected?.closingOffsets;
}

export const hasInlineSyntaxSelection = (state: EditorState) =>
  !!key.getState(state)?.selected.length;

export const revealedInlineMarks = (state: EditorState) =>
  key.getState(state)?.revealed ?? [];

export const retainInlineSyntax = (tr: Transaction, retain: boolean) =>
  tr.setMeta(retainMeta, retain);

function selectedMarks(
  selection: TextSelection,
  revealed: readonly RevealedMark[],
  endpoints: Endpoints | null,
) {
  const order = Object.keys(selection.$from.doc.type.schema.marks);
  return revealed.flatMap((range) => {
    const { mark, from, to, opening, closing } = range;
    const openingOffsets = offsets(
      selection,
      endpoints,
      { pos: from, boundary: { mark, outside: -1 } },
      opening.length,
      order,
    );
    const closingOffsets = offsets(
      selection,
      endpoints,
      { pos: to, boundary: { mark, outside: 1 } },
      closing.length,
      order,
    );
    return openingOffsets || closingOffsets
      ? [{ ...range, openingOffsets, closingOffsets }]
      : [];
  });
}

export function setInlineSyntaxSelection(
  state: EditorState,
  tr: Transaction,
  endpoints: Endpoints,
) {
  if (
    !(tr.selection instanceof TextSelection) ||
    !selectedMarks(tr.selection, revealedInlineMarks(state), endpoints).length
  )
    return false;
  tr.setMeta(key, endpoints);
  return true;
}

export function materializeInlineSyntaxSelection(
  state: EditorState,
  tr = state.tr,
  options: {
    encode?: (text: string) => string;
    preserveCompleteMarks?: boolean;
  } = {},
) {
  const syntax = key.getState(state);
  return syntax && materialize(tr, syntax, options);
}

function materialize(
  tr: Transaction,
  syntax: Pick<SyntaxSelection, 'endpoints' | 'selected'>,
  options: {
    encode?: (text: string) => string;
    preserveCompleteMarks?: boolean;
  } = {},
) {
  if (!syntax.selected.length) return null;
  const { doc, selection } = tr;
  const { schema } = doc.type;
  const { endpoints, selected } = syntax;
  const encode = options.encode ?? ((text: string) => text);
  const ranges = options.preserveCompleteMarks
    ? selected.filter(
        ({ opening, closing, openingOffsets, closingOffsets }) =>
          !(
            openingOffsets?.[0] === 0 &&
            openingOffsets[1] === opening.length &&
            closingOffsets?.[0] === 0 &&
            closingOffsets[1] === closing.length
          ),
      )
    : selected;
  // Match each virtual caret stop to the real position it will occupy if
  // the user edits the selection. The same operation can copy without dispatch.
  const order = Object.keys(schema.marks);
  const tokens = ranges
    .flatMap(({ from, to, mark, opening, closing }) => {
      tr.removeMark(from, to, schema.marks[mark]);
      return [
        { pos: from, outside: -1 as const, mark, text: opening },
        { pos: to, outside: 1 as const, mark, text: closing },
      ];
    })
    .sort((a, b) => b.pos - a.pos || boundaryOrder(b, a, order));

  const placed = tokens.map((token) => {
    const $pos = doc.resolve(token.pos);
    const inside =
      (token.outside === -1 ? $pos.nodeAfter : $pos.nodeBefore)?.marks ?? [];
    const index = inside.findIndex((mark) => mark.type.name === token.mark);
    const wraps = inside
      .slice(0, Math.max(index, 0))
      .filter(
        (mark) =>
          !ranges.some(
            (range) =>
              range.mark === mark.type.name &&
              range.from <= token.pos &&
              token.pos <= range.to,
          ),
      );
    tr.insert(token.pos, schema.text(encode(token.text), wraps));
    return { ...token, after: tr.steps.length };
  });
  function endpoint(
    pos: number,
    hit: BoundaryClick | undefined,
    assoc: number,
  ) {
    const token = placed.find(
      (part) =>
        part.pos === pos &&
        (hit
          ? hit.boundary.mark === part.mark &&
            hit.boundary.outside === part.outside
          : selection.empty),
    );
    if (!token) return tr.mapping.map(pos, assoc);
    const start = tr.mapping.slice(token.after).map(token.pos, 1);
    const offset = hit
      ? (hit.syntaxOffset ?? (hit.side === -1 ? 0 : token.text.length))
      : token.outside === -1
        ? 0
        : token.text.length;
    return start + encode(token.text.slice(0, offset)).length;
  }
  const anchor = endpoint(
    selection.anchor,
    endpoints?.anchor,
    selection.anchor === selection.from ? 1 : -1,
  );
  const head = endpoint(
    selection.head,
    endpoints?.head,
    selection.head === selection.from ? 1 : -1,
  );
  tr.setSelection(TextSelection.create(tr.doc, anchor, head));
  return tr;
}

export function materializeInlineSyntaxCaret(
  tr: Transaction,
  range: RevealedMark,
  hit: BoundaryClick,
) {
  return materialize(tr, {
    endpoints: { anchor: hit, head: hit },
    selected: [{ ...range, openingOffsets: null, closingOffsets: null }],
  })!;
}

// Asynchronous insertion uses the original syntax selection, even if focus
// moves while a local image is being saved. A changed mark is never replaced
// using stale delimiter offsets.
export function captureInlineSyntaxSelection(state: EditorState) {
  const syntax = key.getState(state);
  if (!syntax?.selected.length) return null;
  let ranges: RevealedMark[] = syntax.selected;
  let endpoints = syntax.endpoints;
  let valid = true;
  return {
    map(tr: Transaction) {
      if (!tr.docChanged || !valid) return;
      ranges = ranges.map((range) => {
        const from = tr.mapping.map(range.from, 1);
        const to = tr.mapping.map(range.to, -1);
        const found = getMarkRange(
          tr.doc.resolve(from),
          tr.doc.type.schema.marks[range.mark],
        );
        if (
          !found ||
          found.from !== from ||
          found.to !== to ||
          (range.mark === 'code' &&
            codeFence(tr.doc.textBetween(from, to)) !== range.opening)
        )
          valid = false;
        return { ...range, from, to };
      });
      if (endpoints) {
        const map = (hit: BoundaryClick | undefined) =>
          hit && {
            ...hit,
            pos: tr.mapping.map(hit.pos, -hit.boundary.outside),
          };
        endpoints = {
          anchor: map(endpoints.anchor),
          head: map(endpoints.head),
        };
      }
    },
    restore(tr: Transaction) {
      if (!valid || !(tr.selection instanceof TextSelection)) return false;
      const selection = TextSelection.create(
        tr.doc,
        endpoints?.anchor?.pos ?? tr.selection.anchor,
        endpoints?.head?.pos ?? tr.selection.head,
      );
      const selected = selectedMarks(selection, ranges, endpoints);
      if (!selected.length) return false;
      closeHistory(tr.setSelection(selection));
      return !!materialize(tr, { endpoints, selected });
    },
  };
}

function copy(view: EditorView, event: ClipboardEvent, cut = false) {
  if (!event.clipboardData || !hasInlineSyntaxSelection(view.state))
    return false;
  const { state } = view;
  // Keep selected delimiter spelling verbatim while the clipboard serializer
  // handles the surrounding marks, links, and block structure normally.
  const source = JSON.stringify(state.selection.content().toJSON());
  let placeholder = '\uE004';
  while (source.includes(placeholder)) placeholder += '\uE004';
  const letters: string[] = [];
  const encode = (text: string) =>
    Array.from(text, (letter) => {
      if (!letters.includes(letter)) letters.push(letter);
      return (
        placeholder + String.fromCharCode(0xe100 + letters.indexOf(letter))
      );
    }).join('');
  const decode = (text: string) => {
    for (const [index, letter] of letters.entries())
      text = text.replaceAll(
        placeholder + String.fromCharCode(0xe100 + index),
        letter,
      );
    return text;
  };
  const tr = materializeInlineSyntaxSelection(state, state.tr, {
    encode,
    preserveCompleteMarks: true,
  });
  if (!tr) return false;
  const slice = state.selection.empty
    ? new Slice(
        Fragment.from(
          state.schema.text(
            tr.doc.textBetween(tr.selection.from, tr.selection.to),
          ),
        ),
        0,
        0,
      )
    : tr.selection.content();
  const { dom, text } = view.serializeForClipboard(slice);
  const walker = dom.ownerDocument.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    node.nodeValue = decode(node.nodeValue ?? '');
  event.clipboardData.setData('text/plain', decode(text));
  if (!containsTaskItems(slice))
    event.clipboardData.setData('text/html', dom.innerHTML);
  if (cut && view.editable) {
    const edit = materializeInlineSyntaxSelection(state)!;
    view.dispatch(closeHistory(edit).deleteSelection().scrollIntoView());
  }
  event.preventDefault();
  return true;
}

export function inlineSyntaxSelectionPlugin() {
  let composition: { before: EditorState; preparation: Transaction } | null =
    null;
  return new Plugin<SyntaxSelection>({
    key,
    filterTransaction(tr) {
      if (composition && tr.docChanged) {
        if (
          tr === composition.preparation ||
          tr.getMeta('composition') !== undefined
        ) {
          tr.setMeta('addToHistory', false).setMeta('preventUpdate', true);
        } else composition = null;
      }
      return true;
    },
    state: {
      init: () => hidden,
      apply(tr, previous, _oldState, state) {
        const focused = tr.getMeta(focusMeta) ?? previous.focused;
        const retain = tr.getMeta(retainMeta);
        const { doc, schema, selection } = state;
        if (!focused) return hidden;
        if (!(selection instanceof TextSelection))
          return {
            ...hidden,
            focused,
            revealed: retain && !tr.docChanged ? previous.revealed : [],
          };
        if (
          focused === previous.focused &&
          retain === undefined &&
          !tr.docChanged &&
          !tr.selectionSet
        )
          return previous;
        const endpoints: Endpoints | null =
          tr.getMeta(key) ??
          (tr.selectionSet || tr.docChanged ? null : previous.endpoints);
        let revealed = tr.docChanged ? [] : previous.revealed;
        if (!retain) {
          revealed =
            selection.empty && !endpoints
              ? inlineSyntaxMarkNames.flatMap((mark) => {
                  const range = getMarkRange(
                    selection.$from,
                    schema.marks[mark],
                  );
                  if (
                    !range ||
                    !showsInlineSyntax(selection.from, range.from, range.to)
                  )
                    return [];
                  const fence =
                    mark === 'code'
                      ? codeFence(doc.textBetween(range.from, range.to))
                      : null;
                  const syntax = inlineSyntaxMarks[mark];
                  return [
                    {
                      mark,
                      ...range,
                      opening: fence ?? syntax.opening,
                      closing: fence ?? syntax.closing,
                    },
                  ];
                })
              : revealed.filter(
                  ({ from, to }) =>
                    selection.from <= to && selection.to >= from,
                );
        }
        return {
          focused,
          endpoints,
          revealed,
          selected: selectedMarks(selection, revealed, endpoints),
        };
      },
    },
    props: {
      attributes: (state): Record<string, string> =>
        hasInlineSyntaxSelection(state) && state.selection.empty
          ? { class: 'inline-syntax-range' }
          : {},
      handleDOMEvents: {
        focus(view) {
          view.dispatch(view.state.tr.setMeta(focusMeta, true));
          return false;
        },
        blur(view) {
          view.dispatch(view.state.tr.setMeta(focusMeta, false));
          return false;
        },
        compositionstart(view) {
          if (composition) return false;
          const before = view.state;
          const preparation = materializeInlineSyntaxSelection(before);
          if (!preparation) return false;
          // Give the browser an actual text selection for the duration of
          // composition. Candidate changes are temporary until commit.
          composition = { before, preparation };
          view.dispatch(preparation);
          return false;
        },
        compositionend(view, event) {
          const pending = composition;
          if (!pending) return false;
          const text = event.data;
          // ProseMirror queues its last composition DOM read in this event.
          // Restore the original state after it, then commit once for undo.
          queueMicrotask(() =>
            queueMicrotask(() => {
              if (composition !== pending || view.isDestroyed) return;
              composition = null;
              view.updateState(pending.before);
              const edit =
                text && materializeInlineSyntaxSelection(pending.before);
              if (edit)
                view.dispatch(
                  closeHistory(edit)
                    .insertText(text)
                    .setMeta(focusMeta, view.hasFocus())
                    .scrollIntoView(),
                );
              else if (!view.hasFocus())
                view.dispatch(view.state.tr.setMeta(focusMeta, false));
            }),
          );
          return false;
        },
        copy: (view, event) => copy(view, event),
        cut: (view, event) => copy(view, event, true),
        beforeinput(view, event) {
          if (
            event.isComposing ||
            (event.inputType !== 'insertText' &&
              event.inputType !== 'deleteContentBackward' &&
              event.inputType !== 'deleteContentForward')
          )
            return false;
          const tr = materializeInlineSyntaxSelection(view.state);
          if (!tr) return false;
          event.preventDefault();
          view.dispatch(
            closeHistory(tr)
              .insertText(event.data ?? '')
              .scrollIntoView(),
          );
          return true;
        },
      },
      handleKeyDown(view, event) {
        if (
          event.isComposing ||
          (event.key !== 'Delete' && event.key !== 'Backspace')
        )
          return false;
        const tr = materializeInlineSyntaxSelection(view.state);
        if (!tr) return false;
        view.dispatch(closeHistory(tr).deleteSelection().scrollIntoView());
        return true;
      },
      handlePaste(view, _event, slice) {
        const tr = materializeInlineSyntaxSelection(view.state);
        if (!tr) return false;
        view.dispatch(
          closeHistory(tr)
            .replaceSelection(slice)
            .scrollIntoView()
            .setMeta('paste', true),
        );
        return true;
      },
    },
  });
}
