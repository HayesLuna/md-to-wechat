import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

export type CodeFoldRange = { from: number; to: number };
type Fold = CodeFoldRange & { block: number };
type FoldState = { folds: Fold[]; decorations: DecorationSet };
const key = new PluginKey<FoldState>('codeFolding');
const empty: FoldState = { folds: [], decorations: DecorationSet.empty };

export function codeLines(source: string) {
  const lines = source.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return { lines, starts };
}
export function codeLineAt(starts: number[], offset: number) {
  let lo = 0,
    hi = starts.length;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Only presentation metadata is produced. The document always retains all code.
// Analysis is delayed in the NodeView and bounded independently of highlighting.
export function findCodeFolds(
  source: string,
  language: string,
): CodeFoldRange[] {
  if (source.length > 200_000) return [];
  const { lines, starts } = codeLines(source);
  const folds: CodeFoldRange[] = [];
  const add = (from: number, to: number) => {
    if (from < to && codeLineAt(starts, from) < codeLineAt(starts, to))
      folds.push({ from, to });
  };
  if (/^(html|xml|svg|vue|svelte)$/.test(language)) {
    const tags: { name: string; end: number }[] = [];
    const voids = new Set([
      'area',
      'base',
      'br',
      'col',
      'embed',
      'hr',
      'img',
      'input',
      'link',
      'meta',
      'param',
      'source',
      'track',
      'wbr',
    ]);
    for (let i = 0; i < source.length; i++) {
      if (source[i] !== '<') continue;
      if (source.startsWith('<!--', i)) {
        const end = source.indexOf('-->', i + 4);
        if (end < 0) break;
        add(i + 4, end);
        i = end + 2;
        continue;
      }
      const start = i;
      let quote = '';
      for (i++; i < source.length; i++) {
        const c = source[i];
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
      }
      const token = source.slice(start, i + 1);
      const match = /^<\/?([\w:.-]+)/.exec(token);
      if (!match) continue;
      const name = match[1].toLowerCase();
      if (token[1] === '/') {
        let at = tags.length - 1;
        while (at >= 0 && tags[at].name !== name) at--;
        if (at >= 0) {
          add(tags[at].end, start);
          tags.length = at;
        }
      } else if (!voids.has(name) && !/\/\s*>$/.test(token))
        tags.push({ name, end: i + 1 });
    }
  } else {
    const stack: { char: string; pos: number }[] = [];
    let quote = '',
      comment = -1,
      lineComment = false;
    const hashComments =
      /^(python|py|ruby|rb|bash|shell|sh|yaml|yml|perl|r)$/.test(language);
    for (let i = 0; i < source.length; i++) {
      const c = source[i],
        next = source[i + 1];
      if (lineComment) {
        if (c === '\n') lineComment = false;
        continue;
      }
      if (comment >= 0) {
        if (c === '*' && next === '/') {
          add(comment + 2, i);
          comment = -1;
          i++;
        }
        continue;
      }
      if (quote) {
        if (c === '\\') i++;
        else if (source.startsWith(quote, i)) {
          i += quote.length - 1;
          quote = '';
        }
        continue;
      }
      if ((c === '/' && next === '/') || (c === '#' && hashComments)) {
        lineComment = true;
        continue;
      }
      if (c === '/' && next === '*') {
        comment = i++;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        quote = source.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
        i += quote.length - 1;
        continue;
      }
      if ('{[('.includes(c)) stack.push({ char: c, pos: i });
      else if ('}])'.includes(c)) {
        const open = stack.at(-1);
        if (open && '{[('.indexOf(open.char) === '}])'.indexOf(c)) {
          stack.pop();
          add(open.pos + 1, i);
        }
      }
    }
    if (/^(python|py|yaml|yml)$/.test(language)) {
      const indents: { indent: number; line: number }[] = [];
      let last = 0;
      for (let i = 0; i <= lines.length; i++) {
        const line = lines[i] ?? '';
        if (
          i < lines.length &&
          (!line.trim() || line.trimStart().startsWith('#'))
        )
          continue;
        const indent =
          i === lines.length ? -1 : line.length - line.trimStart().length;
        while (indents.length && indent <= indents.at(-1)!.indent) {
          const start = indents.pop()!.line;
          add(
            starts[start] + lines[start].length,
            starts[last] + lines[last].length,
          );
        }
        if (
          i > 0 &&
          indent > 0 &&
          lines[last]?.trim() &&
          indent > lines[last].length - lines[last].trimStart().length
        )
          indents.push({
            indent: lines[last].length - lines[last].trimStart().length,
            line: last,
          });
        last = i;
      }
    }
  }
  // One gutter affordance per line, with the widest region on that line.
  const byLine = new Map<number, CodeFoldRange>();
  for (const fold of folds) {
    const line = codeLineAt(starts, fold.from);
    const previous = byLine.get(line);
    if (!previous || fold.to > previous.to) byLine.set(line, fold);
  }
  return [...byLine.values()].sort((a, b) => a.from - b.from);
}

export function getCodeFolds(
  state: EditorState,
  block: number,
): CodeFoldRange[] {
  return (key.getState(state)?.folds ?? [])
    .filter((f) => f.block === block)
    .map((f) => ({ from: f.from - block - 1, to: f.to - block - 1 }));
}
export function toggleCodeFold(
  editor: Editor,
  block: number,
  range: CodeFoldRange,
) {
  const node = editor.state.doc.nodeAt(block);
  if (
    node?.type.name !== 'codeBlock' ||
    range.from < 0 ||
    range.to > node.content.size
  )
    return;
  const from = block + 1 + range.from,
    to = block + 1 + range.to;
  const tr = editor.state.tr
    .setMeta(key, { toggle: { block, from, to } })
    .setMeta('addToHistory', false);
  if (
    tr.selection instanceof TextSelection &&
    ((tr.selection.head > from && tr.selection.head < to) ||
      (tr.selection.anchor > from && tr.selection.anchor < to))
  )
    tr.setSelection(TextSelection.create(tr.doc, from));
  editor.view.dispatch(tr);
}

function decorated(doc: Node, folds: Fold[]): FoldState {
  if (!folds.length) return empty;
  const decorations: Decoration[] = [];
  const blocks = new Map<number, Fold[]>();
  for (const fold of folds) {
    const list = blocks.get(fold.block) ?? [];
    list.push(fold);
    blocks.set(fold.block, list);
  }
  for (const [block, regions] of blocks) {
    const node = doc.nodeAt(block)!;
    decorations.push(
      Decoration.node(
        block,
        block + node.nodeSize,
        {
          'data-code-folds': regions.map((f) => `${f.from}:${f.to}`).join(','),
        },
        { codeFolds: regions.map((f) => `${f.from}:${f.to}`).join(',') },
      ),
    );
    let end = -1;
    for (const fold of [...regions].sort(
      (a, b) => a.from - b.from || b.to - a.to,
    )) {
      if (fold.from < end) continue;
      end = fold.to;
      decorations.push(
        Decoration.inline(fold.from, fold.to, {
          class: 'code-fold-hidden',
          style: 'display:none',
        }),
      );
      decorations.push(
        Decoration.widget(
          fold.from,
          (view) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'code-fold-placeholder';
            button.textContent = ' … ';
            button.contentEditable = 'false';
            button.setAttribute('aria-label', '展开此处代码');
            button.addEventListener('mousedown', (e) => e.preventDefault());
            button.addEventListener('click', () =>
              view.dispatch(
                view.state.tr
                  .setMeta(key, { toggle: fold })
                  .setMeta('addToHistory', false),
              ),
            );
            return button;
          },
          {
            key: `fold-${fold.from}-${fold.to}`,
            side: -1,
            ignoreSelection: true,
          },
        ),
      );
    }
  }
  return { folds, decorations: DecorationSet.create(doc, decorations) };
}

