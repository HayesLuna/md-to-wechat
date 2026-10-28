import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  lowlight,
  syntaxRevision,
  MAX_CODE_HIGHLIGHT_CHARACTERS,
} from './syntax';

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
  const pending = new Map<number, ProseMirrorNode>();
  let appliedRevision = syntaxRevision;
  const decorateBlock = (node: ProseMirrorNode, pos: number): Decoration[] => {
    const language = String(node.attrs.language || '').toLowerCase();
    if (
      !language ||
      language === 'mermaid' ||
      node.content.size > MAX_CODE_HIGHLIGHT_CHARACTERS ||
      !lowlight.registered(language)
    )
      return [];
    let entry = cache.get(node);
    if (!entry || entry.revision !== syntaxRevision) {
      const spans: Span[] = [];
      let offset = 0;
      const visit = (token: Token, inherited: string[] = []) => {
        const classes = [...inherited, ...(token.properties?.className || [])];
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
    return entry.spans.map((span) =>
      Decoration.inline(pos + 1 + span.from, pos + 1 + span.to, {
        class: span.classes,
      }),
    );
  };
  const decorations = (doc: ProseMirrorNode) => {
    const result: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock')
        result.push(...decorateBlock(node, pos));
      return !node.isTextblock;
    });
    pending.clear();
    appliedRevision = syntaxRevision;
    return DecorationSet.create(doc, result);
  };
  const changedBlocks = (tr: Transaction) => {
    const blocks = new Map<number, ProseMirrorNode>();
    const visit = (from: number, to: number) =>
      tr.doc.nodesBetween(
        Math.max(0, from - 1),
        Math.min(tr.doc.content.size, to + 1),
        (node, pos) => {
          if (!node.isTextblock) return;
          blocks.set(pos, node);
          return false;
        },
      );
    tr.steps.forEach((step, index) => {
      const after = tr.mapping.slice(index + 1);
      let changed = false;
      step.getMap().forEach((_a, _b, from, to) => {
        changed = true;
        visit(after.map(from, -1), after.map(to, 1));
      });
      if (!changed) {
        const { from, to, pos } = step.toJSON() as {
          from?: number;
          to?: number;
          pos?: number;
        };
        if (from !== undefined && to !== undefined)
          visit(after.map(from, -1), after.map(to, 1));
        else if (pos !== undefined) visit(after.map(pos), after.map(pos));
        else visit(0, tr.doc.content.size);
      }
    });
    return blocks;
  };
  const refresh = (doc: ProseMirrorNode, previous: DecorationSet) => {
    if (appliedRevision !== syntaxRevision) return decorations(doc);
    if (!pending.size) return previous;
    const ranges: { from: number; to: number }[] = [],
      add: Decoration[] = [],
      remove: Decoration[] = [];
    for (const [pos, node] of pending) {
      ranges.push({ from: pos, to: pos + node.nodeSize });
      remove.push(...previous.find(pos, pos + node.nodeSize));
      add.push(...decorateBlock(node, pos));
    }
    pending.clear();
    // Dense local removal is quadratic in PM. Reuse the existing decoration
    // objects when a bulk tree rebuild is cheaper than removing them one by one.
    if (remove.length > 128)
      return DecorationSet.create(doc, [
        ...previous
          .find()
          .filter((d) => !ranges.some((r) => d.from >= r.from && d.to <= r.to)),
        ...add,
      ]);
    return previous.remove(remove).add(doc, add);
  };
  return new Plugin<DecorationSet>({
    key: codeHighlightKey,
    state: {
      init: (_, state) => decorations(state.doc),
      apply: (tr, previous) => {
        if (tr.getMeta(codeHighlightKey)) return refresh(tr.doc, previous);
        if (!tr.docChanged) return previous;
        const shifted = [...pending.keys()].map((pos) =>
          tr.mapping.map(pos, 1),
        );
        pending.clear();
        for (const pos of shifted) {
          const node = tr.doc.nodeAt(pos);
          if (node?.type.name === 'codeBlock') pending.set(pos, node);
        }
        let mapped = previous.map(tr.mapping, tr.doc);
        for (const [pos, node] of changedBlocks(tr)) {
          if (node.type.name === 'codeBlock') pending.set(pos, node);
          else mapped = mapped.remove(mapped.find(pos, pos + node.nodeSize));
        }
        return mapped;
      },
    },
    props: { decorations: (state) => codeHighlightKey.getState(state) },
    view: () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return {
        update: (view, previous) => {
          if (previous.doc === view.state.doc) return;
          clearTimeout(timer);
          if (!pending.size) return;
          timer = setTimeout(() => {
            if (!view.isDestroyed && pending.size)
              view.dispatch(view.state.tr.setMeta(codeHighlightKey, true));
          }, 100);
        },
        destroy: () => clearTimeout(timer),
      };
    },
  });
}
