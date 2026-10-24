import DOMPurify from 'dompurify';
import { download } from './storage';
let engine: Promise<typeof import('mermaid').default> | undefined;
let queue: Promise<unknown> = Promise.resolve();
type DiagramTask = {
  promise: Promise<string>;
  users: number;
  started: boolean;
  size: number;
};
const cache = new Map<string, DiagramTask>();
let cachedCharacters = 0;
function removeCached(source: string, task: DiagramTask) {
  if (cache.get(source) !== task) return;
  cache.delete(source);
  cachedCharacters -= task.size;
}
function trimCache() {
  while (cache.size > 40 || cachedCharacters > 2_000_000) {
    const source = cache.keys().next().value!;
    removeCached(source, cache.get(source)!);
  }
}
export function diagram(source: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (!source.trim()) return Promise.reject(new Error('请输入 Mermaid 源码。'));
  let task = cache.get(source);
  if (task && !task.started && !task.users) {
    removeCached(source, task);
    task = undefined;
  }
  if (!task) {
    const created: DiagramTask = {
      promise: Promise.resolve(''),
      users: 0,
      started: false,
      size: source.length,
    };
    const pending = queue.then(async () => {
      // Obsolete queued snapshots have no owners. In-flight Mermaid work cannot
      // be interrupted, but must not hold up the latest version with more work.
      if (!created.users)
        throw new DOMException('图形任务已取消', 'AbortError');
      created.started = true;
      engine ||= import('mermaid')
        .then((m) => {
          m.default.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'base',
            themeVariables: {
              primaryColor: '#e8f2ff',
              primaryTextColor: '#24415f',
              primaryBorderColor: '#5b92d4',
              secondaryColor: '#dcecff',
              secondaryTextColor: '#24415f',
              secondaryBorderColor: '#739ed4',
              tertiaryColor: '#f1f7ff',
              tertiaryTextColor: '#24415f',
              tertiaryBorderColor: '#91b4de',
              lineColor: '#527ca6',
              textColor: '#24415f',
              clusterBkg: '#f1f7ff',
              clusterBorder: '#91b4de',
              actorBkg: '#f1f7ff',
              actorBorder: '#91b4de',
              actorTextColor: '#24415f',
              signalColor: '#527ca6',
              signalTextColor: '#24415f',
              sequenceNumberColor: '#ffffff',
              noteBkgColor: '#e8f2ff',
              noteBorderColor: '#5b92d4',
              noteTextColor: '#24415f',
            },
            htmlLabels: false,
            secure: [
              'secure',
              'securityLevel',
              'startOnLoad',
              'htmlLabels',
              'flowchart',
            ],
            flowchart: { htmlLabels: false },
            suppressErrorRendering: true,
          });
          return m.default;
        })
        .catch((error) => {
          engine = undefined;
          throw error;
        });
      const m = await engine;
      if (!created.users)
        throw new DOMException('图形任务已取消', 'AbortError');
      const result = await m.render('mojian-' + crypto.randomUUID(), source);
      return DOMPurify.sanitize(result.svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['foreignObject', 'script'],
        FORBID_ATTR: ['onload', 'onclick'],
      });
    });
    created.promise = pending.then(
      (svg) => {
        if (cache.get(source) === created) {
          cachedCharacters += svg.length;
          created.size += svg.length;
          trimCache();
        }
        return svg;
      },
      (error) => {
        removeCached(source, created);
        throw error;
      },
    );
    queue = created.promise.catch(() => {});
    cache.set(source, created);
    cachedCharacters += created.size;
    trimCache();
    task = created;
  }
  const owned = task;
  owned.users++;
  return new Promise<string>((resolve, reject) => {
    let finished = false;
    const release = () => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener('abort', abort);
      owned.users--;
      if (!owned.users && !owned.started) removeCached(source, owned);
      return true;
    };
    const abort = () => {
      if (release()) reject(signal!.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
    owned.promise.then(
      (svg) => {
        if (release()) resolve(svg);
      },
      (error) => {
        if (release()) reject(error);
      },
    );
  });
}

export async function downloadDiagram(
  source: string,
  format: 'png' | 'svg' = 'png',
) {
  let svg = await diagram(source);
  const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = xml.documentElement;
  const box = (root.getAttribute('viewBox') || '').split(/[ ,]+/).map(Number);
  if (box.length === 4 && box.every(Number.isFinite)) {
    root.setAttribute('width', String(Math.max(1, Math.min(4000, box[2]))));
    root.setAttribute('height', String(Math.max(1, Math.min(4000, box[3]))));
    svg = new XMLSerializer().serializeToString(root);
  }
  if (format === 'svg') {
    download(new Blob([svg], { type: 'image/svg+xml' }), '墨笺图形.svg');
    return;
  }
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    const scale = 2;
    c.width = Math.min(8000, (img.naturalWidth || 1000) * scale);
    c.height = Math.min(8000, (img.naturalHeight || 600) * scale);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const png = await new Promise<Blob>((resolve, reject) =>
      c.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error('PNG 转换失败，请下载 SVG。')),
        'image/png',
      ),
    );
    download(png, '墨笺图形.png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
