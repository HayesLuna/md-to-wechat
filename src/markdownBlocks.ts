import { imageIndent, imageIndentPadding } from './outputUtils';
import TaskList from '@tiptap/extension-task-list';
import { Table, TableKit, TableView } from '@tiptap/extension-table';

const taskTokenizer = TaskList.config.markdownTokenizer!;
const tableTokenizer = Table.config.markdownTokenizer!;

// Marked tries custom block tokenizers at every block. Avoid splitting the
// remaining document unless its first nonblank line can start a task list.
export const ArticleTaskList = TaskList.extend({
  markdownTokenizer: {
    ...taskTokenizer,
    tokenize(source, tokens, helpers) {
      if (!/^\s*[-+*]\s+\[[ xX]\]\s+/.test(source)) return undefined;
      return taskTokenizer.tokenize(source, tokens, helpers);
    },
  },
});

// The table tokenizer only needs the first two lines to reject ordinary prose.
// Splitting all remaining lines here makes a many-paragraph document quadratic.
const tableIndentMarker = /^<!-- table-indent=(\d+) -->\n/;
function tableStart(source: string) {
  source = source.replace(tableIndentMarker, '');
  const firstEnd = source.indexOf('\n');
  if (firstEnd < 0 || !source.slice(0, firstEnd).includes('|')) return -1;
  const nextEnd = source.indexOf('\n', firstEnd + 1);
  const separator = source.slice(
    firstEnd + 1,
    nextEnd < 0 ? undefined : nextEnd,
  );
  return /^[ \t|:]*-[ \t|:-]*$/.test(separator) && separator.includes('|')
    ? 0
    : -1;
}

export const ArticleTableKit = TableKit.extend({
  addExtensions() {
    return (this.parent?.() || []).map((extension) =>
      extension.name === 'table'
        ? (extension as typeof Table).extend({
            addOptions() {
              return {
                ...this.parent!(),
                View: class extends TableView {
                  constructor(
                    ...args: ConstructorParameters<typeof TableView>
                  ) {
                    super(...args);
                    this.dom.style.marginLeft = imageIndentPadding(
                      this.node.attrs.indent,
                    );
                  }
                  update(node: Parameters<TableView['update']>[0]) {
                    if (!super.update(node)) return false;
                    this.dom.style.marginLeft = imageIndentPadding(
                      node.attrs.indent,
                    );
                    return true;
                  }
                },
              };
            },
            addAttributes() {
              return {
                ...this.parent?.(),
                indent: {
                  default: 0,
                  parseHTML: (el) =>
                    imageIndent(el.getAttribute('data-block-indent')),
                  renderHTML: (attrs) =>
                    imageIndent(attrs.indent)
                      ? { 'data-block-indent': imageIndent(attrs.indent) }
                      : {},
                },
              };
            },
            renderHTML(props) {
              const result = this.parent!(props);
              if (!Array.isArray(result)) return result;
              if (this.options.renderWrapper) {
                result[1] = {
                  ...(result[1] as Record<string, string>),
                  style: `margin-left:${imageIndentPadding(props.node.attrs.indent)}`,
                };
              }
              return result;
            },
            parseMarkdown(token, helpers) {
              const result = this.parent!(token, helpers);
              if (!result || Array.isArray(result)) return result;
              return {
                ...result,
                attrs: { ...result.attrs, indent: imageIndent(token.indent) },
              };
            },
            renderMarkdown(node, helpers, context) {
              const text = this.parent!(node, helpers, context);
              const indent = imageIndent(node.attrs?.indent);
              return indent
                ? `<!-- table-indent=${indent} -->\n${text.trimStart()}`
                : text;
            },
            markdownTokenizer: {
              ...tableTokenizer,
              start: tableStart,
              tokenize(...args: Parameters<typeof tableTokenizer.tokenize>) {
                const [source, tokens, helpers] = args;
                if (tableStart(source) < 0) return undefined;
                const marker = tableIndentMarker.exec(source);
                const plain = source.replace(tableIndentMarker, '');
                const table = marker
                  ? helpers.blockTokens(plain)[0]
                  : tableTokenizer.tokenize(plain, tokens, helpers);
                return table?.type === 'table' && marker
                  ? {
                      ...table,
                      raw: marker[0] + table.raw,
                      indent: imageIndent(marker[1]),
                    }
                  : table;
              },
            },
          })
        : extension,
    );
  },
});
