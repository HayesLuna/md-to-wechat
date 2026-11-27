import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

function initialWidth(storageKey: string, defaultWidth: number) {
  try {
    const saved = Number(localStorage.getItem(storageKey));
    return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : defaultWidth;
  } catch {
    return defaultWidth;
  }
}

export function useSidebarResize({
  side,
  storageKey,
  defaultWidth = 240,
  ariaLabel = '调整侧栏宽度',
}: {
  side: 'left' | 'right';
  storageKey: string;
  defaultWidth?: number;
  ariaLabel?: string;
}) {
  const [width, setWidth] = useState(() =>
    initialWidth(storageKey, defaultWidth),
  );
  const [resizing, setResizing] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const currentWidth = useRef(width);
  const drag = useRef<{ x: number; width: number; max: number } | null>(null);

  const maxWidth = () => {
    const parent = sidebar.current?.parentElement;
    const available = parent?.getBoundingClientRect().width ?? 800;
    if (window.matchMedia('(max-width:800px)').matches || available <= 680) {
      return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, available - 40));
    }
    let others = 0;
    if (parent) {
      for (const el of parent.querySelectorAll<HTMLElement>(
        '.document-sidebar',
      )) {
        if (el !== sidebar.current) others += el.getBoundingClientRect().width;
      }
    }
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, available - others - 320));
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
      localStorage.setItem(storageKey, String(currentWidth.current));
    } catch {
      // Resizing still works when browser storage is unavailable.
    }
  };

  const handleProps = {
    role: 'separator' as const,
    tabIndex: 0,
    'aria-label': ariaLabel,
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
      if (!start) return;
      const delta =
        side === 'left' ? event.clientX - start.x : start.x - event.clientX;
      resize(start.width + delta, start.max);
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
      const step =
        event.key === 'ArrowRight'
          ? side === 'left'
            ? 10
            : -10
          : side === 'left'
            ? -10
            : 10;
      resize(
        event.key === 'Home'
          ? MIN_WIDTH
          : event.key === 'End'
            ? MAX_WIDTH
            : currentWidth.current + step,
        maxWidth(),
      );
      finish();
    },
  };
  return { width, resizing, sidebar, handleProps };
}
