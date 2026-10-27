// Matches highlight.js/styles/github.css (GitHub's light syntax palette).
// Export uses inline styles so the same colors survive the WeChat clipboard.
export function githubHighlightStyle(classes: string) {
  const tokens = new Set(classes.split(/\s+/));
  const has = (...names: string[]) =>
    names.some((name) => tokens.has(`hljs-${name}`));
  if (
    has('doctag', 'keyword', 'template-tag', 'template-variable', 'type') ||
    (has('variable') && tokens.has('language_'))
  )
    return 'color:#d73a49;';
  if (has('title')) return 'color:#6f42c1;';
  if (
    has(
      'attr',
      'attribute',
      'literal',
      'meta',
      'number',
      'operator',
      'variable',
      'selector-attr',
      'selector-class',
      'selector-id',
    )
  )
    return 'color:#005cc5;';
  if (has('regexp', 'string')) return 'color:#032f62;';
  if (has('built_in', 'symbol')) return 'color:#e36209;';
  if (has('comment', 'code', 'formula')) return 'color:#6a737d;';
  if (has('name', 'quote', 'selector-tag', 'selector-pseudo'))
    return 'color:#22863a;';
  if (has('subst')) return 'color:#24292e;';
  if (has('section')) return 'color:#005cc5;font-weight:bold;';
  if (has('bullet')) return 'color:#735c0f;';
  if (has('emphasis')) return 'color:#24292e;font-style:italic;';
  if (has('strong')) return 'color:#24292e;font-weight:bold;';
  if (has('addition')) return 'color:#22863a;background-color:#f0fff4;';
  if (has('deletion')) return 'color:#b31d28;background-color:#ffeef0;';
  return '';
}
