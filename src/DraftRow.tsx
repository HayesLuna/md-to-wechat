import { memo, useMemo, type RefObject, type PointerEvent } from 'react';
import { Pencil, Trash2, GripVertical } from 'lucide-react';
import type { DraftSummary } from './storage';

export type DraftRowActions = {
  pointerDown: (event: PointerEvent<HTMLSpanElement>, id: string) => void;
  pointerMove: (event: PointerEvent<HTMLSpanElement>) => void;
  pointerUp: (event: PointerEvent<HTMLSpanElement>, commit: boolean) => void;
  cancel: () => void;
  select: (draft: DraftSummary) => void;
  rename: (draft: DraftSummary) => void;
  delete: (draft: DraftSummary) => void;
};
const dates = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
export const DraftRow = memo(function DraftRow({
  draft: d,
  active,
  busy,
  canReorder,
  searching,
  actions,
}: {
  draft: DraftSummary;
  active: boolean;
  busy: boolean;
  canReorder: boolean;
  searching: boolean;
  actions: RefObject<DraftRowActions | null>;
}) {
  const savedAt = useMemo(() => dates.format(d.savedAt), [d.savedAt]);
  return (
    <li data-draft-id={d.id} className={active ? 'current' : ''}>
      <span
        className="draft-drag-handle"
        aria-hidden="true"
        data-disabled={!canReorder ? 'true' : undefined}
        title={searching ? '清空搜索后可调整顺序' : '拖动调整顺序'}
        onPointerDown={(event) => actions.current?.pointerDown(event, d.id)}
        onPointerMove={(event) => actions.current?.pointerMove(event)}
        onPointerUp={(event) => actions.current?.pointerUp(event, true)}
        onPointerCancel={(event) => actions.current?.pointerUp(event, false)}
        onLostPointerCapture={() => actions.current?.cancel()}
      >
        <GripVertical size={14} />
      </span>
      <button
        className="draft-select"
        aria-current={active ? 'page' : undefined}
        disabled={busy}
        onClick={() => actions.current?.select(d)}
      >
        <strong>{d.title}</strong>
        <small>
          {savedAt}
          {active ? ' · 当前文章' : ''}
        </small>
      </button>
      <div className="draft-actions">
        <button
          disabled={busy}
          aria-label={`重命名 ${d.title}`}
          title="重命名"
          onClick={() => actions.current?.rename(d)}
        >
          <Pencil size={14} />
        </button>
        <button
          disabled={busy}
          aria-label={`删除 ${d.title}`}
          title="删除"
          onClick={() => actions.current?.delete(d)}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
});
