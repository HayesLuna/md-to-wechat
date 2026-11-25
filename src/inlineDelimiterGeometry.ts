import {
  closingSyntaxAttribute,
  openingSyntaxAttribute,
} from './inlineSyntaxEdges';

export type DelimiterSide = -1 | 1;

const graphemes =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null;

export function firstGrapheme(text: string) {
  return (
    graphemes?.segment(text).containing(0)?.segment ??
    text[Symbol.iterator]().next().value
  );
}

export function inlineTextEdge(
  element: Element,
  side: DelimiterSide,
  measureGlyph = false,
) {
  const doc = element.ownerDocument;
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const text = side === -1 ? walker.firstChild() : walker.lastChild();
  if (!text?.nodeValue) return null;
  const value = text.nodeValue;
  const range = doc.createRange();
  let glyph: DOMRect | undefined;
  if (measureGlyph) {
    const index = side === -1 ? 0 : value.length - 1;
    const segment = graphemes?.segment(value).containing(index);
    range.setStart(text, segment?.index ?? index);
    range.setEnd(
      text,
      segment ? segment.index + segment.segment.length : index + 1,
    );
    glyph = range.getBoundingClientRect();
  }
  range.setStart(text, side === -1 ? 0 : value.length);
  range.collapse(true);
  return { caret: range.getBoundingClientRect(), glyph };
}

const measuringContexts = new WeakMap<Document, CanvasRenderingContext2D>();

export function delimiterStops(element: Element, outside: DelimiterSide) {
  const attribute =
    outside === -1 ? openingSyntaxAttribute : closingSyntaxAttribute;
  const syntax = element.getAttribute(attribute);
  const edge = inlineTextEdge(element, outside, true);
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  const fragments = element.getClientRects();
  const box = outside === -1 ? fragments[0] : fragments[fragments.length - 1];
  if (!syntax || !edge || !win || !box) return null;
  const style = win.getComputedStyle(
    element,
    outside === -1 ? '::before' : '::after',
  );
  let context = measuringContexts.get(doc);
  if (!context) {
    context = doc.createElement('canvas').getContext('2d') ?? undefined;
    if (!context) return null;
    measuringContexts.set(doc, context);
  }
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const widths = Array.from(
    { length: syntax.length + 1 },
    (_, index) => context.measureText(syntax.slice(0, index)).width,
  );
  const { caret, glyph } = edge;
  const layout = win.getComputedStyle(element);
  const width = widths[syntax.length];
  // A nested delimiter starts at its own fragment edge. The text edge can
  // sit after several other opening delimiters or before several closers.
  const start =
    outside === -1
      ? box.left +
        parseFloat(layout.paddingLeft) +
        parseFloat(layout.borderLeftWidth)
      : box.right -
        parseFloat(layout.paddingRight) -
        parseFloat(layout.borderRightWidth) -
        width;
  return { caret, glyph, box, stops: widths.map((width) => start + width) };
}
