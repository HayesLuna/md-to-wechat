export type StorageProvider = 'oss' | 'cos' | 'minio';

export type ShareStorageConfig = {
  provider: StorageProvider;
  bucket: string;
  region: string;
  endpoint: string;
  prefix: string;
  accessKeyId: string;
  accessKeySecret: string;
  sessionToken: string;
  credentialExpiresAt: string;
};

export interface ShareStorage {
  upload(key: string, body: Blob): Promise<void>;
  downloadURL(key: string, expiresIn: number): Promise<string>;
  remove(key: string): Promise<void>;
}

export type ShareDescriptor = {
  version: 1;
  id: string;
  url: string;
  expiresAt: number;
  sha256: string;
};

export type ShareRecord = {
  // Local UI selection only; older snapshots remain valid until they expire.
  current?: boolean;
  id: string;
  draftId: string;
  title: string;
  key: string;
  createdAt: number;
  expiresAt: number;
  link: string;
  target: Pick<
    ShareStorageConfig,
    'provider' | 'bucket' | 'region' | 'endpoint'
  >;
};
