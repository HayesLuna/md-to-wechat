import MarkdownIt from 'markdown-it';
import { markdownHighlight } from './highlight';

export type ArticleHeading = { level: number; text: string; line: number };
type InlineToken = {
  type: string;
  content: string;
  children?: InlineToken[] | null;
};
const parser = new MarkdownIt({ html: false }).use(markdownHighlight);

function inlineText(tokens: InlineToken[]): string {
  return tokens
    .map((token) => {
      if (token.type === 'text' || token.type === 'code_inline')
        return token.content;
      if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
      if (token.type === 'image')
        return token.children ? inlineText(token.children) : token.content;
      return '';
    })
    .join('');
}

// Labels use parsed text, so entities and inline formatting never leak into
// the outline, automatic draft name, or exported file name. Line positions
// remain tied to the original Markdown for navigation.
let cachedMarkdown: string | undefined;
let cachedHeadings: ArticleHeading[] = [];
export function headings(markdown: string): ArticleHeading[] {
  if (markdown === cachedMarkdown) return cachedHeadings;
  const tokens = parser.parse(markdown, {});
  const result: ArticleHeading[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'heading_open') continue;
    result.push({
      level: Number(token.tag.slice(1)),
      text: inlineText(tokens[index + 1]?.children ?? []).trim(),
      line: token.map?.[0] ?? 0,
    });
  }
  cachedMarkdown = markdown;
  cachedHeadings = result;
  return result;
}
