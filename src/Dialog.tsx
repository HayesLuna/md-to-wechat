import { useEffect, useRef } from 'react';
import { Loader2, X } from 'lucide-react';
export function Dialog({
  title,
  children,
  onClose,
  drawer = false,
  className = '',
  closing = false,
  busy = false,
  closeOnEscape = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  drawer?: boolean;
  className?: string;
  closing?: boolean;
  busy?: boolean;
  closeOnEscape?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const focused = document.activeElement as HTMLElement;
    const el = ref.current!;
    el.querySelector<HTMLElement>('input,button,textarea')?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = Array.from(
        el.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),a[href],textarea,select',
        ),
      );
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        items.at(-1)?.focus();
      } else if (!e.shiftKey && i === items.length - 1) {
        e.preventDefault();
        items[0]?.focus();
      }
    };
    el.addEventListener('keydown', trap);
    return () => {
      el.removeEventListener('keydown', trap);
      if (focused?.isConnected) focused.focus();
    };
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (!busy || !element) return;
    const focused = document.activeElement;
    if (!element.contains(focused) || focused?.matches(':disabled'))
      element.focus();
  }, [busy]);
  return (
    <div
      className={`dialog-backdrop ${drawer ? 'drawer-backdrop' : ''}`}
      data-closing={closing}
      onKeyDown={(event) => {
        if (closeOnEscape && event.key === 'Escape' && !busy && !closing) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onClickCapture={(event) => {
        if (closing) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerDownCapture={(event) => {
        if (closing) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDownCapture={(event) => {
        if (closing) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onMouseDown={(e) => {
        if (!closing && !busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`dialog ${drawer ? 'draft-drawer' : ''} ${className}`}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={title}
        aria-busy={busy || undefined}
      >
        <header>
          <h2>{title}</h2>
          <button title="关闭弹窗" disabled={busy || closing} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function DialogLoading({ label }: { label: string }) {
  return (
    <div className="dialog-loading" role="status" aria-live="polite">
      <Loader2 size={26} className="spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