function placeCodeCaret(view: EditorView, event: MouseEvent) {
  if (
    event.button !== 0 ||
    event.detail !== 1 ||
    event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !view.editable ||
    !(event.target instanceof Element)
  )
    return false;
  if (event.target.closest('button,input,select,textarea,.code-gutter'))
    return false;
  const viewport = event.target.closest('.code-viewport');
  const pre = viewport?.querySelector('pre');
  const content = pre?.querySelector('[data-node-view-content]');
  if (
    !viewport ||
    !pre ||
    !content ||
    view.dom.ownerDocument.getSelection()?.isCollapsed === false
  )
    return false;
  const $pos = view.state.doc.resolve(view.posAtDOM(content, 0));
  let depth = $pos.depth;
  while (depth > 0 && $pos.node(depth).type.name !== 'codeBlock') depth--;
  if (!depth) return false;
  const block = $pos.before(depth),
    node = $pos.node(depth);
  const { lines, starts } = codeLines(node.textContent);
  const rect = pre.getBoundingClientRect(),
    bounds = viewport.getBoundingClientRect(),
    style = getComputedStyle(pre);
  const lineHeight = parseFloat(style.lineHeight) || 22.75,
    padding = parseFloat(style.paddingTop) || 0;
  const visual = Math.max(
    0,
    Math.floor((event.clientY - rect.top - padding) / lineHeight),
  );
  const folds = getCodeFolds(view.state, block).sort(
    (a, b) => a.from - b.from || b.to - a.to,
  );
  let removed = 0,
    end = -1;
  for (const fold of folds) {
    if (fold.from < end) continue;
    const start = codeLineAt(starts, fold.from),
      last = codeLineAt(starts, fold.to);
    if (visual <= start - removed) break;
    removed += last - start;
    end = fold.to;
  }
  const line = Math.min(lines.length - 1, visual + removed);
  let last = line;
  for (const fold of folds)
    if (codeLineAt(starts, fold.from) === line)
      last = Math.max(last, codeLineAt(starts, fold.to));
  const from = block + 1 + starts[line],
    to = block + 1 + starts[last] + lines[last].length;
  // Hit-test the text's vertical center, retaining the clicked horizontal column.
  // Native hit testing between inline token boxes can otherwise choose the whole block's edge.
  const top = Math.max(
    bounds.top + 1,
    Math.min(
      bounds.bottom - 2,
      rect.top + padding + (visual + 0.5) * lineHeight,
    ),
  );
  const hit = view.posAtCoords({ left: event.clientX, top });
  const pos = Math.max(from, Math.min(to, hit?.pos ?? from));
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  );
  view.focus();
  return true;
}
export function codeFoldingPlugin() {
  return new Plugin<FoldState>({
    key,
    state: {
      init: () => empty,
      apply(tr, value, oldState) {
        if (!value.folds.length && !tr.getMeta(key)) return value;
        let folds = value.folds;
        if (tr.docChanged)
          folds = folds.flatMap((fold) => {
            let { block, from, to } = fold;
            for (const map of tr.mapping.maps) {
              let touched = false;
              map.forEach((a, b) => {
                if (a <= to && b >= from) touched = true;
              });
              if (touched) return [];
              block = map.map(block, 1);
              from = map.map(from, 1);
              to = map.map(to, -1);
            }
            const node = tr.doc.nodeAt(block);
            if (
              node?.type.name !== 'codeBlock' ||
              node.attrs.language !==
                oldState.doc.nodeAt(fold.block)?.attrs.language
            )
              return [];
            return [{ block, from, to }];
          });
        const toggle = tr.getMeta(key)?.toggle as Fold | undefined;
        if (toggle) {
          const exists = folds.some(
            (f) => f.from === toggle.from && f.to === toggle.to,
          );
          folds = exists
            ? folds.filter((f) => f.from !== toggle.from || f.to !== toggle.to)
            : [...folds, toggle];
        }
        if (tr.selection instanceof TextSelection)
          folds = folds.filter(
            (f) =>
              ![tr.selection.head, tr.selection.anchor].some(
                (p) => p > f.from && p < f.to,
              ),
          );
        if (
          !tr.docChanged &&
          folds.length === value.folds.length &&
          folds.every((f, i) => f === value.folds[i])
        )
          return value;
        return decorated(tr.doc, folds);
      },
    },
    props: {
      handleDOMEvents: { click: placeCodeCaret },
      decorations: (state) => key.getState(state)?.decorations,
      handleKeyDown(view, event) {
        if (
          event.isComposing ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey
        )
          return false;
        const sel = view.state.selection;
        if (!(sel instanceof TextSelection) || !sel.empty) return false;
        const fold = key
          .getState(view.state)
          ?.folds.find(
            (f) =>
              (event.key === 'Delete' && sel.head === f.from) ||
              (event.key === 'Backspace' && sel.head === f.to),
          );
        if (!fold) return false;
        view.dispatch(
          view.state.tr
            .setMeta(key, { toggle: fold })
            .setMeta('addToHistory', false),
        );
        return true;
      },
    },
  });
}
