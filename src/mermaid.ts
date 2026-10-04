import DOMPurify from 'dompurify';
import { download } from './storage';
let engine: Promise<typeof import('mermaid').default> | undefined;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string,Promise<string>>();
export function diagram(source: string): Promise<string> {
 if(!source.trim()) return Promise.reject(new Error('请输入 Mermaid 源码。'));
 if(cache.has(source)) return cache.get(source)!;
 const pending = queue.then(async()=>{
  engine ||= import('mermaid').then(m=>{m.default.initialize({startOnLoad:false,securityLevel:'strict',theme:'neutral',htmlLabels:false,secure:['secure','securityLevel','startOnLoad','htmlLabels','flowchart'],flowchart:{htmlLabels:false},suppressErrorRendering:true});return m.default;});
  const m=await engine;
  const result=await m.render('mojian-'+crypto.randomUUID(),source);
  return DOMPurify.sanitize(result.svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['foreignObject','script'],FORBID_ATTR:['onload','onclick']});
 });
 queue=pending.catch(()=>{}); cache.set(source,pending);
 if(cache.size>40) cache.delete(cache.keys().next().value!);
 return pending;
}
export async function downloadDiagram(source: string, format: 'png'|'svg'='png') {
 let svg=await diagram(source);
 const xml=new DOMParser().parseFromString(svg,'image/svg+xml');const root=xml.documentElement;const box=(root.getAttribute('viewBox')||'').split(/[ ,]+/).map(Number);
 if(box.length===4&&box.every(Number.isFinite)){root.setAttribute('width',String(Math.max(1,Math.min(4000,box[2]))));root.setAttribute('height',String(Math.max(1,Math.min(4000,box[3]))));svg=new XMLSerializer().serializeToString(root);}
 if(format==='svg') { download(new Blob([svg],{type:'image/svg+xml'}),'墨笺图形.svg'); return; }
 const blob=new Blob([svg],{type:'image/svg+xml'});const url=URL.createObjectURL(blob);
 try { const img=new Image(); img.src=url; await img.decode(); const c=document.createElement('canvas');
  const scale=2;c.width=Math.min(8000,(img.naturalWidth||1000)*scale);c.height=Math.min(8000,(img.naturalHeight||600)*scale);
  const ctx=c.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
  const png=await new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('PNG 转换失败，请下载 SVG。')),'image/png'));
  download(png,'墨笺图形.png');
 } finally {URL.revokeObjectURL(url);}
}
