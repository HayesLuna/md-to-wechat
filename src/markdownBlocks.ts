import TaskList from '@tiptap/extension-task-list';
import { Table, TableKit } from '@tiptap/extension-table';

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
function tableStart(source: string) {
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
        ? extension.extend({
            markdownTokenizer: {
              ...tableTokenizer,
              start: tableStart,
              tokenize(...args: Parameters<typeof tableTokenizer.tokenize>) {
                const [source, tokens, helpers] = args;
                if (tableStart(source) < 0) return undefined;
                return tableTokenizer.tokenize(source, tokens, helpers);
              },
            },
          })
        : extension,
    );
  },
});
