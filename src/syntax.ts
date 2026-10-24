import highlighter from 'highlight.js/lib/core';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';

// Larger blocks stay editable and exportable as plain code without a long
// synchronous tokenization pass on the main thread.
export const MAX_CODE_HIGHLIGHT_CHARACTERS = 50_000;

const initial = {
  javascript,
  json,
};
export const lowlight = createLowlight(initial);
for (const [name, grammar] of Object.entries(initial))
  highlighter.registerLanguage(name, grammar);
export { highlighter };
export let syntaxRevision = 0;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();
export function onSyntaxReady(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ensureSyntax(language: string): Promise<void> {
  if (!language || language === 'mermaid' || highlighter.getLanguage(language))
    return Promise.resolve();
  loading ||= import('./syntaxExtras')
    .then(({ common }) => {
      lowlight.register(common);
      for (const [name, grammar] of Object.entries(common))
        highlighter.registerLanguage(name, grammar);
      syntaxRevision++;
      listeners.forEach((listener) => listener());
    })
    .catch((error) => {
      loading = undefined;
      throw error;
    });
  return loading;
}
