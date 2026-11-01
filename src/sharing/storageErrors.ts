const EXPIRED_CODES = new Set([
  'SecurityTokenExpired',
  'ExpiredToken',
  'ExpiredTokenException',
  'InvalidSecurityToken.Expired',
]);

function credentialCode(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as Record<string, unknown>;
  const nested =
    value.error && typeof value.error === 'object'
      ? (value.error as Record<string, unknown>)
      : undefined;
  return [value.code, value.Code, value.name, nested?.code, nested?.Code].find(
    (code): code is string =>
      typeof code === 'string' && EXPIRED_CODES.has(code),
  );
}

// Never display SDK messages or remote XML: they may contain signed URLs or keys.
export function credentialErrorMessage(error: unknown, recipient = false) {
  if (!credentialCode(error)) return undefined;
  return recipient
    ? '分享凭证已过期，请联系发送方重新分享。'
    : '临时凭证已过期，请更新 AccessKey 和 Token 后重试。';
}

export async function credentialResponseError(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    // Only inspect a bounded error prefix; never download an arbitrary error body.
    while (length < 16384) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, 16384 - length);
      chunks.push(chunk);
      length += chunk.length;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const code = /<Code>\s*([a-zA-Z0-9._-]+)\s*<\/Code>/.exec(
      new TextDecoder().decode(bytes),
    )?.[1];
    const message = credentialErrorMessage({ code });
    return message ? Object.assign(new Error(message), { code }) : undefined;
  } catch {
    return undefined;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
