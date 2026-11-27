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

function rerenderWholeDocument(editor: Editor): RerenderResult {
  const oldDoc = editor.state.doc;
  const raw = serializeDocRaw(editor, oldDoc.toJSON());
  const parsed = parseRawMarkdown(editor, raw);
  const nextDoc = editor.schema.nodeFromJSON(parsed);
  if (nextDoc.eq(oldDoc)) return { changed: false, scoped: false };
  const oldPos = editor.state.selection.from;
  const tr = editor.state.tr.replaceWith(
    0,
    oldDoc.content.size,
    nextDoc.content,
  );
  const clamped = Math.min(oldPos, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(clamped)));
  dispatchRerender(editor, tr);
  return { changed: true, scoped: false };
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

  if (selection instanceof AllSelection) {
    const result = rerenderWholeDocument(editor);
    return { ...result, scoped: false };
  }

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
    return { changed: false, scoped: true };
  }

  const { from, to, $from, $to } = selection;

  if ($from.sameParent($to)) {
    if ($from.parent.type.spec.code)
      return { changed: false, scoped: true, reason: 'code' };
    if (
      schema.marks.code &&
      isOnlyCodeSelected(state.doc, from, to, schema.marks.code.name)
    )
      return { changed: false, scoped: true, reason: 'code' };

    const sliceJson = selection.content().content.toJSON() as JSONContent[];
    const raw = serializeDocRaw(editor, { type: 'doc', content: sliceJson });
    const fullParagraph =
      $from.parent.type.name === 'paragraph' &&
      $from.parentOffset === 0 &&
      $to.parentOffset === $to.parent.content.size;

    if (fullParagraph) {
      const parsed = parseRawMarkdown(editor, raw);
      const parsedDoc = schema.nodeFromJSON(parsed);
      const singleParagraph =
        parsedDoc.childCount === 1 &&
        parsedDoc.firstChild?.type.name === 'paragraph';
      if (!singleParagraph) {
        const blockFrom = $from.before();
        const blockTo = $from.after();
        const tr = state.tr.replaceRange(
          blockFrom,
          blockTo,
          new Slice(parsedDoc.content, 0, 0),
        );
        if (!tr.doc.eq(state.doc)) {
          const mappedTo = tr.mapping.map(blockTo);
          tr.setSelection(
            TextSelection.between(
              tr.doc.resolve(Math.min(blockFrom, tr.doc.content.size)),
              tr.doc.resolve(Math.min(mappedTo, tr.doc.content.size)),
            ),
          );
          dispatchRerender(editor, tr);
          return { changed: true, scoped: true };
        }
        return { changed: false, scoped: true };
      }
    }

    const inlineNodes = parseInlineRaw(editor, raw);
    if (!inlineNodes) return { changed: false, scoped: true };
    const fragment = Fragment.fromArray(
      inlineNodes.map((node) => schema.nodeFromJSON(node)),
    );
    const tr = state.tr.replaceWith(from, to, fragment);
    if (tr.doc.eq(state.doc)) return { changed: false, scoped: true };
    const newTo = from + fragment.size;
    tr.setSelection(
      TextSelection.create(
        tr.doc,
        Math.min(from, tr.doc.content.size),
        Math.min(newTo, tr.doc.content.size),
      ),
    );
    dispatchRerender(editor, tr);
    return { changed: true, scoped: true };
  }

  // Multi-block selection spanning multiple siblings or containers.
  const partialStart = $from.parentOffset > 0;
  const partialEnd = $to.parentOffset < $to.parent.content.size;
  if (
    (partialStart && $from.parent.type.spec.code) ||
    (partialEnd && $to.parent.type.spec.code)
  )
    return { changed: false, scoped: true, reason: 'code' };

  const slice = selection.content();
  const sliceBlocks = ((slice.content.toJSON() as JSONContent[]) || []).map(
    (block) => ({ ...block }),
  );
  if (!sliceBlocks.length) return { changed: false, scoped: true };

  // Partial selections inside a heading will merge their inline content back
  // into that heading, so avoid serializing a leading `# ` marker.
  if (partialStart && sliceBlocks[0].type === 'heading')
    sliceBlocks[0] = { type: 'paragraph', content: sliceBlocks[0].content };
  if (partialEnd && sliceBlocks[sliceBlocks.length - 1].type === 'heading')
    sliceBlocks[sliceBlocks.length - 1] = {
      type: 'paragraph',
      content: sliceBlocks[sliceBlocks.length - 1].content,
    };

  const sameBlockParent =
    $from.depth === $to.depth &&
    $from.depth >= 1 &&
    $from.node(-1) === $to.node(-1);

  let raw = serializeDocRaw(editor, { type: 'doc', content: sliceBlocks });
  const startSentinel = partialStart
    ? uniqueSentinel(raw, 'MOJIANSTART')
    : null;
  const endSentinel = partialEnd
    ? uniqueSentinel(raw + (startSentinel || ''), 'MOJIANEND')
    : null;
  if (startSentinel) raw = `${startSentinel} ${raw}`;
  if (endSentinel) raw = `${raw} ${endSentinel}`;

  const parsed = parseRawMarkdown(editor, raw);
  if (!parsed.content?.length) return { changed: false, scoped: true };

  if (startSentinel) {
    const first = parsed.content[0];
    if (
      first.type !== 'paragraph' ||
      !stripLeadingSentinel(first.content, `${startSentinel} `)
    )
      return { changed: false, scoped: true };
  }
  if (endSentinel) {
    const last = parsed.content[parsed.content.length - 1];
    if (
      last.type !== 'paragraph' ||
      !stripTrailingSentinel(last.content, ` ${endSentinel}`)
    )
      return { changed: false, scoped: true };
  }

  const parsedDoc = schema.nodeFromJSON(parsed);
  const replaceStartBlock = sameBlockParent && !partialStart;
  const replaceEndBlock = sameBlockParent && !partialEnd;
  const targetFrom = replaceStartBlock ? $from.before() : from;
  const targetTo = replaceEndBlock ? $to.after() : to;
  const openStart =
    !replaceStartBlock &&
    parsedDoc.firstChild?.isTextblock &&
    !parsedDoc.firstChild.type.spec.code
      ? 1
      : 0;
  const openEnd =
    !replaceEndBlock &&
    parsedDoc.lastChild?.isTextblock &&
    !parsedDoc.lastChild.type.spec.code
      ? 1
      : 0;

  const tr = state.tr.replaceRange(
    targetFrom,
    targetTo,
    new Slice(parsedDoc.content, openStart, openEnd),
  );
  if (tr.doc.eq(state.doc)) return { changed: false, scoped: true };

  const mappedTo = tr.mapping.map(targetTo);
  tr.setSelection(
    TextSelection.between(
      tr.doc.resolve(Math.min(targetFrom, tr.doc.content.size)),
      tr.doc.resolve(Math.min(mappedTo, tr.doc.content.size)),
    ),
  );
  dispatchRerender(editor, tr);
  return { changed: true, scoped: true };
}

export function rerenderMarkdown(editor: Editor | null): RerenderResult {
  if (!editor || editor.isDestroyed || !editor.isEditable || !editor.markdown)
    return { changed: false, scoped: false };
  const { selection } = editor.state;
  if (selection.empty) return rerenderWholeDocument(editor);
  return rerenderSelection(editor);
}
