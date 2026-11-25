import type { MarkViewRenderer } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { delimiterStops } from './inlineDelimiterGeometry';
import {
  inlineSyntaxSelectionOffsets,
  revealedInlineMarks,
} from './inlineSyntaxSelection';
import {
  inlineMarkElement,
  openingSyntaxAttribute as opening,
  closingSyntaxAttribute as closing,
} from './inlineSyntaxEdges';

const openingSelected = 'data-md-opening-selected';
const closingSelected = 'data-md-closing-selected';
const openingPartial = 'data-md-opening-partial';
const closingPartial = 'data-md-closing-partial';
const syntaxAttributes = new Set([
  opening,
  closing,
  openingSelected,
  closingSelected,
  openingPartial,
  closingPartial,
  'style',
]);

function setPartialSelection(
  element: Element,
  attribute: string,
  offsets?: string,
) {
  if (!(element instanceof HTMLElement)) return;
  const edge = attribute === openingPartial ? 'opening' : 'closing';
  for (const [index, name] of ['start', 'end'].entries()) {
    const property = `--md-${edge}-selection-${name}`;
    if (offsets) element.style.setProperty(property, offsets.split(' ')[index]);
    else element.style.removeProperty(property);
  }
}

export const inlineSyntaxMarkView: MarkViewRenderer = ({
  mark,
  view,
  inline,
}) => {
  const rendered = DOMSerializer.renderSpec(
    view.dom.ownerDocument,
    mark.type.spec.toDOM!(mark, inline),
  );
  return {
    ...rendered,
    ignoreMutation: (mutation) =>
      mutation.type === 'attributes' &&
      syntaxAttributes.has(mutation.attributeName ?? ''),
  };
};

export function inlineSyntaxPlugin() {
  return new Plugin({
    view(view) {
      let displayed = new Map<Element, Map<string, string>>();
      const update = () => {
        const next = new Map<Element, Map<string, string>>();
        const show = (
          element: Element | null | undefined,
          edge: string,
          syntax: string,
        ) => {
          if (!element) return;
          let edges = next.get(element);
          if (!edges) next.set(element, (edges = new Map()));
          edges.set(edge, syntax);
          if (element.getAttribute(edge) !== syntax) {
            element.setAttribute(edge, syntax);
            if (edge === openingPartial || edge === closingPartial)
              setPartialSelection(element, edge, syntax);
          }
        };
        if (view.editable && view.state.selection instanceof TextSelection) {
          for (const {
            mark: type,
            from,
            to,
            opening: openingText,
            closing: closingText,
          } of revealedInlineMarks(view.state)) {
            const start = inlineMarkElement(view, from, 1, type);
            const end = inlineMarkElement(view, to, -1, type);
            show(start, opening, openingText);
            show(end, closing, closingText);
            for (const [element, pos, outside, text, selected, partial] of [
              [start, from, -1, openingText, openingSelected, openingPartial],
              [end, to, 1, closingText, closingSelected, closingPartial],
            ] as const) {
              if (!element) continue;
              const offsets = inlineSyntaxSelectionOffsets(view.state, {
                pos,
                boundary: { mark: type, outside },
              });
              if (!offsets) continue;
              const [lo, hi] = offsets;
              show(element, selected, '');
              if (lo === 0 && hi === text.length) continue;
              const stops = delimiterStops(element, outside)?.stops;
              if (!stops) continue;
              const width = stops[stops.length - 1] - stops[0];
              show(
                element,
                partial,
                `${((stops[lo] - stops[0]) / width) * 100}% ${((stops[hi] - stops[0]) / width) * 100}%`,
              );
            }
          }
        }
        for (const [element, edges] of displayed)
          for (const edge of edges.keys())
            if (!next.get(element)?.has(edge)) {
              element.removeAttribute(edge);
              if (edge === openingPartial || edge === closingPartial)
                setPartialSelection(element, edge);
            }
        displayed = next;
      };
      return {
        update,
        destroy() {
          for (const [element, edges] of displayed)
            for (const edge of edges.keys()) {
              element.removeAttribute(edge);
              if (edge === openingPartial || edge === closingPartial)
                setPartialSelection(element, edge);
            }
        },
      };
    },
  });
}
