import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { outputKey } from './outputUtils';
import type { Output } from './output';
import type { Settings } from './sample';

export function useArticleOutput({
  markdown,
  settings,
  ready,
  preview,
  contentRevision,
  requestedOutput,
  revision,
}: {
  markdown: string;
  settings: Settings;
  ready: boolean;
  preview: boolean;
  contentRevision: number;
  requestedOutput: { key: string; attempt: number } | null;
  revision: RefObject<number>;
}) {
  const outputRef = useRef<Output | null>(null);
  const outputAbort = useRef<AbortController | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [renderError, setRenderError] = useState('');
  const invalidate = useCallback(() => {
    outputAbort.current?.abort();
    setPreparing(true);
  }, []);
  const reset = useCallback(() => {
    outputAbort.current?.abort();
    outputRef.current?.dispose();
    outputRef.current = null;
    setOutput(null);
    setPreparing(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const key = outputKey(markdown, settings);
    const demanded = preview || requestedOutput?.key === key;
    if (
      outputRef.current?.key === key &&
      (!demanded || outputRef.current.previewReady)
    ) {
      setPreparing(false);
      setRenderError('');
      return;
    }
    if (!demanded && markdown.length > 50_000) {
      // Free a stale snapshot while long articles wait for explicit preview/copy.
      outputRef.current?.dispose();
      outputRef.current = null;
      setOutput(null);
      setPreparing(true);
      return;
    }
    let active = true;
    const controller = new AbortController();
    outputAbort.current = controller;
    const renderRevision = revision.current;
    setPreparing(true);
    setRenderError('');
    const timer = setTimeout(
      () => {
        import('./output')
          .then(({ renderArticle }) =>
            renderArticle(markdown, settings, controller.signal, {
              diagrams: demanded,
            }),
          )
          .then((result) => {
            if (
              active &&
              !controller.signal.aborted &&
              renderRevision === revision.current
            ) {
              outputRef.current?.dispose();
              outputRef.current = result;
              setOutput(result);
              setPreparing(false);
            } else result.dispose();
          })
          .catch((e) => {
            if (active && !controller.signal.aborted) {
              setPreparing(false);
              setRenderError('排版准备失败，请重试：' + e.message);
            }
          });
      },
      preview ? 250 : 600,
    );
    return () => {
      active = false;
      controller.abort();
      if (outputAbort.current === controller) outputAbort.current = null;
      clearTimeout(timer);
    };
  }, [markdown, settings, ready, preview, contentRevision, requestedOutput]);
  useEffect(
    () => () => {
      outputRef.current?.dispose();
    },
    [],
  );

  return { output, preparing, renderError, invalidate, reset };
}
