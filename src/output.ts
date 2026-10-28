import type { CodeSource } from './codeOutput';
import { githubHighlightStyle } from './githubCodeTheme';
import { ensureSyntax } from './syntax';
import DOMPurify from 'dompurify';
import { acquireImageURL } from './storage';
import { diagram } from './mermaid';
import { DEFAULT_SETTINGS, type Settings } from './sample';
import { codeCardRenderer, addCodeDecorations } from './codeOutput';
import { workBudget } from './workBudget';
import { outputKey } from './outputUtils';
import { parseArticleAsync } from './articleParserClient';
export type Asset = {
  kind: 'image' | 'diagram';
  label: string;
  src?: string;
  source?: string;
  missing?: boolean;
};
export type Output = {
  html: string;
  previewHTML: string;
  previewShell: string;
  previewBlocks: string[];
  previewReady: boolean;
  text: string;
  assets: Asset[];
  errors: string[];
  key: string;
  dispose: () => void;
};
export function escapeHTML(value: string) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}
export { headings } from './headings';
export { outputKey, safeURL, widthFromTitle } from './outputUtils';
export { copyRich, copyText } from './clipboard';

async function inlineStyles(
  root: HTMLElement,
  s: Settings,
  checkpoint: ReturnType<typeof workBudget>,
) {
  const color = /^#[0-9a-f]{6}$/i.test(s.color)
    ? s.color
    : DEFAULT_SETTINGS.color;
  const headingStyle = `color:${color};border-bottom:1px solid ${color};padding-bottom:8px;`;
  const dark = s.codeTheme === 'dark';
  root.setAttribute(
    'style',
    `font-family:${s.theme === 'elegant' ? 'Georgia,SimSun,serif' : '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif'};font-size:${s.fontSize}px;line-height:${Number((s.fontSize * s.lineHeight).toFixed(2))}px;color:#303030;word-wrap:break-word;`,
  );
  const rules: Record<string, string> = {
    p: 'margin:0 0 20px;line-height:inherit;',
    h1: `font-size:26px;line-height:1.45;font-weight:700;margin:8px 0 24px;${headingStyle}`,
    h2: `font-size:22px;line-height:1.5;font-weight:700;margin:30px 0 18px;${headingStyle}`,
    h3: `font-size:19px;line-height:1.5;margin:24px 0 14px;${headingStyle}`,
    h4: `font-size:17px;line-height:1.5;font-weight:700;margin:22px 0 12px;${headingStyle}`,
    h5: `font-size:16px;line-height:1.5;font-weight:700;margin:20px 0 12px;${headingStyle}`,
    h6: `font-size:16px;line-height:1.5;font-weight:700;margin:20px 0 12px;${headingStyle}`,
    blockquote: `margin:20px 0;padding:14px 18px;border-left:3px solid ${color};background:#f6f6f5;color:#686868;`,
    ul: 'padding-left:24px;margin:14px 0 20px;',
    ol: 'padding-left:26px;margin:14px 0 20px;',
    li: 'margin:6px 0;line-height:inherit;',
    strong: 'font-weight:700;',
    mark: 'background-color:#fff3a3;color:inherit;',
    em: 'font-style:italic;font-synthesis:style;',
    s: 'text-decoration:line-through;',
    a: `color:${color};text-decoration:underline;`,
    hr: 'border:0;border-top:1px solid #ddd;margin:30px 0;',
    table:
      'border-collapse:collapse;width:100%;font-size:14px;margin:0;table-layout:fixed;box-sizing:border-box;',
    th: 'border:1px solid #ddd;background:#f2f2f2;font-weight:600;padding:9px 12px;vertical-align:top;white-space:normal;overflow-wrap:anywhere;word-break:break-word;',
    td: 'border:1px solid #ddd;padding:9px 12px;vertical-align:top;white-space:normal;overflow-wrap:anywhere;word-break:break-word;',
    pre: `margin:20px 0;padding:16px;background:${dark ? '#25272b' : '#f5f5f5'};color:${dark ? '#e2e4e8' : '#373a40'};font-size:13px;line-height:1.7;white-space:pre;overflow-x:auto;border-radius:3px;font-family:Consolas,Menlo,monospace;tab-size:4;`,
    code: 'font-family:Consolas,Menlo,monospace;font-size:0.88em;background:#f0f0ef;padding:2px 4px;border-radius:3px;',
    img: 'height:auto;max-width:100%;display:block;margin:20px auto;',
  };
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    const pause = checkpoint();
    if (pause) await pause;
    if (el.namespaceURI === 'http://www.w3.org/2000/svg') continue;
    const existingAlign = el.style.textAlign;
    const imageWidth =
      el.tagName === 'IMG' ? el.getAttribute('data-width') : null;
    el.removeAttribute('style');
    const style = rules[el.tagName.toLowerCase()];
    if (style) el.setAttribute('style', style);
    if (existingAlign && ['left', 'right', 'center'].includes(existingAlign))
      el.style.textAlign = existingAlign;
    if (imageWidth) {
      el.style.width = imageWidth + '%';
      el.removeAttribute('data-width');
    }
    if (el.matches('pre code'))
      el.setAttribute(
        'style',
        'display:block;white-space:pre;font-family:inherit;font-size:inherit;background:transparent;padding:0;color:inherit;',
      );
    if (el.tagName === 'SPAN' && el.className.includes('hljs')) {
      const c = el.className;
      const palette = dark
        ? ['#a5d6ff', '#ff7b72', '#a5d6ff', '#d2a8ff', '#79c0ff', '#8b949e']
        : ['#a6493d', '#9a3754', '#31599c', '#7650a8', '#80572a', '#83888f'];
      const index = /comment|quote/.test(c)
        ? 5
        : /keyword|selector|literal/.test(c)
          ? 1
          : /string|regexp/.test(c)
            ? 0
            : /number|attr/.test(c)
              ? 2
              : /title|function/.test(c)
                ? 3
                : 4;
      el.setAttribute(
        'style',
        dark
          ? `color:${palette[index]};${index === 5 ? 'font-style:italic;' : ''}`
          : githubHighlightStyle(c),
      );
    }
    if (!el.className.startsWith('mermaid-preview-'))
      el.removeAttribute('class');
  }
  // Resolve typography before export: WeChat can normalize unitless/inherited
  // line-height differently during paste. Every text element carries pixel values,
  // including inline marks and highlight tokens, without changing source Markdown.
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    const pause = checkpoint();
    if (pause) await pause;
    if (
      el.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
      el.matches('img,hr')
    )
      continue;
    const parent = el.parentElement!;
    const parentSize = parseFloat(parent.style.fontSize) || s.fontSize;
    const parentLine =
      parseFloat(parent.style.lineHeight) || s.fontSize * s.lineHeight;
    const sizeValue = el.style.fontSize;
    const size = sizeValue.endsWith('px')
      ? parseFloat(sizeValue)
      : sizeValue.endsWith('em')
        ? parentSize * parseFloat(sizeValue)
        : parentSize;
    const lineValue = el.style.lineHeight;
    const line = lineValue.endsWith('px')
      ? parseFloat(lineValue)
      : lineValue && lineValue !== 'inherit' && lineValue !== 'normal'
        ? size * parseFloat(lineValue)
        : parentLine;
    el.style.fontSize = Number(size.toFixed(2)) + 'px';
    el.style.lineHeight = Number(Math.max(size, line).toFixed(2)) + 'px';
    if (el.matches('strong,em,s,a,code,span') && !el.matches('pre code'))
      el.style.setProperty('display', 'inline', 'important');
  }
  // Empty structural parents represent indentation of a first list item.
  for (const li of root.querySelectorAll<HTMLElement>('li')) {
    const pause = checkpoint();
    if (pause) await pause;
    const nested = Array.from(li.children).find((child) =>
      ['UL', 'OL'].includes(child.tagName),
    );
    if (!nested) continue;
    const surrounding = Array.from(li.childNodes).filter(
      (child) => child !== nested,
    );
    if (
      surrounding.every(
        (child) =>
          /^(?:[☐☑]|\[[ xX]\])?\s*$/.test(child.textContent || '') &&
          (!(child instanceof Element) || child.tagName === 'P'),
      )
    ) {
      li.style.listStyle = 'none';
      surrounding.forEach((child) => child.remove());
    }
  }
  // Only remove a single paragraph from genuinely simple list items.
  for (const li of root.querySelectorAll('li')) {
    const pause = checkpoint();
    if (pause) await pause;
    if (li.children.length === 1 && li.firstElementChild?.tagName === 'P')
      li.firstElementChild.replaceWith(...li.firstElementChild.childNodes);
  }
  // Paste importers can normalize bare link/code text differently from adjacent
  // styled spans. Give their text the same inline leaf structure; keep safe hrefs
  // and never touch block code cards or introduce line breaks.
  for (const mark of root.querySelectorAll<HTMLElement>('a,code')) {
    const pause = checkpoint();
    if (pause) await pause;
    if (mark.closest('pre')) continue;
    for (const node of Array.from(mark.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const leaf = document.createElement('span');
      leaf.style.fontSize = mark.style.fontSize;
      leaf.style.lineHeight = mark.style.lineHeight;
      leaf.style.setProperty('display', 'inline', 'important');
      node.replaceWith(leaf);
      leaf.appendChild(node);
    }
  }
  // WeChat's older overlap checker miscounts mixed direct text + inline marks.
  // Keep rich text inline, but give direct text its own leaf span in mixed blocks.
  // Traverse DOM nodes (not Markdown) so nested lists and code stay intact.
  for (const block of root.querySelectorAll<HTMLElement>(
    'p,li,h1,h2,h3,h4,h5,h6,blockquote,th,td',
  )) {
    const pause = checkpoint();
    if (pause) await pause;
    if (!block.children.length) continue;
    for (const node of Array.from(block.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim())
        continue;
      const leaf = document.createElement('span');
      leaf.style.fontSize = block.style.fontSize;
      leaf.style.lineHeight = block.style.lineHeight;
      leaf.style.setProperty('display', 'inline', 'important');
      node.replaceWith(leaf);
      leaf.appendChild(node);
    }
  }

  // Enlarged images scroll locally instead of widening or clipping the article.
  for (const image of root.querySelectorAll<HTMLImageElement>('img')) {
    const pause = checkpoint();
    if (pause) await pause;
    if (parseFloat(image.style.width) <= 100) continue;
    image.style.maxWidth = 'none';
    image.setAttribute('data-ignore-width', '');
    const frame = document.createElement('span');
    frame.setAttribute('data-image-scroll', '');
    frame.setAttribute('data-ignore-width', '');
    frame.setAttribute(
      'style',
      'display:block;width:100%;max-width:100%;overflow-x:auto;box-sizing:border-box;-webkit-overflow-scrolling:touch;',
    );
    image.replaceWith(frame);
    frame.append(image);
  }
  // Keep a real table layout in both preview and pasted HTML. Many columns may
  // deliberately scroll, but the article itself must stay within its viewport.
  for (const table of root.querySelectorAll<HTMLTableElement>('table')) {
    const pause = checkpoint();
    if (pause) await pause;
    const columns = Math.max(
      1,
      ...Array.from(table.rows, (row) => row.cells.length),
    );
    table.style.minWidth = columns * 80 + 'px';
    // The official checker can detach a table as its own paragraph, so retain the
    // documented exemption for intentional scrolling on the table as well.
    table.setAttribute('data-ignore-width', '');
    const scroll = document.createElement('div');
    scroll.setAttribute('data-table-scroll', '');
    scroll.setAttribute('data-ignore-width', '');
    scroll.setAttribute(
      'style',
      `display:block;width:100%;max-width:100%;min-width:0;margin:20px 0;overflow-x:auto;box-sizing:border-box;-webkit-overflow-scrolling:touch;font-size:${table.style.fontSize};line-height:${table.style.lineHeight};`,
    );
    table.replaceWith(scroll);
    scroll.append(table);
  }

  // The quote padding already provides bottom space; avoid stacking its last
  // child's normal paragraph/list/quote margin onto that padding.
  for (const quote of root.querySelectorAll('blockquote')) {
    const pause = checkpoint();
    if (pause) await pause;
    const last = quote.lastElementChild as HTMLElement | null;
    if (last) last.style.marginBottom = '0';
  }
}
export function readableText(
  root: Node,
  codeSources: CodeSource[] = [],
): string {
  function walk(node: Node, depth = 0): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (!(node instanceof Element))
      return Array.from(node.childNodes, (n) => walk(n, depth)).join('');
    const tag = node.tagName;
    if (tag === 'BR') return '\n';
    if (node.hasAttribute('data-code-block'))
      return (
        '\n' +
        (codeSources[Number(node.getAttribute('data-code-index'))]?.text ||
          node.querySelector('code')?.textContent ||
          '') +
        '\n\n'
      );
    if (tag === 'PRE') return '\n' + (node.textContent || '') + '\n\n';
    if (tag === 'IMG')
      return '[图片：' + (node.getAttribute('alt') || '图片') + ']\n';
    if (tag === 'TR')
      return (
        Array.from(node.children, (n) =>
          walk(n, depth).replace(/^\n+|\n+$/g, ''),
        ).join('\t') + '\n'
      );
    if (tag === 'UL' || tag === 'OL') {
      const start = Number(node.getAttribute('start') || 1);
      return (
        '\n' +
        Array.from(node.children, (li, i) => {
          if (
            (li as HTMLElement).style.listStyle === 'none' &&
            li.children.length === 1 &&
            ['UL', 'OL'].includes(li.children[0].tagName)
          )
            return walk(li.children[0], depth + 1);
          return (
            '  '.repeat(depth) +
            (tag === 'OL' ? `${start + i}. ` : '• ') +
            Array.from(li.childNodes, (n) => walk(n, depth + 1))
              .join('')
              .replace(/^\n+|\n+$/g, '') +
            '\n'
          );
        }).join('') +
        '\n'
      );
    }
    const content = Array.from(node.childNodes, (n) => walk(n, depth)).join('');
    return /^(P|H[1-6]|BLOCKQUOTE|TABLE)$/.test(tag)
      ? content + '\n\n'
      : content;
  }
  return walk(root);
}
export async function renderArticle(
  markdown: string,
  s: Settings,
  signal?: AbortSignal,
  options: { diagrams?: boolean } = {},
): Promise<Output> {
  const releases: (() => void)[] = [];
  const checkpoint = workBudget(signal);
  let delivered = false;
  const dispose = () => {
    releases.splice(0).forEach((release) => release());
  };
  try {
    signal?.throwIfAborted();
    const { blocks, codeSources, sources, images } = await parseArticleAsync(
      markdown,
      signal,
    );
    const assets: Asset[] = [],
      errors: string[] = [];
    const root = document.createElement('section');
    const clipboard = document.createElement('section');
    for (const block of blocks) {
      const pause = checkpoint();
      if (pause) await pause;
      const fragment = DOMPurify.sanitize(block, {
        ADD_ATTR: ['data-image-index', 'data-diagram-index'],
        RETURN_DOM_FRAGMENT: true,
      });
      clipboard.append(fragment.cloneNode(true));
      root.append(fragment);
    }
    await Promise.all(
      images.map(async (img, i) => {
        const previewTarget = root.querySelector(`[data-image-index="${i}"]`)!;
        const copyTarget = clipboard.querySelector(
          `[data-image-index="${i}"]`,
        )!;
        if (img.src.startsWith('local-image:')) {
          let url = '';
          try {
            const image = await acquireImageURL(img.src);
            url = image.url;
            releases.push(image.release);
          } catch {}
          assets.push({
            kind: 'image',
            label: img.alt || `本地图片 ${i + 1}`,
            src: img.src,
            missing: !url,
          });
          const placeholder = document.createElement('p');
          placeholder.textContent = `[请在此处上传本地图片：${img.alt || `图片 ${i + 1}`}]`;
          copyTarget.replaceWith(placeholder);
          if (url) {
            const image = document.createElement('img');
            image.src = url;
            image.alt = img.alt;
            image.setAttribute('data-width', String(img.width));
            previewTarget.replaceWith(image);
          } else {
            const missing = document.createElement('p');
            missing.textContent = `[本地图片缺失：${img.alt || img.src}]`;
            previewTarget.replaceWith(missing);
          }
        } else if (/^https?:\/\//i.test(img.src)) {
          const image = document.createElement('img');
          image.src = img.src;
          image.alt = img.alt;
          image.setAttribute('data-width', String(img.width));
          previewTarget.replaceWith(image);
          copyTarget.replaceWith(image.cloneNode(true));
        } else {
          previewTarget.remove();
          copyTarget.remove();
        }
      }),
    );
    signal?.throwIfAborted();
    await Promise.all(
      sources.map(async (source, i) => {
        const target = root.querySelector(`[data-diagram-index="${i}"]`)!;
        const copy = clipboard.querySelector(`[data-diagram-index="${i}"]`)!;
        assets.push({
          kind: 'diagram',
          label: `Mermaid 图形 ${i + 1}`,
          source,
        });
        try {
          if (options.diagrams !== false)
            target.innerHTML = await diagram(source, signal);
          const svg = target.querySelector('svg');
          if (svg) {
            svg.style.maxWidth = '100%';
            svg.style.height = 'auto';
          }
        } catch {
          signal?.throwIfAborted();
          errors.push(`Mermaid 图形 ${i + 1} 语法错误，请修正源码。`);
          target.textContent = errors.at(-1)!;
          target.setAttribute('data-mermaid-error', 'true');
        }
        const diagramContent = document.createElement('div');
        diagramContent.className = 'mermaid-preview-diagram';
        while (target.firstChild) diagramContent.append(target.firstChild);
        target.setAttribute('data-mermaid-block', '');
        target.append(diagramContent);
        target.removeAttribute('data-diagram-index');
        const p = document.createElement('p');
        p.textContent = `[请在此处插入 Mermaid 图形 ${i + 1}，先下载 PNG 并上传到公众号]`;
        copy.replaceWith(p);
      }),
    );
    signal?.throwIfAborted();
    await Promise.all(
      // Syntax coloring is optional; a failed language download must not block
      // publication or copying the original code as plain text.
      codeSources.map((source) =>
        ensureSyntax(source.language).catch(() => {}),
      ),
    );
    signal?.throwIfAborted();
    await inlineStyles(root, s, checkpoint);
    await inlineStyles(clipboard, s, checkpoint);
    // Sanitize user-derived content before inserting our code cards. Cards are
    // built from text nodes, fixed elements, and a local highlight palette, so
    // thousands of generated spans need not go through the sanitizer again.
    const sanitizeOptions = {
      FORBID_TAGS: ['script', 'style', 'svg', 'input', 'button', 'iframe'],
      FORBID_ATTR: ['id', 'class'],
      ADD_ATTR: ['style', 'data-code-block'],
    };
    const clean = document.createElement('div');
    clean.innerHTML = DOMPurify.sanitize(
      (clipboard.cloneNode(false) as HTMLElement).outerHTML,
      sanitizeOptions,
    );
    const cleanArticle = clean.firstElementChild!;
    for (const block of clipboard.childNodes) {
      const pause = checkpoint();
      if (pause) await pause;
      const html =
        block instanceof Element
          ? block.outerHTML
          : escapeHTML(block.textContent || '');
      cleanArticle.append(
        DOMPurify.sanitize(html, {
          ...sanitizeOptions,
          RETURN_DOM_FRAGMENT: true,
        }),
      );
    }
    const renderCard = codeCardRenderer(codeSources, s.codeTheme === 'dark');
    for (const target of [root, clean]) {
      for (const pre of target.querySelectorAll<HTMLElement>(
        'pre[data-code-index]',
      )) {
        const pause = checkpoint();
        if (pause) await pause;
        const index = Number(pre.dataset.codeIndex);
        pre.replaceWith(
          await renderCard(
            codeSources[index],
            index,
            s.codeTheme === 'dark',
            checkpoint,
          ),
        );
      }
    }
    signal?.throwIfAborted();
    const pause = checkpoint();
    if (pause) await pause;
    addCodeDecorations(root);
    addCodeDecorations(clean);
    const serializeBlocks = async (element: Element) => {
      const blocks: string[] = [];
      for (const child of element.childNodes) {
        const pause = checkpoint();
        if (pause) await pause;
        blocks.push(
          child instanceof Element
            ? child.outerHTML
            : escapeHTML(child.textContent || ''),
        );
      }
      return blocks;
    };
    const clipboardBlocks = await serializeBlocks(cleanArticle);
    const clipboardShell = cleanArticle.cloneNode(false) as Element;
    const html = clipboardShell.outerHTML.replace(
      '</section>',
      clipboardBlocks.join('') + '</section>',
    );
    // Preview affordances are applied after the clipboard document is finalized.
    for (const image of root.querySelectorAll('img')) {
      const pause = checkpoint();
      if (pause) await pause;
      image.setAttribute('data-media-preview', 'image');
      image.setAttribute('role', 'button');
      image.tabIndex = 0;
      image.setAttribute('aria-label', `预览图片：${image.alt || '图片'}`);
      image.title = '点击放大预览';
    }
    for (const graph of root.querySelectorAll<HTMLElement>(
      '.mermaid-preview-diagram',
    ))
      if (graph.querySelector('svg')) {
        graph.setAttribute('data-media-preview', 'diagram');
        graph.setAttribute('role', 'button');
        graph.tabIndex = 0;
        graph.setAttribute('aria-label', '预览 Mermaid 图表');
        graph.title = '点击放大预览';
      }
    const previewBlocks = await serializeBlocks(root);
    const previewShell = (root.cloneNode(false) as Element).outerHTML;
    let previewHTML: string | undefined;
    const result: Output = {
      html,
      get previewHTML() {
        return (previewHTML ??= previewShell.replace(
          '</section>',
          previewBlocks.join('') + '</section>',
        ));
      },
      previewShell,
      previewBlocks,
      previewReady: options.diagrams !== false || sources.length === 0,
      text: readableText(clean, codeSources),
      assets,
      errors,
      key: outputKey(markdown, s),
      dispose,
    };
    delivered = true;
    return result;
  } finally {
    if (!delivered) dispose();
  }
}
