import { test, expect } from '@playwright/test';
import { indentJSON, compactJSON } from '../src/jsonIndentation';

test('JSON indentation preserves every value and escape without validating JSON', () => {
  const result = (() => {
    const source =
      '{ "id":9007199254740993,"id":1,"negative":-0,"exp":1e+09,"text":"\\u4e2d {[,] : \\"quote\\" \\\\ \\t", "empty": [ {},[] ], "values":[true,false,null,1.2300] }';
    const result = indentJSON(source);
    const formatted = result.text;
    const opaque = '{unquoted:tru e,"value":unknown}';
    return {
      source,
      formatted,
      again: indentJSON(formatted).text,
      selections: Array.from(
        source.matchAll(/"(?:\\.|[^"\\])*"|[^\s{}[\],:]+/g),
        (match) => ({
          before: match[0],
          after: formatted.slice(
            result.mapOffset(match.index!, 1),
            result.mapOffset(match.index! + match[0].length, -1),
          ),
        }),
      ),
      opaque: indentJSON(opaque).text,
      unfinished: ['{"text":"unfinished', '{"a":1', '[1}'].map((text) => ({
        text,
        formatted: indentJSON(text).text,
      })),
    };
  })();
  const tokens = (text: string) => text.match(/"(?:\\.|[^"\\])*"|[^\s]/g);
  expect(tokens(result.formatted)).toEqual(tokens(result.source));
  expect(result.formatted).toContain('\n  "id": 9007199254740993,\n  "id": 1,');
  expect(result.formatted).toContain(
    '"values": [\n    true,\n    false,\n    null,\n    1.2300\n  ]',
  );
  expect(result.again).toBe(result.formatted);
  for (const selection of result.selections)
    expect(selection.after).toBe(selection.before);
  expect(result.opaque).toBe('{\n  unquoted: tru e,\n  "value": unknown\n}');
  for (const entry of result.unfinished)
    expect(entry.formatted).toBe(entry.text);
});

test('JSON compression preserves literal tokens, maps selections and never repairs syntax', () => {
  const result = (() => {
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
    return {
      source,
      text: compact.text,
      again: compactJSON(compact.text).text,
      selections,
      opaque: compactJSON('{ unquoted : tru e , "value" : unknown }').text,
      unfinished: ['{"text":"unfinished', '{"a":1', '[1}'].map((text) => ({
        text,
        result: compactJSON(text).text,
      })),
      guards: [
        '"' + '中'.repeat(7000) + '"',
        '['.repeat(65) + '0' + ']'.repeat(65),
      ].map((text) => {
        try {
          compactJSON(text);
          return '';
        } catch (error) {
          return (error as Error).message;
        }
      }),
    };
  })();
  const tokens = (text: string) => text.match(/"(?:\\.|[^"\\])*"|[^\s]/g);
  expect(tokens(result.text)).toEqual(tokens(result.source));
  expect(result.text).toBe(
    String.raw`{"id":9007199254740993,"id":-0,"exp":1e+09,"decimal":1.2300,"text":"  a b \\ \" \u4e2d \t \n  ","list":[true,false,null,{},[]]}`,
  );
  expect(result.again).toBe(result.text);
  for (const selection of result.selections)
    expect(selection.after).toBe(selection.before);
  expect(result.opaque).toBe('{unquoted:tru e,"value":unknown}');
  for (const entry of result.unfinished) expect(entry.result).toBe(entry.text);
  for (const message of result.guards)
    expect(message).toContain('暂不压缩，原文已保留');
});
