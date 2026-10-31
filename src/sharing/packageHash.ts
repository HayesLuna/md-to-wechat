export async function packageHash(bytes: Uint8Array<ArrayBuffer>) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (n) => n.toString(16).padStart(2, '0')).join('');
}
