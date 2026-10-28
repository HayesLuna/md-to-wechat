import { useLayoutEffect, useRef, useState } from 'react';
import type { Output } from './output';
import type { MediaPreviewItem } from './mediaPreviewEvents';

export function ArticlePreview({
  output,
  preparing,
  onMedia,
}: {
  output: Output | null;
  preparing: boolean;
  onMedia: (item: MediaPreviewItem) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(false);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    if (!output) {
      element.replaceChildren();
      return;
    }
    if (preparing) return;
    let frame = 0,
      index = 0,
      active = true;
    element.innerHTML = output.previewShell;
    const article = element.firstElementChild!;
    setRendering(true);
    const append = () => {
      if (!active) return;
      const start = performance.now();
      do {
        const template = document.createElement('template');
        template.innerHTML = output.previewBlocks[index++];
        article.append(template.content);
      } while (
        index < output.previewBlocks.length &&
        performance.now() - start < 4
      );
      if (index < output.previewBlocks.length)
        frame = requestAnimationFrame(append);
      else setRendering(false);
    };
    if (output.previewBlocks.length) frame = requestAnimationFrame(append);
    else setRendering(false);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [output, preparing]);
  return (
    <div
      ref={host}
      className={`preview-paper ${preparing || rendering ? 'preparing' : ''}`}
      aria-label="公众号排版正文"
      onKeyDown={(event) => {
        if (
          (event.key === 'Enter' || event.key === ' ') &&
          (event.target as HTMLElement).matches('[data-media-preview]')
        ) {
          event.preventDefault();
          (event.target as HTMLElement).click();
        }
      }}
      onClick={(event) => {
        const target = (event.target as Element).closest<HTMLElement>(
          '[data-media-preview]',
        );
        if (!target) return;
        event.preventDefault();
        if (target instanceof HTMLImageElement)
          onMedia({
            kind: 'image',
            url: target.src,
            title: target.alt || '图片',
          });
        else {
          const svg = target.querySelector('svg');
          if (svg)
            onMedia({
              kind: 'diagram',
              svg: svg.outerHTML,
              title: 'Mermaid 图表',
            });
        }
      }}
    />
  );
}
