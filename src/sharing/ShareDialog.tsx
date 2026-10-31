import { useEffect, useState } from 'react';
import { Loader2, Copy, Settings2, Check, ArrowLeft } from 'lucide-react';
import { Dialog } from '../Dialog';
import { copyText } from '../clipboard';
import type { Draft } from '../storage';
import {
  clearShareCredentials,
  loadShareConfig,
  loadShareRecords,
  saveShareConfig,
  shareLifetime,
  validateConfig,
} from './config';
import { cancelShare, createShare, testShareStorage } from './service';
import type { ShareStorageConfig } from './types';

export function ShareDialog({
  article,
  getArticle,
  onClose,
}: {
  article: Pick<Draft, 'id' | 'title'>;
  getArticle: () => Pick<Draft, 'id' | 'title' | 'markdown' | 'settings'>;
  onClose: () => void;
}) {
  const [initial] = useState(loadShareConfig);
  const [config, setConfig] = useState(initial.config);
  const [remember, setRemember] = useState(initial.remember);
  const [configuring, setConfiguring] = useState(!initial.config.bucket);
  const [advanced, setAdvanced] = useState(!!initial.config.sessionToken);
  const [records, setRecords] = useState(loadShareRecords);
  const [duration, setDuration] = useState(604800);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
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
  const change = (key: keyof ShareStorageConfig, value: string) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setError('');
    setMessage('');
  };
  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成，请重试。');
    } finally {
      setBusy('');
    }
  };
  const save = () => {
    validateConfig(config);
    saveShareConfig(config, remember);
  };
  const close = () => {
    if (!busy) onClose();
  };
  const field = (
    key: keyof ShareStorageConfig,
    label: string,
    placeholder = '',
    secret = false,
  ) => (
    <label key={key}>
      {label}
      <input
        type={
          secret
            ? 'password'
            : key === 'credentialExpiresAt'
              ? 'datetime-local'
              : 'text'
        }
        value={config[key]}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => change(key, e.target.value)}
      />
    </label>
  );
  const endpoint = field(
    'endpoint',
    config.provider === 'minio'
      ? 'S3 API 地址（HTTPS）'
      : 'Endpoint（可选，HTTPS）',
    config.provider === 'minio' ? 'https://s3.example.com' : '留空使用官方地址',
  );
  let lifetime = '';
  try {
    const seconds = shareLifetime(config, duration);
    if (seconds < duration)
      lifetime = `实际有效期约 ${Math.max(1, Math.floor(seconds / 60))} 分钟`;
  } catch {
    /* Validation is shown when saving or creating a share. */
  }
  const feedback = (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="share-status" role="status">
          {message}
        </p>
      )}
    </>
  );
  return (
    <Dialog
      title={configuring ? '分享存储设置' : '分享当前文章'}
      onClose={close}
      className="share-dialog"
    >
      {configuring ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('保存中…', async () => {
              save();
              setConfiguring(false);
            });
          }}
        >
          <fieldset disabled={!!busy} className="share-fields">
            <label>
              存储类型
              <select
                aria-label="存储类型"
                value={config.provider}
                onChange={(e) => {
                  setConfig((c) => ({
                    ...c,
                    provider: e.target.value as ShareStorageConfig['provider'],
                    bucket: '',
                    region: e.target.value === 'minio' ? 'us-east-1' : '',
                    endpoint: '',
                    accessKeyId: '',
                    accessKeySecret: '',
                    sessionToken: '',
                    credentialExpiresAt: '',
                  }));
                  setAdvanced(false);
                  setError('');
                  setMessage('');
                }}
              >
                <option value="oss">阿里云 OSS</option>
                <option value="cos">腾讯云 COS</option>
                <option value="minio">MinIO</option>
              </select>
            </label>
            <div className="share-field-pair">
              {field(
                'bucket',
                'Bucket',
                config.provider === 'cos' ? '名称-APPID' : '桶名称',
              )}
              {field(
                'region',
                'Region',
                config.provider === 'oss'
                  ? 'cn-hangzhou'
                  : config.provider === 'cos'
                    ? 'ap-guangzhou'
                    : 'us-east-1',
              )}
            </div>
            {config.provider === 'minio' && endpoint}
            {field(
              'accessKeyId',
              config.provider === 'cos' ? 'SecretId' : 'AccessKey ID',
            )}
            {field(
              'accessKeySecret',
              config.provider === 'cos' ? 'SecretKey' : 'AccessKey Secret',
              '',
              true,
            )}
            <label
              className="share-checkbox"
              title="不勾选时，凭证仅用于当前会话"
            >
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              在此浏览器记住凭证
            </label>
            <details
              className="share-advanced"
              open={advanced}
              onToggle={(e) => setAdvanced(e.currentTarget.open)}
            >
              <summary>高级设置</summary>
              {config.provider !== 'minio' && endpoint}
              {field('prefix', '存储目录', 'mojian/shares/')}
              {field('sessionToken', '临时凭证 Token（可选）', '', true)}
              {field('credentialExpiresAt', '凭证到期时间（临时凭证必填）')}
              <button
                className="share-text-button"
                type="button"
                onClick={() =>
                  void run('清除中…', async () => {
                    clearShareCredentials();
                    setConfig((c) => ({
                      ...c,
                      accessKeyId: '',
                      accessKeySecret: '',
                      sessionToken: '',
                      credentialExpiresAt: '',
                    }));
                    setRemember(false);
                    setMessage('凭证已清除');
                  })
                }
              >
                清除凭证
              </button>
            </details>
          </fieldset>
          {feedback}
          <div className="share-settings-actions">
            <button
              className="share-text-button"
              type="button"
              disabled={!!busy}
              onClick={() =>
                void run('测试中…', async () => {
                  validateConfig(config);
                  await testShareStorage(config);
                  setMessage('连接正常');
                })
              }
            >
              测试连接
            </button>
            <div className="dialog-actions">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => {
                  setConfiguring(false);
                  setError('');
                  setMessage('');
                }}
              >
                <ArrowLeft size={14} />
                返回
              </button>
              <button type="submit" className="primary" disabled={!!busy}>
                保存配置
              </button>
            </div>
          </div>
          {busy && (
            <p className="share-progress" role="status">
              <Loader2 size={15} className="spin" />
              {busy}
            </p>
          )}
        </form>
      ) : (
        <>
          <div className="share-article-row">
            <p className="share-article-title">
              {article.title || '未命名文章'}
            </p>
            <button
              className="share-text-button"
              disabled={!!busy}
              onClick={() => {
                setConfiguring(true);
                setError('');
                setMessage('');
              }}
            >
              <Settings2 size={14} />
              存储设置
            </button>
          </div>
          {!showLink && (
            <div className="share-options">
              <label htmlFor="share-duration">有效期</label>
              <select
                id="share-duration"
                value={duration}
                disabled={!!busy}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                <option value={3600}>1 小时</option>
                <option value={86400}>1 天</option>
                <option value={604800}>7 天</option>
              </select>
              {lifetime && <span className="muted">{lifetime}</span>}
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
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? '已复制' : '复制链接'}
                </button>
              </div>
              <div className="share-record-meta">
                <span>
                  {expired
                    ? '已过期'
                    : `${new Date(share.expiresAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 到期`}
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
                  取消分享
                </button>
              </div>
            </section>
          )}
          {feedback}
          <div className="dialog-actions share-create-actions">
            {showLink ? (
              <button
                disabled={!!busy}
                onClick={() => {
                  setCreating(true);
                  setCopied(false);
                  setError('');
                  setMessage('');
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
                      setMessage('');
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
                      save();
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
      )}
    </Dialog>
  );
}
