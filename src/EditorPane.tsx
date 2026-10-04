import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { createLowlight, common } from 'lowlight';
import DOMPurify from 'dompurify';
import { useEffect, useRef } from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import { SizedImage, SmartCode, EditingRules } from './editorExtensions';
import { safeURL } from './output';
export function safeDocument(editor:Editor,markdown:string) {
 const json=editor.markdown!.parse(markdown);
 function clean(n:JSONContent) {
  if(n.marks)n.marks=n.marks.filter(m=>m.type!=='link'||safeURL(m.attrs?.href||''));
  if(n.type==='image'&& !/^https?:\/\/|^local-image:[a-zA-Z0-9-]+$/.test(n.attrs?.src||'')){n.attrs={...n.attrs,src:'',alt:'不安全的图片地址已阻止'};}
  n.content?.forEach(clean);
 }clean(json);return json;
}
export function replaceDocument(editor:Editor,markdown:string) {
 const json=safeDocument(editor,markdown);
 editor.chain().command(({tr})=>{tr.setMeta('addToHistory',false);return true;}).setContent(json,{emitUpdate:false}).run();
}
export function EditorPane({initial,onReady,onChange,onSelection,onContext,onPasteImage}: {
 initial:string;onReady:(e:Editor)=>void;onChange:(s:string)=>void;onSelection:()=>void;
 onContext:(event:MouseEvent,editor:Editor)=>boolean;onPasteImage:(file:File)=>void;
}) {
 const props=useRef({onChange,onSelection,onContext,onPasteImage});props.current={onChange,onSelection,onContext,onPasteImage};
 const editorRef=useRef<Editor|null>(null);
 const editor=useEditor({
  extensions:[StarterKit.configure({codeBlock:false,link:{openOnClick:false,autolink:false,enableClickSelection:true,isAllowedUri:(url)=>safeURL(url)}}),Markdown.configure({markedOptions:{gfm:true,breaks:false}}),SizedImage,SmartCode.configure({lowlight:createLowlight(common),defaultLanguage:null}),TableKit.configure({table:{resizable:false,renderWrapper:true,allowTableNodeSelection:true}}),TaskList,TaskItem.configure({nested:true}),EditingRules],
  content:initial,contentType:'markdown',immediatelyRender:false,
  editorProps:{attributes:{class:'article-editor',spellcheck:'false','aria-label':'所见即所得正文'},
   transformPastedHTML:html=>DOMPurify.sanitize(html,{FORBID_TAGS:['svg','script','style','iframe'],FORBID_ATTR:['style']}),
   handleDOMEvents:{keydown:(_view,event)=>Boolean(event.isComposing||event.keyCode===229),contextmenu:(view,event)=>editorRef.current ? props.current.onContext(event,editorRef.current) : false},
   handlePaste:(_view,event)=>{const file=Array.from(event.clipboardData?.files||[]).find(f=>f.type.startsWith('image/'));if(file){event.preventDefault();props.current.onPasteImage(file);return true;}return false;},
  },
  onUpdate:({editor})=>props.current.onChange(editor.getMarkdown()),
  onSelectionUpdate:()=>props.current.onSelection(),
 });
 useEffect(()=>{if(editor){editorRef.current=editor;replaceDocument(editor,initial);onReady(editor);}},[editor]);
 return <EditorContent editor={editor}/>;
}
