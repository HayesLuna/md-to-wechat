import { parseArticle } from './articleParser';

self.addEventListener(
  'message',
  (event: MessageEvent<{ id: number; markdown: string }>) => {
    const { id, markdown } = event.data;
    try {
      self.postMessage({ id, result: parseArticle(markdown) });
    } catch (error) {
      self.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
