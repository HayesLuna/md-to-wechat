import { packageHash } from './packageHash';
import { zipSync, unzipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import {
  analyzeImageReferences,
  remapImageReferences,
} from './imageReferences';
import { MAX_PACKAGE_BYTES, type ShareArticle } from './packageProtocol';
import { DEFAULT_SETTINGS, type Settings } from '../sample';

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 100;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

type Manifest = {
  format: 'mojian-article';
  version: 1;
  title: string;
  settings: Settings;
  images: { id: string; path: string; type: string }[];
};

export async function encodeArticlePackage(
  article: ShareArticle,
  loadImages: (sources: string[]) => Promise<(Blob | undefined)[]>,
) {
  const text = strToU8(article.markdown);
  if (text.length > MAX_TEXT_BYTES) throw new Error('文章正文不能超过 5 MB。');
  const assets = analyzeImageReferences(article.markdown).ids.map(
    (id) => 'local-image:' + id,
  );
  if (assets.length > MAX_IMAGES)
    throw new Error('一次最多分享 100 张本地图片。');
  const manifest: Manifest = {
    format: 'mojian-article',
    version: 1,
    title: article.title.slice(0, 100),
    settings: { ...article.settings },
    images: [],
  };
  const files: Zippable = { 'article.md': [text, { level: 6 }] };
  let size = text.length;
  const blobs = await loadImages(assets);
  for (const [index, asset] of assets.entries()) {
    const blob = blobs[index];
    if (
      !blob ||
      !IMAGE_TYPES.includes(blob.type) ||
      blob.size > 10 * 1024 * 1024
    )
      throw new Error('文章中的本地图片缺失或格式不支持，请补齐后再分享。');
    size += blob.size;
    if (size > MAX_PACKAGE_BYTES - 65536)
      throw new Error('文章和图片合计不能超过 50 MB。');
    const id = asset.slice(12);
    const path = `images/${id}`;
    manifest.images.push({ id, path, type: blob.type });
    files[path] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  files['manifest.json'] = [strToU8(JSON.stringify(manifest)), { level: 6 }];
  const bytes = zipSync(files) as Uint8Array<ArrayBuffer>;
  if (bytes.length > MAX_PACKAGE_BYTES)
    throw new Error('文章包不能超过 50 MB。');
  return {
    blob: new Blob([bytes], { type: 'application/octet-stream' }),
    sha256: await packageHash(bytes),
  };
}

function parseManifest(value: unknown): Manifest {
  if (!value || typeof value !== 'object')
    throw new Error('文章包格式不正确。');
  const v = value as Record<string, unknown>;
  if (v.format !== 'mojian-article' || v.version !== 1)
    throw new Error('无法识别文章包版本，请更新工具后重试。');
  if (
    typeof v.title !== 'string' ||
    v.title.length > 100 ||
    !Array.isArray(v.images) ||
    v.images.length > MAX_IMAGES
  )
    throw new Error('文章包信息不完整。');
  const s = v.settings as Record<string, unknown> | null;
  if (
    !s ||
    typeof s !== 'object' ||
    !['default', 'simple', 'elegant'].includes(String(s.theme)) ||
    typeof s.color !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(s.color) ||
    typeof s.fontSize !== 'number' ||
    s.fontSize < 14 ||
    s.fontSize > 20 ||
    typeof s.lineHeight !== 'number' ||
    !Number.isFinite(s.lineHeight) ||
    s.lineHeight < 1.5 ||
    s.lineHeight > 2.3 ||
    !['light', 'dark'].includes(String(s.codeTheme))
  )
    throw new Error('文章包的排版设置不正确。');
  const ids = new Set<string>();
  for (const image of v.images) {
    if (
      !image ||
      typeof image.id !== 'string' ||
      !/^[a-zA-Z0-9-]+$/.test(image.id) ||
      image.path !== `images/${image.id}` ||
      !IMAGE_TYPES.includes(image.type) ||
      ids.has(image.id)
    )
      throw new Error('文章包图片信息不正确。');
    ids.add(image.id);
  }
  return {
    format: 'mojian-article',
    version: 1,
    title: v.title,
    settings: {
      ...DEFAULT_SETTINGS,
      theme: s.theme as Settings['theme'],
      color: s.color,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      codeTheme: s.codeTheme as Settings['codeTheme'],
    },
    images: v.images.map((i) => ({ id: i.id, path: i.path, type: i.type })),
  };
}

export async function decodeArticlePackage(bytes: Uint8Array<ArrayBuffer>) {
  if (bytes.length > MAX_PACKAGE_BYTES)
    throw new Error('文章包不能超过 50 MB。');
  let total = 0;
  let count = 0;
  let invalid = false;
  let files: Record<string, Uint8Array<ArrayBuffer>>;
  try {
    files = unzipSync(bytes, {
      filter: (entry) => {
        total += entry.originalSize;
        count++;
        const limit =
          entry.name === 'manifest.json'
            ? 65536
            : entry.name === 'article.md'
              ? MAX_TEXT_BYTES
              : 10 * 1024 * 1024;
        if (
          !Number.isFinite(total) ||
          total > MAX_PACKAGE_BYTES ||
          count > MAX_IMAGES + 2 ||
          entry.originalSize > limit ||
          !/^(manifest\.json|article\.md|images\/[a-zA-Z0-9-]+)$/.test(
            entry.name,
          )
        )
          invalid = true;
        return !invalid;
      },
    }) as Record<string, Uint8Array<ArrayBuffer>>;
  } catch {
    throw new Error('文章包已损坏，无法导入。');
  }
  if (invalid || !files['manifest.json'] || !files['article.md'])
    throw new Error('文章包内容不完整或超过大小限制。');
  let manifest: Manifest;
  try {
    manifest = parseManifest(JSON.parse(strFromU8(files['manifest.json'])));
  } catch (error) {
    throw error instanceof SyntaxError
      ? new Error('文章包信息已损坏。')
      : error;
  }
  const markdown = strFromU8(files['article.md']);
  const references = analyzeImageReferences(markdown);
  const referenced = new Set(references.ids);
  if (
    referenced.size !== manifest.images.length ||
    manifest.images.some((i) => !referenced.has(i.id))
  )
    throw new Error('文章包的图片与正文不匹配。');
  const images: { oldId: string; id: string; blob: Blob }[] = [];
  for (const entry of manifest.images) {
    const data = files[entry.path];
    if (!data?.length) throw new Error('文章包中的图片缺失。');
    const blob = new Blob([data], { type: entry.type });
    try {
      const bitmap = await createImageBitmap(blob);
      bitmap.close();
    } catch {
      throw new Error('文章包中有无法读取的图片。');
    }
    images.push({ oldId: entry.id, id: crypto.randomUUID(), blob });
  }
  const replacements = new Map(images.map((i) => [i.oldId, i.id]));
  const restored = remapImageReferences(markdown, replacements, references);
  // Every accepted local image must have a source destination to rewrite.
  const mapped = new Set(references.destinations.map((entry) => entry.id));
  if (references.ids.some((id) => !mapped.has(id)))
    throw new Error('文章包的图片引用无法恢复，导入已停止。');
  return {
    title: manifest.title,
    markdown: restored,
    settings: manifest.settings,
    images: images.map(({ id, blob }) => ({ id, blob })),
  };
}
