import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Scan } from 'lucide-react';
import { Dialog } from './Dialog';
import type { MediaPreviewItem } from './mediaPreview';
export function MediaPreview({item,onClose}:{item:MediaPreviewItem;onClose:()=>void}) {
 const viewport=useRef<HTMLDivElement>(null);
 const anchor=useRef<{x:number;y:number;imageX:number;imageY:number}|null>(null);
 const latest=useRef({percent:100,failed:false,loaded:false});
 const [zoomInput,setZoomInput]=useState('100');const [zoomError,setZoomError]=useState('');
 const [url,setURL]=useState('');const [failed,setFailed]=useState(false);
 const [natural,setNatural]=useState({width:0,height:0});const [size,setSize]=useState({width:0,height:0});const [zoom,setZoom]=useState<number|null>(null);
 useEffect(()=>{
  if(item.kind==='image'){setURL(item.url);return;}
  // This SVG is the same sanitized Mermaid result shown in the document.
  // Display it as an image, keeping its IDs isolated from the editor's SVG.
  const doc=new DOMParser().parseFromString(item.svg,'image/svg+xml');const svg=doc.documentElement;
  const bounds=(svg.getAttribute('viewBox')||'').split(/[ ,]+/).map(Number);
  if(bounds.length===4&&bounds.every(Number.isFinite)&&bounds[2]>0&&bounds[3]>0){svg.setAttribute('width',String(bounds[2]));svg.setAttribute('height',String(bounds[3]));}
  const blobURL=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));setURL(blobURL);
  return()=>URL.revokeObjectURL(blobURL);
 },[item]);
 useEffect(()=>{
  const el=viewport.current!;const observer=new ResizeObserver(()=>setSize({width:el.clientWidth,height:el.clientHeight}));observer.observe(el);
  const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
  return()=>{observer.disconnect();document.body.style.overflow=overflow;};
 },[]);
 const fit=natural.width&&natural.height?Math.min(Math.max(1,size.width-32)/natural.width,Math.max(1,size.height-32)/natural.height,item.kind==='image'?1:Infinity):1;
 const scale=zoom===null?fit:zoom/100;const percent=Math.round(scale*1000)/10;
 latest.current={percent,failed,loaded:!!natural.width};
 const rememberAnchor=(clientX?:number,clientY?:number)=>{
  const el=viewport.current;const image=el?.querySelector('img');if(!el||!image||!image.naturalWidth)return;
  const box=el.getBoundingClientRect();const imageBox=image.getBoundingClientRect();
  const x=clientX??box.left+el.clientLeft+el.clientWidth/2;const y=clientY??box.top+el.clientTop+el.clientHeight/2;
  anchor.current={x:x-box.left-el.clientLeft,y:y-box.top-el.clientTop,imageX:(x-imageBox.left)*image.naturalWidth/imageBox.width,imageY:(y-imageBox.top)*image.naturalHeight/imageBox.height};
 };
 const applyZoom=(value:number)=>{
  rememberAnchor();setZoomError('');setZoom(Math.round(Math.max(10,Math.min(400,value))*10)/10);
 };
 const changeZoom=(step:number)=>applyZoom(percent+step);
 const commitZoom=()=>{
  const value=Number(zoomInput);
  if(!zoomInput.trim()||!Number.isFinite(value)||value<10||value>400){setZoomInput(String(percent));setZoomError('请输入 10%–400% 的缩放比例。');return;}
  setZoomError('');if(value!==percent)applyZoom(value);
 };
 useEffect(()=>setZoomInput(String(percent)),[percent,zoom]);
 useEffect(()=>{
  const el=viewport.current!;
  const wheel=(event:WheelEvent)=>{
   const current=latest.current;if(current.failed||!current.loaded||!event.deltaY)return;
   event.preventDefault();
   const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?el.clientHeight:1);
   const value=Math.round(Math.max(10,Math.min(400,current.percent*Math.exp(-Math.max(-120,Math.min(120,pixels))/1200)))*10)/10;
   if(value===current.percent)return;
   rememberAnchor(event.clientX,event.clientY);latest.current={...current,percent:value};setZoomError('');setZoom(value);
  };
  el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);
 },[]);
 useLayoutEffect(()=>{
  const point=anchor.current;const el=viewport.current;if(!point||!el)return;
  el.scrollLeft=(Math.max(size.width,natural.width*scale+32)-natural.width*scale)/2+point.imageX*scale-point.x;
  el.scrollTop=(Math.max(size.height,natural.height*scale+32)-natural.height*scale)/2+point.imageY*scale-point.y;
  anchor.current=null;
 },[scale,natural,size]);
 return <Dialog title={item.kind==='image'?'图片预览':'图表预览'} className="media-preview-dialog" onClose={onClose}>
  <div className="media-preview-toolbar"><span title={item.title}>{item.title}</span><div><button aria-label="缩小预览" disabled={failed||!natural.width||percent<=10} onClick={()=>changeZoom(-10)}><ZoomOut size={17}/></button><label className="media-preview-zoom-input" title={zoom===null?'适应窗口 · 可输入缩放比例':'可输入 10%–400%'}><input type="number" inputMode="decimal" aria-label="预览缩放比例" aria-invalid={!!zoomError} min="10" max="400" step="0.1" disabled={failed||!natural.width} value={zoomInput} onChange={e=>{setZoomInput(e.target.value);setZoomError('');}} onBlur={commitZoom} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commitZoom();}}}/><span>%</span></label><button aria-label="放大预览" disabled={failed||!natural.width||percent>=400} onClick={()=>changeZoom(10)}><ZoomIn size={17}/></button><button aria-label="原始尺寸" disabled={failed||!natural.width} onClick={()=>applyZoom(100)}>100%</button><button aria-label="适应窗口" disabled={failed||!natural.width} onClick={()=>{anchor.current=null;setZoomError('');setZoom(null);}}><Scan size={17}/></button></div></div>
  <div ref={viewport} className="media-preview-viewport">
   {failed?<p className="media-preview-message" role="status">图片无法加载，请检查图片地址或本地资源。</p>:<>
    {!natural.width&&<p className="media-preview-message" role="status">正在加载预览…</p>}
    {url&&<div className="media-preview-content" style={{width:Math.max(size.width,natural.width*scale+32),height:Math.max(size.height,natural.height*scale+32)}}><img src={url} alt={item.title} draggable={false} style={{width:natural.width?natural.width*scale:undefined,height:natural.height?natural.height*scale:undefined,visibility:natural.width?'visible':'hidden'}} onLoad={e=>setNatural({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})} onError={()=>setFailed(true)}/></div>}
   </>}
  </div><p className={`media-preview-hint ${zoomError?'form-error':''}`} role={zoomError?'alert':undefined}>{zoomError||'滚轮缩放 · 可输入比例 · Esc 或点击遮罩关闭'}</p>
 </Dialog>;
}
