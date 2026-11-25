import { InputRule, markInputRule } from '@tiptap/core';
import type { MarkType, ResolvedPos } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { setInlineCodeStart } from './inlineCodeCaret';

function textAfter($after: ResolvedPos, type: MarkType) {
  const { parent } = $after;
  const startIndex = $after.index();
  let suffix = '';
  for (let index = startIndex; index < parent.childCount; index++) {
    const node = parent.child(index);
    const inCode = node.marks.some((mark) => mark.type.spec.code);
    if (
      !node.text ||
      (inCode && type.spec.code) ||
      node.marks.some((mark) => mark.type !== type && mark.type.excludes(type))
    )
      break;
    const text = node.text.slice(index === startIndex ? $after.textOffset : 0);
    // Inline code can be formatted, but its contents are literal.
    suffix += inCode ? '\ufffc'.repeat(text.length) : text;
  }
  return suffix;
}

function isEscaped(text: string) {
  return (text.match(/\\+$/)?.[0].length ?? 0) % 2 === 1;
}

function canOpenAt($start: ResolvedPos, type: MarkType) {
  return (
    $start.parent.type.allowsMarkType(type) &&
    !isEscaped($start.parent.textBetween(0, $start.parentOffset, '', '\ufffc'))
  );
}

function closingBackticks($after: ResolvedPos, length: number, type: MarkType) {
  const suffix = textAfter($after, type);
  // Ticks next to the cursor are still part of the opening run. Inside a code
  // span, only a run of equal length closes it, even after a backslash.
  if (suffix.startsWith('`')) return null;
  for (const match of suffix.matchAll(/`+/g))
    if (match[0].length === length) return $after.pos + match.index;
  return null;
}

export function openingBacktickRule(type: MarkType) {
  return new InputRule({
    find: /`+$/,
    handler: ({ state, range }) => {
      const { tr } = state;
      if (!canOpenAt(tr.doc.resolve(range.from), type)) return null;
      const length = range.to - range.from;
      const closing = closingBackticks(tr.doc.resolve(range.to), length, type);
      if (closing === null) return null;

      tr.delete(closing, closing + length)
        .delete(range.from, range.to)
        .addMark(range.from, closing - length, type.create());
      const marks = tr.doc.resolve(range.from).nodeAfter?.marks ?? [];
      setInlineCodeStart(tr, range.from, marks, 1);
    },
  });
}

function regexLiteral(value: string) {
  return value.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');
}

export function additionalInlineRules(
  type: MarkType,
  { opening, closing }: { opening: string; closing: string },
) {
  const repeated = opening === closing;
  const opener = regexLiteral(opening);
  const closer = regexLiteral(closing);
  const character = regexLiteral(opening[0]);
  const before = repeated ? `(?<!${character})` : '';
  const after = repeated ? `(?!${character})` : '';
  const body = repeated
    ? `[^\\s${character}](?:[^${character}\\r\\n]*?[^\\s${character}])?`
    : '[^\\r\\n]+?';
  const forward = new RegExp(`${before}${opener}(${body})${closer}$`);
  const remainder = new RegExp(`^(${body})${closer}${after}`);

  // Allow delimiters adjacent to words, including Chinese text.
  const adjacent = markInputRule({
    find: (text) => {
      const match = forward.exec(text);
      if (
        !match ||
        isEscaped(text.slice(0, match.index)) ||
        isEscaped(match[1])
      )
        return null;
      return { index: match.index, text: match[0], replaceWith: match[1] };
    },
    type,
  });
  return [
    new InputRule({
      find: adjacent.find,
      handler: (props) => {
        const { state, range } = props;
        const code = state.schema.marks.code;
        if (
          code &&
          (state.doc.rangeHasMark(
            range.from,
            range.from + opening.length,
            code,
          ) ||
            state.doc.rangeHasMark(range.to - closing.length, range.to, code))
        )
          return null;
        return adjacent.handler(props);
      },
    }),
    new InputRule({
      find: new RegExp(`${before}${opener}$`),
      handler: ({ state, range }) => {
        const { tr } = state;
        if (!canOpenAt(tr.doc.resolve(range.from), type)) return null;
        const suffix = textAfter(tr.doc.resolve(range.to), type);
        const content = remainder.exec(suffix)?.[1];
        if (!content || isEscaped(content)) return null;
        const end = range.to + content.length;
        tr.delete(end, end + closing.length)
          .delete(range.from, range.to)
          .addMark(range.from, range.from + content.length, type.create());
        const marks = tr.doc.resolve(range.from).nodeAfter?.marks ?? [];
        tr.setSelection(
          TextSelection.create(tr.doc, range.from),
        ).setStoredMarks(marks);
      },
    }),
  ];
}
