// Boundary tabs have structural meaning in Markdown: they can create code
// blocks or be trimmed from headings. Numeric entities keep them as literal
// text on roundtrip. Interior tabs and tabs in code are left untouched.
export function preserveBoundaryTabs(text: string) {
  const encode = (spaces: string) =>
    spaces.replace(/ /g, '&#32;').replace(/\t/g, '&#9;');
  return text
    .replace(/^[ \t]*\t[ \t]*/, encode)
    .replace(/[ \t]*\t[ \t]*$/, encode);
}

// Markdown container parsers can expand interior tabs. Encode prose tabs before
// reparsing while preserving inline-code contents and their backtick fences.
export function preserveProseTabs(text: string) {
  if (!text.includes('\t')) return text;
  const tokens = Array.from(text.matchAll(/`+|\t/g));
  const next = new Map<number, number>();
  const closing = new Map<number, number>();
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i][0];
    if (token === '\t') continue;
    const match = next.get(token.length);
    if (match !== undefined) closing.set(i, match);
    next.set(token.length, i);
  }
  let result = '',
    offset = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i],
      start = token.index;
    result += text.slice(offset, start);
    if (token[0] === '\t') result += '&#9;';
    else {
      let backslashes = 0;
      for (let p = start - 1; p >= 0 && text[p] === '\\'; p--) backslashes++;
      const end = backslashes % 2 === 0 ? closing.get(i) : undefined;
      if (end !== undefined) {
        const last = tokens[end];
        offset = last.index + last[0].length;
        result += text.slice(start, offset);
        i = end;
        continue;
      }
      result += token[0];
    }
    offset = start + token[0].length;
  }
  return result + text.slice(offset);
}
