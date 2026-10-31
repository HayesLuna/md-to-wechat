import {
  highlighter as hljs,
  syntaxRevision,
  MAX_CODE_HIGHLIGHT_CHARACTERS,
} from './syntax';
import type { workBudget } from './workBudget';
import { githubHighlightStyle } from './githubCodeTheme';

export type CodeSource = { text: string; language: string };
const cards = new Map<string, { card: HTMLDivElement; size: number }>();
let cachedCharacters = 0;
const MAX_CACHED_CHARACTERS = 200_000;
const MAX_CACHED_CARDS = 64;

export function codeCard(source: CodeSource, index: number, dark: boolean) {
  return copyCard(cachedCard(source, dark), index);
}

function cachedCard(
  source: CodeSource,
  dark: boolean,
  prepared?: HTMLDivElement,
) {
  if (source.text.length > MAX_CACHED_CHARACTERS)
    return prepared || createCodeCard(source, 0, dark);
  const key = JSON.stringify([
    source.text,
    source.language,
    dark,
    syntaxRevision,
  ]);
  let entry = cards.get(key);
  if (entry) cards.delete(key);
  else {
    entry = {
      card: prepared || createCodeCard(source, 0, dark),
      size: source.text.length,
    };
    cachedCharacters += entry.size;
  }
  cards.set(key, entry);
  while (
    cards.size > MAX_CACHED_CARDS ||
    cachedCharacters > MAX_CACHED_CHARACTERS
  ) {
    const oldest = cards.keys().next().value!;
    cachedCharacters -= cards.get(oldest)!.size;
    cards.delete(oldest);
  }
  return entry.card;
}

function copyCard(card: HTMLDivElement, index: number) {
  // Consumers add decorations and styles. Never let those mutations enter cache.
  const copy = card.cloneNode(true) as HTMLDivElement;
  copy.setAttribute('data-code-index', String(index));
  return copy;
}

export function codeCardRenderer(sources: CodeSource[], dark: boolean) {
  // Preview and clipboard always share tokenization within one snapshot, even
  // for documents larger than the bounded cross-snapshot cache.
  const snapshot = new Map<string, HTMLDivElement>();
  // Capture hits before any misses can evict them. A sequential scan of an
  // article larger than the cache must not turn every block into a cache miss.
  for (const source of sources) {
    const entry = cards.get(
      JSON.stringify([source.text, source.language, dark, syntaxRevision]),
    );
    if (entry)
      snapshot.set(
        JSON.stringify([source.text, source.language, dark]),
        entry.card,
      );
  }
  return async (
    source: CodeSource,
    index: number,
    dark: boolean,
    checkpoint: ReturnType<typeof workBudget>,
  ) => {
    const key = JSON.stringify([source.text, source.language, dark]);
    let card = snapshot.get(key);
    if (!card) {
      const cached = cards.get(
        JSON.stringify([source.text, source.language, dark, syntaxRevision]),
      );
      if (cached) card = cachedCard(source, dark);
      else {
        const builder = buildCodeCard(source, 0, dark);
        let step = builder.next();
        while (!step.done) {
          const pause = checkpoint();
          if (pause) await pause;
          step = builder.next();
        }
        card = cachedCard(source, dark, step.value);
      }
      snapshot.set(key, card);
    }
    return copyCard(card, index);
  };
}
// Fixed, local decoration only. No SVG markup, URLs or attributes come from Markdown.
export function codeDecoration(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({
    xmlns: ns,
    width: '45px',
    height: '13px',
    viewBox: '0 0 450 130',
    role: 'img',
    'aria-label': '代码块装饰',
  }))
    svg.setAttribute(key, value);
  svg.setAttribute(
    'style',
    'width:45px;height:13px;max-width:none;flex-shrink:0;',
  );
  for (const [cx, stroke, fill] of [
    ['50', 'rgb(220,60,54)', 'rgb(237,108,96)'],
    ['225', 'rgb(218,151,33)', 'rgb(247,193,81)'],
    ['400', 'rgb(27,161,37)', 'rgb(100,200,86)'],
  ]) {
    const ellipse = document.createElementNS(ns, 'ellipse');
    for (const [key, value] of Object.entries({
      cx,
      cy: '65',
      rx: '50',
      ry: '52',
      stroke,
      'stroke-width': '2',
      fill,
    }))
      ellipse.setAttribute(key, value);
    svg.append(ellipse);
  }
  return svg;
}
export function addCodeDecorations(root: HTMLElement) {
  for (const header of root.querySelectorAll(
    '[data-code-block] > pre > [data-code-chrome]',
  )) {
    header.replaceChildren(codeDecoration());
  }
}
const JSON_DARK_COLORS = [
  '#79c0ff',
  '#7ee787',
  '#d2a8ff',
  '#ff7b72',
  '#8b949e',
];

function highlightColor(className: string, dark: boolean, json: boolean) {
  if (!dark) return githubHighlightStyle(className);
  if (json) {
    const index = /attr/.test(className)
      ? 0
      : /string/.test(className)
        ? 1
        : /number/.test(className)
          ? 2
          : /literal|keyword/.test(className)
            ? 3
            : /punctuation/.test(className)
              ? 4
              : -1;
    if (index >= 0) return `color:${JSON_DARK_COLORS[index]};`;
  }
  const palette = dark
    ? ['#a5d6ff', '#ff7b72', '#a5d6ff', '#d2a8ff', '#79c0ff', '#8b949e']
    : ['#a6493d', '#9a3754', '#31599c', '#7650a8', '#80572a', '#83888f'];
  const index = /comment|quote/.test(className)
    ? 5
    : /keyword|selector|literal/.test(className)
      ? 1
      : /string|regexp/.test(className)
        ? 0
        : /number|attr/.test(className)
          ? 2
          : /title|function/.test(className)
            ? 3
            : 4;
  return `color:${palette[index]};${index === 5 ? 'font-style:italic;' : ''}`;
}
function createCodeCard(
  source: CodeSource,
  index: number,
  dark: boolean,
): HTMLDivElement {
  const builder = buildCodeCard(source, index, dark);
  let step = builder.next();
  while (!step.done) step = builder.next();
  return step.value;
}

