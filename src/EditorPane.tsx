import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { createLowlight, common } from 'lowlight';
import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef } from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import { SizedImage, SmartCode, CleanParagraph, EditingRules, StructuredListItem } from './editorExtensions';
import { safeURL } from './output';
import { markdownSelection } from './markdownClipboard';
import { shouldParseMarkdownPaste } from './markdownPaste';
function modifiedLink(event:MouseEvent,dom:HTMLElement) {
 if(event.button!==0||(!event.ctrlKey&&!event.metaKey))return null;
 const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;
 return link&&dom.contains(link)?link:null;
}
export function safeDocument(editor:Editor,markdown:string) {
 const json=editor.markdown!.parse(markdown);
 function clean(n:JSONContent) {
  if(n.type==='listItem'&&n.content?.[0]?.type!=='paragraph')n.content=[{type:'paragraph'},...(n.content||[])];
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
 const editorRef=useRef<Editor|null>(null);const plainPaste=useRef(false);
 const extensions=useMemo(()=>([StarterKit.configure({paragraph:false,codeBlock:false,listItem:false,link:{openOnClick:false,autolink:false,enableClickSelection:true,isAllowedUri:(url)=>safeURL(url),HTMLAttributes:{title:'Ctrl / Cmd＋点击，在新标签页打开'}}}),StructuredListItem,Markdown.configure({markedOptions:{gfm:true,breaks:false}}),CleanParagraph,SizedImage,SmartCode.configure({lowlight:createLowlight(common),defaultLanguage:null}),TableKit.configure({table:{resizable:false,renderWrapper:true,allowTableNodeSelection:true}}),TaskList,TaskItem.configure({nested:true}),EditingRules]),[]);
 const editor=useEditor({
  extensions,
  content:initial,contentType:'markdown',immediatelyRender:false,
  editorProps:{clipboardTextSerializer:slice=>markdownSelection(editorRef.current,slice),attributes:{class:'article-editor',spellcheck:'false','aria-label':'所见即所得正文'},
   transformPastedHTML:html=>DOMPurify.sanitize(html,{FORBID_TAGS:['svg','script','style','iframe'],FORBID_ATTR:['style']}),
   handleDOMEvents:{
    keydown:(_view,event)=>{plainPaste.current=!!((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='v');return Boolean(event.isComposing||event.keyCode===229);},
    contextmenu:(_view,event)=>editorRef.current ? props.current.onContext(event,editorRef.current) : false,
    mousedown:(view,event)=>{if(!modifiedLink(event,view.dom))return false;event.preventDefault();return true;},
    click:(view,event)=>{const link=modifiedLink(event,view.dom);if(!link)return false;event.preventDefault();if(safeURL(link.getAttribute('href')||''))window.open(link.href,'_blank','noopener,noreferrer');return true;},
   },
   handlePaste:(_view,event)=>{
    const literal=plainPaste.current;plainPaste.current=false;const data=event.clipboardData;const file=Array.from(data?.files||[]).find(f=>f.type.startsWith('image/'));
    if(file){event.preventDefault();props.current.onPasteImage(file);return true;}
    const editor=editorRef.current;const text=data?.getData('text/plain')||'';const html=data?.getData('text/html')||'';
    if(!editor||literal||editor.isActive('codeBlock')||editor.isActive('code')||!shouldParseMarkdownPaste(text,html))return false;
    const parsed=safeDocument(editor,text);if(!editor.commands.insertContent(parsed.content||[]))return false;
    event.preventDefault();return true;
   },
  },
  onUpdate:({editor})=>props.current.onChange(editor.getMarkdown()),
  onSelectionUpdate:()=>props.current.onSelection(),
 });
 useEffect(()=>{if(editor){editorRef.current=editor;replaceDocument(editor,initial);onReady(editor);}},[editor]);
 return <EditorContent editor={editor}/>;
}
