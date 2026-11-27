import { useMemo, type CSSProperties } from 'react';
import { useSidebarResize } from './useSidebarResize';

type HeadingItem = { text: string; level: number; line: number };

function baseHeadingLevel(headings: HeadingItem[]) {
  return headings.reduce(
    (level, h) => Math.min(level, h.level),
    headings[0]?.level ?? 1,
  );
}

export function OutlineSidebar({
  headings,
  activeHeading,
  onHeading,
}: {
  headings: HeadingItem[];
  activeHeading: number;
  onHeading: (index: number) => void;
}) {
  const { width, resizing, sidebar, handleProps } = useSidebarResize({
    side: 'right',
    storageKey: 'mojian-outline-width',
    defaultWidth: 236,
    ariaLabel: '调整大纲栏宽度',
  });
  const base = useMemo(() => baseHeadingLevel(headings), [headings]);
  return (
    <aside
      ref={sidebar}
      id="outline-sidebar"
      className={`document-sidebar outline-sidebar ${resizing ? 'resizing' : ''}`}
      style={{ '--sidebar-width': `${width}px` } as CSSProperties}
      aria-label="文章大纲"
    >
      <div className="sidebar-resize-handle" {...handleProps} />
      <header className="sidebar-header outline-header">
        <span className="outline-tab">大纲</span>
      </header>
      <div
        id="outline-content"
        role="region"
        aria-label="大纲目录"
        className="sidebar-content sidebar-outline"
      >
        {headings.map((h, index) => (
          <button
            key={index}
            className={index === activeHeading ? 'current' : ''}
            data-depth={Math.min(Math.max(h.level - base, 0), 3)}
            aria-current={index === activeHeading ? 'location' : undefined}
            style={{ paddingLeft: 16 + (h.level - base) * 14 }}
            onClick={() => onHeading(index)}
          >
            {h.text || '无标题'}
          </button>
        ))}
        {!headings.length && (
          <p className="sidebar-empty">添加标题后，这里会显示文章大纲</p>
        )}
      </div>
    </aside>
  );
}

export function OutlineMinimap({
  headings,
  activeHeading,
  onHeading,
}: {
  headings: HeadingItem[];
  activeHeading: number;
  onHeading: (index: number) => void;
}) {
  const base = useMemo(() => baseHeadingLevel(headings), [headings]);
  if (!headings.length) return null;
  const maxBars = 28;
  const items =
    headings.length <= maxBars
      ? headings.map((h, index) => ({ h, index }))
      : Array.from({ length: maxBars }, (_, i) => {
          const index = Math.round((i * (headings.length - 1)) / (maxBars - 1));
          return { h: headings[index], index };
        });
  const activeBarIndex = items.reduce(
    (best, item, i) =>
      Math.abs(item.index - activeHeading) <
      Math.abs(items[best].index - activeHeading)
        ? i
        : best,
    0,
  );
  return (
    <nav className="outline-minimap" aria-label="大纲缩略导航">
      {items.map(({ h, index }, i) => {
        const label = h.text || '无标题';
        const isCurrent = i === activeBarIndex;
        return (
          <button
            key={index}
            type="button"
            className={`outline-minimap-item ${isCurrent ? 'active' : ''}`}
            aria-label={label}
            aria-current={isCurrent ? 'location' : undefined}
            onClick={() => onHeading(index)}
          >
            <span
              className="outline-minimap-bar"
              data-depth={Math.min(Math.max(h.level - base, 0), 2)}
              aria-hidden="true"
            />
            <span className="outline-minimap-tip" aria-hidden="true">
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
