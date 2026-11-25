import type { SourcePair } from './sourceDelimiter';

function isEscaped(source: string, index: number) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

function skipCodeSpan(source: string, index: number) {
  const run = /^`+/.exec(source.slice(index));
  if (!run) return index;
  const fence = run[0];
  const end = source.indexOf(fence, index + fence.length);
  return end < 0 ? index : end + fence.length;
}

/** Mask characters inside inline code so other scanners treat them as inert. */
function maskCodeSpans(source: string) {
  let out = '';
  for (let i = 0; i < source.length; ) {
    if (source[i] === '`' && !isEscaped(source, i)) {
      const end = skipCodeSpan(source, i);
      if (end > i) {
        out += '\ufffc'.repeat(end - i);
        i = end;
        continue;
      }
    }
    out += source[i++];
  }
  return out;
}

function canOpen(source: string, index: number, length: number) {
  const next = source[index + length];
  return next !== undefined && !/\s/.test(next);
}

function canClose(source: string, index: number) {
  return index > 0 && !/\s/.test(source[index - 1]);
}

function symmetricPairs(
  source: string,
  marker: string,
  kind: SourcePair['kind'],
  tag: string,
  masked = source,
) {
  const pairs: SourcePair[] = [];
  let opening: number | undefined;
  const length = marker.length;
  for (let i = 0; i < masked.length; i++) {
    if (
      (masked[i] === '\n' || masked[i] === '\r') &&
      /^[\r\n][\t ]*[\r\n]/.test(masked.slice(i))
    )
      opening = undefined;
    if (masked[i] === '\ufffc') continue;
    if (isEscaped(source, i)) continue;
    if (!masked.startsWith(marker, i)) continue;
    // Prefer longer markers that start at the same place (handled by callers).
    if (opening !== undefined) {
      if (i > opening + length && canClose(source, i)) {
        pairs.push({
          from: opening,
          to: i + length,
          openLen: length,
          closeLen: length,
          kind,
          tag,
        });
        opening = undefined;
        i += length - 1;
      }
    } else if (canOpen(source, i, length)) {
      opening = i;
      i += length - 1;
    }
  }
  return pairs;
}

function underlinePairs(source: string, masked: string) {
  const pairs: SourcePair[] = [];
  const stack: number[] = [];
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '\ufffc' || isEscaped(source, i)) continue;
    if (masked.startsWith('<u>', i) || masked.startsWith('<U>', i)) {
      if (canOpen(source, i, 3)) stack.push(i);
      i += 2;
      continue;
    }
    if (masked.startsWith('</u>', i) || masked.startsWith('</U>', i)) {
      const opening = stack.pop();
      if (opening !== undefined && i > opening + 3 && canClose(source, i)) {
        pairs.push({
          from: opening,
          to: i + 4,
          openLen: 3,
          closeLen: 4,
          kind: 'underline',
          tag: 'u',
        });
      }
      i += 3;
    }
  }
  return pairs;
}

function codePairs(source: string) {
  const pairs: SourcePair[] = [];
  for (let i = 0; i < source.length; ) {
    if (source[i] !== '`' || isEscaped(source, i)) {
      i++;
      continue;
    }
    const run = /^`+/.exec(source.slice(i))![0];
    const end = source.indexOf(run, i + run.length);
    if (end < 0 || end === i + run.length) {
      i += run.length;
      continue;
    }
    // Closing fence must not be longer by adjacent ticks; indexOf finds the
    // next equal-length run, matching CommonMark's backtick span rule.
    pairs.push({
      from: i,
      to: end + run.length,
      openLen: run.length,
      closeLen: run.length,
      kind: 'code',
      tag: 'code',
    });
    i = end + run.length;
  }
  return pairs;
}

function maskOffsets(
  source: string,
  ranges: readonly { from: number; to: number }[],
) {
  if (!ranges.length) return source;
  const chars = Array.from(source);
  for (const range of ranges)
    for (let i = range.from; i < range.to; i++) chars[i] = '\ufffc';
  return chars.join('');
}

function emphasisPairs(masked: string) {
  // Mask bold markers first so italic does not consume their stars.
  const bold = symmetricPairs(masked, '**', 'bold', 'strong');
  const forItalic = maskOffsets(
    masked,
    bold.flatMap((pair) => [
      { from: pair.from, to: pair.from + pair.openLen },
      { from: pair.to - pair.closeLen, to: pair.to },
    ]),
  );
  const italic = symmetricPairs(forItalic, '*', 'italic', 'em');
  return [...bold, ...italic];
}

function occupied(pairs: readonly SourcePair[]) {
  const taken = new Uint8Array(
    pairs.reduce((max, pair) => Math.max(max, pair.to), 0),
  );
  for (const pair of pairs)
    for (let i = pair.from; i < pair.to; i++) taken[i] = 1;
  return taken;
}

function withoutOccupied(pairs: SourcePair[], taken: Uint8Array) {
  return pairs.filter((pair) => {
    for (let i = pair.from; i < pair.to; i++) if (taken[i]) return false;
    return true;
  });
}

/**
 * Scan one textblock's source for editable inline delimiter pairs.
 * Code spans are literal: nothing else pairs inside them.
 */
export function sourceInlinePairs(source: string): SourcePair[] {
  const codes = codePairs(source);
  const masked = maskCodeSpans(source);
  const underlines = underlinePairs(source, masked);
  const strikes = symmetricPairs(masked, '~~', 'strike', 's');
  // Underline/strike may overlap code masks already; drop anything that still
  // lands on a code span, then mask those ranges before emphasis.
  const taken = occupied(codes);
  const outside = [
    ...withoutOccupied(underlines, taken),
    ...withoutOccupied(strikes, taken),
  ];
  // Code is fully literal. Underline/strike only reserve their delimiter
  // characters so nested emphasis inside their content can still pair.
  const forEmphasis = maskOffsets(masked, [
    ...codes.map((pair) => ({ from: pair.from, to: pair.to })),
    ...outside.flatMap((pair) => [
      { from: pair.from, to: pair.from + pair.openLen },
      { from: pair.to - pair.closeLen, to: pair.to },
    ]),
  ]);
  const emphasis = emphasisPairs(forEmphasis);
  return [...codes, ...outside, ...emphasis].sort((a, b) => a.from - b.from);
}

export function matchSourcePair(
  source: string,
  kind: SourcePair['kind'],
): { raw: string; text: string } | null {
  const pair = sourceInlinePairs(source).find(
    (candidate) => candidate.kind === kind && candidate.from === 0,
  );
  if (!pair) return null;
  return {
    raw: source.slice(0, pair.to),
    text: source.slice(pair.openLen, pair.to - pair.closeLen),
  };
}
