import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

type Option = { value: string; label: string };

export function ShareSelect({
  label,
  value,
  options,
  disabled = false,
  onChange,
  compact = false,
}: {
  label: string;
  value: string;
  options: readonly Option[];
  disabled?: boolean;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 160,
  });
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const show = (index = selected) => {
    if (disabled || !trigger.current || !options.length) return;
    const rect = trigger.current.getBoundingClientRect();
    const height = options.length * 36 + 10;
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const upward = below < height && above > below;
    const maxHeight = Math.min(height, Math.max(36, upward ? above : below));
    const width = Math.min(window.innerWidth - 24, Math.max(rect.width, 112));
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: upward ? rect.top - maxHeight - 6 : rect.bottom + 6,
      width,
      maxHeight,
    });
    setActive(index);
    setOpen(true);
  };
  const choose = (index: number) => {
    setOpen(false);
    if (options[index].value !== value) onChange(options[index].value);
    trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const item = menu.current.children[active] as HTMLElement | undefined;
    if (!item) return;
    const bottom = item.offsetTop + item.offsetHeight;
    if (item.offsetTop < menu.current.scrollTop)
      menu.current.scrollTop = item.offsetTop;
    else if (bottom > menu.current.scrollTop + menu.current.clientHeight)
      menu.current.scrollTop = bottom - menu.current.clientHeight;
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const reposition = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.share-select-menu')
      )
        return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);
  return (
    <div className={`share-select${compact ? ' compact' : ''}`} ref={root}>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open && !disabled}
        aria-haspopup="listbox"
        aria-controls={open && !disabled ? id : undefined}
        aria-activedescendant={
          open && !disabled ? `${id}-${active}` : undefined
        }
        className="share-select-trigger"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onBlur={(event) => {
          if (!root.current?.contains(event.relatedTarget)) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) show();
            else
              setActive(
                (index) =>
                  (index +
                    (event.key === 'ArrowDown' ? 1 : -1) +
                    options.length) %
                  options.length,
              );
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            if (!open) show(event.key === 'Home' ? 0 : options.length - 1);
            else setActive(event.key === 'Home' ? 0 : options.length - 1);
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (open) choose(active);
            else show();
          } else if (event.key === 'Tab') setOpen(false);
        }}
      >
        <span>{options[selected]?.label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && !disabled && (
        <div
          ref={menu}
          id={id}
          role="listbox"
          aria-label={label}
          className="share-select-menu"
          style={position}
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={`share-select-option${index === active ? ' active' : ''}`}
              onPointerMove={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={14} aria-hidden="true" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
