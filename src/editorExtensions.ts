import { Extension, wrappingInputRule, type Editor, type Attributes } from '@tiptap/core';
import { Plugin, PluginKey, AllSelection, NodeSelection, TextSelection, type Selection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { Slice, type Node } from '@tiptap/pm/model';
import { ReplaceAroundStep } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { joinBackward } from '@tiptap/pm/commands';
import Image from '@tiptap/extension-image';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import { preserveBoundaryTabs, preserveProseTabs } from './markdownTabs';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ListItem } from '@tiptap/extension-list';
import TaskItem from '@tiptap/extension-task-item';
import StarterKit from '@tiptap/starter-kit';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ImageView, CodeView } from './nodeViews';
import { widthFromTitle } from './output';

// Markdown permits emphasis around inline code. StarterKit's default code
// mark excludes all other marks, making valid Markdown fail insertion checks.
export const MarkdownStarterKit=StarterKit.extend({
 addExtensions(){return (this.parent?.()||[]).map(extension=>
  extension.name==='code'?extension.extend({excludes:''}):extension,
 );},
});

export const StructuredTaskItem=TaskItem.extend({
 parseHTML() {
  // Editor HTML has a direct content wrapper. A descendant div may belong
  // to a nested task and must never replace the current item's content.
  return (this.parent?.()||[]).map(rule=>({
   ...rule,
   contentElement:(element:HTMLElement)=>element.querySelector(':scope > div')??element,
  }));
 },
});

export const StructuredListItem=ListItem.extend({
 parseMarkdown(token,h) {
  const parsed=this.parent?.(token,h)||[];
  if(parsed&&!Array.isArray(parsed)&&parsed.content?.[0]?.type!=='paragraph')parsed.content=[h.createNode('paragraph'),...(parsed.content||[])];
  return parsed;
 },
 renderMarkdown(node,h,ctx) {
  const rendered=this.parent?.(node,h,ctx)||'';
  // A marker with a trailing space is parsed as text by the GFM lexer when
  // followed by a nested bullet list; a bare marker preserves the sublist.
  if(node.content?.length===2&&node.content[0].type==='paragraph'&&!node.content[0].content?.length&&['bulletList','orderedList'].includes(node.content[1].type||''))return rendered.replace(/^([^\n]+)\n/,(_,line:string)=>line.trimEnd()+'\n');
  return rendered;
 },
});

// Let block separators represent empty paragraphs, without HTML placeholders.
// Keep inline text and code untouched, including intentionally written entities.
export const CleanParagraph=Paragraph.extend({
 renderMarkdown(node,h,ctx){
  const text=preserveBoundaryTabs(h.renderChildren(node.content||[]));
  return ctx.parentType&&ctx.parentType!=='doc'?preserveProseTabs(text):text;
 },
});

export const CleanHeading=Heading.extend({
 renderMarkdown(node,h,ctx){
  if(!node.content)return '';
  const level=node.attrs?.level?parseInt(node.attrs.level as string,10):1;
  const text=preserveBoundaryTabs(h.renderChildren(node.content));
  return '#'.repeat(level)+' '+(ctx.parentType&&ctx.parentType!=='doc'?preserveProseTabs(text):text);
 },
});

