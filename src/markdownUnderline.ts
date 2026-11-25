import MarkdownIt from 'markdown-it';

let linkParser: MarkdownIt | undefined;

type InlineTokens = (source: string) => { type?: string; raw?: string }[];

export function underlineSpan(
  source: string,
  options: { env?: Record<string, unknown>; inlineTokens?: InlineTokens } = {},
) {
  const html = /^<u>/i.test(source);
  if (!html && !source.startsWith('++')) return undefined;

  const openingLength = html ? 3 : 2;
  const tokens = /\\[\s\S]|`+|!?\[|<\/?u>|\+\+/gi;
  tokens.lastIndex = openingLength;
  let depth = 1;
  let linkState: InstanceType<MarkdownIt['inline']['State']> | undefined;
  for (let token = tokens.exec(source); token; token = tokens.exec(source)) {
    const symbol = token[0].toLowerCase();
    if (symbol.startsWith('`')) {
      const fence = new RegExp('(?<!`)`{' + symbol.length + '}(?!`)', 'g');
      fence.lastIndex = tokens.lastIndex;
      if (fence.exec(source)) tokens.lastIndex = fence.lastIndex;
      continue;
    }
    if (symbol === '[' || symbol === '![') {
      linkParser ??= new MarkdownIt({ html: false });
      linkState ??= new linkParser.inline.State(
        source,
        linkParser,
        options.env ?? {},
        [],
      );
      linkState.pos = token.index;
      linkParser.inline.skipToken(linkState);
      // The Markdown parser consumes valid links and images as one token,
      // including their quoted title and destination.
      const skipped = linkState.pos;
      if (skipped > tokens.lastIndex) {
        tokens.lastIndex = skipped;
      } else if (options.inlineTokens) {
        // The editor's Markdown lexer has the document's reference links.
        // Give it just the candidate label or label pair to resolve.
        const label = linkParser.helpers.parseLinkLabel(
          linkState,
          tokens.lastIndex - 1,
          true,
        );
        if (label >= 0) {
          const reference =
            source[label + 1] === '['
              ? linkParser.helpers.parseLinkLabel(linkState, label + 1)
              : -1;
          const end = Math.max(label, reference) + 1;
          const candidate = source.slice(token.index, end);
          if (/<\/?u>|\+\+/i.test(candidate)) {
            const resolved = options.inlineTokens(candidate)[0];
            if (
              (resolved?.type === 'link' || resolved?.type === 'image') &&
              resolved.raw === candidate
            )
              tokens.lastIndex = end;
          }
        }
      }
      continue;
    }
    if (html && symbol === '<u>') depth++;
    if (symbol !== (html ? '</u>' : '++') || --depth !== 0) continue;

    const body = source.slice(openingLength, token.index);
    const text = html ? body : body.trim();
    if (!text) return undefined;
    const leading = html ? 0 : body.length - body.trimStart().length;
    return {
      raw: source.slice(0, tokens.lastIndex),
      text,
      from: openingLength + leading,
    };
  }
  return undefined;
}

// Render only paired underline syntax. Other raw HTML stays escaped.
export function markdownUnderline(md: MarkdownIt) {
  md.inline.ruler.before('emphasis', 'underline', (state, silent) => {
    const first = state.src[state.pos];
    if (first !== '<' && first !== '+') return false;
    const span = underlineSpan(state.src.slice(state.pos, state.posMax), {
      env: state.env,
    });
    if (!span) return false;
    const end = state.pos + span.raw.length;
    if (!silent) {
      const limit = state.posMax;
      state.pos += span.from;
      state.posMax = state.pos + span.text.length;
      state.push('underline_open', 'u', 1);
      state.md.inline.tokenize(state);
      state.push('underline_close', 'u', -1);
      state.posMax = limit;
    }
    state.pos = end;
    return true;
  });
}
