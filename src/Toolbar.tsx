import type { Editor } from '@tiptap/core';
import { Bold, Italic, Strikethrough, Code, Link, Quote, List, ListOrdered, ListTodo, Table, ImagePlus, Minus, Braces, Undo2, Redo2, MoreHorizontal } from 'lucide-react';
export type Operation='link'|'image'|'table'|'more';
export function Toolbar({editor,onOpen,source,onCopySource,linkTools}: {editor:Editor|null;onOpen:(op:Operation)=>void;source:boolean;onCopySource:()=>void;linkTools?:React.ReactNode}) {
 if(source)return <div className="toolbar source-tools"><span>原始 Markdown · 不自动改写输入</span><button onClick={onCopySource}><Code size={15}/>复制 Markdown 源码</button></div>;
 const action=(fn:(e:Editor)=>unknown)=>()=>{if(editor)fn(editor);};
 const button=(title:string,icon:React.ReactNode,fn:()=>void,active=false)=><button key={title} type="button" title={title} aria-label={title} className={active?'active':''} onMouseDown={e=>e.preventDefault()} onClick={fn}>{icon}</button>;
 return <div className="toolbar" role="toolbar" aria-label="正文格式">
  {linkTools}
  <select aria-label="标题级别" value={editor?.isActive('heading')?String(editor.getAttributes('heading').level):'0'} onChange={e=>{const level=Number(e.target.value);if(editor){if(!level)editor.chain().focus().setParagraph().run();else editor.chain().focus().toggleHeading({level:level as 1|2|3}).run();}}}><option value="0">正文</option><option value="1">H1</option><option value="2">H2</option><option value="3">H3</option></select><i/>
  {button('粗体',<Bold size={17}/>,action(e=>e.chain().focus().toggleBold().run()),editor?.isActive('bold'))}
  {button('斜体',<Italic size={17}/>,action(e=>e.chain().focus().toggleItalic().run()),editor?.isActive('italic'))}
  {button('删除线',<Strikethrough size={17}/>,action(e=>e.chain().focus().toggleStrike().run()),editor?.isActive('strike'))}
  {button('行内代码',<Code size={17}/>,action(e=>e.chain().focus().toggleCode().run()),editor?.isActive('code'))}
  {button('插入链接',<Link size={17}/>,()=>onOpen('link'))}<i/>
  {button('引用',<Quote size={17}/>,action(e=>e.chain().focus().toggleBlockquote().run()),editor?.isActive('blockquote'))}
  {button('无序列表',<List size={17}/>,action(e=>e.chain().focus().toggleBulletList().run()),editor?.isActive('bulletList'))}
  {button('有序列表',<ListOrdered size={17}/>,action(e=>e.chain().focus().toggleOrderedList().run()),editor?.isActive('orderedList'))}
  {button('任务列表',<ListTodo size={17}/>,action(e=>e.chain().focus().toggleTaskList().run()),editor?.isActive('taskList'))}<i/>
  {button('插入表格',<Table size={17}/>,()=>onOpen('table'))}
  {button('插入图片',<ImagePlus size={17}/>,()=>onOpen('image'))}
  {button('代码块',<Braces size={17}/>,action(e=>e.chain().focus().toggleCodeBlock().run()))}
  {button('分隔线',<Minus size={17}/>,action(e=>e.chain().focus().setHorizontalRule().run()))}<i/>
  {button('撤销',<Undo2 size={16}/>,action(e=>e.chain().focus().undo().run()))}
  {button('重做',<Redo2 size={16}/>,action(e=>e.chain().focus().redo().run()))}
  <span className="toolbar-fill"/>{button('更多操作',<MoreHorizontal size={18}/>,()=>onOpen('more'))}
 </div>;
}
