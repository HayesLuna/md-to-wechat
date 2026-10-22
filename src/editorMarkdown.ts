import type { Editor } from '@tiptap/core';

const pending = new WeakMap<
  Editor,
  { timer: ReturnType<typeof setTimeout>; flush: () => void }
>();

export function cancelEditorMarkdown(editor: Editor) {
  const update = pending.get(editor);
  if (update) clearTimeout(update.timer);
  pending.delete(editor);
}

export function flushEditorMarkdown(editor: Editor | null) {
  if (editor && !editor.isDestroyed) pending.get(editor)?.flush();
}

export function scheduleEditorMarkdown(
  editor: Editor,
  publish: (text: string) => void,
) {
  cancelEditorMarkdown(editor);
  const flush = () => {
    cancelEditorMarkdown(editor);
    if (!editor.isDestroyed) publish(editor.getMarkdown());
  };
  pending.set(editor, { timer: setTimeout(flush, 100), flush });
}
