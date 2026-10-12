import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { MediaPreviewItem } from './mediaPreviewEvents';
export function MediaPreview({item,onClose}:{item:MediaPreviewItem;onClose:()=>void}) {
 const viewport=useRef<HTMLDivElement>(null);
 const root=useRef<HTMLDivElement>(null);
 const drag=useRef<{x:number;y:number;left:number;top:number;moved:boolean;blank:boolean}|null>(null);
 const anchor=useRef<{x:number;y:number;imageX:number;imageY:number}|null>(null);
 const latest=useRef({percent:100,failed:false,loaded:false});
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
  const previous=document.activeElement as HTMLElement;const panel=root.current!;
  panel.focus({preventScroll:true});
  const trap=(event:KeyboardEvent)=>{
   if(event.key!=='Tab')return;
   const controls=Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)'));const index=controls.indexOf(document.activeElement as HTMLElement);
   if(event.shiftKey&&index<=0){event.preventDefault();controls.at(-1)?.focus();}else if(!event.shiftKey&&index===controls.length-1){event.preventDefault();controls[0]?.focus();}
  };
  panel.addEventListener('keydown',trap);
  return()=>{observer.disconnect();panel.removeEventListener('keydown',trap);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[]);
 const fit=natural.width&&natural.height?Math.min(Math.max(1,size.width-86)/natural.width,Math.max(1,size.height-86)/natural.height,item.kind==='image'?1:Infinity):1;
 const scale=zoom===null?fit:zoom/100;const percent=Math.round(scale*1000)/10;
 latest.current={percent,failed,loaded:!!natural.width};
 const rememberAnchor=(clientX?:number,clientY?:number)=>{
  const el=viewport.current;const image=el?.querySelector('img');if(!el||!image||!image.naturalWidth)return;
  const box=el.getBoundingClientRect();const imageBox=image.getBoundingClientRect();
  const x=clientX??box.left+el.clientLeft+el.clientWidth/2;const y=clientY??box.top+el.clientTop+el.clientHeight/2;
  anchor.current={x:x-box.left-el.clientLeft,y:y-box.top-el.clientTop,imageX:(x-imageBox.left)*image.naturalWidth/imageBox.width,imageY:(y-imageBox.top)*image.naturalHeight/imageBox.height};
 };
 useEffect(()=>{
  const el=viewport.current!;
  const wheel=(event:WheelEvent)=>{
   const current=latest.current;if((!event.ctrlKey&&!event.metaKey)||current.failed||!current.loaded||!event.deltaY)return;
   event.preventDefault();
   const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?el.clientHeight:1);
   const value=Math.round(Math.max(10,Math.min(400,current.percent*Math.exp(-Math.max(-120,Math.min(120,pixels))/1200)))*10)/10;
   if(value===current.percent)return;
   rememberAnchor(event.clientX,event.clientY);latest.current={...current,percent:value};setZoom(value);
  };
  el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);
 },[]);
 useLayoutEffect(()=>{
  const point=anchor.current;const el=viewport.current;if(!point||!el)return;
  el.scrollLeft=(Math.max(size.width,natural.width*scale+32)-natural.width*scale)/2+point.imageX*scale-point.x;
  el.scrollTop=(Math.max(size.height,natural.height*scale+32)-natural.height*scale)/2+point.imageY*scale-point.y;
  anchor.current=null;
 },[scale,natural,size]);
 return <div ref={root} role="region" tabIndex={-1} aria-label={item.kind==='image'?'图片预览':'图表预览'} className="media-preview-screen" onKeyDown={e=>{
  if(!natural.width||failed)return;
  if(e.key==='+'||e.key==='='||e.key==='-'){e.preventDefault();rememberAnchor();setZoom(Math.max(10,Math.min(400,percent*(e.key==='-'?1/1.1:1.1))));}
  if(e.key==='0'){e.preventDefault();anchor.current=null;setZoom(null);}
 }}>
  <button className="media-preview-close" aria-label="关闭预览" title="关闭预览（Esc）" onClick={onClose}><X size={18}/></button>
  <div ref={viewport} className="media-preview-viewport" onPointerDown={e=>{
   if(e.button!==0)return;const el=e.currentTarget;drag.current={x:e.clientX,y:e.clientY,left:el.scrollLeft,top:el.scrollTop,moved:false,blank:e.target===el||(e.target as HTMLElement).classList.contains('media-preview-content')};el.setPointerCapture(e.pointerId);
  }} onPointerMove={e=>{
   const start=drag.current;if(!start||!e.currentTarget.hasPointerCapture(e.pointerId))return;
   if(Math.abs(e.clientX-start.x)+Math.abs(e.clientY-start.y)>4)start.moved=true;
   if(start.moved){e.currentTarget.scrollLeft=start.left+start.x-e.clientX;e.currentTarget.scrollTop=start.top+start.y-e.clientY;}
  }} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{drag.current=null;}} onClick={e=>{
   const click=drag.current;drag.current=null;
   if(click){if(!click.moved&&click.blank)onClose();return;}
   if(e.target===e.currentTarget||(e.target as HTMLElement).classList.contains('media-preview-content'))onClose();
  }}>
   {failed?<p className="media-preview-message" role="status">图片无法加载，请检查图片地址或本地资源。</p>:<>
    {!natural.width&&<p className="media-preview-message" role="status">正在加载预览…</p>}
    {url&&<div className="media-preview-content" style={{width:Math.max(size.width,natural.width*scale+32),height:Math.max(size.height,natural.height*scale+32)}}><img src={url} alt={item.title} draggable={false} style={{width:natural.width?natural.width*scale:undefined,height:natural.height?natural.height*scale:undefined,visibility:natural.width?'visible':'hidden'}} onLoad={e=>setNatural({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})} onError={()=>setFailed(true)}/></div>}
   </>}
  </div>
 </div>;
}
