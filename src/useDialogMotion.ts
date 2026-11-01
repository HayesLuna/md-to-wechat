import { useCallback, useEffect, useRef, useState } from 'react';

export function useDialogMotion() {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef(false);
  const exit = useCallback((action: () => void) => {
    if (pending.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      action();
      return;
    }
    pending.current = true;
    setClosing(true);
    timer.current = window.setTimeout(() => {
      pending.current = false;
      timer.current = undefined;
      setClosing(false);
      action();
    }, 140);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      pending.current = false;
    },
    [],
  );
  return { closing, exit };
}
