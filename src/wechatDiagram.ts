import DOMPurify from 'dompurify';
import { workBudget } from './workBudget';

const ns = 'http://www.w3.org/2000/svg';
// Read the attached SVG and write a detached clone to avoid a style/layout
// flush for every node. CSS geometry is baked into SVG transform attributes.
const properties = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'alignment-baseline',
  'text-decoration',
  'letter-spacing',
  'white-space',
  'visibility',
  'display',
  'paint-order',
  'color',
];

function reference(value: string) {
  return value.match(/url\(["']?[^)]*#([^"')]+)["']?\)/)?.[1];
}

function expandMarker(
  source: SVGGeometryElement,
  target: SVGElement,
  marker: SVGMarkerElement,
  start: boolean,
) {
  const length = source.getTotalLength();
  if (!length) return;
  const point = source.getPointAtLength(start ? 0 : length);
  const near = source.getPointAtLength(
    start ? Math.min(0.01, length) : Math.max(0, length - 0.01),
  );
  const orient = marker.getAttribute('orient') || '0';
  let angle = orient.startsWith('auto')
    ? (Math.atan2(
        start ? near.y - point.y : point.y - near.y,
        start ? near.x - point.x : point.x - near.x,
      ) *
        180) /
      Math.PI
    : marker.orientAngle.baseVal.value;
  if (start && orient === 'auto-start-reverse') angle += 180;
  const box = marker.viewBox.baseVal;
  const width = marker.markerWidth.baseVal.value;
  const height = marker.markerHeight.baseVal.value;
  let sx = box.width ? width / box.width : 1;
  let sy = box.height ? height / box.height : 1;
  let dx = 0;
  let dy = 0;
  const aspect = marker.preserveAspectRatio.baseVal;
  if (box.width && box.height && aspect.align !== 1) {
    sx = sy = aspect.meetOrSlice === 2 ? Math.max(sx, sy) : Math.min(sx, sy);
    dx =
      (width - box.width * sx) *
      ([2, 5, 8].includes(aspect.align)
        ? 0
        : [3, 6, 9].includes(aspect.align)
          ? 0.5
          : 1);
    dy =
      (height - box.height * sy) *
      (aspect.align <= 4 ? 0 : aspect.align <= 7 ? 0.5 : 1);
  }
  const units =
    marker.getAttribute('markerUnits') === 'userSpaceOnUse'
      ? 1
      : parseFloat(getComputedStyle(source).strokeWidth) || 1;
  const refX = (marker.refX.baseVal.value - box.x) * sx + dx;
  const refY = (marker.refY.baseVal.value - box.y) * sy + dy;
  const group = document.createElementNS(ns, 'g');
  group.setAttribute(
    'transform',
    `translate(${point.x} ${point.y}) rotate(${angle}) scale(${units}) translate(${-refX + dx} ${-refY + dy}) scale(${sx} ${sy}) translate(${-box.x} ${-box.y})`,
  );
  for (const child of marker.children) group.append(child.cloneNode(true));
  const visibility = target.style.visibility;
  if (visibility && visibility !== 'visible') {
    // Visibility can be overridden by a child's inlined value, unlike opacity
    // and display. Definitions were measured outside the hidden edge.
    for (const child of group.querySelectorAll<SVGElement>('*'))
      child.style.visibility = visibility;
  }
  const transform = target.getAttribute('transform');
  const outer = document.createElementNS(ns, 'g');
  if (transform) outer.setAttribute('transform', transform);
  // Native markers are painted as part of the edge. Sibling geometry must
  // carry its compositing/visibility state explicitly.
  for (const property of ['opacity', 'visibility', 'display'])
    outer.style.setProperty(property, target.style.getPropertyValue(property));
  outer.append(group);
  target.after(outer);
}

