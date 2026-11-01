import { useCallback } from 'react';
import { useDialogMotion } from '../useDialogMotion';
import { useEffect, useState } from 'react';
import { Loader2, Copy, Check } from 'lucide-react';
import { Dialog } from '../Dialog';
import { copyText } from '../clipboard';
import type { Draft } from '../storage';
import { ShareSelect } from './ShareSelect';
import { loadShareConfig, loadShareRecords } from './config';
import { cancelShare, createShare } from './service';

export function ShareDialog({
  article,
  getArticle,
  onClose: dismiss,
  onConfigure: configure,
}: {
  article: Pick<Draft, 'id' | 'title'>;
  getArticle: () => Pick<Draft, 'id' | 'title' | 'markdown' | 'settings'>;
  onClose: () => void;
  onConfigure: () => void;
}) {
  const { closing, exit } = useDialogMotion();
  const onClose = useCallback(() => exit(dismiss), [exit, dismiss]);
  const onConfigure = () => exit(configure);
  const [config] = useState(() => loadShareConfig().config);
  const configured = !!(
    config.bucket &&
    config.region &&
    config.accessKeyId &&
    config.accessKeySecret
  );
  const [records, setRecords] = useState(loadShareRecords);
  const [duration, setDuration] = useState(604800);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [busy, onClose]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const share = records.find(
    (record) => record.draftId === article.id && record.current !== false,
  );
  const expired = !!share && share.expiresAt <= Date.now();
  const showLink = !!share && !creating;
  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作未完成，请重试。');
    } finally {
      setBusy('');
    }
  };
  const feedback = error && (
    <p className="form-error" role="alert">
      {error}
    </p>
  );
  return (
    <Dialog
      closing={closing}
      busy={!!busy}
      title="分享当前文章"
      onClose={() => {
        if (!busy) onClose();
      }}
      className="share-dialog"
    >
      <>
        <div className="share-article-row">
          <p className="share-article-title">{article.title || '未命名文章'}</p>
        </div>
        {!showLink && configured && (
          <div className="share-options">
            <span className="share-option-label">有效期</span>
            <ShareSelect
              compact
              label="有效期"
              value={String(duration)}
              disabled={!!busy}
              onChange={(value) => setDuration(Number(value))}
              options={[
                { value: '3600', label: '1 小时' },
                { value: '86400', label: '1 天' },
                { value: '604800', label: '7 天' },
              ]}
            />
            {config.sessionToken && (
              <span className="muted">有效期受临时凭证限制</span>
            )}
          </div>
        )}
        {showLink && (
          <section className="share-record" aria-label="当前文章的分享链接">
            <div className="share-link-row">
              <input
                aria-label="分享链接"
                value={share.link}
                readOnly
                onFocus={(e) => e.target.select()}
              />
              <button
                className="primary"
                disabled={!!busy || expired}
                aria-label="复制分享链接"
                onClick={() =>
                  void run('复制中…', async () => {
                    await copyText(share.link);
                    setCopied(true);
                  })
                }
              >
                {busy === '复制中…' ? (
                  <Loader2 size={15} className="spin" />
                ) : copied ? (
                  <Check size={15} />
                ) : (
                  <Copy size={15} />
                )}
                {copied ? '已复制' : '复制链接'}
              </button>
            </div>
            <div className="share-record-meta">
              <span>
                {expired
                  ? '已过期'
                  : `最晚 ${new Date(share.expiresAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 到期`}
              </span>
              <button
                className="share-text-button"
                disabled={!!busy}
                onClick={() =>
                  void run('取消中…', async () => {
                    await cancelShare(config, share);
                    setRecords(loadShareRecords());
                    setCopied(false);
                  })
                }
              >
                {busy === '取消中…' && <Loader2 size={14} className="spin" />}
                {busy === '取消中…' ? busy : '取消分享'}
              </button>
            </div>
          </section>
        )}
        {feedback}
        <div className="dialog-actions share-create-actions">
          {!configured && !showLink ? (
            <button className="primary" onClick={onConfigure}>
              配置存储
            </button>
          ) : showLink ? (
            <button
              disabled={!!busy}
              onClick={() => {
                setCreating(true);
                setCopied(false);
                setError('');
              }}
            >
              生成新链接
            </button>
          ) : (
            <>
              {share && (
                <button
                  disabled={!!busy}
                  onClick={() => {
                    setCreating(false);
                    setError('');
                  }}
                >
                  返回
                </button>
              )}
              <button
                className="primary"
                disabled={!!busy}
                onClick={() =>
                  void run('生成中…', async () => {
                    await createShare(config, getArticle(), duration);
                    setRecords(loadShareRecords());
                    setCreating(false);
                    setCopied(false);
                  })
                }
              >
                {busy && <Loader2 size={15} className="spin" />}
                {busy || '生成分享链接'}
              </button>
            </>
          )}
        </div>
      </>
    </Dialog>
  );
}
