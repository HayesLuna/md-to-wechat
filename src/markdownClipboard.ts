import type { Editor, JSONContent } from "@tiptap/core";
import type { Slice } from "@tiptap/pm/model";

// Contenteditable can introduce NBSP to keep consecutive spaces visible.
// Normalize only copied prose; code and the source document stay unchanged.
function ordinarySpaces(node: JSONContent, inCode = false): JSONContent {
  const code =
    inCode ||
    node.type === "codeBlock" ||
    !!node.marks?.some((mark) => mark.type === "code");
  return {
    ...node,
    ...(node.text !== undefined
      ? { text: code ? node.text : node.text.replace(/\u00a0/g, " ") }
      : {}),
    ...(node.content
      ? { content: node.content.map((child) => ordinarySpaces(child, code)) }
      : {}),
  };
}
export function markdownSelection(editor: Editor | null, slice: Slice) {
  if (!editor?.markdown)
    return slice.content
      .textBetween(0, slice.content.size, "\n\n")
      .replace(/\u00a0/g, " ");
  return editor.markdown.serialize(
    ordinarySpaces({ type: "doc", content: slice.content.toJSON() }),
  );
}
