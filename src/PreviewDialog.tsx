import { useEffect, useRef } from 'react';
import { Copy, Loader2, X } from 'lucide-react';
import type { Settings } from './sample';
import type { Output } from './output';
import type { MediaPreviewItem } from './mediaPreviewEvents';
import { SettingsPanel } from './SettingsPanel';
import { ArticlePreview } from './ArticlePreview';

export interface PreviewDialogProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  output: Output | null;
  preparing: boolean;
  renderError: string;
  copying: boolean;
  onCopy: () => void;
  onMedia: (item: MediaPreviewItem) => void;
  onClose: () => void;
  obscured?: boolean;
}

export function PreviewDialog({
  settings,
  onSettingsChange,
  output,
  preparing,
  renderError,
  copying,
  onCopy,
  onMedia,
  onClose,
  obscured = false,
}: PreviewDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = dialogRef.current;
    el?.focus({ preventScroll: true });
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !el) return;
      const items = Array.from(
        el.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),a[href],textarea,select,[tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && index <= 0) {
        e.preventDefault();
        items.at(-1)?.focus();
      } else if (!e.shiftKey && index === items.length - 1) {
        e.preventDefault();
        items[0]?.focus();
      }
    };
    el?.addEventListener('keydown', trap);
    return () => {
      el?.removeEventListener('keydown', trap);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="dialog-backdrop preview-dialog-backdrop"
      aria-hidden={obscured || undefined}
      inert={obscured || undefined}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog preview-dialog preview-pane"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label="公众号预览"
      >
        <header className="preview-header">
          <div className="preview-title-group">
            <h2>公众号预览</h2>
            <span className="preview-status">
              {preparing ? '准备排版…' : '与复制使用同一排版'}
            </span>
          </div>
          <div className="preview-header-actions">
            <button
              type="button"
              className="primary preview-copy-button"
              aria-label={copying ? '复制中…' : '复制到公众号'}
              disabled={copying}
              onClick={onCopy}
            >
              {copying ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Copy size={15} />
              )}
              <span>{copying ? '复制中…' : '复制到公众号'}</span>
            </button>
            <button
              type="button"
              className="preview-close"
              aria-label="关闭预览"
              title="关闭预览"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="preview-body">
          <div className="preview-settings-column">
            <SettingsPanel settings={settings} onChange={onSettingsChange} />
            <div className="preview-explanation">
              手机阅读宽度 · 图片与图形迁移前需确认
            </div>
          </div>
          <div className="preview-scroll">
            {renderError ? (
              <p className="output-error">{renderError}</p>
            ) : (
              <ArticlePreview
                output={output}
                preparing={preparing}
                onMedia={onMedia}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
