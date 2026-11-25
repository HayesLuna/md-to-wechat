import type { Editor, JSONContent } from '@tiptap/core';
import type { ResolvedPos, Slice } from '@tiptap/pm/model';
import { sourceInlinePairs } from './sourceInlinePairs';

// Contenteditable can introduce NBSP to keep consecutive spaces visible.
// Normalize only copied prose; code and the source document stay unchanged.
function ordinarySpaces(node: JSONContent, inCode = false): JSONContent {
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
      ? { content: node.content.map((child) => ordinarySpaces(child, code)) }
      : {}),
  };
}
type TextWrap = { opening: string; closing: string };

// Headings, list items and quotes need the serializer to emit their block
// prefix (`## `, `- `, `> `); plain paragraphs, including table cells, do not.
function needsBlockPrefix($from: ResolvedPos) {
  if ($from.parent.type.name === 'heading') return true;
  for (let depth = $from.depth - 1; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === 'listItem' || name === 'taskItem' || name === 'blockquote')
      return true;
  }
  return false;
}

// Delimiters sit outside the selection, so a partial selection would otherwise
// copy as plain text. Find the pairs that enclose it and rebuild both ends.
function inlineWrap(editor: Editor): TextWrap | null {
  const { $from, $to, from, to } = editor.state.selection;
  if (!$from.sameParent($to) || !$from.parent.inlineContent) return null;
  const parentText = $from.parent.textBetween(
    0,
    $from.parent.content.size,
    '\n',
    '\ufffc',
  );
  const base = $from.start();
  const enclosing = sourceInlinePairs(parentText)
    .filter(
      (pair) =>
        from >= base + pair.from + pair.openLen &&
        to <= base + pair.to - pair.closeLen,
    )
    .sort((a, b) => a.from - b.from);
  if (!enclosing.length) return null;
  return {
    opening: enclosing
      .map((pair) => parentText.slice(pair.from, pair.from + pair.openLen))
      .join(''),
    closing: [...enclosing]
      .reverse()
      .map((pair) => parentText.slice(pair.to - pair.closeLen, pair.to))
      .join(''),
  };
}

function wrapSliceText(node: JSONContent, wrap: TextWrap): JSONContent {
  const texts: JSONContent[] = [];
  const collect = (current: JSONContent) => {
    if (current.type === 'text' && current.text) texts.push(current);
    current.content?.forEach(collect);
  };
  collect(node);
  if (!texts.length) return node;
  texts[0].text = wrap.opening + texts[0].text;
  const last = texts[texts.length - 1];
  last.text = last.text! + wrap.closing;
  return node;
}

// A code span whose content starts or ends with a backtick merges into its
// fence in the document. Copied Markdown needs the canonical padding space so
// the fence stays unambiguous.
function padCodeFences(text: string) {
  const pairs = sourceInlinePairs(text).filter((pair) => pair.kind === 'code');
  let out = text;
  for (const pair of [...pairs].reverse()) {
    const content = out.slice(
      pair.from + pair.openLen,
      pair.to - pair.closeLen,
    );
    if (!content.startsWith('`') && !content.endsWith('`')) continue;
    out =
      out.slice(0, pair.from) +
      '`'.repeat(pair.openLen) +
      ' ' +
      content +
      ' ' +
      '`'.repeat(pair.closeLen) +
      out.slice(pair.to);
  }
  return out;
}

export function markdownSelection(editor: Editor | null, slice: Slice) {
  if (editor) {
    const { $from, $to, from, to } = editor.state.selection;
    if ($from.sameParent($to) && $from.parent.type.name === 'codeBlock') {
      return $from.parent.textBetween(
        $from.parentOffset,
        $to.parentOffset,
        '\n',
        '\n',
      );
    }
    // Source-editable delimiters already live in the document. Prefer the raw
    // text for ordinary inline selections so partial markers are not escaped.
    if (
      !needsBlockPrefix($from) &&
      $from.sameParent($to) &&
      $from.parent.inlineContent
    ) {
      let rich = false;
      editor.state.doc.nodesBetween(from, to, (node) => {
        if (
          node.type.name === 'inlineImage' ||
          node.marks.some((mark) => mark.type.name === 'link')
        )
          rich = true;
        return !rich;
      });
      if (!rich) {
        const raw = padCodeFences(
          editor.state.doc
            .textBetween(from, to, '\n', '\ufffc')
            .replace(/\u00a0/g, ' '),
        );
        const wrap = inlineWrap(editor);
        return wrap ? wrap.opening + raw + wrap.closing : raw;
      }
    }
  }
  if (!editor?.markdown)
    return slice.content
      .textBetween(0, slice.content.size, '\n\n')
      .replace(/\u00a0/g, ' ');
  const json = ordinarySpaces({ type: 'doc', content: slice.content.toJSON() });
  const wrap = editor ? inlineWrap(editor) : null;
  return editor.markdown.serialize(wrap ? wrapSliceText(json, wrap) : json);
}

export function containsTaskItems(slice: Slice) {
  let tasks = false;
  slice.content.descendants((node) => {
    if (node.type.name === 'taskItem') tasks = true;
    return !tasks;
  });
  return tasks;
}

// Typora ignores checkbox inputs when importing rich HTML. Use the Markdown
// flavor for selections containing tasks so checked state and nesting survive.
export function copyTaskMarkdown(
  editor: Editor | null,
  event: ClipboardEvent,
  cut = false,
) {
  if (!editor || editor.state.selection.empty || !event.clipboardData)
    return false;
  if (cut && !editor.isEditable) {
    event.preventDefault();
    return true;
  }
  const slice = editor.state.selection.content();
  if (!containsTaskItems(slice)) return false;
  const text = markdownSelection(editor, slice);
  event.clipboardData.clearData();
  event.clipboardData.setData('text/plain', text);
  event.preventDefault();
  if (cut) editor.commands.deleteSelection();
  return true;
}
