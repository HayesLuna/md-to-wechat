import type { Editor } from '@tiptap/core';
import type { Output } from '../src/output';
import type { Settings } from '../src/sample';

declare global {
  interface Window {
    __mojian?: {
      editor: Editor | null;
      setMarkdown: (text: string) => void;
      getMarkdown: () => string;
      getSettings: () => Settings;
      getOutput: () => Output | null;
    };
  }
}
export {};
