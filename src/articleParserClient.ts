import type { ParsedArticle } from './articleParser';

type Task = {
  resolve: (result: ParsedArticle) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
};
let worker: Worker | undefined;
let nextId = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, Task>();
function stop() {
  clearTimeout(idle);
  worker?.terminate();
  worker = undefined;
}
function scheduleIdle() {
  clearTimeout(idle);
  if (!pending.size) idle = setTimeout(stop, 30_000);
}
export async function parseArticleAsync(
  markdown: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (typeof Worker === 'undefined') {
    const { parseArticle } = await import('./articleParser');
    signal?.throwIfAborted();
    return parseArticle(markdown);
  }
  clearTimeout(idle);
  if (!worker) {
    worker = new Worker(new URL('./articleParser.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (
      event: MessageEvent<{
        id: number;
        result: ParsedArticle;
        error?: string;
      }>,
    ) => {
      const task = pending.get(event.data.id);
      if (!task) return;
      pending.delete(event.data.id);
      task.cleanup();
      if (event.data.error) task.reject(new Error(event.data.error));
      else task.resolve(event.data.result);
      scheduleIdle();
    };
    worker.onerror = () => {
      stop();
      for (const task of pending.values()) {
        task.cleanup();
        task.reject(new Error('排版解析任务加载失败，请重试。'));
      }
      pending.clear();
    };
  }
  const id = ++nextId;
  return new Promise<ParsedArticle>((resolve, reject) => {
    const abort = () => {
      pending.delete(id);
      reject(signal?.reason);
      if (!pending.size) stop();
    };
    pending.set(id, {
      resolve,
      reject,
      cleanup: () => signal?.removeEventListener('abort', abort),
    });
    signal?.addEventListener('abort', abort, { once: true });
    worker!.postMessage({ id, markdown });
  });
}
