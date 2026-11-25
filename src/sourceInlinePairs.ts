import type { SourcePair } from './sourceDelimiter';

function isEscaped(source: string, index: number) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
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
  for (let i = 0; i < source.length;) {
    if (source[i] !== '`' || isEscaped(source, i)) {
      i++;
      continue;
    }
    const run = /^`+/.exec(source.slice(i))![0].length;
    // Content may itself start with a backtick, merging it into the opener's
    // run. Try shorter fences from the same run until one closes exactly.
    let fence = 0;
    let end = -1;
    for (let length = run; length >= 1 && end < 0; length--) {
      const marker = '`'.repeat(length);
      let at = i + length;
      while (at <= source.length - length) {
        const found = source.indexOf(marker, at);
        if (found < 0) break;
        const width = /^`+/.exec(source.slice(found))![0].length;
        if (width === length && found > i + length) {
          end = found;
          fence = length;
          break;
        }
        at = found + width;
      }
    }
    if (end < 0) {
      i += run;
      continue;
    }
    pairs.push({
      from: i,
      to: end + fence,
      openLen: fence,
      closeLen: fence,
      kind: 'code',
      tag: 'code',
    });
    i = end + fence;
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

// A pair may contain code (or sit inside it), but a pair that half-overlaps a
// code span would produce unbalanced markup.
function crossesAny(
  pair: SourcePair,
  ranges: readonly { from: number; to: number }[],
) {
  return ranges.some((range) => {
    if (pair.from >= range.to || pair.to <= range.from) return false;
    const contains = pair.from <= range.from && pair.to >= range.to;
    const inside = pair.from >= range.from && pair.to <= range.to;
    return !contains && !inside;
  });
}

/**
 * Scan one textblock's source for editable inline delimiter pairs.
 * Code spans are literal: nothing else pairs inside them.
 */
export function sourceInlinePairs(source: string): SourcePair[] {
  const codes = codePairs(source);
  // Mask from the same pairing result so merged fences stay literal for the
  // other scanners too.
  const masked = maskOffsets(
    source,
    codes.map((pair) => ({ from: pair.from, to: pair.to })),
  );
  // Underline/strike may contain code; only drop the ones that cross a code
  // boundary and would serialize to unbalanced markup.
  const outside = [
    ...underlinePairs(source, masked),
    ...symmetricPairs(masked, '~~', 'strike', 's'),
  ].filter((pair) => !crossesAny(pair, codes));
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
