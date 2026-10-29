import {
  useEditorState,
  NodeViewWrapper,
  NodeViewContent,
  type NodeViewProps,
} from '@tiptap/react';
import { useEffect, useState, useRef, useMemo } from 'react';
import {
  Copy,
  ChevronDown,
  ChevronUp,
  Download,
  Trash2,
  ImageOff,
  IndentIncrease,
  Minimize2,
} from 'lucide-react';
import { requestMediaPreview } from './mediaPreviewEvents';
import { acquireImageURL, download } from './storage';
import { copyText } from './clipboard';
import { diagram, downloadDiagram } from './mermaid';
import { indentJSON, compactJSON } from './jsonIndentation';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { CodeGutter, CODE_LINE_HEIGHT } from './CodeGutter';
import { codeLines, getCodeFolds, toggleCodeFold } from './codeFolding';
import { CodeLanguagePicker } from './CodeLanguagePicker';
const sourceExtensions: Record<string, string> = {
  javascript: 'js',
  js: 'js',
  typescript: 'ts',
  ts: 'ts',
  jsx: 'jsx',
  tsx: 'tsx',
  python: 'py',
  py: 'py',
  java: 'java',
  html: 'html',
  css: 'css',
  json: 'json',
  yaml: 'yaml',
  yml: 'yml',
  xml: 'xml',
  sql: 'sql',
  bash: 'sh',
  shell: 'sh',
  sh: 'sh',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  go: 'go',
  rust: 'rs',
  rs: 'rs',
  php: 'php',
  ruby: 'rb',
  swift: 'swift',
  kotlin: 'kt',
  markdown: 'md',
  md: 'md',
  mermaid: 'mmd',
};
function signal(message: string) {
  window.dispatchEvent(new CustomEvent('mojian-notice', { detail: message }));
}
export function ImageView({ node, selected, editor, getPos }: NodeViewProps) {
  const editable = useEditorState({
    editor,
    selector: ({ editor }) => editor.isEditable,
  });
  const [widthInput, setWidthInput] = useState(String(node.attrs.percent));
  useEffect(
    () => setWidthInput(String(node.attrs.percent)),
    [node.attrs.percent],
  );
  const [url, setURL] = useState('');
  const [missing, setMissing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const setWidth = (percent: number) => {
    if (!editor.isEditable) return;
    const pos = getPos();
    if (pos === undefined) return;
    editor.commands.command(({ tr }) => {
      const image = tr.doc.nodeAt(pos);
      if (!image) return false;
      tr.setNodeMarkup(pos, undefined, { ...image.attrs, percent });
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      return true;
    });
  };
  useEffect(() => {
    let active = true;
    let release: (() => void) | undefined;
    setURL('');
    setMissing(false);
    acquireImageURL(node.attrs.src)
      .then((image) => {
        if (active) {
          release = image.release;
          setURL(image.url);
          setMissing(!image.url);
        } else image.release();
      })
      .catch(() => {
        if (active) setMissing(true);
      });
    return () => {
      active = false;
      release?.();
    };
  }, [node.attrs.src]);
  const resize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!editor.isEditable) return;
    editor.view.dispatch(closeHistory(editor.state.tr));
    const start = event.clientX;
    const base = box.current!.getBoundingClientRect().width;
    const frame = box.current!.parentElement!;
    const style = getComputedStyle(frame);
    const parent =
      frame.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight);
    let width = node.attrs.percent;
    event.currentTarget.setPointerCapture(event.pointerId);
    const button = event.currentTarget;
    const move = (e: PointerEvent) => {
      width = Math.round(
        Math.max(1, Math.min(200, ((base + e.clientX - start) / parent) * 100)),
      );
      setDragWidth(width);
    };
    const up = () => {
      button.removeEventListener('pointermove', move);
      button.removeEventListener('pointerup', up);
      button.removeEventListener('pointercancel', up);
      setDragWidth(null);
      setWidth(width);
      editor.view.dispatch(closeHistory(editor.state.tr));
      editor.commands.focus();
    };
    button.addEventListener('pointermove', move);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
  };
  const selectImage = (event: React.MouseEvent) => {
    event.preventDefault();
    const pos = getPos();
    if (pos !== undefined) editor.chain().focus().setNodeSelection(pos).run();
  };
  return (
    <NodeViewWrapper
      contentEditable={false}
      className={`image-node ${selected ? 'selected' : ''}`}
      onContextMenu={(e: React.MouseEvent<HTMLDivElement>) => {
        if (window.matchMedia('(pointer: coarse)').matches) return;
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent('mojian-context', {
            detail: { event: e.nativeEvent, editor },
          }),
        );
      }}
    >
      <div className="image-scroll">
        <div
          ref={box}
          className="image-box"
          style={{ width: `${dragWidth ?? node.attrs.percent}%` }}
          contentEditable={false}
          onMouseDown={selectImage}
        >
          {url ? (
            <button
              type="button"
              className="image-preview-trigger"
              aria-label={`预览图片：${node.attrs.alt || '图片'}`}
              title="点击放大预览"
              disabled={missing}
              onClick={(e) => {
                e.stopPropagation();
                requestMediaPreview({
                  kind: 'image',
                  url,
                  title: node.attrs.alt || '图片',
                });
              }}
            >
              <img
                src={url}
                alt={node.attrs.alt || '图片'}
                draggable={false}
                onError={() => setMissing(true)}
              />
            </button>
          ) : (
            <div className="missing-image">
              <ImageOff size={24} />
              {missing ? '本地图片缺失，请重新选择图片' : '图片加载中…'}
              <small>{node.attrs.alt}</small>
            </div>
          )}
          {missing && url && (
            <span className="image-failed">图片无法加载，请检查地址</span>
          )}
          {selected && editable && (
            <button
              className="resize-handle"
              aria-label="拖拽调整图片宽度"
              onPointerDown={resize}
            />
          )}
        </div>
      </div>
      {selected && editable && (
        <div
          className="image-controls"
          contentEditable={false}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span>图片宽度</span>
          <input
            aria-label="图片宽度百分比"
            type="number"
            min="1"
            max="200"
            value={widthInput}
            onChange={(e) => {
              setWidthInput(e.target.value);
              const n = Number(e.target.value);
              if (
                e.target.value !== '' &&
                Number.isInteger(n) &&
                n >= 1 &&
                n <= 200
              )
                setWidth(n);
            }}
            onBlur={() => {
              const n = Number(widthInput);
              if (
                widthInput === '' ||
                !Number.isInteger(n) ||
                n < 1 ||
                n > 200
              ) {
                setWidthInput(String(node.attrs.percent));
                signal('图片宽度请输入 1%–200% 的整数。');
              }
            }}
          />
          %
          <button
            title="删除图片"
            onClick={() => {
              const pos = getPos();
              if (pos !== undefined)
                editor
                  .chain()
                  .focus()
                  .deleteRange({ from: pos, to: pos + node.nodeSize })
                  .run();
            }}
          >
            <Trash2 size={14} />
          </button>
          {node.attrs.src.startsWith('local-image:') && (
            <small>本地资源 · 公众号需重新上传</small>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}
// Only the native editing controls subscribe to editability. Keeping the card
// itself out of this subscription avoids rerendering every code body on lock.
function CodeEditControls({
  editor,
  children,
}: {
  editor: NodeViewProps['editor'];
  children: React.ReactNode;
}) {
  const editable = useEditorState({
    editor,
    selector: ({ editor }) => editor.isEditable,
  });
  return (
    <fieldset className="code-edit-controls" disabled={!editable}>
      {children}
    </fieldset>
  );
}
export function CodeView({
  node,
  updateAttributes,
  editor,
  getPos,
}: NodeViewProps) {
  const [folded, setFolded] = useState(false);
  const [svg, setSVG] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const language = String(node.attrs.language || '')
    .trim()
    .toLowerCase();
  const mermaid = language === 'mermaid';
  const source = node.textContent;
  const { starts } = useMemo(() => codeLines(source), [source]);
  const folds = getCodeFolds(editor.state, getPos() ?? -1);
  const viewport = useRef<HTMLDivElement>(null);
  const [codeHeight, setCodeHeight] = useState<number | null>(null);
  const [codeWindow, setCodeWindow] = useState({ first: 0, height: 360 });
  const windowHeight = useRef(360);
  const resizeCleanup = useRef<() => void>(() => {});
  useEffect(() => () => resizeCleanup.current(), []);
  const [view, setView] = useState<'diagram' | 'code'>('diagram');
  const wrapper = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    if (nearViewport || !wrapper.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, [mermaid, nearViewport]);
  const showCode = !mermaid || view === 'code' || !!error;
  useEffect(() => {
    const element = viewport.current;
    if (!element || folded || !showCode) return;
    const observer = new ResizeObserver(([entry]) => {
      windowHeight.current = entry.contentRect.height;
      setCodeWindow((previous) =>
        previous.height === entry.contentRect.height
          ? previous
          : { ...previous, height: entry.contentRect.height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [folded, showCode]);
  const maximumHeight = Math.max(
    96,
    Math.min(720, Math.floor(window.innerHeight * 0.7)),
  );
  const resizeCode = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!viewport.current || event.button !== 0) return;
    event.preventDefault();
    resizeCleanup.current();
    const element = viewport.current,
      handle = event.currentTarget;
    const start = event.clientY,
      base = element.getBoundingClientRect().height;
    let height = base,
      frame = 0;
    handle.setPointerCapture(event.pointerId);
    const move = (event: PointerEvent) => {
      height = Math.round(
        Math.max(96, Math.min(maximumHeight, base + event.clientY - start)),
      );
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        element.style.height = `${height}px`;
      });
    };
    const cleanup = () => {
      cancelAnimationFrame(frame);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
    };
    const up = () => {
      cleanup();
      resizeCleanup.current = () => {};
      element.style.height = `${height}px`;
      setCodeHeight(height);
    };
    const cancel = () => {
      cleanup();
      resizeCleanup.current = () => {};
      element.style.height = codeHeight === null ? '' : `${codeHeight}px`;
    };
    resizeCleanup.current = cancel;
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
  };
  useEffect(() => {
    const n = ++seq.current;
    setSVG('');
    setError('');
    setBusy(false);
    if (!mermaid || !nearViewport) return;
    if (!source.trim()) {
      setError('请输入 Mermaid 源码以生成图表。');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      diagram(source, controller.signal)
        .then((s) => {
          if (n === seq.current) {
            setSVG(s);
            setError('');
          }
        })
        .catch(() => {
          if (n === seq.current) setError('图形语法有误，请修正源码。');
        })
        .finally(() => {
          if (n === seq.current) setBusy(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
      seq.current++;
    };
  }, [source, mermaid, nearViewport]);
  const downloadSource = () => {
    try {
      const language = String(node.attrs.language || '')
        .trim()
        .toLowerCase();
      const extension = Object.hasOwn(sourceExtensions, language)
        ? sourceExtensions[language]
        : 'txt';
      download(
        new Blob([source], { type: 'text/plain;charset=utf-8' }),
        `墨笺代码.${extension}`,
      );
      signal('已发起源码下载');
    } catch {
      signal('源码下载失败，请检查浏览器是否允许下载后重试。');
    }
  };
  const asyncAction = (action: () => Promise<unknown>) =>
    action().catch((e) => signal(e.message));
  const rewriteJSON = (action: 'format' | 'compact') => {
    if (!editor.isEditable) return;
    const pos = getPos();
    if (pos === undefined) return;
    const current = editor.state.doc.nodeAt(pos);
    if (
      current?.type.name !== 'codeBlock' ||
      String(current.attrs.language || '')
        .trim()
        .toLowerCase() !== 'json'
    )
      return;
    try {
      const formatted =
        action === 'compact'
          ? compactJSON(current.textContent)
          : indentJSON(current.textContent);
      if (formatted.text === current.textContent) {
        signal('内容无需调整');
        return;
      }
      const selection = editor.state.selection;
      const from = pos + 1;
      const to = pos + current.nodeSize - 1;
      const tr = closeHistory(editor.state.tr).insertText(
        formatted.text,
        from,
        to,
      );
      if (
        selection instanceof TextSelection &&
        selection.from >= from &&
        selection.to <= to
      )
        tr.setSelection(
          TextSelection.create(
            tr.doc,
            from +
              formatted.mapOffset(
                selection.anchor - from,
                selection.anchor === selection.from ? 1 : -1,
              ),
            from +
              formatted.mapOffset(
                selection.head - from,
                selection.head === selection.from ? 1 : -1,
              ),
          ),
        );
      editor.view.dispatch(tr);
      editor.view.dispatch(closeHistory(editor.state.tr));
      editor.commands.focus(undefined, { scrollIntoView: false });
      signal(action === 'compact' ? '已压缩 JSON' : '已格式化 JSON');
    } catch (error) {
      signal(
        error instanceof Error ? error.message : '内容未调整，原文已保留。',
      );
    }
  };
  return (
    <NodeViewWrapper
      ref={wrapper}
      className={`code-node ${showCode ? 'code-theme-github' : ''} ${folded ? 'folded' : ''}`}
      data-language={language || undefined}
    >
      <div className="code-header" contentEditable={false}>
        <span className="code-traffic-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <CodeEditControls editor={editor}>
          <CodeLanguagePicker
            language={String(node.attrs.language || '')}
            disabled={false}
            change={(value) => {
              if (editor.isEditable) updateAttributes({ language: value });
            }}
          />
        </CodeEditControls>

        <div>
          {language === 'json' && (
            <CodeEditControls editor={editor}>
              <button
                aria-label="压缩 JSON"
                title="压缩 JSON（仅移除排版空白）"
                disabled={!source.length}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => rewriteJSON('compact')}
              >
                <Minimize2 size={14} />
                <span>压缩</span>
              </button>
              <button
                aria-label="格式化 JSON"
                title="格式化 JSON（2 空格缩进）"
                disabled={!source.length}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => rewriteJSON('format')}
              >
                <IndentIncrease size={14} />
                <span>格式化</span>
              </button>
            </CodeEditControls>
          )}
          {mermaid && (
            <>
              <button
                aria-label="展示图表"
                aria-pressed={view === 'diagram'}
                onClick={() => setView('diagram')}
              >
                图表
              </button>
              <button
                aria-label="展示代码"
                aria-pressed={view === 'code'}
                onClick={() => {
                  setView('code');
                  setFolded(false);
                }}
              >
                代码
              </button>
            </>
          )}
          <button
            aria-label="复制代码"
            title="复制代码"
            onClick={() =>
              asyncAction(async () => {
                await copyText(source);
                signal('已复制原始代码');
              })
            }
          >
            <Copy size={14} />
            <span>复制</span>
          </button>
          <button
            aria-label={folded ? '展开代码' : '折叠代码'}
            title={folded ? '展开代码' : '折叠代码'}
            onClick={() => setFolded((f) => !f)}
          >
            {folded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
          <button
            aria-label="下载源码"
            title="下载源码"
            onMouseDown={(e) => e.preventDefault()}
            onClick={downloadSource}
          >
            <Download size={15} />
          </button>
          {!source && (
            <CodeEditControls editor={editor}>
              <button
                title="删除空代码块"
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              >
                <Trash2 size={15} />
              </button>
            </CodeEditControls>
          )}
        </div>
      </div>
      <div
        ref={viewport}
        className="code-viewport"
        style={{
          display: folded || !showCode ? 'none' : undefined,
          height: codeHeight ?? undefined,
        }}
        onScroll={(event) => {
          const first = Math.floor(
            event.currentTarget.scrollTop / CODE_LINE_HEIGHT,
          );
          setCodeWindow((previous) =>
            previous.first === first
              ? previous
              : { first, height: windowHeight.current },
          );
        }}
      >
        <div className="code-editor-body">
          <CodeGutter
            source={source}
            language={language}
            starts={starts}
            folds={folds}
            nearViewport={nearViewport}
            first={codeWindow.first}
            height={codeWindow.height}
            toggle={(range) => {
              const pos = getPos();
              if (
                pos !== undefined &&
                editor.state.doc.nodeAt(pos)?.textContent === source
              )
                toggleCodeFold(editor, pos, range);
            }}
          />
          <pre>
            <code>
              <NodeViewContent style={{ whiteSpace: 'pre' }} />
            </code>
          </pre>
        </div>
      </div>
      {!folded && showCode && (
        <div
          className="code-height-handle"
          role="separator"
          aria-label="调整代码块高度"
          aria-orientation="horizontal"
          aria-valuemin={96}
          aria-valuemax={maximumHeight}
          aria-valuenow={Math.round(codeWindow.height)}
          tabIndex={0}
          contentEditable={false}
          onPointerDown={resizeCode}
          onDoubleClick={() => setCodeHeight(null)}
          onKeyDown={(event) => {
            const next =
              event.key === 'ArrowDown'
                ? codeWindow.height + 24
                : event.key === 'ArrowUp'
                  ? codeWindow.height - 24
                  : event.key === 'Home'
                    ? 96
                    : event.key === 'End'
                      ? maximumHeight
                      : null;
            if (next === null) return;
            event.preventDefault();
            setCodeHeight(Math.max(96, Math.min(maximumHeight, next)));
          }}
          title="拖动调整高度，双击恢复默认"
        >
          <span />
        </div>
      )}
      {folded && showCode && (
        <div className="fold-summary" contentEditable={false}>
          {source.split('\n').length} 行代码 · 已折叠
        </div>
      )}
      {mermaid && (view === 'diagram' || !!error) && (
        <div
          className="mermaid-editor-preview"
          contentEditable={false}
          onMouseDown={(e) => e.preventDefault()}
        >
          {busy && !svg ? (
            <small>图形生成中…</small>
          ) : error ? (
            <div className="diagram-error">{error}</div>
          ) : (
            <button
              type="button"
              className="diagram media-preview-trigger"
              aria-label="预览 Mermaid 图表"
              title="点击放大预览"
              disabled={!svg}
              onClick={() =>
                requestMediaPreview({
                  kind: 'diagram',
                  svg,
                  title: 'Mermaid 图表',
                })
              }
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
          {!!svg && (
            <div className="diagram-download">
              <button
                onClick={() => asyncAction(() => downloadDiagram(source))}
              >
                <Download size={14} /> PNG
              </button>
              <button
                onClick={() =>
                  asyncAction(() => downloadDiagram(source, 'svg'))
                }
              >
                SVG
              </button>
            </div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}
