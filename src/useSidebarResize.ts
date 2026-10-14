import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 258;
const STORAGE_KEY = 'mojian-sidebar-width';

function initialWidth() {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

export function useSidebarResize() {
  const [width, setWidth] = useState(initialWidth);
  const [resizing, setResizing] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const currentWidth = useRef(width);
  const drag = useRef<{ x: number; width: number; max: number } | null>(null);

  const maxWidth = () => {
    const available =
      sidebar.current?.parentElement?.getBoundingClientRect().width ?? 800;
    return Math.max(
      MIN_WIDTH,
      Math.min(MAX_WIDTH, available - (available <= 600 ? 40 : 320)),
    );
  };
  const resize = (next: number, max: number) => {
    const value = Math.round(Math.max(MIN_WIDTH, Math.min(max, next)));
    if (value === currentWidth.current) return;
    currentWidth.current = value;
    setWidth(value);
  };
  const finish = () => {
    drag.current = null;
    setResizing(false);
    try {
      localStorage.setItem(STORAGE_KEY, String(currentWidth.current));
    } catch {
      // Resizing still works when browser storage is unavailable.
    }
  };

  const handleProps = {
    role: 'separator' as const,
    tabIndex: 0,
    'aria-label': '调整侧栏宽度',
    'aria-orientation': 'vertical' as const,
    'aria-valuemin': MIN_WIDTH,
    'aria-valuemax': MAX_WIDTH,
    'aria-valuenow': width,
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0 || !sidebar.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        x: event.clientX,
        width: sidebar.current.getBoundingClientRect().width,
        max: maxWidth(),
      };
      setResizing(true);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const start = drag.current;
      if (start) resize(start.width + event.clientX - start.x, start.max);
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      if (!drag.current) return;
      finish();
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: finish,
    onLostPointerCapture() {
      if (drag.current) finish();
    },
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
        return;
      event.preventDefault();
      resize(
        event.key === 'Home'
          ? MIN_WIDTH
          : event.key === 'End'
            ? MAX_WIDTH
            : currentWidth.current + (event.key === 'ArrowRight' ? 10 : -10),
        maxWidth(),
      );
      finish();
    },
  };
  return { width, resizing, sidebar, handleProps };
}
