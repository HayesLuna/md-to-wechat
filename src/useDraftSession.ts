import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Editor } from '@tiptap/core';
import { SAMPLE, DEFAULT_SETTINGS, type Settings } from './sample';
import {
  beginImageSession,
  loadDraftLibrary,
  loadDraft,
  newDraft,
  summarizeDraft,
  saveDraft,
  draftTitle,
  DraftConflictError,
  type Draft,
  type DraftSummary,
} from './storage';
import { flushEditorMarkdown } from './editorMarkdown';
import { outputKey } from './outputUtils';
type SaveStatus = 'saving' | 'saved' | 'failed';
function validSettings(s?: Settings): Settings {
  if (!s) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    theme: ['default', 'simple', 'elegant'].includes(s.theme)
      ? s.theme
      : 'default',
    color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : DEFAULT_SETTINGS.color,
    fontSize: Math.max(14, Math.min(20, s.fontSize || 16)),
    lineHeight: Math.max(1.5, Math.min(2.3, s.lineHeight || 1.85)),
    codeTheme: s.codeTheme === 'dark' ? 'dark' : 'light',
  };
}

export function useDraftSession({
  editor: latestEditor,
  notify,
  setDrafts,
}: {
  editor: RefObject<Editor | null>;
  notify: (message: string) => void;
  setDrafts: Dispatch<SetStateAction<DraftSummary[]>>;
}) {
  const [switching, setSwitching] = useState(false);
  const savedVersions = useRef(new Map<string, number>());
  const activeDraft = useRef<Draft | null>(null);
  const switchingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [markdown, setMarkdown] = useState('');
  const [contentRevision, setContentRevision] = useState(0);
  const [initial, setInitial] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saving');
  const version = useRef(Date.now());
  const [saveTime, setSaveTime] = useState(0);
  const current = useRef({ markdown, settings, readOnly });
  current.current = { markdown, settings, readOnly };
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const statusRef = useRef(saveStatus);
  statusRef.current = saveStatus;
  useEffect(() => {
    let active = true;
    let releaseImages: (() => void) | undefined;
    beginImageSession()
      .then((release) => {
        releaseImages = release;
        if (!active) {
          release();
          return null;
        }
        return loadDraftLibrary();
      })
      .then(async (library) => {
        if (!active || !library) return;
        library.drafts.forEach((d) =>
          savedVersions.current.set(d.id, d.version),
        );
        const selected =
          library.drafts.find((d) => d.id === library.activeId) ||
          library.drafts[0];
        const d =
          (selected && (await loadDraft(selected.id))) ||
          newDraft(SAMPLE, DEFAULT_SETTINGS);
        if (!active) return;
        activeDraft.current = d;
        setDrafts(library.drafts.length ? library.drafts : [summarizeDraft(d)]);
        setReadOnly(d.readOnly === true);
        setMarkdown(d.markdown);
        setInitial(d.markdown);
        setSettings(validSettings(d.settings));
        version.current = Math.max(Date.now(), d.version + 1);
        setSaveTime(d.savedAt);
        setReady(true);
      })
      .catch(() => {
        if (active) {
          const d = newDraft(SAMPLE, DEFAULT_SETTINGS);
          activeDraft.current = d;
          setDrafts([summarizeDraft(d)]);
          setMarkdown(SAMPLE);
          setInitial(SAMPLE);
          setReady(true);
          notify('无法读取本地存储；请保留内容并导出 Markdown。');
        }
      });
    return () => {
      active = false;
      releaseImages?.();
    };
  }, [notify]);
  const changed = (text: string) => {
    current.current = { ...current.current, markdown: text };
    version.current++;
    statusRef.current = 'saving';
    setMarkdown(text);
    setContentRevision((n) => n + 1);
    setSaveStatus('saving');
  };
  const markDirty = () => {
    version.current++;
    statusRef.current = 'saving';
    setSaveStatus('saving');
  };
  const readCurrent = useCallback(() => {
    flushEditorMarkdown(latestEditor.current);
    return current.current;
  }, []);
  const changeReadOnly = (value: boolean) => {
    if (switchingRef.current) return;
    readCurrent();
    current.current = { ...current.current, readOnly: value };
    version.current++;
    statusRef.current = 'saving';
    setSaveStatus('saving');
    setReadOnly(value);
  };
  const changeSettings = (s: Settings) => {
    if (
      switchingRef.current ||
      outputKey('', s) === outputKey('', current.current.settings)
    )
      return;
    current.current = { ...current.current, settings: s };
    version.current++;
    setSettings(s);
    setSaveStatus('saving');
  };
  const saveNow = useCallback(
    (manual = false) => {
      if (!activeDraft.current) return Promise.resolve();
      const snapshot = readCurrent();
      const v = version.current;
      const draft = {
        ...activeDraft.current,
        ...snapshot,
        title: activeDraft.current.customTitle
          ? activeDraft.current.title
          : draftTitle(snapshot.markdown),
        version: v,
        savedAt: Date.now(),
      };
      setSaveStatus('saving');
      const pending = saveQueue.current
        .catch(() => {})
        .then(async () => {
          await saveDraft(draft, savedVersions.current.get(draft.id));
          savedVersions.current.set(draft.id, draft.version);
          if (activeDraft.current?.id === draft.id) activeDraft.current = draft;
        });
      saveQueue.current = pending;
      pending
        .then(() => {
          setDrafts((items) =>
            items.map((item) =>
              item.id === draft.id ? summarizeDraft(draft) : item,
            ),
          );
          if (activeDraft.current?.id === draft.id && v === version.current) {
            activeDraft.current = draft;
            setSaveStatus('saved');
            setSaveTime(draft.savedAt);
            if (manual) notify('草稿已保存到当前浏览器');
          }
        })
        .catch((error) => {
          if (activeDraft.current?.id === draft.id && v === version.current) {
            setSaveStatus('failed');
            notify(
              error instanceof DraftConflictError
                ? error.message
                : '保存失败：浏览器存储不可用或空间不足。正文仍在，请重试或导出。',
            );
          }
        });
      return pending;
    },
    [notify, readCurrent],
  );
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      if (!switchingRef.current) void saveNow().catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [markdown, settings, readOnly, ready, saveNow, switching]);
  const activate = (d: Draft) => {
    activeDraft.current = d;
    version.current = Math.max(version.current + 1, d.version);
    current.current = {
      readOnly: d.readOnly === true,
      markdown: d.markdown,
      settings: validSettings(d.settings),
    };
    setReadOnly(d.readOnly === true);
    setMarkdown(d.markdown);
    setSettings(current.current.settings);
    setInitial(d.markdown);
    setSaveTime(d.savedAt);
    setSaveStatus('saved');
  };

  return {
    ready,
    markdown,
    contentRevision,
    initial,
    settings,
    switching,
    setSwitching,
    savedVersions,
    activeDraft,
    switchingRef,
    saveStatus,
    saveTime,
    version,
    current,
    statusRef,
    setSaveTime,
    changed,
    markDirty,
    readCurrent,
    changeSettings,
    readOnly,
    changeReadOnly,
    saveNow,
    activate,
  };
}
