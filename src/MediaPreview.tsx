import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Scan } from 'lucide-react';
import { Dialog } from './Dialog';
import type { MediaPreviewItem } from './mediaPreview';
export function MediaPreview({item,onClose}:{item:MediaPreviewItem;onClose:()=>void}) {
 const viewport=useRef<HTMLDivElement>(null);
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
 const scale=zoom===null?fit:zoom/100;const percent=Math.round(scale*100);
 const changeZoom=(step:number)=>setZoom(Math.max(25,Math.min(400,Math.round((zoom??percent)/25)*25+step)));
 return <Dialog title={item.kind==='image'?'图片预览':'图表预览'} className="media-preview-dialog" onClose={onClose}>
  <div className="media-preview-toolbar"><span title={item.title}>{item.title}</span><div><button aria-label="缩小预览" disabled={failed||!natural.width||percent<=25} onClick={()=>changeZoom(-25)}><ZoomOut size={17}/></button><output aria-label="预览缩放比例">{zoom===null?'适应窗口':`${percent}%`}</output><button aria-label="放大预览" disabled={failed||!natural.width||percent>=400} onClick={()=>changeZoom(25)}><ZoomIn size={17}/></button><button aria-label="原始尺寸" disabled={failed||!natural.width} onClick={()=>setZoom(100)}>100%</button><button aria-label="适应窗口" disabled={failed||!natural.width} onClick={()=>setZoom(null)}><Scan size={17}/></button></div></div>
  <div ref={viewport} className="media-preview-viewport">
   {failed?<p className="media-preview-message" role="status">图片无法加载，请检查图片地址或本地资源。</p>:<>
    {!natural.width&&<p className="media-preview-message" role="status">正在加载预览…</p>}
    {url&&<div className="media-preview-content" style={{width:Math.max(size.width,natural.width*scale+32),height:Math.max(size.height,natural.height*scale+32)}}><img src={url} alt={item.title} draggable={false} style={{width:natural.width?natural.width*scale:undefined,height:natural.height?natural.height*scale:undefined,visibility:natural.width?'visible':'hidden'}} onLoad={e=>setNatural({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})} onError={()=>setFailed(true)}/></div>}
   </>}
  </div><p className="media-preview-hint">可放大查看细节 · Esc 或点击遮罩关闭</p>
 </Dialog>;
}
