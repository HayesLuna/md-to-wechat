import { validateConfig } from './config';
import type { ShareStorage, ShareStorageConfig } from './types';

// Provider SDKs are loaded only when sharing is used; the editor knows no SDK types.
export async function createShareStorage(
  config: ShareStorageConfig,
): Promise<ShareStorage> {
  validateConfig(config);
  switch (config.provider) {
    case 'oss': {
      const { default: OSS } = await import('ali-oss');
      const client = new OSS({
        bucket: config.bucket,
        region: config.region.startsWith('oss-')
          ? config.region
          : `oss-${config.region}`,
        endpoint: config.endpoint || undefined,
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
        stsToken: config.sessionToken || undefined,
        secure: true,
        authorizationV4: true,
        timeout: 60_000,
      });
      return {
        async upload(key, body) {
          await client.put(key, body, {
            headers: {
              'Content-Type': 'application/octet-stream',
              'Cache-Control': 'no-store',
            },
          });
        },
        downloadURL: (key, expiresIn) =>
          client.signatureUrlV4('GET', expiresIn, undefined, key),
        async remove(key) {
          await client.delete(key);
        },
      };
    }
    case 'cos': {
      const { default: COS } = await import('cos-js-sdk-v5/index.js');
      const client = new COS({
        SecretId: config.accessKeyId,
        SecretKey: config.accessKeySecret,
        SecurityToken: config.sessionToken || undefined,
        ExpiredTime: config.credentialExpiresAt
          ? Math.floor(Date.parse(config.credentialExpiresAt) / 1000)
          : undefined,
        Domain: config.endpoint ? new URL(config.endpoint).host : undefined,
        Protocol: 'https:',
        Timeout: 60_000,
      });
      const target = { Bucket: config.bucket, Region: config.region };
      return {
        async upload(key, body) {
          await client.putObject({
            ...target,
            Key: key,
            Body: body,
            ContentType: 'application/octet-stream',
            CacheControl: 'no-store',
          });
        },
        downloadURL: (key, expiresIn) =>
          new Promise((resolve, reject) => {
            client.getObjectUrl(
              {
                ...target,
                Key: key,
                Sign: true,
                Expires: expiresIn,
                Protocol: 'https:',
              },
              (error, data) => {
                if (error) reject(error);
                else resolve(data.Url);
              },
            );
          }),
        async remove(key) {
          await client.deleteObject({ ...target, Key: key });
        },
      };
    }
    case 'minio': {
      const [
        { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand },
        { getSignedUrl },
      ] = await Promise.all([
        import('@aws-sdk/client-s3'),
        import('@aws-sdk/s3-request-presigner'),
      ]);
      const client = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.accessKeySecret,
          sessionToken: config.sessionToken || undefined,
        },
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        maxAttempts: 2,
        requestHandler: { requestTimeout: 60_000 },
      });
      const target = { Bucket: config.bucket };
      return {
        async upload(key, body) {
          const url = await getSignedUrl(
            client,
            new PutObjectCommand({
              ...target,
              Key: key,
              ContentType: 'application/octet-stream',
              CacheControl: 'no-store',
            }),
            { expiresIn: 300 },
          );
          const response = await fetch(url, {
            method: 'PUT',
            body,
            headers: {
              'Content-Type': 'application/octet-stream',
              'Cache-Control': 'no-store',
            },
            signal: AbortSignal.timeout(60_000),
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
          });
          if (!response.ok) throw new Error('上传失败');
        },
        downloadURL: (key, expiresIn) =>
          getSignedUrl(client, new GetObjectCommand({ ...target, Key: key }), {
            expiresIn,
          }),
        async remove(key) {
          await client.send(new DeleteObjectCommand({ ...target, Key: key }));
        },
      };
    }
  }
}
