import { describe, it, expect } from 'vitest';
import { findCodeFolds, codeLines, codeLineAt } from '../../src/codeFolding';

describe('codeFolding', () => {
  const source =
    'function outer() {\n  const data = "{ brace in a string }";\n  if (data) {\n    console.log(data);\n  }\n}';

  it('ignores braces in quoted strings and supports comments, JSON, indentation and tags', () => {
    const regions = findCodeFolds(source, 'javascript');
    expect(regions).toHaveLength(2);
    expect(regions.map((r) => source.slice(r.from, r.to))).toContain(
      '\n    console.log(data);\n  ',
    );
    expect(
      findCodeFolds(
        '/* comment\nsecond line */\nconst text = "{\\"}";',
        'javascript',
      ),
    ).toHaveLength(1);
    expect(
      findCodeFolds('{\n  "key": [\n    "}",\n    "value"\n  ]\n}', 'json'),
    ).toHaveLength(2);
    expect(
      findCodeFolds(
        'def outer():\n    if value:\n        return value\n    return None\nnext_value = 1',
        'python',
      ),
    ).toHaveLength(2);
    expect(
      findCodeFolds(
        '<div>\n  <section>\n    <br>\n    text\n  </section>\n</div>',
        'html',
      ),
    ).toHaveLength(2);
    expect(findCodeFolds('const unfinished = {\n', 'javascript')).toEqual([]);
    expect(findCodeFolds('x'.repeat(200001), 'javascript')).toEqual([]);
  });

  it('maps offsets to line indices accurately', () => {
    const { lines, starts } = codeLines('first\nsecond\nthird');
    expect(lines).toEqual(['first', 'second', 'third']);
    expect(starts).toEqual([0, 6, 13]);
    expect(codeLineAt(starts, 0)).toBe(0);
    expect(codeLineAt(starts, 5)).toBe(0);
    expect(codeLineAt(starts, 6)).toBe(1);
    expect(codeLineAt(starts, 17)).toBe(2);
  });
});
