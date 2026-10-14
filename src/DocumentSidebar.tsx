import { useMemo, type CSSProperties } from "react";
import { Search, Plus, Pencil, Trash2 } from "lucide-react";
import { DraftListIcon, OutlineIcon } from "./NavigationIcons";
import { useSidebarResize } from "./useSidebarResize";
import type { Draft } from "./storage";

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
  headings,
  activeHeading,
  onHeading,
}: {
  tab: "drafts" | "outline";
  onTab: (tab: "drafts" | "outline") => void;
  searching: boolean;
  onSearchToggle: () => void;
  query: string;
  onQuery: (value: string) => void;
  drafts: Draft[];
  total: number;
  activeId?: string;
  busy: boolean;
  onCreate: () => void;
  onSelect: (draft: Draft) => void;
  onRename: (draft: Draft) => void;
  onDelete: (draft: Draft) => void;
  headings: { text: string; level: number; line: number }[];
  activeHeading: number;
  onHeading: (index: number) => void;
}) {
  const { width, resizing, sidebar, handleProps } = useSidebarResize();
  const normalizedQuery = query.trim().toLocaleLowerCase();
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
      className={`document-sidebar ${resizing ? "resizing" : ""}`}
      style={{ "--sidebar-width": `${width}px` } as CSSProperties}
      aria-label="文章导航"
    >
      <header className="sidebar-header">
        <button
          aria-label={tab === "outline" ? "切换到草稿" : "切换到大纲"}
          title={tab === "outline" ? "切换到草稿" : "切换到大纲"}
          aria-controls="sidebar-content"
          onClick={() => onTab(tab === "outline" ? "drafts" : "outline")}
        >
          {tab === "outline" ? (
            <OutlineIcon size={16} />
          ) : (
            <DraftListIcon size={18} />
          )}
        </button>
        <span className="sidebar-title">
          {tab === "outline" ? "大纲" : "草稿"}
        </span>
        <button
          aria-label={tab === "drafts" ? "搜索草稿" : "搜索大纲"}
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
            aria-label={tab === "drafts" ? "搜索草稿标题" : "搜索大纲标题"}
            placeholder={tab === "drafts" ? "搜索草稿…" : "搜索标题…"}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
      )}
      <div
        id="sidebar-content"
        role="region"
        aria-label={tab === "drafts" ? "草稿箱" : "文章大纲"}
        className={`sidebar-content ${tab === "drafts" ? "sidebar-drafts" : "sidebar-outline"}`}
      >
        {tab === "drafts" ? (
          <>
            <div className="sidebar-draft-count">{total} 篇草稿</div>
            <div className="sidebar-draft-scroll">
              <ul className="draft-list">
                {drafts.map((d) => (
                  <li key={d.id} className={d.id === activeId ? "current" : ""}>
                    <button
                      className="draft-select"
                      aria-current={d.id === activeId ? "page" : undefined}
                      disabled={busy}
                      onClick={() => onSelect(d)}
                    >
                      <strong>{d.title}</strong>
                      <small>
                        {new Date(d.savedAt).toLocaleString("zh-CN", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {d.id === activeId ? " · 当前文章" : ""}
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
                className={index === activeHeading ? "current" : ""}
                aria-current={index === activeHeading ? "location" : undefined}
                style={{ paddingLeft: 16 + (h.level - base) * 14 }}
                onClick={() => onHeading(index)}
              >
                {h.text || "无标题"}
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
