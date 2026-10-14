import type { Editor, JSONContent } from '@tiptap/core';
import type { Slice } from '@tiptap/pm/model';

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
export function markdownSelection(editor: Editor | null, slice: Slice) {
  if (editor) {
    const { $from, $to } = editor.state.selection;
    if ($from.sameParent($to) && $from.parent.type.name === 'codeBlock') {
      return $from.parent.textBetween(
        $from.parentOffset,
        $to.parentOffset,
        '\n',
        '\n',
      );
    }
  }
  if (!editor?.markdown)
    return slice.content
      .textBetween(0, slice.content.size, '\n\n')
      .replace(/\u00a0/g, ' ');
  return editor.markdown.serialize(
    ordinarySpaces({ type: 'doc', content: slice.content.toJSON() }),
  );
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
  let tasks = false;
  slice.content.descendants((node) => {
    if (node.type.name === 'taskItem') tasks = true;
  });
  if (!tasks) return false;
  const text = markdownSelection(editor, slice);
  event.clipboardData.clearData();
  event.clipboardData.setData('text/plain', text);
  event.preventDefault();
  if (cut) editor.commands.deleteSelection();
  return true;
}
