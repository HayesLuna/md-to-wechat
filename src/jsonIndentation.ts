type TokenPosition = { from: number; to: number; output: number };

// Only called by the code-block action. Never parse values into JS objects:
// number spelling, duplicate keys and string escapes must survive unchanged.
export function indentJSON(source: string) {
  const unchanged = { text: source, mapOffset: (offset: number) => offset };
  if (
    source.length > 20_000 ||
    new TextEncoder().encode(source).length > 20_000
  )
    throw new Error('代码较长，暂不格式化，原文已保留。');

  const parts: string[] = [];
  const positions: TokenPosition[] = [];
  const stack: string[] = [];
  let length = 0;
  let lines = 1;
  let lineStart = true;
  let space = false;
  let previous = '';
  const whitespace = (char: string) =>
    char === ' ' || char === '\t' || char === '\r' || char === '\n';
  const append = (text: string) => {
    parts.push(text);
    length += text.length;
  };
  const newline = () => {
    space = false;
    if (lineStart) return;
    if (++lines > 2000)
      throw new Error('展开后的代码行数较多，暂不格式化，原文已保留。');
    append('\n');
    lineStart = true;
  };
  const token = (from: number, to: number, allowSpace = true) => {
    if (lineStart) append('  '.repeat(stack.length));
    else if (allowSpace && space) append(' ');
    positions.push({ from, to, output: length });
    append(source.slice(from, to));
    lineStart = false;
    space = false;
  };

  // This is whitespace layout, not JSON validation. Opaque values are copied
  // verbatim; string contents and escaped quotes never enter the layout logic.
  for (let index = 0; index < source.length;) {
    const char = source[index];
    if (whitespace(char)) {
      if (previous === 'value') space = true;
      index++;
    } else if (char === '"') {
      const from = index++;
      let closed = false;
      while (index < source.length) {
        const next = source[index++];
        if (next === '\\') index++;
        else if (next === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) return unchanged;
      token(from, index);
      previous = 'value';
    } else if (char === '{' || char === '[') {
      if (stack.length >= 64)
        throw new Error('代码嵌套较深，暂不格式化，原文已保留。');
      token(index, ++index);
      stack.push(char === '{' ? '}' : ']');
      let next = index;
      while (whitespace(source[next])) next++;
      if (source[next] !== stack[stack.length - 1]) newline();
      previous = 'open';
    } else if (char === '}' || char === ']') {
      // An unfinished/mismatched structure cannot be indented reliably.
      if (stack.pop() !== char) return unchanged;
      if (previous !== 'open') newline();
      token(index, ++index, false);
      previous = 'value';
    } else if (char === ',') {
      token(index, ++index, false);
      newline();
      previous = 'comma';
    } else if (char === ':') {
      token(index, ++index, false);
      space = true;
      previous = 'colon';
    } else {
      const from = index++;
      while (
        index < source.length &&
        !whitespace(source[index]) &&
        !'{}[],:"'.includes(source[index])
      )
        index++;
      token(from, index);
      previous = 'value';
    }
  }
  if (stack.length || !positions.length) return unchanged;
  const text = parts.join('');
  return {
    text,
    // Keep a caret/selection attached to the same original token after layout.
    mapOffset(offset: number, association = 1) {
      let low = 0;
      let high = positions.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (
          positions[middle].to < offset ||
          (association > 0 && positions[middle].to === offset)
        )
          low = middle + 1;
        else high = middle;
      }
      const position = positions[low];
      return position
        ? position.output + Math.max(0, offset - position.from)
        : text.length;
    },
  };
}
