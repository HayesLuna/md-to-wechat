import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { Search, Plus, Pencil, Trash2, GripVertical } from 'lucide-react';
import { DraftListIcon, OutlineIcon } from './NavigationIcons';
import { useSidebarResize } from './useSidebarResize';
import type { DraftSummary } from './storage';

type DraftPosition = {
  id: string;
  top: number;
  height: number;
  element: HTMLLIElement;
};

export function DocumentSidebar({
  tab,
  onTab,
  searching,
  onSearchToggle,
  query,
  onQuery,
  drafts,
  total,
  activeId,
  busy,
  onCreate,
  onSelect,
  onRename,
  onDelete,
  onReorder,
  headings,
  activeHeading,
  onHeading,
}: {
  tab: 'drafts' | 'outline';
  onTab: (tab: 'drafts' | 'outline') => void;
  searching: boolean;
  onSearchToggle: () => void;
  query: string;
  onQuery: (value: string) => void;
  drafts: DraftSummary[];
  total: number;
  activeId?: string;
  busy: boolean;
  onCreate: () => void;
  onSelect: (draft: DraftSummary) => void;
  onRename: (draft: DraftSummary) => void;
  onDelete: (draft: DraftSummary) => void;
  onReorder: (id: string, targetId: string, side: 'before' | 'after') => void;
  headings: { text: string; level: number; line: number }[];
  activeHeading: number;
  onHeading: (index: number) => void;
}) {
  const { width, resizing, sidebar, handleProps } = useSidebarResize();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const canReorder =
    tab === 'drafts' && !busy && !normalizedQuery && drafts.length > 1;
  const scrollArea = useRef<HTMLDivElement>(null);
  const settleFrame = useRef<number | null>(null);
  const pointerSession = useRef<{
    id: string;
    pointerId: number;
    element: HTMLSpanElement;
    row: HTMLLIElement | null;
    x: number;
    y: number;
    startY: number;
    scrollStart: number;
    bounds: DOMRect | null;
    positions: DraftPosition[];
    active: boolean;
    timer?: ReturnType<typeof setTimeout>;
    scrollTimer?: number;
    onKeyDown?: (event: globalThis.KeyboardEvent) => void;
  } | null>(null);
  const dropRef = useRef<{ id: string; side: 'before' | 'after' } | null>(null);
  const clearSettling = () => {
    if (settleFrame.current !== null) cancelAnimationFrame(settleFrame.current);
    settleFrame.current = null;
    scrollArea.current
      ?.querySelector('.draft-list')
      ?.classList.remove('settling');
  };
  const applyDrop = (next: { id: string; side: 'before' | 'after' } | null) => {
    const session = pointerSession.current;
    if (!session) return;
    if (
      dropRef.current?.id === next?.id &&
      dropRef.current?.side === next?.side
    )
      return;
    const rows = session.positions;
    const sourceIndex = rows.findIndex((item) => item.id === session.id);
    const targetIndex = rows.findIndex((item) => item.id === next?.id);
    const insertionIndex = targetIndex + (next?.side === 'after' ? 1 : 0);
    const destinationIndex =
      targetIndex < 0
        ? sourceIndex
        : insertionIndex > sourceIndex
          ? insertionIndex - 1
          : insertionIndex;
    const height = rows[sourceIndex]?.height ?? 0;
    rows.forEach((item, index) => {
      const shift =
        index > sourceIndex && index <= destinationIndex
          ? -height
          : index >= destinationIndex && index < sourceIndex
            ? height
            : 0;
      const value = item.element.style.getPropertyValue('--draft-shift');
      if (shift && value !== `${shift}px`)
        item.element.style.setProperty('--draft-shift', `${shift}px`);
      else if (!shift && value)
        item.element.style.removeProperty('--draft-shift');
    });
    dropRef.current = next;
  };
  const finishPointer = (commit: boolean) => {
    const session = pointerSession.current;
    if (!session) return;
    if (session.timer) clearTimeout(session.timer);
    if (session.scrollTimer) window.clearInterval(session.scrollTimer);
    if (session.onKeyDown)
      document.removeEventListener('keydown', session.onKeyDown);
    const target = dropRef.current;
    const sourceIndex = session.positions.findIndex(
      (item) => item.id === session.id,
    );
    const targetIndex = session.positions.findIndex(
      (item) => item.id === target?.id,
    );
    const insertionIndex = targetIndex + (target?.side === 'after' ? 1 : 0);
    const destinationIndex =
      insertionIndex > sourceIndex ? insertionIndex - 1 : insertionIndex;
    const shouldCommit =
      commit &&
      session.active &&
      !!target &&
      sourceIndex >= 0 &&
      targetIndex >= 0 &&
      destinationIndex !== sourceIndex;
    const list = scrollArea.current?.querySelector('.draft-list');
    if (shouldCommit) list?.classList.add('settling');
    applyDrop(null);
    pointerSession.current = null;
    if (session.element.hasPointerCapture(session.pointerId))
      session.element.releasePointerCapture(session.pointerId);
    session.row?.classList.remove('dragging');
    if (shouldCommit && target) {
      try {
        flushSync(() => onReorder(session.id, target.id, target.side));
      } finally {
        settleFrame.current = requestAnimationFrame(() => {
          settleFrame.current = requestAnimationFrame(clearSettling);
        });
      }
    }
  };
  const updateDrop = (x: number, y: number) => {
    const session = pointerSession.current;
    const area = scrollArea.current;
    if (!session || !area) return;
    const bounds = session.bounds;
    if (!bounds) return;
    if (
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top ||
      y > bounds.bottom
    ) {
      if (!dropRef.current) return;
      applyDrop(null);
      return;
    }
    const scrolledY = y + area.scrollTop - session.scrollStart;
    const rows = session.positions;
    const row =
      rows.find((item) => scrolledY < item.top + item.height) ??
      rows[rows.length - 1];
    if (!row) return;
    const side: 'before' | 'after' =
      scrolledY < row.top + row.height / 2 ? 'before' : 'after';
    const targetId = row?.id;
    const next =
      targetId && targetId !== session.id ? { id: targetId, side } : null;
    applyDrop(next);
  };
  const positionDraggedRow = () => {
    const session = pointerSession.current;
    const area = scrollArea.current;
    if (!session?.active || !area) return;
    const offset =
      session.y - session.startY + area.scrollTop - session.scrollStart;
    session.row?.style.setProperty('--draft-drag-y', `${offset}px`);
  };
  const activatePointer = () => {
    const session = pointerSession.current;
    const area = scrollArea.current;
    if (!session || !area) return;
    session.scrollStart = area.scrollTop;
    session.bounds = area.getBoundingClientRect();
    const rows = Array.from(
      area.querySelectorAll<HTMLLIElement>('[data-draft-id]'),
    );
    const first = rows[0];
    if (!first) return;
    const transform = getComputedStyle(first).transform;
    const shifted =
      transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
    const firstTop = first.getBoundingClientRect().top - shifted;
    const firstOffset = first.offsetTop;
    session.positions = rows.map((row) => ({
      id: row.dataset.draftId!,
      top: firstTop + row.offsetTop - firstOffset,
      height: row.offsetHeight,
      element: row,
    }));
    session.active = true;
    session.row?.classList.add('dragging');
    session.scrollTimer = window.setInterval(() => {
      if (pointerSession.current !== session) return;
      const rect = session.bounds;
      if (!rect) return;
      const edge = 34;
      const step =
        session.y < rect.top + edge
          ? -12
          : session.y > rect.bottom - edge
            ? 12
            : 0;
      if (step) {
        area.scrollTop += step;
        updateDrop(session.x, session.y);
        positionDraggedRow();
      }
    }, 30);
    session.onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finishPointer(false);
      }
    };
    document.addEventListener('keydown', session.onKeyDown);
    positionDraggedRow();
  };
  useEffect(() => {
    if (!canReorder) finishPointer(false);
  }, [canReorder]);
  useEffect(() => {
    const area = scrollArea.current;
    if (!area) return;
    const preventDragScroll = (event: TouchEvent) => {
      const session = pointerSession.current;
      if (session?.active && session.element.contains(event.target as Node))
        event.preventDefault();
    };
    area.addEventListener('touchmove', preventDragScroll, { passive: false });
    return () => area.removeEventListener('touchmove', preventDragScroll);
  }, [tab]);
  useEffect(
    () => () => {
      finishPointer(false);
      clearSettling();
    },
    [],
  );
  const handlePointerDown = (
    event: PointerEvent<HTMLSpanElement>,
    id: string,
  ) => {
    if (!canReorder || event.button !== 0) return;
    event.preventDefault();
    clearSettling();
    finishPointer(false);
    const row = event.currentTarget.closest<HTMLLIElement>('[data-draft-id]');
    row?.style.setProperty('--draft-drag-y', '0px');
    event.currentTarget.setPointerCapture(event.pointerId);
    const session = {
      id,
      pointerId: event.pointerId,
      element: event.currentTarget,
      row,
      x: event.clientX,
      y: event.clientY,
      startY: event.clientY,
      scrollStart: 0,
      bounds: null as DOMRect | null,
      positions: [] as DraftPosition[],
      active: false,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
      scrollTimer: undefined as number | undefined,
      onKeyDown: undefined as
        ((event: globalThis.KeyboardEvent) => void) | undefined,
    };
    pointerSession.current = session;
    if (event.pointerType === 'touch')
      session.timer = setTimeout(() => {
        if (pointerSession.current === session) {
          activatePointer();
        }
      }, 300);
  };
  const handlePointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    const session = pointerSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const moved = Math.hypot(
      event.clientX - session.x,
      event.clientY - session.y,
    );
    if (!session.active) {
      if (event.pointerType === 'touch') {
        if (moved > 8) finishPointer(false);
        return;
      }
      if (moved < 5) return;
      activatePointer();
    }
    session.x = event.clientX;
    session.y = event.clientY;
    updateDrop(session.x, session.y);
    positionDraggedRow();
  };
  const visibleHeadings = useMemo(
    () =>
      headings
        .map((h, index) => ({ h, index }))
        .filter(({ h }) =>
          h.text.toLocaleLowerCase().includes(normalizedQuery),
        ),
    [headings, normalizedQuery],
  );
  const base = useMemo(
    () =>
      headings.reduce(
        (level, h) => Math.min(level, h.level),
        headings[0]?.level ?? 1,
      ),
    [headings],
  );
  return (
    <aside
      ref={sidebar}
      id="document-sidebar"
      className={`document-sidebar ${resizing ? 'resizing' : ''}`}
      style={{ '--sidebar-width': `${width}px` } as CSSProperties}
      aria-label="文章导航"
    >
      <header className="sidebar-header">
        <button
          aria-label={tab === 'outline' ? '切换到草稿' : '切换到大纲'}
          title={tab === 'outline' ? '切换到草稿' : '切换到大纲'}
          aria-controls="sidebar-content"
          onClick={() => onTab(tab === 'outline' ? 'drafts' : 'outline')}
        >
          {tab === 'outline' ? (
            <OutlineIcon size={16} />
          ) : (
            <DraftListIcon size={18} />
          )}
        </button>
        <span className="sidebar-title">
          {tab === 'outline' ? '大纲' : '草稿'}
        </span>
        <button
          aria-label={tab === 'drafts' ? '搜索草稿' : '搜索大纲'}
          title="搜索"
          aria-expanded={searching}
          onClick={onSearchToggle}
        >
          <Search size={16} />
        </button>
      </header>
      {searching && (
        <div className="sidebar-search">
          <input
            autoFocus
            aria-label={tab === 'drafts' ? '搜索草稿标题' : '搜索大纲标题'}
            placeholder={tab === 'drafts' ? '搜索草稿…' : '搜索标题…'}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
      )}
      <div
        id="sidebar-content"
        role="region"
        aria-label={tab === 'drafts' ? '草稿箱' : '文章大纲'}
        className={`sidebar-content ${tab === 'drafts' ? 'sidebar-drafts' : 'sidebar-outline'}`}
      >
        {tab === 'drafts' ? (
          <>
            <div className="sidebar-draft-count">
              {total} 篇草稿
              {!!normalizedQuery && total > 1 && (
                <span>清空搜索后可调整顺序</span>
              )}
            </div>
            <div className="sidebar-draft-scroll" ref={scrollArea}>
              <ul className="draft-list">
                {drafts.map((d) => (
                  <li
                    key={d.id}
                    data-draft-id={d.id}
                    className={d.id === activeId ? 'current' : ''}
                  >
                    <span
                      className="draft-drag-handle"
                      aria-hidden="true"
                      data-disabled={!canReorder ? 'true' : undefined}
                      title={
                        normalizedQuery
                          ? '清空搜索后可调整顺序'
                          : '拖动调整顺序'
                      }
                      onPointerDown={(event) => handlePointerDown(event, d.id)}
                      onPointerMove={handlePointerMove}
                      onPointerUp={(event) => {
                        if (
                          pointerSession.current?.pointerId === event.pointerId
                        )
                          finishPointer(true);
                      }}
                      onPointerCancel={(event) => {
                        if (
                          pointerSession.current?.pointerId === event.pointerId
                        )
                          finishPointer(false);
                      }}
                      onLostPointerCapture={() => finishPointer(false)}
                    >
                      <GripVertical size={14} />
                    </span>
                    <button
                      className="draft-select"
                      aria-current={d.id === activeId ? 'page' : undefined}
                      disabled={busy}
                      onClick={() => onSelect(d)}
                    >
                      <strong>{d.title}</strong>
                      <small>
                        {new Date(d.savedAt).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {d.id === activeId ? ' · 当前文章' : ''}
                      </small>
                    </button>
                    <div className="draft-actions">
                      <button
                        disabled={busy}
                        aria-label={`重命名 ${d.title}`}
                        title="重命名"
                        onClick={() => onRename(d)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        disabled={busy}
                        aria-label={`删除 ${d.title}`}
                        title="删除"
                        onClick={() => onDelete(d)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {!drafts.length && (
                <p className="sidebar-empty">没有找到匹配的草稿</p>
              )}
            </div>
            <div className="sidebar-draft-tools">
              <button className="primary" disabled={busy} onClick={onCreate}>
                <Plus size={18} />
                新建文章
              </button>
            </div>
          </>
        ) : (
          <>
            {visibleHeadings.map(({ h, index }) => (
              <button
                key={index}
                className={index === activeHeading ? 'current' : ''}
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
            {!!headings.length && !visibleHeadings.length && (
              <p className="sidebar-empty">没有找到匹配的标题</p>
            )}
          </>
        )}
      </div>
      <div className="sidebar-resize-handle" {...handleProps} />
    </aside>
  );
}
