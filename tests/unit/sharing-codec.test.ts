import { describe, it, expect } from 'vitest';
import {
  analyzeImageReferences,
  remapImageReferences,
} from '../../src/sharing/imageReferences';
import {
  encodeArticlePackage,
  decodeArticlePackage,
} from '../../src/sharing/packageCodec';
import { DEFAULT_SETTINGS } from '../../src/sample';

describe('sharing imageReferences & packageCodec', () => {
  it('analyzes and remaps local-image references while ignoring code blocks', () => {
    const md =
      '![a](local-image:img-1)\n\n```\n![ignored](local-image:img-9)\n```\n\n![b][ref]\n\n[ref]: local-image:img-2';
    const refs = analyzeImageReferences(md);
    expect(refs.ids).toEqual(['img-1', 'img-2']);
    const remapped = remapImageReferences(
      md,
      new Map([
        ['img-1', 'new-1'],
        ['img-2', 'new-2'],
      ]),
    );
    expect(remapped).toContain('![a](local-image:new-1)');
    expect(remapped).toContain('[ref]: local-image:new-2');
    expect(remapped).toContain('![ignored](local-image:img-9)');
  });

  it('round-trips an encoded text article package and verifies sha256', async () => {
    const encoded = await encodeArticlePackage(
      {
        title: '测试分享文章',
        markdown: '# 标题\n\n正文内容与 ==高亮==',
        settings: DEFAULT_SETTINGS,
      },
      async () => [],
    );
    expect(encoded.sha256).toMatch(/^[0-9a-f]{64}$/);
    const bytes = new Uint8Array(await encoded.blob.arrayBuffer());
    const decoded = await decodeArticlePackage(bytes);
    expect(decoded.title).toBe('测试分享文章');
    expect(decoded.markdown).toBe('# 标题\n\n正文内容与 ==高亮==');
    expect(decoded.images).toEqual([]);
  });
});
