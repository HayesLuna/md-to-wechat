import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogLoading } from '../Dialog';
import { useDialogMotion } from '../useDialogMotion';
import type { Draft } from '../storage';
import { receiveShare } from './service';

export function ShareImport({
  hash,
  onImport,
  onClose: dismiss,
}: {
  hash: string;
  onImport: (read: () => Promise<Draft>) => Promise<void>;
  onClose: () => void;
}) {
  const { closing, exit } = useDialogMotion();
  const onClose = useCallback(() => exit(dismiss), [exit, dismiss]);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const handlers = useRef({ onImport, onClose });
  handlers.current = { onImport, onClose };
  useEffect(() => {
    if (!attempt) return;
    const controller = new AbortController();
    setError('');
    void handlers.current
      .onImport(() => receiveShare(hash, controller.signal))
      .then(() => {
        if (!controller.signal.aborted) handlers.current.onClose();
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '导入未完成，请重试。');
      });
    return () => controller.abort();
  }, [hash, attempt]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (!attempt || error)) onClose();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [attempt, error, onClose]);
  return (
    <Dialog
      closing={closing}
      busy={!!attempt && !error}
      title="打开分享文章"
      onClose={() => {
        if (!attempt || error) onClose();
      }}
      className="share-dialog"
    >
      {!attempt ? (
        <>
          <p>将这篇分享文章导入到你的本地草稿？</p>
          <div className="dialog-actions">
            <button onClick={onClose}>取消</button>
            <button className="primary" onClick={() => setAttempt(1)}>
              导入到本地
            </button>
          </div>
        </>
      ) : error ? (
        <>
          <p className="form-error" role="alert">
            {error}
          </p>
          <p className="muted">已有本地草稿和修改会保留。</p>
          <div className="dialog-actions">
            <button onClick={onClose}>返回编辑器</button>
            <button
              className="primary"
              onClick={() => {
                setError('');
                setAttempt((n) => n + 1);
              }}
            >
              重试导入
            </button>
          </div>
        </>
      ) : (
        <DialogLoading label="正在下载并保存到本地草稿…" />
      )}
    </Dialog>
  );
}
