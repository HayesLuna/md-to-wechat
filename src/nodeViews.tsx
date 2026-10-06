import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { useEffect, useState, useRef } from 'react';
import { Copy, ChevronDown, ChevronUp, Download, ArrowDownToLine, Trash2, ImageOff } from 'lucide-react';
import { imageURL } from './storage';
import { copyText } from './output';
import { diagram, downloadDiagram } from './mermaid';
import { TextSelection, NodeSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
function signal(message:string) {window.dispatchEvent(new CustomEvent('mojian-notice',{detail:message}));}
export function ImageView({node,selected,editor,getPos}:NodeViewProps) {
 const [widthInput,setWidthInput]=useState(String(node.attrs.percent));
 useEffect(()=>setWidthInput(String(node.attrs.percent)),[node.attrs.percent]);
 const [url,setURL]=useState('');const [missing,setMissing]=useState(false);const box=useRef<HTMLDivElement>(null);const [dragWidth,setDragWidth]=useState<number|null>(null);
 const setWidth=(percent:number)=>{const pos=getPos();if(pos===undefined)return;editor.commands.command(({tr})=>{const image=tr.doc.nodeAt(pos);if(!image)return false;tr.setNodeMarkup(pos,undefined,{...image.attrs,percent});tr.setSelection(NodeSelection.create(tr.doc,pos));return true;});};
 useEffect(()=>{let active=true;setURL('');setMissing(false);imageURL(node.attrs.src).then(u=>{if(active){setURL(u);setMissing(!u);}}).catch(()=>{if(active)setMissing(true);});return()=>{active=false;};},[node.attrs.src]);
 const resize=(event:React.PointerEvent<HTMLButtonElement>)=>{
  event.preventDefault();editor.view.dispatch(closeHistory(editor.state.tr));const start=event.clientX;const base=box.current!.getBoundingClientRect().width;const frame=box.current!.parentElement!;const style=getComputedStyle(frame);const parent=frame.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);let width=node.attrs.percent;
  event.currentTarget.setPointerCapture(event.pointerId);const button=event.currentTarget;
  const move=(e:PointerEvent)=>{width=Math.round(Math.max(1,Math.min(200,(base+e.clientX-start)/parent*100)));setDragWidth(width);};
  const up=()=>{button.removeEventListener('pointermove',move);button.removeEventListener('pointerup',up);button.removeEventListener('pointercancel',up);setDragWidth(null);setWidth(width);editor.view.dispatch(closeHistory(editor.state.tr));editor.commands.focus();};
  button.addEventListener('pointermove',move);button.addEventListener('pointerup',up);button.addEventListener('pointercancel',up);
 };
 const selectImage=(event:React.MouseEvent)=>{event.preventDefault();const pos=getPos();if(pos!==undefined)editor.chain().focus().setNodeSelection(pos).run();};
 return <NodeViewWrapper contentEditable={false} className={`image-node ${selected?'selected':''}`} onContextMenu={(e:React.MouseEvent<HTMLDivElement>)=>{if(window.matchMedia('(pointer: coarse)').matches)return;e.preventDefault();window.dispatchEvent(new CustomEvent('mojian-context',{detail:{event:e.nativeEvent,editor}}));}}>
  <div className="image-scroll">
  <div ref={box} className="image-box" style={{width:`${dragWidth??node.attrs.percent}%`}} contentEditable={false} onMouseDown={selectImage}>
   {url?<img src={url} alt={node.attrs.alt||'图片'} draggable={false} onError={()=>setMissing(true)}/>:<div className="missing-image"><ImageOff size={24}/>{missing?'本地图片缺失，请重新选择图片':'图片加载中…'}<small>{node.attrs.alt}</small></div>}
   {missing&&url&&<span className="image-failed">图片无法加载，请检查地址</span>}
   {selected&&<button className="resize-handle" aria-label="拖拽调整图片宽度" onPointerDown={resize}/>}
  </div>
  </div>
  {selected&&<div className="image-controls" contentEditable={false} onMouseDown={e=>e.stopPropagation()}><span>图片宽度</span><input aria-label="图片宽度百分比" type="number" min="1" max="200" value={widthInput} onChange={e=>{setWidthInput(e.target.value);const n=Number(e.target.value);if(e.target.value!==''&&Number.isInteger(n)&&n>=1&&n<=200)setWidth(n);}} onBlur={()=>{const n=Number(widthInput);if(widthInput===''||!Number.isInteger(n)||n<1||n>200){setWidthInput(String(node.attrs.percent));signal('图片宽度请输入 1%–200% 的整数。');}}}/>%<button title="删除图片" onClick={()=>{const pos=getPos();if(pos!==undefined)editor.chain().focus().deleteRange({from:pos,to:pos+node.nodeSize}).run();}}><Trash2 size={14}/></button>{node.attrs.src.startsWith('local-image:')&&<small>本地资源 · 公众号需重新上传</small>}</div>}
 </NodeViewWrapper>;
}
export function CodeView({node,updateAttributes,editor,getPos}:NodeViewProps) {
 const [folded,setFolded]=useState(false);const [svg,setSVG]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const seq=useRef(0);
 const mermaid=node.attrs.language==='mermaid';const source=node.textContent;
 useEffect(()=>{
  const n=++seq.current;setSVG('');setError('');if(!mermaid)return;
  if(!source.trim()){setError('在上方输入 Mermaid 源码，下方显示图形。');return;}
  const timer=setTimeout(()=>{setBusy(true);diagram(source).then(s=>{if(n===seq.current){setSVG(s);setError('');}}).catch(()=>{if(n===seq.current)setError('图形语法有误，请修正上方源码。')}).finally(()=>{if(n===seq.current)setBusy(false);});},250);
  return()=>{clearTimeout(timer);seq.current++;};
 },[source,mermaid]);
 const exit=()=>{const pos=getPos();if(pos===undefined)return;const at=pos+node.nodeSize;const tr=editor.state.tr.insert(at,editor.schema.nodes.paragraph.create());tr.setSelection(TextSelection.create(tr.doc,at+1));editor.view.dispatch(tr);editor.commands.focus();};
 const asyncAction=(action:()=>Promise<unknown>)=>action().catch(e=>signal(e.message));
 return <NodeViewWrapper className={`code-node ${folded?'folded':''}`}>
  <div className="code-header" contentEditable={false}>
   <span className="code-traffic-lights" aria-hidden="true"><i/><i/><i/></span>
   <input aria-label="代码语言" value={node.attrs.language||''} placeholder="纯代码" spellCheck={false} onChange={e=>updateAttributes({language:e.target.value.trim()||null})}/>
   <div><button aria-label="复制代码" title="复制代码" onClick={()=>asyncAction(async()=>{await copyText(source);signal('已复制原始代码');})}><Copy size={14}/><span>复制</span></button><button aria-label={folded?'展开代码':'折叠代码'} title={folded?'展开代码':'折叠代码'} onClick={()=>setFolded(f=>!f)}>{folded?<ChevronDown size={15}/>:<ChevronUp size={15}/>}</button><button title="退出代码块" onClick={exit}><ArrowDownToLine size={15}/></button>{!source&&<button title="删除空代码块" onClick={()=>editor.chain().focus().toggleCodeBlock().run()}><Trash2 size={15}/></button>}</div>
  </div>
  <pre style={{display:folded?'none':undefined}}><code><NodeViewContent/></code></pre>
  {folded&&<div className="fold-summary" contentEditable={false}>{source.split('\n').length} 行代码 · 已折叠</div>}
  {mermaid&&<div className="mermaid-editor-preview" contentEditable={false} onMouseDown={e=>e.preventDefault()}>
   {busy&&!svg?<small>图形生成中…</small>:error?<div className="diagram-error">{error}</div>:<div className="diagram" dangerouslySetInnerHTML={{__html:svg}}/>}
   {!!svg&&<div className="diagram-download"><button onClick={()=>asyncAction(()=>downloadDiagram(source))}><Download size={14}/> PNG</button><button onClick={()=>asyncAction(()=>downloadDiagram(source,'svg'))}>SVG</button></div>}
  </div>}
 </NodeViewWrapper>;
}
