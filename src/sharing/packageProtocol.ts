import type { Settings } from '../sample';

export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;

export type ShareArticle = {
  title: string;
  markdown: string;
  settings: Settings;
};
export type DecodedArticle = ShareArticle & {
  images: { id: string; blob: Blob }[];
};
export type PackageRequest =
  | { type: 'create'; article: ShareArticle }
  | { type: 'read'; blob: Blob }
  | { type: 'images'; blobs: (Blob | undefined)[] }
  | { type: 'error'; error: string };
export type PackageResponse =
  | { type: 'images'; sources: string[] }
  | { type: 'created'; result: { blob: Blob; sha256: string } }
  | { type: 'read'; result: DecodedArticle }
  | { type: 'error'; error: string };