// Called only while explicitly preparing publication output. Editor rendering
// and Markdown parsing never attach or measure this export tree.
export async function wechatDiagram(svg: SVGSVGElement, signal?: AbortSignal) {
  const checkpoint = workBudget(signal);
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;inset:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none';
  host.setAttribute('aria-hidden', 'true');
  // Isolate Mermaid's generated ID selectors from both the editor and other
  // diagrams. Do not move or mutate the live editor/preview SVG.
  const shadow = host.attachShadow({ mode: 'closed' });
  const measured = svg.cloneNode(true) as SVGSVGElement;
  shadow.append(measured);
  document.body.append(host);
  try {
    const output = measured.cloneNode(true) as SVGSVGElement;
    const originals = [measured, ...measured.querySelectorAll<SVGElement>('*')];
    const copies = [output, ...output.querySelectorAll<SVGElement>('*')];
    const markers = new Map<string, SVGMarkerElement>();
    for (let i = 0; i < originals.length; i++) {
      const pause = checkpoint();
      if (pause) await pause;
      const original = originals[i];
      const copy = copies[i];
      if (original.localName === 'style') continue;
      const style = getComputedStyle(original);
      for (const property of ['clip-path', 'mask-image', 'filter']) {
        const value = style.getPropertyValue(property);
        if (value && value !== 'none')
          throw new Error('图表包含无法展开的引用');
      }
      copy.removeAttribute('style');
      for (const property of properties) {
        const value = style.getPropertyValue(property);
        if (value) copy.style.setProperty(property, value);
      }
      if (style.transform !== 'none') {
        const matrix = new DOMMatrix(style.transform);
        if (!matrix.is2D) throw new Error('图表包含不支持的三维变换');
        const origin = style.transformOrigin.split(/\s+/).map(parseFloat);
        let x = origin[0] || 0;
        let y = origin[1] || 0;
        if (style.transformBox === 'fill-box') {
          const box = (original as SVGGraphicsElement).getBBox();
          x += box.x;
          y += box.y;
        } else if (style.transformBox === 'stroke-box') {
          throw new Error('图表包含不支持的变换参照框');
        }
        const baked = new DOMMatrix()
          .translate(x, y)
          .multiply(matrix)
          .translate(-x, -y);
        copy.setAttribute(
          'transform',
          `matrix(${baked.a} ${baked.b} ${baked.c} ${baked.d} ${baked.e} ${baked.f})`,
        );
        copy.removeAttribute('transform-origin');
      }
      if (copy.localName === 'marker' && copy.id)
        markers.set(copy.id, copy as SVGMarkerElement);
    }
    for (let i = 0; i < originals.length; i++) {
      const pause = checkpoint();
      if (pause) await pause;
      const original = originals[i];
      const copy = copies[i];
      const style = getComputedStyle(original);
      for (const position of ['start', 'end'] as const) {
        const value = style.getPropertyValue(`marker-${position}`);
        const id = reference(value);
        if (id) {
          const marker = markers.get(id);
          if (!marker || !(original instanceof SVGGeometryElement))
            throw new Error('无法展开图表箭头');
          expandMarker(original, copy, marker, position === 'start');
        }
        copy.removeAttribute(`marker-${position}`);
      }
      if (reference(style.getPropertyValue('marker-mid')))
        throw new Error('暂不支持中间箭头');
    }
    output
      .querySelectorAll('style,defs,marker,title,desc')
      .forEach((el) => el.remove());
    // Unsupported references must fall back visibly instead of exporting a
    // broken picture after WeChat removes IDs/definitions.
    for (const el of [output, ...output.querySelectorAll('*')]) {
      const pause = checkpoint();
      if (pause) await pause;
      if (el.matches('use,foreignObject,image'))
        throw new Error('图表需要图片导出');
      for (const attr of Array.from(el.attributes)) {
        if (
          /url\(/i.test(attr.value) ||
          /^(clip-path|mask|filter)$/.test(attr.name)
        )
          throw new Error('图表包含无法展开的引用');
        if (
          ['id', 'class', 'role'].includes(attr.name) ||
          /^(data-|aria-)/.test(attr.name)
        )
          el.removeAttribute(attr.name);
      }
    }
    const box = measured.viewBox.baseVal;
    if (!(box.width > 0 && box.height > 0)) throw new Error('图表尺寸无效');
    const width = Math.min(677, box.width);
    output.setAttribute('width', String(width));
    output.setAttribute('height', String((width * box.height) / box.width));
    output.setAttribute('aria-label', 'Mermaid 图表');
    output.style.cssText +=
      ';display:block;max-width:100%;height:auto;margin:0 auto;';
    const safe = DOMPurify.sanitize(output.outerHTML, {
      USE_PROFILES: { svg: true },
      FORBID_TAGS: ['style', 'script', 'foreignObject', 'a', 'image', 'use'],
      FORBID_ATTR: ['id', 'class'],
    });
    const container = document.createElement('section');
    container.style.cssText = 'margin:20px 0;text-align:center;';
    container.innerHTML = safe;
    return container;
  } finally {
    host.remove();
  }
}
