import { useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Fragment } from '@tiptap/pm/model';
import { NodeSelection, type EditorState } from '@tiptap/pm/state';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Highlighter,
  Code,
  Eraser,
  Link,
  Quote,
  List,
  ListOrdered,
  ListTodo,
  Table,
  ImagePlus,
  Minus,
  Braces,
  Undo2,
  Redo2,
  MoreHorizontal,
} from 'lucide-react';

function hasSelectedText({ doc, selection }: EditorState) {
  if (selection.empty || selection instanceof NodeSelection) return false;
  let containsText = false;
  for (const { $from, $to } of selection.ranges) {
    if ($from.pos === $to.pos) continue;
    doc.nodesBetween($from.pos, $to.pos, (node) => {
      containsText ||= node.isText;
      return !containsText;
    });
    if (containsText) return true;
  }
  return false;
}

function clearTextFormatting(editor: Editor) {
  if (!editor.isEditable || !hasSelectedText(editor.state)) return;
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const { doc, selection } = tr;
      for (const { $from, $to } of selection.ranges) {
        if ($from.pos === $to.pos) continue;
        doc.nodesBetween($from.pos, $to.pos, (block, pos) => {
          if (!block.isTextblock) return true;
          const start = pos + 1;
          const from = Math.max($from.pos, start);
          const to = Math.min($to.pos, pos + block.nodeSize - 1);
          if (from >= to) return false;
          const original = block.content.cut(from - start, to - start);
          const nodes = original.content.map((node) =>
            node.isText && node.marks.length ? node.mark([]) : node,
          );
          const plain = Fragment.fromArray(nodes);
          if (!plain.eq(original)) tr.replaceWith(from, to, plain);
          return false;
        });
      }
      if (tr.docChanged) {
        tr.setSelection(selection.getBookmark().resolve(tr.doc));
        closeHistory(tr);
      }
      return true;
    })
    .run();
}

export type Operation = 'link' | 'image' | 'table' | 'more';
export function Toolbar({
  editor,
  onOpen,
  source,
  readOnly,
  onCopySource,
}: {
  editor: Editor | null;
  onOpen: (op: Operation) => void;
  source: boolean;
  readOnly: boolean;
  onCopySource: () => void;
}) {
  const formatState = useEditorState({
    editor,
    selector: ({ editor: selected }) =>
      selected
        ? {
            heading: selected.isActive('heading')
              ? selected.getAttributes('heading').level
              : 0,
            bold: selected.isActive('bold'),
            italic: selected.isActive('italic'),
            underline: selected.isActive('underline'),
            strike: selected.isActive('strike'),
            code: selected.isActive('code'),
            quote: selected.isActive('blockquote'),
            bullet: selected.isActive('bulletList'),
            ordered: selected.isActive('orderedList'),
            task: selected.isActive('taskList'),
            block: selected.isActive('codeBlock'),
            highlight: selected.isActive('highlight'),
            hasSelectedText: hasSelectedText(selected.state),
          }
        : null,
  });
  if (source)
    return (
      <div className="toolbar source-tools">
        <span>原始 Markdown · 不自动改写输入</span>
        <button onClick={onCopySource}>
          <Code size={15} />
          复制 Markdown 源码
        </button>
      </div>
    );
  const action = (fn: (e: Editor) => unknown) => () => {
    if (editor && !readOnly) fn(editor);
  };
  const button = (
    title: string,
    icon: React.ReactNode,
    fn: () => void,
    active?: boolean,
    disabled = false,
  ) => (
    <button
      disabled={disabled || (readOnly && title !== '更多操作')}
      key={title}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={active ? 'active' : ''}
      onMouseDown={(e) => e.preventDefault()}
      onClick={fn}
    >
      {icon}
    </button>
  );
  return (
    <div className="toolbar" role="toolbar" aria-label="正文格式">
      <select
        disabled={readOnly}
        aria-label="标题级别"
        value={
          editor?.isActive('heading')
            ? String(editor.getAttributes('heading').level)
            : '0'
        }
        onChange={(e) => {
          const level = Number(e.target.value);
          if (editor) {
            if (!level) editor.chain().focus().setParagraph().run();
            else
              editor
                .chain()
                .focus()
                .toggleHeading({ level: level as 1 | 2 | 3 })
                .run();
          }
        }}
      >
        <option value="0">正文</option>
        <option value="1">H1</option>
        <option value="2">H2</option>
        <option value="3">H3</option>
      </select>
      <i />
      {button(
        '粗体',
        <Bold size={17} />,
        action((e) => e.chain().focus().toggleBold().run()),
        editor?.isActive('bold'),
      )}
      {button(
        '斜体',
        <Italic size={17} />,
        action((e) => e.chain().focus().toggleItalic().run()),
        editor?.isActive('italic'),
      )}
      {button(
        '下划线',
        <Underline size={17} />,
        action((e) => e.chain().focus().toggleUnderline().run()),
        editor?.isActive('underline'),
      )}
      {button(
        '删除线',
        <Strikethrough size={17} />,
        action((e) => e.chain().focus().toggleStrike().run()),
        editor?.isActive('strike'),
      )}
      {button(
        '高亮',
        <Highlighter size={17} />,
        action((e) => e.chain().focus().toggleHighlight().run()),
        editor?.isActive('highlight'),
      )}
      {button(
        '行内代码',
        <Code size={17} />,
        action((e) => e.chain().focus().toggleCode().run()),
        editor?.isActive('code'),
      )}
      {button(
        '清除格式',
        <Eraser size={17} />,
        action(clearTextFormatting),
        undefined,
        !formatState?.hasSelectedText,
      )}
      {button('插入链接', <Link size={17} />, () => onOpen('link'))}
      <i />
      {button(
        '引用',
        <Quote size={17} />,
        action((e) => e.chain().focus().toggleBlockquote().run()),
        editor?.isActive('blockquote'),
      )}
      {button(
        '无序列表',
        <List size={17} />,
        action((e) => e.chain().focus().toggleBulletList().run()),
        editor?.isActive('bulletList'),
      )}
      {button(
        '有序列表',
        <ListOrdered size={17} />,
        action((e) => e.chain().focus().toggleOrderedList().run()),
        editor?.isActive('orderedList'),
      )}
      {button(
        '任务列表',
        <ListTodo size={17} />,
        action((e) => e.chain().focus().toggleTaskList().run()),
        editor?.isActive('taskList'),
      )}
      <i />
      {button('插入表格', <Table size={17} />, () => onOpen('table'))}
      {button('插入图片', <ImagePlus size={17} />, () => onOpen('image'))}
      {button(
        '代码块',
        <Braces size={17} />,
        action((e) => e.chain().focus().toggleCodeBlock().run()),
      )}
      {button(
        '分隔线',
        <Minus size={17} />,
        action((e) => e.chain().focus().setHorizontalRule().run()),
      )}
      <i />
      {button(
        '撤销',
        <Undo2 size={16} />,
        action((e) => e.chain().focus().undo().run()),
      )}
      {button(
        '重做',
        <Redo2 size={16} />,
        action((e) => e.chain().focus().redo().run()),
      )}
      <span className="toolbar-fill" />
      {button('更多操作', <MoreHorizontal size={18} />, () => onOpen('more'))}
    </div>
  );
}
