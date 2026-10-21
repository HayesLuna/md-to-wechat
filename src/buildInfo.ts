export const buildInfo = __BUILD_INFO__;
export const versionLabel = `${buildInfo.development ? '开发版 ' : ''}${buildInfo.revision}${buildInfo.localChanges ? '+local' : ''}`;
export const buildTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}).format(new Date(buildInfo.builtAt));