export const SizedImage=Image.extend({
 addAttributes() { return {...this.parent?.(),percent:{default:100,parseHTML:el=>widthFromTitle(el.getAttribute('title')||'')}}; },
 parseMarkdown(token,h) {return h.createNode('image',{src:token.href,alt:token.text,title:null,percent:widthFromTitle(token.title||'')});},
 renderMarkdown(node) {const alt=String(node.attrs?.alt||'').replace(/[\\\[\]]/g,'\\$&');const src=String(node.attrs?.src||'').replace(/ /g,'%20').replace(/\)/g,'%29');return `![${alt}](${src} "width=${node.attrs?.percent??100}%")`;},
 addNodeView(){return ReactNodeViewRenderer(ImageView);},
});
export const SmartCode=CodeBlockLowlight.extend({
 addAttributes(){
  const attributes:Attributes=this.parent?.()||{};const language=attributes.language;
  return {...attributes,language:{...language,parseHTML:(element:HTMLElement)=>language?.parseHTML?.(element)||element.getAttribute('lang')||element.getAttribute('data-language')||null}};
 },
 parseMarkdown(token,h){
  // The lexer already identified a code block. Nested list fences can retain
  // leading indentation in raw; checking raw.startsWith('```') drops them.
  return h.createNode('codeBlock',{language:token.lang||null},token.text?[h.createTextNode(token.text)]:[]);
 },
 renderMarkdown(node) {
  const source=(node.content||[]).map(n=>n.text||'').join('');
  // Choose a fence longer than any source run, preserving code containing backticks.
  const longest=Math.max(2,...Array.from(source.matchAll(/`+/g),m=>m[0].length));const fence='`'.repeat(longest+1);
  return fence+(node.attrs?.language||'')+'\n'+source+'\n'+fence;
 },
 addNodeView(){return ReactNodeViewRenderer(CodeView);},
});
export function ancestor(editor:Editor,name:string) {
 const {$from}=editor.state.selection;for(let d=$from.depth;d>0;d--)if($from.node(d).type.name===name)return {node:$from.node(d),pos:$from.before(d),depth:d};return null;
}
export function captureTarget(editor:Editor) {
 let bookmark=editor.state.selection.getBookmark();let active=true;
 const map=({transaction}:any)=>{if(active)bookmark=bookmark.map(transaction.mapping);};editor.on('transaction',map);
 return {restore(){if(!active)return;active=false;editor.off('transaction',map);try{editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)));}catch{editor.commands.focus('end');}},cancel(){active=false;editor.off('transaction',map);editor.commands.focus();}};
}
const key=new PluginKey<{progress?:{selections:Selection[];index:number};emptyTable?:number}>('mojian-editing');
// Retain support for empty-parent indentation saved by earlier versions.
function indentWrapper(node:Node) {
 return ['listItem','taskItem'].includes(node.type.name)&&node.childCount===2&&node.firstChild?.type.name==='paragraph'&&!node.firstChild.content.size&&['bulletList','orderedList','taskList'].includes(node.lastChild!.type.name);
}
function unindentWrapper(editor:Editor,itemType:string) {
 const {state}=editor;const {$from,$to}=state.selection;
 const range=$from.blockRange($to,node=>node.childCount>0&&node.firstChild!.type.name===itemType);
 if(!range||range.depth<2||range.startIndex!==0)return false;
 const wrapper=$from.node(range.depth-1);if(!indentWrapper(wrapper))return false;
 const pos=$from.before(range.depth-1);
 if(range.endIndex!==range.parent.childCount) {
  if(!editor.commands.liftListItem(itemType))return false;
  const remaining=editor.state.doc.nodeAt(pos);
  if(remaining?.type.name===itemType&&remaining.childCount===1&&remaining.firstChild?.type.name==='paragraph'&&!remaining.firstChild.content.size)editor.view.dispatch(editor.state.tr.delete(pos,pos+remaining.nodeSize));
  return true;
 }
 editor.view.dispatch(state.tr.step(new ReplaceAroundStep(pos,pos+wrapper.nodeSize,range.start,range.end,Slice.empty,0)).scrollIntoView());return true;
}
function indentCode(editor:Editor,outdent:boolean) {
 const {state}=editor;const {selection}=state;const {$from,$to}=selection;
 if(!$from.sameParent($to)||!$from.parent.type.spec.code)return false;
 const source=$from.parent.textContent;const base=$from.start();
 const from=selection.from-base,to=selection.to-base;
 const start=from===0?0:source.lastIndexOf('\n',from-1)+1;
 const end=to>from&&source[to-1]==='\n'?to-1:to;
 const edits:{pos:number;remove:number}[]=[];
 for(let line=start;line<=end;){
  const remove=outdent?(source[line]==='\t'?1:/^ {1,4}/.exec(source.slice(line))?.[0].length||0):0;
  if(!outdent||remove)edits.push({pos:base+line,remove});
  const next=source.indexOf('\n',line);if(next<0)break;line=next+1;
 }
 const tr=state.tr;for(const edit of edits.reverse()){if(outdent)tr.delete(edit.pos,edit.pos+edit.remove);else tr.insertText('\t',edit.pos);}
 if(tr.docChanged)editor.view.dispatch(tr.scrollIntoView());return true;
}
function insertTextTab(editor:Editor,outdent:boolean) {
 const {state}=editor;const {selection}=state;const tr=state.tr;
 if(!outdent)tr.insertText('\t');
 else if(selection.empty){
  const before=selection.$from.parent.textBetween(0,selection.$from.parentOffset,'','\ufffc');
  const remove=before.endsWith('\t')?1:/ {1,4}$/.exec(before)?.[0].length||0;
  if(remove)tr.delete(selection.from-remove,selection.from);
 }
 if(tr.docChanged)editor.view.dispatch(tr.scrollIntoView());
}
function fullTable(selection:Selection,table:Node) {
 if(selection instanceof NodeSelection && selection.node.type.name==='table')return true;
 if(!(selection instanceof CellSelection))return false;let count=0;selection.forEachCell(()=>count++);let total=0;table.forEach(row=>total+=row.childCount);return count===total;
}
function tableInfo(selection:Selection) {
 if(selection instanceof NodeSelection && selection.node.type.name==='table')return {node:selection.node,pos:selection.from,depth:0};
 const {$from}=selection;for(let d=$from.depth;d>0;d--)if($from.node(d).type.name==='table')return {node:$from.node(d),pos:$from.before(d),depth:d};return null;
}
export function insertCenteredTable(editor:Editor) {
 editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).command(({tr})=>{
  const table=tableInfo(tr.selection);if(!table)return false;
  table.node.descendants((node,offset)=>{if(['tableCell','tableHeader'].includes(node.type.name))tr.setNodeMarkup(table.pos+1+offset,undefined,{...node.attrs,align:'center'});});
  return true;
 }).run();
}
// New rows share GFM column alignment; new columns only change their own cells.
export function addCenteredTablePart(editor:Editor,part:'row'|'col') {
 const table=tableInfo(editor.state.selection);if(!table)return false;
 const map=TableMap.get(table.node);const selection=editor.state.selection;
 let column=map.width;
 if(part==='col'){
  if(selection instanceof CellSelection)column=map.rectBetween(selection.$anchorCell.pos-table.pos-1,selection.$headCell.pos-table.pos-1).right;
  else {const cell=ancestor(editor,'tableCell')||ancestor(editor,'tableHeader');if(!cell)return false;column=map.findCell(cell.pos-table.pos-1).right;}
 }
 const chain=editor.chain().focus();if(part==='row')chain.addRowAfter();else chain.addColumnAfter();
 return chain.command(({tr})=>{
  const updated=tableInfo(tr.selection);if(!updated)return false;
  const nextMap=TableMap.get(updated.node);const positions=new Set<number>();
  if(part==='row')nextMap.map.forEach(pos=>positions.add(pos));
  else for(let row=0;row<nextMap.height;row++)positions.add(nextMap.map[row*nextMap.width+column]);
  for(const offset of positions){const pos=updated.pos+1+offset;const cell=tr.doc.nodeAt(pos);if(cell)tr.setNodeMarkup(pos,undefined,{...cell.attrs,align:'center'});}
  return true;
 }).run();
}
// GFM stores alignment per column, so update its header and all data cells.
export function alignTableColumns(editor:Editor,align:'left'|'center'|'right') {
 const selection=editor.state.selection;const table=tableInfo(selection);if(!table)return;
 const map=TableMap.get(table.node);let left=0,right=map.width;
 if(selection instanceof CellSelection){const rect=map.rectBetween(selection.$anchorCell.pos-table.pos-1,selection.$headCell.pos-table.pos-1);left=rect.left;right=rect.right;}
 else if(!(selection instanceof NodeSelection)){
  const cell=ancestor(editor,'tableCell')||ancestor(editor,'tableHeader');if(!cell)return;
  const rect=map.findCell(cell.pos-table.pos-1);left=rect.left;right=rect.right;
 }
 const positions=new Set<number>();for(let row=0;row<map.height;row++)for(let col=left;col<right;col++)positions.add(map.map[row*map.width+col]);
 const tr=editor.state.tr;for(const offset of positions){const pos=table.pos+1+offset;const cell=tr.doc.nodeAt(pos);if(cell)tr.setNodeMarkup(pos,undefined,{...cell.attrs,align});}
 editor.view.dispatch(tr);editor.commands.focus();
}
export const EditingRules=Extension.create({
 name:'mojianEditing',priority:1000,
 addInputRules(){return [wrappingInputRule({find:/^》\s$/,type:this.editor.schema.nodes.blockquote})];},
 addProseMirrorPlugins(){return [new Plugin({key,
  state:{init:()=>({}),apply(tr,previous){
   if(tr.getMeta('mojian-progress'))return {...previous,progress:tr.getMeta('mojian-progress')};
   if(tr.getMeta('mojian-empty-table')!==undefined)return {emptyTable:tr.getMeta('mojian-empty-table')};
   if(tr.docChanged||tr.selectionSet)return {};return previous;
  }},
  props:{decorations:state=>{
   const decorations:Decoration[]=[];state.doc.descendants((node,pos)=>{
    if(indentWrapper(node))decorations.push(Decoration.node(pos,pos+node.nodeSize,{'data-indent-wrapper':'true'}));
   });
   return DecorationSet.create(state.doc,decorations);
  },handleKeyDown:(view,event)=>{
   if(view.composing||event.isComposing||event.keyCode===229)return false;
   const {state}=view;const selection=state.selection;const $from=selection.$from;
   if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='z') {
    event.preventDefault();
    if(event.shiftKey)this.editor.commands.redo();else this.editor.commands.undo();
    return true;
   }
   if(event.key==='Tab'&&!event.ctrlKey&&!event.metaKey&&!event.altKey) {
    if($from.parent.type.spec.code){event.preventDefault();indentCode(this.editor,event.shiftKey);return true;}
    if(tableInfo(selection)){if(event.shiftKey)return false;if(this.editor.commands.goToNextCell()){event.preventDefault();return true;}if(addCenteredTablePart(this.editor,'row')){this.editor.commands.goToNextCell();event.preventDefault();return true;}return false;}
    let itemType=selection instanceof NodeSelection&&['listItem','taskItem'].includes(selection.node.type.name)?selection.node.type.name:'';
    for(let d=$from.depth;!itemType&&d>0;d--)if(['listItem','taskItem'].includes($from.node(d).type.name)){itemType=$from.node(d).type.name;break;}
    if(itemType) {
     event.preventDefault();
     if(event.shiftKey){
      const before=selection.$from.parent.textBetween(0,selection.$from.parentOffset,'','\ufffc');
      if(selection.empty&&before.endsWith('\t'))insertTextTab(this.editor,true);
      else if(!unindentWrapper(this.editor,itemType))this.editor.commands.liftListItem(itemType);
     }
     else if(!this.editor.commands.sinkListItem(itemType)&&!(selection instanceof NodeSelection)&&selection.$from.sameParent(selection.$to)&&selection.$from.parent.isTextblock)insertTextTab(this.editor,false);
     return true;
    }
    if($from.parent.isTextblock){event.preventDefault();insertTextTab(this.editor,event.shiftKey);return true;}
   }
   if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='a') {
    event.preventDefault();const previous=key.getState(state)?.progress;
    if(previous){const index=Math.min(previous.index+1,previous.selections.length-1);view.dispatch(state.tr.setSelection(previous.selections[index]).setMeta('mojian-progress',{...previous,index}));return true;}
    const selections:Selection[]=[];
    let codeDepth=0;for(let d=$from.depth;d>0;d--)if($from.node(d).type.name==='codeBlock'){codeDepth=d;break;}
    const table=tableInfo(selection);
    if(codeDepth)selections.push(TextSelection.create(state.doc,$from.start(codeDepth),$from.end(codeDepth)));
    else if(table){
     let rowDepth=0;for(let d=$from.depth;d>0;d--)if($from.node(d).type.name==='tableRow'){rowDepth=d;break;}
     if(rowDepth){const first=$from.start(rowDepth);const row=$from.node(rowDepth);selections.push(CellSelection.rowSelection(state.doc.resolve(first),state.doc.resolve(first+row.nodeSize-2-row.lastChild!.nodeSize)));}
     const first=table.pos+2;const lastRow=table.node.lastChild!;const last=table.pos+table.node.nodeSize-2-lastRow.lastChild!.nodeSize;
     selections.push(new CellSelection(state.doc.resolve(first),state.doc.resolve(last)));
    } else {
     let itemDepth=0;for(let d=$from.depth;d>0;d--)if(['listItem','taskItem'].includes($from.node(d).type.name)){itemDepth=d;break;}
     if(itemDepth){selections.push(NodeSelection.create(state.doc,$from.before(itemDepth)));for(let d=itemDepth-1;d>0;d--)if(['bulletList','orderedList','taskList'].includes($from.node(d).type.name))selections.push(NodeSelection.create(state.doc,$from.before(d)));}
    }
    if(selection instanceof NodeSelection&&selection.node.type.name==='blockquote')selections.push(selection);
    for(let d=$from.depth;d>0;d--)if($from.node(d).type.name==='blockquote'){
     const quote=NodeSelection.create(state.doc,$from.before(d));const previous=selections.at(-1);
     // Never shrink the selection when quotes and lists are interleaved.
     if(!previous||(quote.from<=previous.from&&quote.to>=previous.to))selections.push(quote);
    }
    selections.push(new AllSelection(state.doc));view.dispatch(state.tr.setSelection(selections[0]).setMeta('mojian-progress',{selections,index:0}));return true;
   }
   if(event.key==='Enter'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&selection instanceof TextSelection&&selection.empty&&$from.parent.type.name==='paragraph'&&!$from.parent.content.size&&$from.depth>1&&$from.node($from.depth-1).type.name==='blockquote') {
    return this.editor.commands.lift('blockquote');
   }
   // Typora-style quote editing: Backspace joins an interior paragraph with
   // the previous block. Enter lifts an empty paragraph out of the quote.
   // Bypass Blockquote's default Backspace handler, which lifts/splits instead.
   if(event.key==='Backspace'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&selection instanceof TextSelection&&selection.empty&&$from.parentOffset===0&&$from.parent.isTextblock&&!$from.parent.type.spec.code&&$from.depth>1&&$from.node($from.depth-1).type.name==='blockquote'&&$from.index($from.depth-1)>0) {
    return joinBackward(state,tr=>view.dispatch(tr),view);
   }
   if(['Backspace','Delete'].includes(event.key)) {
    const table=tableInfo(selection);const pending=key.getState(state)?.emptyTable;
    if(table && pending===table.pos && !table.node.textContent) {
     const tr=state.tr.replaceWith(table.pos,table.pos+table.node.nodeSize,state.schema.nodes.paragraph.create());tr.setSelection(TextSelection.near(tr.doc.resolve(table.pos+1)));view.dispatch(tr);return true;
    }
    if(table && fullTable(selection,table.node)) {
     const rows:Node[]=[];table.node.forEach(row=>{const cells:Node[]=[];row.forEach(cell=>cells.push(cell.type.create(cell.attrs,state.schema.nodes.paragraph.create())));rows.push(row.type.create(row.attrs,cells));});
     const tr=state.tr.replaceWith(table.pos,table.pos+table.node.nodeSize,table.node.type.create(table.node.attrs,rows));
     tr.setSelection(TextSelection.near(tr.doc.resolve(table.pos+4))).setMeta('mojian-empty-table',table.pos);view.dispatch(tr);return true;
    }
   }
   if(event.key==='Enter'&&selection.empty&&$from.parent.type.name==='paragraph'&&$from.parentOffset===$from.parent.content.size) {
    const match=/^···([a-zA-Z0-9_-]*)$/.exec($from.parent.textContent);
    if(match){event.preventDefault();this.editor.chain().deleteRange({from:$from.start(),to:$from.end()}).setCodeBlock({language:match[1]||''}).run();return true;}
   }
   return false;
  }},
 })];},
});
export function protectedDeleteRow(editor:Editor,notify:(msg:string)=>void) {
 const row=ancestor(editor,'tableRow');if(!row)return;
 if(row.node.firstChild?.type.name==='tableHeader'){notify('表头行需要保留，可以清空表头文字。');editor.commands.focus();return;}
 editor.chain().focus().deleteRow().run();
}
export function protectedDeleteColumn(editor:Editor,notify:(msg:string)=>void) {
 const table=ancestor(editor,'table');if(!table)return;
 if(table.node.firstChild!.childCount===1){notify('已是最后一列，请使用“删除整表”。');editor.commands.focus();return;}
 editor.chain().focus().deleteColumn().run();
}
