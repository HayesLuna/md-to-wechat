import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { lowlight, syntaxRevision } from './syntax';

export const codeHighlightKey = new PluginKey<DecorationSet>(
  'mojian-code-highlight',
);
type Token = {
  type: string;
  value?: string;
  properties?: { className?: string[] };
  children?: Token[];
};
type Span = { from: number; to: number; classes: string };

export function codeHighlightPlugin() {
  // ProseMirror nodes are immutable. Unchanged blocks keep their tokenization,
  // including across selection changes, edits elsewhere, and undo.
  const cache = new WeakMap<
    ProseMirrorNode,
    { revision: number; spans: Span[] }
  >();
  const decorations = (doc: ProseMirrorNode) => {
    const result: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name !== 'codeBlock') return !node.isTextblock;
      const language = String(node.attrs.language || '').toLowerCase();
      if (!language || language === 'mermaid' || !lowlight.registered(language))
        return false;
      let entry = cache.get(node);
      if (!entry || entry.revision !== syntaxRevision) {
        const spans: Span[] = [];
        let offset = 0;
        const visit = (token: Token, inherited: string[] = []) => {
          const classes = [
            ...inherited,
            ...(token.properties?.className || []),
          ];
          if (token.children)
            token.children.forEach((child) => visit(child, classes));
          else if (token.value) {
            const end = offset + token.value.length;
            if (classes.length)
              spans.push({ from: offset, to: end, classes: classes.join(' ') });
            offset = end;
          }
        };
        visit(lowlight.highlight(language, node.textContent));
        entry = { revision: syntaxRevision, spans };
        cache.set(node, entry);
      }
      for (const span of entry.spans)
        result.push(
          Decoration.inline(pos + 1 + span.from, pos + 1 + span.to, {
            class: span.classes,
          }),
        );
      return false;
    });
    return DecorationSet.create(doc, result);
  };
  return new Plugin<DecorationSet>({
    key: codeHighlightKey,
    state: {
      init: (_, state) => decorations(state.doc),
      apply: (tr, previous) =>
        tr.getMeta(codeHighlightKey)
          ? decorations(tr.doc)
          : tr.docChanged
            ? previous.map(tr.mapping, tr.doc)
            : previous,
    },
    props: { decorations: (state) => codeHighlightKey.getState(state) },
    view: () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return {
        update: (view, previous) => {
          if (previous.doc === view.state.doc) return;
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (!view.isDestroyed)
              view.dispatch(view.state.tr.setMeta(codeHighlightKey, true));
          }, 100);
        },
        destroy: () => clearTimeout(timer),
      };
    },
  });
}
