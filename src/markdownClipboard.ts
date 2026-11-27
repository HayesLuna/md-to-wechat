import type { Editor, JSONContent } from '@tiptap/core';
import {
  DOMSerializer,
  Fragment,
  Slice,
  type Node,
  type ResolvedPos,
} from '@tiptap/pm/model';
import { NodeSelection, type Selection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { normalizeListItemContent } from './editorExtensions';
import { isImageName } from './outputUtils';

export function plainTextSelection(slice: Slice) {
  function text(node: Node, inCode = false): string {
    const code = inCode || node.type.spec.code;
    if (node.isText)
      return code || node.marks.some((mark) => mark.type.name === 'code')
        ? node.text!
        : node.text!.replace(/\u00a0/g, ' ');
    if (node.type.name === 'hardBreak') return '\n';
    if (isImageName(node.type.name)) return node.attrs.alt || '';

    const children: string[] = [];
    node.forEach((child) => children.push(text(child, code)));
    if (node.isTextblock) return children.join('');
    return children.join(node.type.name === 'tableRow' ? '\t' : '\n');
  }

  const blocks: string[] = [];
  slice.content.forEach((block) => blocks.push(text(block)));
  return blocks.join(
    slice.content.firstChild?.type.name === 'tableRow' ? '\n' : '\n\n',
  );
}

function preserveListStart(slice: Slice, from: ResolvedPos) {
  // Only left-open ancestors can be missing earlier items. Lists later in the
  // slice already contain their original first item.
  function update(content: Fragment, depth: number): Fragment {
    const node = content.firstChild;
    if (!node || depth > slice.openStart || depth > from.depth) return content;
    const source = from.node(depth);
    if (node.type !== source.type) return content;
    const children = update(node.content, depth + 1);
    const omitted = node.type.name === 'orderedList' ? from.index(depth) : 0;
    const next = omitted
      ? node.type.create(
          { ...node.attrs, start: Number(source.attrs.start) + omitted },
          children,
          node.marks,
        )
      : node.copy(children);
    return content.replaceChild(0, next);
  }
  const content = update(slice.content, 1);
  return content === slice.content
    ? slice
    : new Slice(content, slice.openStart, slice.openEnd);
}

function isWholeListItem(selection: Selection): selection is NodeSelection {
  return (
    selection instanceof NodeSelection &&
    ['listItem', 'taskItem'].includes(selection.node.type.name)
  );
}

function clipboardSlice(selection: Selection, slice: Slice) {
  const { $from } = selection;
  if (isWholeListItem(selection)) {
    const list = $from.parent;
    const attrs =
      list.type.name === 'orderedList'
        ? { ...list.attrs, start: Number(list.attrs.start) + $from.index() }
        : list.attrs;
    const wrapper = list.type.create(attrs, slice.content, list.marks);
    // The item is complete. Leave only its list wrapper open for editor paste.
    return new Slice(Fragment.from(wrapper), 1, 1);
  }
  return preserveListStart(slice, $from);
}

// Contenteditable can introduce NBSP to keep consecutive spaces visible.
// Normalize only copied prose; code and the source document stay unchanged.
function normalizeMarkdownSelection(
  node: JSONContent,
  inCode = false,
): JSONContent {
  const code =
    inCode ||
    node.type === 'codeBlock' ||
    !!node.marks?.some((mark) => mark.type === 'code');
  const children = node.content?.map((child) =>
    normalizeMarkdownSelection(child, code),
  );
  // A slice starting in a sublist can omit the parent's leading paragraph.
  const content =
    node.type === 'listItem' || node.type === 'taskItem'
      ? normalizeListItemContent(children)
      : children;
  return {
    ...node,
    ...(node.text !== undefined
      ? { text: code ? node.text : node.text.replace(/\u00a0/g, ' ') }
      : {}),
    ...(content ? { content } : {}),
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
  const selected = clipboardSlice(editor.state.selection, slice);
  const blocks = (selected.content.toJSON() ?? []) as JSONContent[];
  // A rectangular cell selection can contain rows without their table node.
  const json = normalizeMarkdownSelection({
    type: 'doc',
    content:
      blocks[0]?.type === 'tableRow'
        ? [{ type: 'table', content: blocks }]
        : blocks,
  });
  return editor.markdown.serialize(json);
}

export function copyRichSelection(
  view: EditorView,
  event: ClipboardEvent,
  cut = false,
) {
  if (cut && !view.editable) {
    event.preventDefault();
    return true;
  }
  const { selection, schema } = view.state;
  const data = event.clipboardData;
  if (selection.empty || !data) return false;

  const selected = clipboardSlice(selection, selection.content());
  const { dom, text, slice } = view.serializeForClipboard(selected);
  const context = dom.firstElementChild?.getAttribute('data-pm-slice');
  if (context && !context.endsWith(' []')) {
    // ProseMirror stores elided list/quote ancestors in private metadata.
    // Restore their HTML so editors such as Typora can see the same structure.
    dom.replaceChildren(
      DOMSerializer.fromSchema(schema).serializeFragment(slice.content, {
        document: dom.ownerDocument,
      }),
    );
    dom.firstElementChild?.setAttribute(
      'data-pm-slice',
      `${slice.openStart} ${slice.openEnd} []`,
    );
  }
  if (isWholeListItem(selection))
    dom.firstElementChild?.setAttribute('data-mojian-list-item', 'true');
  for (const item of dom.querySelectorAll('li[data-type="taskItem"]')) {
    const label = item.querySelector(':scope > label');
    const paragraph = item.querySelector(':scope > div > p:first-child');
    const checkbox = label?.querySelector('input[type="checkbox"]');
    // Typora imports the editor's standalone label as an empty list paragraph.
    if (checkbox && paragraph) paragraph.prepend(checkbox);
    label?.remove();
  }
  data.clearData();
  data.setData('text/plain', text);
  data.setData('text/html', dom.innerHTML);
  event.preventDefault();
  if (cut)
    view.dispatch(
      view.state.tr
        .deleteSelection()
        .scrollIntoView()
        .setMeta('uiEvent', 'cut'),
    );
  return true;
}
