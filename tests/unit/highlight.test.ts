import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import {
  highlightPairs,
  matchHighlight,
  markdownHighlight,
  escapePlainHighlights,
} from '../../src/highlight';

describe('highlight', () => {
  it('finds valid highlight pairs while skipping code spans, escapes and blank lines', () => {
    expect(highlightPairs('前文==重点==后文')).toEqual([{ from: 2, to: 8 }]);
    expect(highlightPairs('`==代码==` ==重点==')).toEqual([
      { from: 9, to: 15 },
    ]);
    const escaped = '\\==字面== ==真高亮==';
    expect(
      highlightPairs(escaped).map((p) => escaped.slice(p.from, p.to)),
    ).toEqual(['==真高亮==']);
    expect(highlightPairs('==未闭合\n\n==新段==')).toEqual([
      { from: 7, to: 13 },
    ]);
    expect(highlightPairs('==a== ==b==', 1)).toEqual([{ from: 0, to: 5 }]);
  });

  it('matches leading highlight tokens only when opening is non-whitespace', () => {
    expect(matchHighlight('==重点==后文')).toEqual({
      raw: '==重点==',
      text: '重点',
    });
    expect(matchHighlight('== 空格开头==')).toBeNull();
    expect(matchHighlight('前文==重点==')).toBeNull();
  });

  it('renders highlights in markdown-it without consuming URL equals or code spans', () => {
    const md = new MarkdownIt({ html: false }).use(markdownHighlight);
    expect(md.renderInline('[链接](https://example.com/?q==x) ==重点==')).toBe(
      '<a href="https://example.com/?q==x">链接</a> <mark>重点</mark>',
    );
    expect(md.renderInline('`==code==` ==a=b==')).toBe(
      '<code>==code==</code> <mark>a=b</mark>',
    );
  });

  it('escapes literal plain-text == pairs without touching code or real highlight marks', () => {
    const serialize = (doc: {
      content?: { content?: { text?: string }[] }[];
    }) =>
      (doc.content ?? [])
        .map((p) => (p.content ?? []).map((n) => n.text ?? '').join(''))
        .join('\n');

    expect(
      escapePlainHighlights(
        {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '无等号' }] },
          ],
        },
        serialize,
      ),
    ).toBe('无等号');

    expect(
      escapePlainHighlights(
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: '==字面==' }],
            },
          ],
        },
        serialize,
      ),
    ).toBe('\\==字面\\==');

    expect(
      escapePlainHighlights(
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: '==code==', marks: [{ type: 'code' }] },
              ],
            },
          ],
        },
        serialize,
      ),
    ).toBe('==code==');
  });
});
