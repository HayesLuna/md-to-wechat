import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { underlineSpan, markdownUnderline } from '../../src/markdownUnderline';
import { headings } from '../../src/headings';
import {
  safeURL,
  widthFromTitle,
  imageIndent,
  imageIndentFromTitle,
  codeInfo,
  imageIndentPadding,
  inlineImageLayout,
} from '../../src/outputUtils';
import { centerUnalignedPastedTables } from '../../src/markdownPaste';

describe('markdownUnderline', () => {
  it('parses paired <u> and ++ spans while skipping code spans and link titles', () => {
    expect(underlineSpan('<u>下划线</u>后文')).toEqual({
      raw: '<u>下划线</u>',
      text: '下划线',
      from: 3,
    });
    expect(underlineSpan('++旧下划线++后文')).toEqual({
      raw: '++旧下划线++',
      text: '旧下划线',
      from: 2,
    });
    expect(
      underlineSpan('<u>[甲](https://example.com "标题 </u> 仍是标题")</u>乙'),
    ).toEqual({
      raw: '<u>[甲](https://example.com "标题 </u> 仍是标题")</u>',
      text: '[甲](https://example.com "标题 </u> 仍是标题")',
      from: 3,
    });
    expect(underlineSpan('<u>`</u>`真内容</u>')).toEqual({
      raw: '<u>`</u>`真内容</u>',
      text: '`</u>`真内容',
      from: 3,
    });
    expect(underlineSpan('<u></u>')).toBeUndefined();
  });

  it('renders paired underlines in markdown-it and keeps other raw HTML escaped', () => {
    const md = new MarkdownIt({ html: false }).use(markdownUnderline);
    expect(
      md.renderInline('<u>**加粗**</u> 与 ++旧++ <script>x</script>'),
    ).toBe(
      '<u><strong>加粗</strong></u> 与 <u>旧</u> &lt;script&gt;x&lt;/script&gt;',
    );
  });
});

describe('headings', () => {
  it('extracts plain heading labels without inline syntax delimiters', () => {
    const md =
      '# ==高亮标题==\n\n正文\n\n## **加粗** 与 `代码` 和 <u>下划线</u>';
    expect(headings(md)).toEqual([
      { level: 1, text: '高亮标题', line: 0 },
      { level: 2, text: '加粗 与 代码 和 下划线', line: 4 },
    ]);
  });
});

describe('outputUtils & table alignment', () => {
  it('validates safe URLs and parses image/code metadata', () => {
    expect(safeURL('https://example.com/a')).toBe(true);
    expect(safeURL('mailto:test@example.com')).toBe(true);
    expect(safeURL('javascript:alert(1)')).toBe(false);
    expect(safeURL('not a url')).toBe(false);

    expect(widthFromTitle('width=60%')).toBe(60);
    expect(widthFromTitle('width=60% indent=2')).toBe(60);
    expect(widthFromTitle('width=999%')).toBe(200);
    expect(widthFromTitle('other')).toBe(100);

    expect(imageIndent(3)).toBe(3);
    expect(imageIndent(99)).toBe(6);
    expect(imageIndent(-2)).toBe(0);
    expect(imageIndentFromTitle('width=50% indent=2')).toBe(2);

    expect(codeInfo('ts indent=2')).toEqual({ language: 'ts', indent: 2 });
    expect(codeInfo('javascript')).toEqual({
      language: 'javascript',
      indent: 0,
    });
    expect(imageIndentPadding(2)).toBe('min(48px, 40%)');
    expect(inlineImageLayout(50, 0)).toEqual({
      width: '50%',
      imageWidth: '100%',
      offset: '0px',
    });
  });

  it('centers unaligned pasted table cells while keeping explicit alignment', () => {
    const input = {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', attrs: {} },
            { type: 'tableCell', attrs: { align: 'right' } },
          ],
        },
      ],
    };
    expect(centerUnalignedPastedTables(input)).toEqual({
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', attrs: { align: 'center' } },
            { type: 'tableCell', attrs: { align: 'right' } },
          ],
        },
      ],
    });
  });
});
