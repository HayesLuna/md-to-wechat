import { useDialogMotion } from '../useDialogMotion';
import { useEffect, useState } from 'react';
import { Loader2, Check, X } from 'lucide-react';
import { Dialog } from '../Dialog';
import { ShareSelect } from './ShareSelect';
import {
  clearShareCredentials,
  loadShareConfig,
  saveShareConfig,
  validateConfig,
} from './config';
import { testShareStorage } from './service';
import type { ShareStorageConfig } from './types';

export function StorageSettings({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, exit } = useDialogMotion();
  const [initial] = useState(loadShareConfig);
  const [config, setConfig] = useState(initial.config);
  const [remember, setRemember] = useState(initial.remember);
  const [advanced, setAdvanced] = useState(!!initial.config.sessionToken);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [connection, setConnection] = useState<
    'idle' | 'testing' | 'success' | 'error'
  >('idle');
  const [confirmingClear, setConfirmingClear] = useState(false);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      exit(() => {
        if (confirmingClear) {
          setConfirmingClear(false);
          setError('');
        } else onClose();
      });
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [busy, onClose, confirmingClear, exit]);
  const change = (key: keyof ShareStorageConfig, value: string) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setConnection('idle');
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
    if (busy) return;
    exit(() => {
      if (confirmingClear) {
        setConfirmingClear(false);
        setError('');
      } else onClose();
    });
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
        type={secret ? 'password' : 'text'}
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
      key={confirmingClear ? 'clear-credentials' : 'storage'}
      closing={closing}
      busy={!!busy}
      title={confirmingClear ? '清除凭证' : '分享存储设置'}
      onClose={close}
      className="share-dialog"
    >
      {confirmingClear ? (
        <>
          <p>确定清除已保存的访问凭证？</p>
          {feedback}
          <div className="dialog-actions">
            <button disabled={!!busy} onClick={close}>
              取消
            </button>
            <button
              className="primary"
              disabled={!!busy}
              onClick={() =>
                void run('清除中…', async () => {
                  clearShareCredentials();
                  setConnection('idle');
                  setConfig((c) => ({
                    ...c,
                    accessKeyId: '',
                    accessKeySecret: '',
                    sessionToken: '',
                  }));
                  setRemember(false);
                  setMessage('凭证已清除');
                  exit(() => setConfirmingClear(false));
                })
              }
            >
              {busy || '确认清除'}
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('保存中…', async () => {
              save();
              exit(onSaved);
            });
          }}
        >
          <fieldset disabled={!!busy} className="share-fields">
            <div className="share-provider-field">
              <span>存储类型</span>
              <ShareSelect
                label="存储类型"
                disabled={!!busy}
                value={config.provider}
                onChange={(provider) => {
                  setConfig((c) => ({
                    ...c,
                    provider: provider as ShareStorageConfig['provider'],
                    bucket: '',
                    region: provider === 'minio' ? 'us-east-1' : '',
                    endpoint: '',
                    accessKeyId: '',
                    accessKeySecret: '',
                    sessionToken: '',
                  }));
                  setAdvanced(false);
                  setConnection('idle');
                  setError('');
                  setMessage('');
                }}
                options={[
                  { value: 'oss', label: '阿里云 OSS' },
                  { value: 'cos', label: '腾讯云 COS' },
                  { value: 'minio', label: 'MinIO' },
                ]}
              />
            </div>
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
            </details>
          </fieldset>
          {feedback}
          <div className="share-settings-actions">
            <div className="share-storage-actions">
              <button
                className="share-text-button"
                type="button"
                disabled={!!busy}
                onClick={() => {
                  setError('');
                  setMessage('');
                  exit(() => setConfirmingClear(true));
                }}
              >
                清除凭证
              </button>
              <div className="share-connection-test">
                <button
                  className="share-text-button"
                  type="button"
                  disabled={!!busy}
                  onClick={() =>
                    void run('测试中…', async () => {
                      setConnection('testing');
                      try {
                        validateConfig(config);
                        await testShareStorage(config);
                        setConnection('success');
                      } catch (error) {
                        setConnection('error');
                        throw error;
                      }
                    })
                  }
                >
                  测试连接
                </button>
                {connection !== 'idle' && (
                  <span
                    className={`share-connection-result ${connection}`}
                    role="status"
                    aria-label={
                      connection === 'testing'
                        ? '正在测试连接'
                        : connection === 'success'
                          ? '连接测试成功'
                          : '连接测试失败'
                    }
                    title={
                      connection === 'testing'
                        ? '正在测试连接'
                        : connection === 'success'
                          ? '连接测试成功'
                          : error || '连接测试失败'
                    }
                  >
                    {connection === 'testing' ? (
                      <Loader2 size={16} className="spin" aria-hidden="true" />
                    ) : connection === 'success' ? (
                      <Check size={12} strokeWidth={2.5} aria-hidden="true" />
                    ) : (
                      <X size={12} strokeWidth={2.5} aria-hidden="true" />
                    )}
                  </span>
                )}
              </div>
            </div>
            <div className="dialog-actions">
              <button type="button" disabled={!!busy} onClick={close}>
                取消
              </button>
              <button type="submit" className="primary" disabled={!!busy}>
                保存配置
              </button>
            </div>
          </div>
          {busy && connection !== 'testing' && (
            <p className="share-progress" role="status">
              <Loader2 size={15} className="spin" />
              {busy}
            </p>
          )}
        </form>
      )}
    </Dialog>
  );
}
