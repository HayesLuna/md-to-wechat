import MarkdownIt from 'markdown-it';
import { markdownHighlight } from './highlight';
import { safeURL, widthFromTitle } from './outputUtils';
import type { CodeSource } from './codeOutput';

export function parseArticle(markdown: string) {
  const codeSources: CodeSource[] = [];
  const sources: string[] = [];
  const images: { src: string; alt: string; width: number }[] = [];
  const md = new MarkdownIt({ html: false, linkify: false, breaks: false });
  md.use(markdownHighlight);
  md.validateLink = (url) => safeURL(url) || url.startsWith('local-image:');
  md.renderer.rules.image = (tokens, i) => {
    const t = tokens[i];
    const item = {
      src: t.attrGet('src') || '',
      alt: t.content,
      width: widthFromTitle(t.attrGet('title') || ''),
    };
    images.push(item);
    return `<span data-image-index="${images.length - 1}"></span>`;
  };
  md.renderer.rules.fence = (tokens, i) => {
    const t = tokens[i];
    const lang = t.info.trim().split(/\s+/)[0].toLowerCase();
    if (lang === 'mermaid') {
      sources.push(t.content);
      return `<section data-diagram-index="${sources.length - 1}"></section>`;
    }
    const code = md.utils.escapeHtml(t.content);
    codeSources.push({ text: t.content, language: lang });
    return `<pre data-code-index="${codeSources.length - 1}"><code>${code}</code></pre>`;
  };
  md.renderer.rules.code_block = md.renderer.rules.fence;
  // Task markers operate on list token content, never on the Markdown document.
  const original = md.renderer.rules.inline;
  md.renderer.rules.inline = (tokens, i, opts, env, self) => {
    const t = tokens[i];
    if (t.children?.[0]?.type === 'text') {
      const m = /^\[([ xX])\] /.exec(t.children[0].content);
      if (m)
        t.children[0].content =
          (m[1] === ' ' ? '☐ ' : '☑ ') +
          t.children[0].content.slice(m[0].length);
    }
    return original
      ? original(tokens, i, opts, env, self)
      : self.renderInline(t.children || [], opts, env);
  };
  const tokens = md.parse(markdown, {});
  const blocks: string[] = [];
  let group: typeof tokens = [],
    depth = 0;
  for (const token of tokens) {
    group.push(token);
    depth += token.nesting;
    if (!depth) {
      blocks.push(md.renderer.render(group, md.options, {}));
      group = [];
    }
  }
  if (group.length) blocks.push(md.renderer.render(group, md.options, {}));
  return { blocks, codeSources, sources, images };
}
export type ParsedArticle = ReturnType<typeof parseArticle>;
