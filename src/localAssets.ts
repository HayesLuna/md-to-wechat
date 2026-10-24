import MarkdownIt from 'markdown-it';
import { markdownHighlight } from './highlight';
import type { Asset } from './output';

const parser = new MarkdownIt({ html: false }).use(markdownHighlight);
const validateLink = parser.validateLink.bind(parser);
parser.validateLink = (url) =>
  url.startsWith('local-image:') || validateLink(url);

// The download list follows the current Markdown, even when article rendering
// is deferred. Parsing tokens excludes image-looking text inside code blocks.
export function localImageAssets(markdown: string): Asset[] {
  if (!markdown.includes('local-image:')) return [];
  const assets: Asset[] = [];
  const visit = (tokens: ReturnType<typeof parser.parse>) => {
    for (const token of tokens) {
      if (token.type === 'image') {
        const src = token.attrGet('src') || '';
        if (/^local-image:[a-zA-Z0-9-]+$/.test(src))
          assets.push({
            kind: 'image',
            label: token.content || `本地图片 ${assets.length + 1}`,
            src,
          });
      }
      if (token.children) visit(token.children);
    }
  };
  visit(parser.parse(markdown, {}));
  return assets;
}