function* buildCodeCard(
  source: CodeSource,
  index: number,
  dark: boolean,
): Generator<void, HTMLDivElement> {
  const normalized = source.text
    .replace(/\r\n|\r/g, '\n')
    .replace(/\t/g, '    ');
  const content = normalized.endsWith('\n')
    ? normalized.slice(0, -1)
    : normalized;
  const lines = content.split('\n');
  const fragments = lines.map(() => document.createDocumentFragment());
  const highlighted = document.createElement('div');
  const json = source.language.trim().toLowerCase() === 'json';
  // Highlight the complete block before splitting DOM text into lines, so multi-line
  // comments/strings retain context. Only generated spans are copied into output.
  if (
    content.length <= MAX_CODE_HIGHLIGHT_CHARACTERS &&
    source.language &&
    hljs.getLanguage(source.language)
  )
    highlighted.innerHTML = hljs.highlight(content, {
      language: source.language,
      ignoreIllegals: true,
    }).value;
  else highlighted.textContent = content;
  let lineIndex = 0;
  const visit = (node: Node, styles: string[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parts = (node.textContent || '').split('\n');
      parts.forEach((part, i) => {
        if (i) lineIndex++;
        if (!part) return;
        let parent: Node = fragments[lineIndex];
        for (const style of styles) {
          const token = document.createElement('span');
          token.setAttribute('style', style);
          parent.appendChild(token);
          parent = token;
        }
        parent.appendChild(document.createTextNode(part));
      });
      return;
    }
    const next =
      node instanceof Element && node.tagName === 'SPAN'
        ? [...styles, highlightColor(node.className, dark, json)]
        : styles;
    for (const child of node.childNodes) visit(child, next);
  };
  visit(highlighted, []);
  const outer = document.createElement('div');
  outer.setAttribute('data-code-block', '');
  outer.setAttribute('data-code-index', String(index));
  outer.setAttribute(
    'style',
    'margin:10px 8px;width:calc(100% - 16px);max-width:100%;box-sizing:border-box;',
  );
  const pre = document.createElement('pre');
  pre.setAttribute(
    'style',
    `display:block;width:100%;max-width:100%;border-radius:8px;margin:0;padding:0 !important;box-sizing:border-box;border:1px solid ${dark ? '#30363d' : '#d0d7de'};background:${dark ? '#0d1117' : '#ffffff'};color:${dark ? '#c9d1d9' : '#24292e'};font-size:14px;line-height:1.75;white-space:normal;`,
  );
  const header = document.createElement('span');
  header.setAttribute('data-code-chrome', '');
  header.setAttribute('style', 'display:flex;padding:10px 14px 0;');
  const scroll = document.createElement('div');
  scroll.setAttribute('data-code-scroll', '');
  scroll.setAttribute('data-ignore-width', '');
  scroll.setAttribute(
    'style',
    'display:block;width:100%;max-width:100%;overflow-x:auto !important;-webkit-overflow-scrolling:touch;box-sizing:border-box;',
  );
  const code = document.createElement('code');
  code.setAttribute(
    'style',
    'display:block;padding:0.5em 1em 1em;text-indent:0;text-align:left;line-height:1.75;font-family:Menlo,"Operator Mono",Consolas,Monaco,monospace;font-size:90%;margin:0;white-space:pre !important;word-break:normal !important;overflow-wrap:normal !important;min-width:max-content;',
  );
  const container = document.createElement('div');
  container.setAttribute('data-code-lines', '');
  container.setAttribute(
    'style',
    `display:block;box-sizing:border-box;min-width:max-content;padding:0;white-space:pre !important;--code-line-number-width:${String(lines.length).length}ch;`,
  );
  for (const [i, line] of lines.entries()) {
    const section = document.createElement('section');
    section.setAttribute('data-code-line', '');
    section.setAttribute(
      'style',
      'display:block;margin:0;padding:0;line-height:1.75;white-space:pre;word-break:normal;overflow-wrap:normal;',
    );
    const indent = /^ */.exec(line)![0].length;
    let remaining = indent;
    const walker = document.createTreeWalker(
      fragments[i],
      NodeFilter.SHOW_TEXT,
    );
    let text: Node | null;
    while ((text = walker.nextNode())) {
      const value = text.textContent || '';
      const remove = Math.min(remaining, value.length);
      remaining -= remove;
      text.textContent = value.slice(remove).replace(/ /g, '\u00a0');
    }
    if (indent)
      section.append(document.createTextNode('\u00a0'.repeat(indent)));
    section.append(fragments[i]);
    if (!section.textContent) section.append(document.createTextNode('\u00a0'));
    // Leaf spans retain inline flow and avoid the legacy verifier counting
    // mixed direct text and highlight fragments as separate visual lines.
    for (const node of Array.from(section.childNodes))
      if (node.nodeType === Node.TEXT_NODE) {
        const leaf = document.createElement('span');
        leaf.textContent = node.textContent;
        node.replaceWith(leaf);
      }
    container.append(section);
    if (i % 16 === 15) yield;
  }
  code.append(container);
  scroll.append(code);
  pre.append(header, scroll);
  outer.append(pre);
  return outer;
}
