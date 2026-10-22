import highlighter from 'highlight.js/lib/core';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import java from 'highlight.js/lib/languages/java';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';

const initial = {
  javascript,
  typescript,
  java,
  python,
  bash,
  sql,
  json,
  xml,
  css,
  markdown,
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
