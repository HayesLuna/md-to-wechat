import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog } from '../Dialog';
import type { Draft } from '../storage';
import { receiveShare } from './service';

export function ShareImport({
  hash,
  onImport,
  onClose,
}: {
  hash: string;
  onImport: (read: () => Promise<Draft>) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const handlers = useRef({ onImport, onClose });
  handlers.current = { onImport, onClose };
  useEffect(() => {
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
      if (e.key === 'Escape' && error) onClose();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [error, onClose]);
  return (
    <Dialog
      title="打开分享文章"
      onClose={() => {
        if (error) onClose();
      }}
      className="share-dialog"
    >
      {error ? (
        <>
          <p className="form-error" role="alert">
            {error}
          </p>
          <p className="muted">已有本地草稿和修改会保留。</p>
          <div className="dialog-actions">
            <button onClick={onClose}>返回编辑器</button>
            <button
              className="primary"
              onClick={() => setAttempt((n) => n + 1)}
            >
              重试导入
            </button>
          </div>
        </>
      ) : (
        <p className="share-progress" role="status">
          <Loader2 size={17} className="spin" />
          正在下载并保存到本地草稿…
        </p>
      )}
    </Dialog>
  );
}
