import type { ShareStorageConfig, ShareRecord } from './types';

const CONFIG_KEY = 'mojian-share-config-v1';
const SESSION_KEY = 'mojian-share-credentials-v1';
const RECORDS_KEY = 'mojian-share-records-v1';
export const DEFAULT_SHARE_CONFIG: ShareStorageConfig = {
  provider: 'oss',
  bucket: '',
  region: '',
  endpoint: '',
  prefix: 'mojian/shares/',
  accessKeyId: '',
  accessKeySecret: '',
  sessionToken: '',
};
const fields = Object.keys(
  DEFAULT_SHARE_CONFIG,
) as (keyof ShareStorageConfig)[];
export function normalizeConfig(value: unknown): ShareStorageConfig {
  const config = { ...DEFAULT_SHARE_CONFIG };
  if (value && typeof value === 'object') {
    for (const key of fields) {
      const v = (value as Record<string, unknown>)[key];
      if (typeof v === 'string') Object.assign(config, { [key]: v });
    }
  }
  if (!['oss', 'cos', 'minio'].includes(config.provider))
    config.provider = 'oss';
  return config;
}
function read(key: string, kind: 'local' | 'session'): unknown {
  try {
    const storage = kind === 'local' ? localStorage : sessionStorage;
    return JSON.parse(storage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
export function loadShareConfig() {
  const stored = read(CONFIG_KEY, 'local');
  const session = read(SESSION_KEY, 'session');
  const config = normalizeConfig({
    ...(stored && typeof stored === 'object' ? stored : {}),
    ...(session && typeof session === 'object' ? session : {}),
  });
  // A session-only configuration owns its persistence choice as well as its
  // credentials. Another tab's remembered config must not opt this one in.
  const hasSessionCredentials = !!(
    session &&
    typeof session === 'object' &&
    'accessKeySecret' in session &&
    typeof session.accessKeySecret === 'string'
  );
  const remember = !!(
    !hasSessionCredentials &&
    stored &&
    typeof stored === 'object' &&
    'accessKeySecret' in stored
  );
  return { config, remember };
}
export function saveShareConfig(config: ShareStorageConfig, remember: boolean) {
  const { accessKeyId, accessKeySecret, sessionToken, ...publicConfig } =
    normalizeConfig(config);
  const credentials = {
    accessKeyId,
    accessKeySecret,
    sessionToken,
  };
  // Always remove an earlier persistent credential when opting out of remembering.
  localStorage.setItem(CONFIG_KEY, JSON.stringify(publicConfig));
  sessionStorage.removeItem(SESSION_KEY);
  if (remember)
    localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({ ...publicConfig, ...credentials }),
    );
  else
    // Keep target and credentials together: another tab may change the shared
    // public configuration without changing this tab's session credentials.
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ ...publicConfig, ...credentials }),
    );
}
export function clearShareCredentials() {
  const { config } = loadShareConfig();
  saveShareConfig(
    {
      ...config,
      accessKeyId: '',
      accessKeySecret: '',
      sessionToken: '',
    },
    false,
  );
}

export function validateConfig(config: ShareStorageConfig) {
  if (!config.bucket.trim() || !config.region.trim())
    throw new Error('请填写 Bucket 和 Region。');
  if (!config.accessKeyId.trim() || !config.accessKeySecret.trim())
    throw new Error('请填写访问凭证。');
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(config.bucket))
    throw new Error('Bucket 格式不正确。');
  if (!/^[a-z0-9-]+$/.test(config.region))
    throw new Error('Region 格式不正确。');
  if (!/^[a-zA-Z0-9/_-]*$/.test(config.prefix) || config.prefix.includes('//'))
    throw new Error('存储目录只支持字母、数字、斜线、下划线和连字符。');
  if (config.provider === 'minio' && !config.endpoint)
    throw new Error('请填写 MinIO 的 S3 API 地址。');
  if (config.endpoint) {
    const endpoint = new URL(config.endpoint);
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== '/'
    )
      throw new Error('服务地址应是 HTTPS 地址，不含路径、参数或账号信息。');
  }
}
export function shareLifetime(
  config: ShareStorageConfig,
  requestedSeconds: number,
) {
  validateConfig(config);
  const seconds = Math.min(604800, requestedSeconds);
  if (!Number.isFinite(seconds) || seconds < 60)
    throw new Error('分享有效期不能少于一分钟。');
  return seconds;
}
export function sameTarget(config: ShareStorageConfig, record: ShareRecord) {
  return (
    config.provider === record.target.provider &&
    config.bucket === record.target.bucket &&
    config.region === record.target.region &&
    config.endpoint === record.target.endpoint
  );
}
export function loadShareRecords(): ShareRecord[] {
  const records = read(RECORDS_KEY, 'local');
  if (!Array.isArray(records)) return [];
  return records.filter(
    (r): r is ShareRecord =>
      r &&
      typeof r.id === 'string' &&
      typeof r.draftId === 'string' &&
      typeof r.key === 'string' &&
      typeof r.link === 'string' &&
      typeof r.title === 'string' &&
      Number.isFinite(r.expiresAt) &&
      r.target &&
      ['oss', 'cos', 'minio'].includes(r.target.provider),
  );
}
export function addShareRecord(record: ShareRecord) {
  localStorage.setItem(
    RECORDS_KEY,
    JSON.stringify([
      { ...record, current: true },
      ...loadShareRecords().map((previous) =>
        previous.draftId === record.draftId
          ? { ...previous, current: false }
          : previous,
      ),
    ]),
  );
}
export function removeShareRecord(id: string) {
  const records = loadShareRecords();
  const removed = records.find((record) => record.id === id);
  localStorage.setItem(
    RECORDS_KEY,
    JSON.stringify(
      records
        .filter((r) => r.id !== id)
        .map((record) =>
          removed?.current !== false && record.draftId === removed?.draftId
            ? { ...record, current: false }
            : record,
        ),
    ),
  );
}
