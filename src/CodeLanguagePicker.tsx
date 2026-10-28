import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
const languages = [
  ['', '纯文本', 'plain text txt plaintext'],
  ['javascript', 'JavaScript', 'js'],
  ['typescript', 'TypeScript', 'ts'],
  ['jsx', 'JSX', 'react'],
  ['tsx', 'TSX', 'react typescript'],
  ['java', 'Java', ''],
  ['python', 'Python', 'py'],
  ['html', 'HTML', 'html5'],
  ['css', 'CSS', ''],
  ['json', 'JSON', ''],
  ['yaml', 'YAML', 'yml'],
  ['xml', 'XML', ''],
  ['sql', 'SQL', ''],
  ['bash', 'Bash / Shell', 'sh shell zsh'],
  ['c', 'C', ''],
  ['cpp', 'C++', 'cplusplus'],
  ['csharp', 'C#', 'cs'],
  ['go', 'Go', 'golang'],
  ['rust', 'Rust', 'rs'],
  ['php', 'PHP', ''],
  ['ruby', 'Ruby', 'rb'],
  ['swift', 'Swift', ''],
  ['kotlin', 'Kotlin', 'kt'],
  ['markdown', 'Markdown', 'md'],
  ['dockerfile', 'Dockerfile', 'docker'],
  ['mermaid', 'Mermaid', 'diagram 图表'],
];
const normalize = (s: string) => s.toLowerCase().replace(/[\s_.-]/g, '');
function match(query: string, text: string) {
  query = normalize(query);
  text = normalize(text);
  if (!query) return 0;
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  if (text.includes(query)) return 2;
  let i = 0;
  for (const c of text) if (c === query[i]) i++;
  return i === query.length ? 3 : Infinity;
}
export function CodeLanguagePicker({
  language,
  disabled,
  change,
}: {
  language: string;
  disabled: boolean;
  change: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [searching, setSearching] = useState(false),
    [active, setActive] = useState(0);
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
  }>({
    left: 0,
    top: 0,
    width: 240,
    maxHeight: 280,
  });
  const input = useRef<HTMLInputElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const initialActive = useRef(0);
  const id = useId();
  const label = language
    ? (languages.find(([value, , aliases]) =>
        [value, ...aliases.split(' ')].includes(language.toLowerCase()),
      )?.[1] ?? language)
    : '';
  const display = open && searching ? query : label;
  const options = useMemo(
    () =>
      languages
        .map(([value, label, aliases]) => ({
          value,
          label,
          score: Math.min(
            ...[value, label, ...aliases.split(' ')].map((text) =>
              match(query, text),
            ),
          ),
        }))
        .filter((x) => Number.isFinite(x.score))
        .sort((a, b) => a.score - b.score),
    [query],
  );
  const show = () => {
    if (disabled || open || !input.current) return;
    const rect = input.current.getBoundingClientRect(),
      width = Math.min(240, window.innerWidth - 24);
    const above = window.innerHeight - rect.bottom < 200 && rect.top > 220;
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: above ? undefined : rect.bottom + 6,
      bottom: above ? window.innerHeight - rect.top + 6 : undefined,
      width,
      maxHeight: above
        ? Math.min(280, rect.top - 20)
        : Math.max(120, Math.min(280, window.innerHeight - rect.bottom - 20)),
    });
    setQuery('');
    setSearching(false);
    const selected = Math.max(
      0,
      languages.findIndex(([value, label, aliases]) =>
        [value, label, ...aliases.split(' ')].some(
          (text) => text.toLowerCase() === language.toLowerCase(),
        ),
      ),
    );
    initialActive.current = selected;
    setActive(selected);
    setOpen(true);
  };
  const choose = (value: string) => {
    change(value.trim() || null);
    setOpen(false);
    setSearching(false);
  };
  useEffect(() => {
    if (!open && document.activeElement === input.current)
      input.current?.select();
  }, [language, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        event.target !== input.current
      )
        setOpen(false);
    };
    const scroll = (event: Event) => {
      if (
        event.target instanceof Node &&
        event.target !== input.current &&
        !menu.current?.contains(event.target)
      )
        setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  useEffect(() => {
    if (open)
      menu.current
        ?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)
        ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);
  return (
    <span className="code-language-picker">
      <input
        ref={input}
        role="combobox"
        aria-label="代码语言"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={
          open && options[active] ? `${id}-${active}` : undefined
        }
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        size={Math.min(16, Math.max(8, display.length + 1))}
        value={display}
        placeholder="纯文本"
        onFocus={(event) => {
          show();
          event.currentTarget.select();
        }}
        onClick={show}
        onChange={(event) => {
          if (!open) show();
          setQuery(event.target.value);
          setSearching(true);
          setActive(0);
        }}
        onBlur={() => {
          setOpen(false);
          setSearching(false);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setSearching(false);
            return;
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
              show();
              return;
            }
            setActive(
              (previous) =>
                (previous +
                  (event.key === 'ArrowDown' ? 1 : -1) +
                  Math.max(1, options.length)) %
                Math.max(1, options.length),
            );
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            if (!open) {
              show();
              return;
            }
            choose(
              !searching && active === initialActive.current
                ? language
                : (options[active]?.value ?? query),
            );
            return;
          }
        }}
      />
      {open &&
        createPortal(
          <div
            ref={menu}
            className="code-language-menu"
            style={position}
            id={id}
            role="listbox"
            aria-label="代码语言候选"
            onMouseDown={(event) => event.preventDefault()}
          >
            {options.map((option, index) => (
              <div
                id={`${id}-${index}`}
                data-option-index={index}
                key={option.value}
                role="option"
                aria-selected={active === index}
                className={active === index ? 'active' : ''}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option.value)}
              >
                <span>{option.label}</span>
                <small>{option.value || 'text'}</small>
              </div>
            ))}
            {!options.length && (
              <div
                role="option"
                aria-selected="true"
                onClick={() => choose(query)}
              >
                使用“{query}”
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
