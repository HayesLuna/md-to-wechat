import { useEditor, EditorContent } from '@tiptap/react';
import { Markdown } from '@tiptap/markdown';
import {
  parseHighlightMarkdown,
  serializeHighlightMarkdown,
} from './highlight';
import { ArticleTableKit, ArticleTaskList } from './markdownBlocks';
import {
  lowlight,
  ensureSyntax,
  syntaxRevision,
  onSyntaxReady,
} from './syntax';
import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef } from 'react';
import {
  Extension,
  selectionToInsertionEnd,
  type Editor,
  type EditorOptions,
  type JSONContent,
} from '@tiptap/core';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import { copyImage } from './clipboard';
import { closeHistory } from '@tiptap/pm/history';
import { Slice } from '@tiptap/pm/model';
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
import { safeURL } from './outputUtils';
import { markdownSelection, copyTaskMarkdown } from './markdownClipboard';
import {
  shouldParseMarkdownPaste,
  normalizeTaskClipboardHTML,
  centerUnalignedPastedTables,
  normalizePastedTableHTML,
} from './markdownPaste';
import { codeHighlightKey } from './codeHighlight';
import { BlockBoundaries } from './blockBoundaries';
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
      tr.setMeta('mojian-load-document', true);
      return true;
    })
    .setContent(json, { emitUpdate: false })
    .run();
}
export function EditorPane({
  initial,
  readOnly,
  onReady,
  onChange,
  onDirty,
  onSelection,
  onContext,
  onPasteImage,
}: {
  initial: string;
  readOnly: boolean;
  onReady: (e: Editor) => void;
  onChange: (s: string) => void;
  onDirty: () => void;
  onSelection: () => void;
  onContext: (event: MouseEvent, editor: Editor) => boolean;
  onPasteImage: (file: File | null, image?: JSONContent) => void;
}) {
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
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
        gapcursor: false,
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
      ArticleTableKit.configure({
        table: {
          resizable: false,
          renderWrapper: true,
          allowTableNodeSelection: true,
        },
      }),
      ArticleTaskList,
      StructuredTaskItem.configure({ nested: true }),
      EditingRules,
      BlockBoundaries,
      Extension.create({
        name: 'readOnlyGuard',
        addProseMirrorPlugins() {
          return [
            new Plugin({
              filterTransaction: (tr) =>
                !tr.docChanged ||
                !readOnlyRef.current ||
                tr.getMeta('mojian-load-document') === true,
            }),
          ];
        },
      }),
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
        copy: (view, event) => {
          const editor = editorRef.current;
          const selection = editor?.state.selection;
          if (
            !editor ||
            !(selection instanceof NodeSelection) ||
            selection.node.type.name !== 'image' ||
            !event.clipboardData
          )
            return copyTaskMarkdown(editor, event);
          // Always finish the native copy, including when Async Clipboard is
          // unavailable or denied. PNG is an optional enhancement of this copy.
          const { dom, text } = view.serializeForClipboard(selection.content());
          dom.querySelector('img')?.setAttribute('data-mojian-image', 'true');
          event.clipboardData.clearData();
          event.clipboardData.setData('text/plain', text);
          event.clipboardData.setData('text/html', dom.innerHTML);
          event.preventDefault();
          const node = view.nodeDOM(selection.from);
          const image =
            node instanceof HTMLElement ? node.querySelector('img') : null;
          if (
            image?.complete &&
            image.naturalWidth &&
            typeof navigator.clipboard?.write === 'function' &&
            typeof window.ClipboardItem !== 'undefined'
          )
            void copyImage(image, text, { nativeCopied: true }).catch(() => {
              // The native text/HTML copy remains available if PNG writing fails.
            });
          return true;
        },
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
        if (readOnlyRef.current) return true;
        const literal = plainPaste.current;
        plainPaste.current = false;
        const data = event.clipboardData;
        const editor = editorRef.current;
        const text = data?.getData('text/plain') || '';
        const html = data?.getData('text/html') || '';
        const file = Array.from(data?.files || []).find((f) =>
          f.type.startsWith('image/'),
        );
        // Our image clipboard also contains PNG pixels. Prefer its Markdown
        // inside the editor to retain the asset reference and configured width.
        if (
          editor &&
          !literal &&
          !editor.isActive('codeBlock') &&
          !editor.isActive('code') &&
          html.includes('data-mojian-image') &&
          new DOMParser()
            .parseFromString(html, 'text/html')
            .querySelector('img[data-mojian-image="true"]')
        ) {
          const parsed = safeDocument(editor, text);
          if (
            parsed.content?.length === 1 &&
            parsed.content[0].type === 'image'
          ) {
            event.preventDefault();
            props.current.onPasteImage(file ?? null, parsed.content[0]);
            return true;
          }
        }
        if (file) {
          event.preventDefault();
          props.current.onPasteImage(file);
          return true;
        }
        if (
          !editor ||
          literal ||
          editor.isActive('codeBlock') ||
          editor.isActive('code') ||
          !shouldParseMarkdownPaste(text, html)
        )
          return false;
        const { selection } = editor.state;
        const { $from, $to } = selection;
        const prefix = $from.parent.textBetween(
          0,
          $from.parentOffset,
          '',
          '\ufffc',
        );
        // Input rules only see typing. A paste can supply the space/content
        // after typed hashes, so parse that paragraph prefix together with it.
        if (
          $from.sameParent($to) &&
          $from.parent.type.name === 'paragraph' &&
          /^#{1,6}[ \t]*$/.test(prefix) &&
          /^#{1,6}[ \t]+\S/.test(prefix + text) &&
          $from
            .node(-1)
            .canReplaceWith(
              $from.index(-1),
              $from.indexAfter(-1),
              editor.schema.nodes.heading,
            )
        ) {
          const heading = centerUnalignedPastedTables(
            safeDocument(editor, prefix + text),
          );
          const first = heading.content?.[0];
          if (
            first?.type === 'heading' &&
            editor
              .chain()
              .command(({ tr }) => {
                const content = editor.schema.nodeFromJSON(heading).content;
                closeHistory(tr);
                tr.replaceRange(
                  $from.start(),
                  selection.to,
                  new Slice(
                    content,
                    1,
                    content.lastChild?.isTextblock &&
                      !content.lastChild.type.spec.code
                      ? 1
                      : 0,
                  ),
                );
                selectionToInsertionEnd(tr, tr.steps.length - 1, -1);
                tr.setBlockType(
                  $from.start(),
                  $from.start(),
                  editor.schema.nodes.heading,
                  first.attrs,
                );
                return true;
              })
              .run()
          ) {
            event.preventDefault();
            return true;
          }
        }
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
    // setContent with emitUpdate:false is used when returning from source mode.
    // Transactions still report the replaced document and need language loading.
    const documentChanged = ({
      transaction,
    }: {
      transaction: { docChanged: boolean };
    }) => {
      if (transaction.docChanged) scheduleLoad();
    };
    editor.on('transaction', documentChanged);
    scheduleLoad();
    return () => {
      active = false;
      unsubscribe();
      clearTimeout(timer);
      cancelEditorMarkdown(editor);
      editor.off('update', scheduleLoad);
      editor.off('transaction', documentChanged);
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
