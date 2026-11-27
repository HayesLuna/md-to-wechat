import { describe, it, expect } from 'vitest';
import { indentJSON, compactJSON } from '../../src/jsonIndentation';

describe('jsonIndentation', () => {
  it('preserves every value and escape without validating JSON', () => {
    const source =
      '{ "id":9007199254740993,"id":1,"negative":-0,"exp":1e+09,"text":"\\u4e2d {[,] : \\"quote\\" \\\\ \\t", "empty": [ {},[] ], "values":[true,false,null,1.2300] }';
    const result = indentJSON(source);
    const formatted = result.text;
    const opaque = '{unquoted:tru e,"value":unknown}';
    const selections = Array.from(
      source.matchAll(/"(?:\\.|[^"\\])*"|[^\s{}[\],:]+/g),
      (match) => ({
        before: match[0],
        after: formatted.slice(
          result.mapOffset(match.index!, 1),
          result.mapOffset(match.index! + match[0].length, -1),
        ),
      }),
    );
    const tokens = (text: string) => text.match(/"(?:\\.|[^"\\])*"|[^\s]/g);

    expect(tokens(formatted)).toEqual(tokens(source));
    expect(formatted).toContain('\n  "id": 9007199254740993,\n  "id": 1,');
    expect(formatted).toContain(
      '"values": [\n    true,\n    false,\n    null,\n    1.2300\n  ]',
    );
    expect(indentJSON(formatted).text).toBe(formatted);
    for (const selection of selections)
      expect(selection.after).toBe(selection.before);
    expect(indentJSON(opaque).text).toBe(
      '{\n  unquoted: tru e,\n  "value": unknown\n}',
    );
    for (const text of ['{"text":"unfinished', '{"a":1', '[1}'])
      expect(indentJSON(text).text).toBe(text);
  });

  it('compresses JSON while preserving literal tokens, mapping selections and never repairing syntax', () => {
    const source = String.raw`{ "id": 9007199254740993, "id": -0, "exp": 1e+09, "decimal": 1.2300, "text": "  a b \\ \" \u4e2d \t \n  ", "list": [ true, false, null, {}, [] ] }`;
    const formatted = indentJSON(source).text;
    const compact = compactJSON(formatted);
    const selections = Array.from(
      formatted.matchAll(/"(?:\\.|[^"\\])*"|[^\s{}[\],:]+/g),
      (match) => ({
        before: match[0],
        after: compact.text.slice(
          compact.mapOffset(match.index!, 1),
          compact.mapOffset(match.index! + match[0].length, -1),
        ),
      }),
    );
    const tokens = (text: string) => text.match(/"(?:\\.|[^"\\])*"|[^\s]/g);

    expect(tokens(compact.text)).toEqual(tokens(source));
    expect(compact.text).toBe(
      String.raw`{"id":9007199254740993,"id":-0,"exp":1e+09,"decimal":1.2300,"text":"  a b \\ \" \u4e2d \t \n  ","list":[true,false,null,{},[]]}`,
    );
    expect(compactJSON(compact.text).text).toBe(compact.text);
    for (const selection of selections)
      expect(selection.after).toBe(selection.before);
    expect(compactJSON('{ unquoted : tru e , "value" : unknown }').text).toBe(
      '{unquoted:tru e,"value":unknown}',
    );
    for (const text of ['{"text":"unfinished', '{"a":1', '[1}'])
      expect(compactJSON(text).text).toBe(text);
    for (const text of [
      '"' + '中'.repeat(7000) + '"',
      '['.repeat(65) + '0' + ']'.repeat(65),
    ]) {
      expect(() => compactJSON(text)).toThrow('暂不压缩，原文已保留');
    }
  });
});
