import { useEditor, EditorContent } from '@tiptap/react';
import { Markdown } from '@tiptap/markdown';
import {
  parseHighlightMarkdown,
  serializeHighlightMarkdown,
} from './highlight';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import {
  lowlight,
  ensureSyntax,
  syntaxRevision,
  onSyntaxReady,
} from './syntax';
import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef } from 'react';
import type { Editor, EditorOptions, JSONContent } from '@tiptap/core';
import {
  SizedImage,
  SmartCode,
  CleanParagraph,
  CleanHeading,
  EditingRules,
  StructuredListItem,
  StructuredTaskItem,
  MarkdownStarterKit,
} from './editorExtensions';
import { TyporaHighlight, HighlightLiteral } from './sourceHighlight';
import { safeURL } from './output';
import { markdownSelection, copyTaskMarkdown } from './markdownClipboard';
import {
  shouldParseMarkdownPaste,
  normalizeTaskClipboardHTML,
  centerUnalignedPastedTables,
  normalizePastedTableHTML,
} from './markdownPaste';
import { codeHighlightKey } from './codeHighlight';
import { cancelEditorMarkdown, scheduleEditorMarkdown } from './editorMarkdown';

const HighlightMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    this.parent?.(event);
    const manager = this.editor.markdown!;
    const parse = manager.parse.bind(manager);
    manager.parse = (markdown) => parseHighlightMarkdown(markdown, parse);
    const serialize = manager.serialize.bind(manager);
    manager.serialize = (document) =>
      serializeHighlightMarkdown(document, serialize);
  },
});
function modifiedLink(event: MouseEvent, dom: HTMLElement) {
  if (event.button !== 0 || (!event.ctrlKey && !event.metaKey)) return null;
  const link =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>('a[href]')
      : null;
  return link && dom.contains(link) ? link : null;
}
export function safeDocument(editor: Editor, markdown: string) {
  const json = editor.markdown!.parse(markdown);
  function clean(n: JSONContent) {
    if (n.type === 'listItem' && n.content?.[0]?.type !== 'paragraph')
      n.content = [{ type: 'paragraph' }, ...(n.content || [])];
    if (n.marks)
      n.marks = n.marks.filter(
        (m) => m.type !== 'link' || safeURL(m.attrs?.href || ''),
      );
    if (
      n.type === 'image' &&
      !/^https?:\/\/|^local-image:[a-zA-Z0-9-]+$/.test(n.attrs?.src || '')
    ) {
      n.attrs = { ...n.attrs, src: '', alt: '不安全的图片地址已阻止' };
    }
    n.content?.forEach(clean);
  }
  clean(json);
  return json;
}
export function replaceDocument(editor: Editor, markdown: string) {
  const json = safeDocument(editor, markdown);
  cancelEditorMarkdown(editor);
  editor
    .chain()
    .command(({ tr }) => {
      tr.setMeta('addToHistory', false);
      return true;
    })
    .setContent(json, { emitUpdate: false })
    .run();
}
export function EditorPane({
  initial,
  onReady,
  onChange,
  onDirty,
  onSelection,
  onContext,
  onPasteImage,
}: {
  initial: string;
  onReady: (e: Editor) => void;
  onChange: (s: string) => void;
  onDirty: () => void;
  onSelection: () => void;
  onContext: (event: MouseEvent, editor: Editor) => boolean;
  onPasteImage: (file: File) => void;
}) {
  const props = useRef({
    onChange,
    onDirty,
    onSelection,
    onContext,
    onPasteImage,
  });
  props.current = { onChange, onDirty, onSelection, onContext, onPasteImage };
  const editorRef = useRef<Editor | null>(null);
  const plainPaste = useRef(false);
  const extensions = useMemo(
    () => [
      MarkdownStarterKit.configure({
        paragraph: false,
        heading: false,
        codeBlock: false,
        listItem: false,
        link: {
          openOnClick: false,
          autolink: false,
          enableClickSelection: true,
          isAllowedUri: (url) => safeURL(url),
          HTMLAttributes: { title: 'Ctrl / Cmd＋点击，在新标签页打开' },
        },
      }),
      StructuredListItem,
      TyporaHighlight,
      HighlightLiteral,
      HighlightMarkdown.configure({
        markedOptions: { gfm: true, breaks: false },
      }),
      CleanParagraph,
      CleanHeading,
      SizedImage,
      SmartCode.configure({
        lowlight,
        defaultLanguage: null,
      }),
      TableKit.configure({
        table: {
          resizable: false,
          renderWrapper: true,
          allowTableNodeSelection: true,
        },
      }),
      TaskList,
      StructuredTaskItem.configure({ nested: true }),
      EditingRules,
    ],
    [],
  );
  // A new editorProps object makes Tiptap setOptions/updateState on every
  // parent render. Handlers read refs, so the view options can stay stable.
  const editorProps = useMemo<NonNullable<EditorOptions['editorProps']>>(
    () => ({
      clipboardTextSerializer: (slice) =>
        markdownSelection(editorRef.current, slice),
      attributes: {
        class: 'article-editor',
        spellcheck: 'false',
        'aria-label': '所见即所得正文',
      },
      transformPastedHTML: (html) =>
        DOMPurify.sanitize(
          normalizePastedTableHTML(normalizeTaskClipboardHTML(html)),
          {
            FORBID_TAGS: ['svg', 'script', 'style', 'iframe'],
            FORBID_ATTR: ['style'],
          },
        ),
      handleDOMEvents: {
        copy: (_view, event) => copyTaskMarkdown(editorRef.current, event),
        cut: (_view, event) => copyTaskMarkdown(editorRef.current, event, true),
        keydown: (_view, event) => {
          plainPaste.current = !!(
            (event.ctrlKey || event.metaKey) &&
            event.shiftKey &&
            event.key.toLowerCase() === 'v'
          );
          return Boolean(event.isComposing || event.keyCode === 229);
        },
        contextmenu: (_view, event) =>
          editorRef.current
            ? props.current.onContext(event, editorRef.current)
            : false,
        mousedown: (view, event) => {
          if (!modifiedLink(event, view.dom)) return false;
          event.preventDefault();
          return true;
        },
        click: (view, event) => {
          const link = modifiedLink(event, view.dom);
          if (!link) return false;
          event.preventDefault();
          if (safeURL(link.getAttribute('href') || ''))
            window.open(link.href, '_blank', 'noopener,noreferrer');
          return true;
        },
      },
      handlePaste: (_view, event) => {
        const literal = plainPaste.current;
        plainPaste.current = false;
        const data = event.clipboardData;
        const file = Array.from(data?.files || []).find((f) =>
          f.type.startsWith('image/'),
        );
        if (file) {
          event.preventDefault();
          props.current.onPasteImage(file);
          return true;
        }
        const editor = editorRef.current;
        const text = data?.getData('text/plain') || '';
        const html = data?.getData('text/html') || '';
        if (
          !editor ||
          literal ||
          editor.isActive('codeBlock') ||
          editor.isActive('code') ||
          !shouldParseMarkdownPaste(text, html)
        )
          return false;
        const parsed = centerUnalignedPastedTables(safeDocument(editor, text));
        if (!editor.commands.insertContent(parsed.content || [])) return false;
        event.preventDefault();
        return true;
      },
    }),
    [],
  );
  const editor = useEditor({
    extensions,
    // Populate once through safeDocument below, rather than parsing and building
    // the entire document twice during startup and draft switches.
    content: '',
    contentType: 'markdown',
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps,
    onUpdate: ({ editor }) => {
      props.current.onDirty();
      scheduleEditorMarkdown(editor, (text) => props.current.onChange(text));
    },
    onSelectionUpdate: () => props.current.onSelection(),
  });
  useEffect(() => {
    if (!editor) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let appliedRevision = syntaxRevision;
    const refresh = () => {
      if (!active || editor.isDestroyed || appliedRevision === syntaxRevision)
        return;
      appliedRevision = syntaxRevision;
      // Refresh decorations without changing text, selection or undo history.
      editor.view.dispatch(editor.state.tr.setMeta(codeHighlightKey, true));
    };
    const unsubscribe = onSyntaxReady(refresh);
    const load = () => {
      const languages = new Set<string>();
      editor.state.doc.descendants((node) => {
        if (
          node.type.name === 'codeBlock' &&
          node.attrs.language &&
          node.attrs.language !== 'mermaid'
        )
          languages.add(node.attrs.language);
        return !node.isTextblock;
      });
      if (!languages.size) return;
      void Promise.all(Array.from(languages, ensureSyntax))
        .then(refresh)
        .catch(() => {});
    };
    const scheduleLoad = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 150);
    };
    editor.on('update', scheduleLoad);
    scheduleLoad();
    return () => {
      active = false;
      unsubscribe();
      clearTimeout(timer);
      cancelEditorMarkdown(editor);
      editor.off('update', scheduleLoad);
    };
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    let active = true;
    // React NodeViews may flush synchronously. Populate after the effect has
    // finished, so loading code/image blocks does not flush during a lifecycle.
    queueMicrotask(() => {
      if (!active || editor.isDestroyed) return;
      editorRef.current = editor;
      replaceDocument(editor, initial);
      onReady(editor);
    });
    return () => {
      active = false;
    };
  }, [editor]);
  return <EditorContent editor={editor} />;
}
