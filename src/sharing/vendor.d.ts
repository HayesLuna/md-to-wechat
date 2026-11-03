// Use COS's source entry so its XML dependency can receive security updates,
// instead of bundling the SDK's prebuilt copy of that dependency.
declare module 'cos-js-sdk-v5/index.js' {
  import COS from 'cos-js-sdk-v5';
  export default COS;
}

declare module 'markdown-it/lib/rules_inline/image.mjs' {
  import type { RuleInline } from 'markdown-it/lib/parser_inline.mjs';
  const image: RuleInline;
  export default image;
}

declare module 'markdown-it/lib/rules_block/reference.mjs' {
  import type { RuleBlock } from 'markdown-it/lib/parser_block.mjs';
  const reference: RuleBlock;
  export default reference;
}

declare module 'markdown-it/lib/rules_block/table.mjs' {
  import type { RuleBlock } from 'markdown-it/lib/parser_block.mjs';
  const table: RuleBlock;
  export default table;
}
