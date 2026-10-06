import { Extension, wrappingInputRule, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, AllSelection, NodeSelection, TextSelection, type Selection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import type { Node } from '@tiptap/pm/model';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ImageView, CodeView } from './nodeViews';
import { widthFromTitle } from './output';

export const SizedImage=Image.extend({
 addAttributes() { return {...this.parent?.(),percent:{default:100,parseHTML:el=>widthFromTitle(el.getAttribute('title')||'')}}; },
 parseMarkdown(token,h) {return h.createNode('image',{src:token.href,alt:token.text,title:null,percent:widthFromTitle(token.title||'')});},
 renderMarkdown(node) {const alt=String(node.attrs?.alt||'').replace(/[\\\[\]]/g,'\\$&');const src=String(node.attrs?.src||'').replace(/ /g,'%20').replace(/\)/g,'%29');return `![${alt}](${src} "width=${node.attrs?.percent??100}%")`;},
 addNodeView(){return ReactNodeViewRenderer(ImageView);},
});
export const SmartCode=CodeBlockLowlight.extend({
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
function fullTable(selection:Selection,table:Node) {
 if(selection instanceof NodeSelection && selection.node.type.name==='table')return true;
 if(!(selection instanceof CellSelection))return false;let count=0;selection.forEachCell(()=>count++);let total=0;table.forEach(row=>total+=row.childCount);return count===total;
}
function tableInfo(selection:Selection) {
 if(selection instanceof NodeSelection && selection.node.type.name==='table')return {node:selection.node,pos:selection.from,depth:0};
 const {$from}=selection;for(let d=$from.depth;d>0;d--)if($from.node(d).type.name==='table')return {node:$from.node(d),pos:$from.before(d),depth:d};return null;
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
  props:{handleKeyDown:(view,event)=>{
   if(view.composing||event.isComposing||event.keyCode===229)return false;
   const {state}=view;const selection=state.selection;const $from=selection.$from;
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
    selections.push(new AllSelection(state.doc));view.dispatch(state.tr.setSelection(selections[0]).setMeta('mojian-progress',{selections,index:0}));return true;
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
