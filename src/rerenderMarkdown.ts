import type { Editor, JSONContent } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import {
  Fragment,
  Slice,
  type Node as ProseMirrorNode,
} from '@tiptap/pm/model';
import {
  AllSelection,
  NodeSelection,
  TextSelection,
  type Transaction,
} from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { getBaseMarkdownSerializer, safeDocument } from './EditorPane';
import { centerUnalignedPastedTables } from './markdownPaste';

type MarkdownManagerEncoder = {
  encodeTextForMarkdown?: (
    text: string,
    node: JSONContent,
    parentNode?: JSONContent,
  ) => string;
};

export type RerenderResult = {
  changed: boolean;
  scoped: boolean;
  reason?: 'code';
};

const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})[^`\n]*$/;
const TABLE_SEPARATOR =
  /^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-{3,}:?[ \t]*\|?[ \t]*$|^[ \t]*\|[ \t]*:?-{3,}:?[ \t]*\|[ \t]*$/;
const TASK_LINE = /^[ \t]{0,3}[-+*] \[[ xX]\] /;
const BULLET_LINE = /^[ \t]{0,3}[-+*] /;
const ORDERED_LINE = /^[ \t]{0,3}\d+[.)] /;
const QUOTE_LINE = /^[ \t]{0,3}>(?: |$)/;

function normalizeSpaces(node: JSONContent, inCode = false): JSONContent {
  const code =
    inCode ||
    node.type === 'codeBlock' ||
    !!node.marks?.some((mark) => mark.type === 'code');
  return {
    ...node,
    ...(node.text !== undefined
      ? { text: code ? node.text : node.text.replace(/\u00a0/g, ' ') }
      : {}),
    ...(node.content
      ? { content: node.content.map((child) => normalizeSpaces(child, code)) }
      : {}),
  };
}

function encodeRawTextForMarkdown(
  text: string,
  node: JSONContent,
  parentNode?: JSONContent,
) {
  if (
    parentNode?.type === 'codeBlock' ||
    (node.marks || []).some(
      (mark) => (typeof mark === 'string' ? mark : mark.type) === 'code',
    )
  )
    return text;
  let result = text;
  if (
    (node.marks || []).some(
      (mark) => (typeof mark === 'string' ? mark : mark.type) === 'highlight',
    )
  )
    result = result.replace(/=(?==)|^=|=$/g, '\\=');
  // Preserve literal '&' entities and keep <u>/</u> and '>' intact for
  // underline and blockquote parsing while escaping other raw HTML openers.
  return result.replace(/&/g, '&amp;').replace(/<(?!\/?u>)/gi, '&lt;');
}

function withRawSerializer<T>(
  editor: Editor,
  run: (serialize: (doc: JSONContent) => string) => T,
): T {
  const manager = editor.markdown as unknown as
    MarkdownManagerEncoder | undefined;
  const baseSerialize = getBaseMarkdownSerializer(editor);
  if (!manager || !baseSerialize)
    throw new Error('Markdown serializer is not ready');
  const originalEncode = manager.encodeTextForMarkdown;
  if (typeof originalEncode === 'function')
    manager.encodeTextForMarkdown = encodeRawTextForMarkdown;
  try {
    return run(baseSerialize);
  } finally {
    if (typeof originalEncode === 'function')
      manager.encodeTextForMarkdown = originalEncode;
  }
}

function plainParagraphText(node: JSONContent): string | null {
  if (node.type !== 'paragraph' || !node.content?.length) return null;
  let text = '';
  for (const child of node.content) {
    if (child.type !== 'text' || child.marks?.length) return null;
    text += child.text || '';
  }
  return text;
}

function singleLineParagraphText(
  node: JSONContent,
  serialize: (doc: JSONContent) => string,
): string | null {
  if (node.type !== 'paragraph' || !node.content?.length) return null;
  if (node.content.some((child) => child.type === 'hardBreak')) return null;
  const raw = serialize({ type: 'doc', content: [node] });
  return raw.includes('\n') ? null : raw;
}

function lineGroupKind(line: string) {
  if (TASK_LINE.test(line)) return 'task';
  if (BULLET_LINE.test(line)) return 'bullet';
  if (ORDERED_LINE.test(line)) return 'ordered';
  if (QUOTE_LINE.test(line)) return 'quote';
  return null;
}

function serializeBlocksRaw(
  nodes: JSONContent[],
  serialize: (doc: JSONContent) => string,
): string {
  const chunks: string[] = [];
  let normal: JSONContent[] = [];
  const flushNormal = () => {
    if (!normal.length) return;
    chunks.push(serialize({ type: 'doc', content: normal }));
    normal = [];
  };

  for (let i = 0; i < nodes.length;) {
    const node = nodes[i];
    const plain = plainParagraphText(node);
    const fence = plain ? FENCE_OPEN.exec(plain) : null;
    if (fence) {
      const marker = fence[1];
      const closePattern = new RegExp(
        `^[ \\t]{0,3}${marker[0]}{${marker.length},}[ \\t]*$`,
      );
      let close = -1;
      for (let j = i + 1; j < nodes.length; j++) {
        const candidate = nodes[j];
        if (candidate.type !== 'paragraph') break;
        const text = candidate.content?.length
          ? plainParagraphText(candidate)
          : '';
        if (text === null) break;
        if (closePattern.test(text)) {
          close = j;
          break;
        }
      }
      if (close > i) {
        flushNormal();
        const lines: string[] = [];
        for (let j = i; j <= close; j++) {
          lines.push(
            nodes[j].content?.length ? plainParagraphText(nodes[j]) || '' : '',
          );
        }
        chunks.push(lines.join('\n'));
        i = close + 1;
        continue;
      }
    }

    const line = singleLineParagraphText(node, serialize);
    if (line !== null && line.includes('|') && i + 1 < nodes.length) {
      const nextLine = singleLineParagraphText(nodes[i + 1], serialize);
      if (nextLine !== null && TABLE_SEPARATOR.test(nextLine)) {
        flushNormal();
        const rows = [line, nextLine];
        let j = i + 2;
        while (j < nodes.length) {
          const row = singleLineParagraphText(nodes[j], serialize);
          if (row === null || !row.includes('|')) break;
          rows.push(row);
          j++;
        }
        chunks.push(rows.join('\n'));
        i = j;
        continue;
      }
    }

    const kind = line !== null ? lineGroupKind(line) : null;
    if (kind && i + 1 < nodes.length) {
      const nextLine = singleLineParagraphText(nodes[i + 1], serialize);
      if (nextLine !== null && lineGroupKind(nextLine) === kind) {
        flushNormal();
        const items = [line!, nextLine];
        let j = i + 2;
        while (j < nodes.length) {
          const next = singleLineParagraphText(nodes[j], serialize);
          if (next === null || lineGroupKind(next) !== kind) break;
          items.push(next);
          j++;
        }
        chunks.push(items.join('\n'));
        i = j;
        continue;
      }
    }

    normal.push(node);
    i++;
  }

  flushNormal();
  return chunks.join('\n\n');
}

function serializeDocRaw(editor: Editor, doc: JSONContent): string {
  const normalized = normalizeSpaces(doc);
  return withRawSerializer(editor, (serialize) =>
    normalized.type === 'doc' && Array.isArray(normalized.content)
      ? serializeBlocksRaw(normalized.content, serialize)
      : serialize(normalized),
  );
}

function uniqueSentinel(text: string, prefix: string) {
  let token = prefix;
  while (text.includes(token)) token += 'X';
  return token;
}

function stripLeadingSentinel(
  nodes: JSONContent[] | undefined,
  sentinel: string,
): boolean {
  if (!nodes?.length) return false;
  const first = nodes[0];
  if (first.type === 'text' && first.text?.startsWith(sentinel)) {
    const rest = first.text.slice(sentinel.length);
    if (rest) first.text = rest;
    else nodes.shift();
    return true;
  }
  return false;
}

function stripTrailingSentinel(
  nodes: JSONContent[] | undefined,
  sentinel: string,
): boolean {
  if (!nodes?.length) return false;
  const last = nodes[nodes.length - 1];
  if (last.type === 'text' && last.text?.endsWith(sentinel)) {
    const rest = last.text.slice(0, -sentinel.length);
    if (rest) last.text = rest;
    else nodes.pop();
    return true;
  }
  return false;
}

function parseRawMarkdown(editor: Editor, raw: string) {
  return centerUnalignedPastedTables(safeDocument(editor, raw));
}

function parseInlineRaw(editor: Editor, raw: string): JSONContent[] | null {
  const start = uniqueSentinel(raw, 'MOJIANSTART');
  const end = uniqueSentinel(raw + start, 'MOJIANEND');
  const parsed = parseRawMarkdown(editor, `${start} ${raw} ${end}`);
  if (
    parsed.content?.length !== 1 ||
    parsed.content[0].type !== 'paragraph' ||
    !parsed.content[0].content
  )
    return null;
  const content = [...parsed.content[0].content];
  if (
    !stripLeadingSentinel(content, `${start} `) ||
    !stripTrailingSentinel(content, ` ${end}`)
  )
    return null;
  return content;
}

function isOnlyCodeSelected(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  codeMarkName: string,
) {
  let sawText = false;
  let hasNonCode = false;
  doc.nodesBetween(from, to, (node) => {
    if (node.isText) {
      sawText = true;
      if (!node.marks.some((mark) => mark.type.name === codeMarkName))
        hasNonCode = true;
    } else if (node.isAtom && !node.isTextblock) {
      hasNonCode = true;
    }
    return !hasNonCode;
  });
  return sawText && !hasNonCode;
}

function dispatchRerender(editor: Editor, tr: Transaction) {
  closeHistory(tr);
  editor.view.dispatch(tr);
}

function blockText(content: Fragment) {
  return content
    .textBetween(0, content.size, '', '\ufffc')
    .replace(/\u00a0/g, ' ');
}

// Markdown rendering mostly removes source delimiters. Count the characters
// that survive before the caret instead of counting the removed delimiters.
function mapTextOffset(before: string, after: string, offset: number) {
  let consumed = 0;
  let position = 0;
  for (let i = 0; i < before.length && consumed < after.length; i++) {
    if (before[i] !== after[consumed]) continue;
    consumed++;
    if (i < offset) position++;
  }
  return consumed === after.length ? position : Math.min(offset, after.length);
}

function applyInlineRerender(
  editor: Editor,
  tr: Transaction,
  from: number,
  to: number,
) {
  const content = tr.doc.slice(from, to).content;
  const raw = serializeDocRaw(editor, {
    type: 'paragraph',
    content: content.toJSON() as JSONContent[],
  });
  const parsed = parseInlineRaw(editor, raw);
  if (!parsed) return;
  const next = Fragment.fromArray(
    parsed.map((node) => editor.schema.nodeFromJSON(node)),
  );
  if (next.eq(content)) return;
  const caret = tr.selection.empty ? tr.selection.from : -1;
  tr.replaceWith(from, to, next);
  if (caret >= from && caret <= to) {
    const offset = mapTextOffset(
      blockText(content),
      blockText(next),
      caret - from,
    );
    tr.setSelection(TextSelection.create(tr.doc, from + offset));
  }
}

function replaceRenderedParagraphs(
  tr: Transaction,
  from: number,
  to: number,
  previous: Fragment,
  rendered: Fragment,
) {
  let caret: number | undefined;
  const selection = tr.selection;
  if (
    selection.empty &&
    selection.$from.parent.isTextblock &&
    selection.from > from &&
    selection.from < to
  ) {
    const start = tr.doc.resolve(from);
    const paragraphIndex = selection.$from.index(start.depth) - start.index();
    const original = blockText(selection.$from.parent.content);
    const blocks: { node: ProseMirrorNode; pos: number }[] = [];
    rendered.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      blocks.push({ node, pos });
      return false;
    });
    let corresponding = blocks[Math.min(paragraphIndex, blocks.length - 1)];
    if (blocks.length !== previous.childCount) {
      // A table or fenced block can change how many textblocks the range has.
      // Prefer a block containing the original paragraph's surviving text.
      let distance = Infinity;
      blocks.forEach((block, i) => {
        const text = blockText(block.node.content);
        const proximity = Math.abs(i - paragraphIndex);
        if (
          text &&
          (text.includes(original) || original.includes(text)) &&
          proximity < distance
        ) {
          corresponding = block;
          distance = proximity;
        }
      });
    }
    if (corresponding) {
      const offset = mapTextOffset(
        original,
        blockText(corresponding.node.content),
        selection.$from.parentOffset,
      );
      caret = from + corresponding.pos + 1 + offset;
    }
  }
  tr.replaceWith(from, to, rendered);
  if (caret !== undefined) tr.setSelection(TextSelection.create(tr.doc, caret));
}

type ParagraphRange = {
  start: number;
  end: number;
  from: number;
  to: number;
};

function applyParagraphRerender(
  editor: Editor,
  tr: Transaction,
  { start, end, from, to }: ParagraphRange,
) {
  const partialStart = from > start + 1;
  const partialEnd = to < end - 1;
  if (
    (partialStart || partialEnd) &&
    tr.doc.resolve(from).sameParent(tr.doc.resolve(to))
  ) {
    applyInlineRerender(editor, tr, from, to);
    return;
  }

  const targetFrom = partialStart ? from : start;
  const targetTo = partialEnd ? to : end;
  const selected = tr.doc.slice(targetFrom, targetTo);
  let raw = serializeDocRaw(editor, {
    type: 'doc',
    content: selected.content.toJSON() as JSONContent[],
  });
  const startToken = partialStart ? uniqueSentinel(raw, 'MOJIANSTART') : '';
  const endToken = partialEnd
    ? uniqueSentinel(raw + startToken, 'MOJIANEND')
    : '';
  if (startToken) raw = `${startToken} ${raw}`;
  if (endToken) raw = `${raw} ${endToken}`;

  const parsed = parseRawMarkdown(editor, raw);
  if (!parsed.content?.length) return;
  const first = parsed.content[0];
  const last = parsed.content[parsed.content.length - 1];
  if (
    startToken &&
    (first.type !== 'paragraph' ||
      !stripLeadingSentinel(first.content, `${startToken} `))
  )
    return;
  if (
    endToken &&
    (last.type !== 'paragraph' ||
      !stripTrailingSentinel(last.content, ` ${endToken}`))
  )
    return;

  const next = new Slice(
    editor.schema.nodeFromJSON(parsed).content,
    Number(partialStart),
    Number(partialEnd),
  );
  if (next.eq(selected)) return;
  const $start = tr.doc.resolve(start);
  if ($start.depth === 0) {
    if (partialStart || partialEnd) tr.replaceRange(targetFrom, targetTo, next);
    else
      replaceRenderedParagraphs(tr, start, end, selected.content, next.content);
    return;
  }

  // Nested ranges contain whole paragraphs. Keep replacement inside their
  // parent, including when a list item requires a leading paragraph.
  const $end = tr.doc.resolve(end);
  const parent = $start.parent;
  const firstIndex = $start.index();
  const paragraph = editor.schema.nodes.paragraph;
  const replacement =
    firstIndex === 0 &&
    ['listItem', 'taskItem'].includes(parent.type.name) &&
    next.content.firstChild?.type !== paragraph
      ? Fragment.from(paragraph.create()).append(next.content)
      : next.content;
  if (parent.canReplace(firstIndex, $end.index(), replacement)) {
    replaceRenderedParagraphs(tr, start, end, selected.content, replacement);
    return;
  }
  let pos = end;
  for (let i = selected.content.childCount - 1; i >= 0; i--) {
    const child = selected.content.child(i);
    pos -= child.nodeSize;
    if (child.content.size)
      applyInlineRerender(editor, tr, pos + 1, pos + child.nodeSize - 1);
  }
}

function rerenderRange(
  editor: Editor,
  from: number,
  to: number,
  scoped: boolean,
): RerenderResult {
  const { state } = editor;
  const ranges: (ParagraphRange | { from: number; to: number })[] = [];
  let paragraphs: ParagraphRange | undefined;
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;
    const start = Math.max(from, pos + 1);
    const end = Math.min(to, pos + node.nodeSize - 1);
    const whole = start === pos + 1 && end === pos + node.nodeSize - 1;
    if (node.type.name === 'paragraph' && (parent === state.doc || whole)) {
      if (paragraphs?.end === pos) {
        paragraphs.end = pos + node.nodeSize;
        paragraphs.to = end;
      } else {
        paragraphs = {
          start: pos,
          end: pos + node.nodeSize,
          from: start,
          to: end,
        };
        ranges.push(paragraphs);
      }
    } else if (start < end) {
      // A clipped paragraph in an existing container can change inline only.
      ranges.push({ from: start, to: end });
    }
    return false;
  });

  const tr = state.tr;
  for (const range of ranges.reverse()) {
    if ('start' in range) applyParagraphRerender(editor, tr, range);
    else applyInlineRerender(editor, tr, range.from, range.to);
  }
  if (tr.doc.eq(state.doc)) return { changed: false, scoped };
  if (scoped) {
    const anchor = tr.doc.resolve(tr.mapping.map(from, -1));
    const head = tr.doc.resolve(tr.mapping.map(to, 1));
    tr.setSelection(TextSelection.between(anchor, head));
  }
  dispatchRerender(editor, tr);
  return { changed: true, scoped };
}

function applyCellRerender(
  editor: Editor,
  tr: Transaction,
  cellPos: number,
): boolean {
  const cell = tr.doc.nodeAt(cellPos);
  if (!cell || !cell.content.size) return false;
  const raw = serializeDocRaw(editor, {
    type: 'doc',
    content: cell.content.toJSON() as JSONContent[],
  });
  const parsed = parseRawMarkdown(editor, raw);
  const nextDoc = editor.schema.nodeFromJSON(parsed);
  if (nextDoc.content.eq(cell.content)) return false;
  const from = cellPos + 1;
  const to = cellPos + cell.nodeSize - 1;
  const before = tr.doc;
  tr.replaceRange(from, to, new Slice(nextDoc.content, 0, 0));
  return !tr.doc.eq(before);
}

function rerenderCells(
  editor: Editor,
  cellPositions: number[],
): RerenderResult {
  const tr = editor.state.tr;
  let changed = false;
  for (const pos of [...cellPositions].sort((a, b) => b - a)) {
    if (applyCellRerender(editor, tr, pos)) changed = true;
  }
  if (!changed) return { changed: false, scoped: true };
  dispatchRerender(editor, tr);
  return { changed: true, scoped: true };
}

function rerenderSelection(editor: Editor): RerenderResult {
  const { state, schema } = editor;
  const { selection } = state;

  if (selection instanceof AllSelection)
    return rerenderRange(editor, 0, state.doc.content.size, false);

  if (selection instanceof CellSelection) {
    const cellPositions: number[] = [];
    selection.forEachCell((_node, pos) => cellPositions.push(pos));
    return rerenderCells(editor, cellPositions);
  }

  if (selection instanceof NodeSelection) {
    if (selection.node.type.name === 'codeBlock')
      return { changed: false, scoped: true, reason: 'code' };
    if (selection.node.type.name === 'table') {
      const cells: number[] = [];
      selection.node.descendants((node, offset) => {
        if (
          node.type.name === 'tableCell' ||
          node.type.name === 'tableHeader'
        ) {
          cells.push(selection.from + 1 + offset);
          return false;
        }
        return true;
      });
      return rerenderCells(editor, cells);
    }
    return rerenderRange(editor, selection.from, selection.to, true);
  }

  const { from, to, $from, $to } = selection;
  if (
    $from.sameParent($to) &&
    ($from.parent.type.spec.code ||
      (schema.marks.code &&
        isOnlyCodeSelected(state.doc, from, to, schema.marks.code.name)))
  )
    return { changed: false, scoped: true, reason: 'code' };

  return rerenderRange(editor, from, to, true);
}

export function rerenderMarkdown(editor: Editor | null): RerenderResult {
  if (!editor || editor.isDestroyed || !editor.isEditable || !editor.markdown)
    return { changed: false, scoped: false };
  const { selection } = editor.state;
  if (selection.empty)
    return rerenderRange(editor, 0, editor.state.doc.content.size, false);
  return rerenderSelection(editor);
}
