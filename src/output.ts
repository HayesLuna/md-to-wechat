import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { imageURL } from './storage';
import { diagram } from './mermaid';
import type { Settings } from './sample';
import { codeCard, addCodeDecorations, type CodeSource } from './codeOutput';
export type Asset = { kind:'image'|'diagram'; label:string; src?:string; source?:string; missing?:boolean };
export type Output = { html:string; previewHTML:string; text:string; assets:Asset[]; errors:string[]; key:string };
export const outputKey=(markdown:string,settings:Settings)=>JSON.stringify([markdown,settings]);
export function safeURL(url:string) { try{const parsed=new URL(url);return ['https:','http:','mailto:','tel:'].includes(parsed.protocol);}catch{return false;} }
export function escapeHTML(value:string) { const div=document.createElement('div');div.textContent=value;return div.innerHTML; }
export function widthFromTitle(title:string) { const m=/^width=(\d{1,3})%$/.exec(title||'');return m?Math.min(100,Math.max(10,Number(m[1]))):100; }
export function headings(markdown:string) {
 const md=new MarkdownIt({html:false});const tokens=md.parse(markdown,{});const out:{level:number;text:string;line:number}[]=[];
 for(let i=0;i<tokens.length;i++)if(tokens[i].type==='heading_open')out.push({level:Number(tokens[i].tag.slice(1)),text:tokens[i+1].content,line:tokens[i].map?.[0]||0});
 return out;
}
function inlineStyles(root:HTMLElement,s:Settings,codeSources:CodeSource[]) {
 const color=/^#[0-9a-f]{6}$/i.test(s.color)?s.color:'#a6493d';const dark=s.codeTheme==='dark';
 root.setAttribute('style',`font-family:${s.theme==='elegant'?'Georgia,SimSun,serif':'-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif'};font-size:${s.fontSize}px;line-height:${Number((s.fontSize*s.lineHeight).toFixed(2))}px;color:#303030;word-wrap:break-word;`);
 const rules:Record<string,string>={
 p:'margin:0 0 20px;line-height:inherit;',h1:`font-size:26px;line-height:1.45;font-weight:700;margin:8px 0 24px;color:${s.theme==='simple'?'#242424':color};`,
 h2:`font-size:22px;line-height:1.5;font-weight:700;margin:30px 0 18px;color:${color};${s.theme==='default'?`border-bottom:1px solid #dedede;padding-bottom:8px;`:''}`,
 h3:`font-size:19px;line-height:1.5;margin:24px 0 14px;color:${color};`,h4:'font-size:17px;line-height:1.5;font-weight:700;margin:22px 0 12px;',h5:'font-size:16px;line-height:1.5;font-weight:700;margin:20px 0 12px;',h6:'font-size:16px;line-height:1.5;font-weight:700;margin:20px 0 12px;',
 blockquote:`margin:20px 0;padding:14px 18px;border-left:3px solid ${color};background:#f6f6f5;color:#686868;`,
 ul:'padding-left:24px;margin:14px 0 20px;',ol:'padding-left:26px;margin:14px 0 20px;',li:'margin:6px 0;line-height:inherit;',strong:'font-weight:700;',em:'font-style:italic;',s:'text-decoration:line-through;',a:`color:${color};text-decoration:underline;`,hr:'border:0;border-top:1px solid #ddd;margin:30px 0;',
 table:'border-collapse:collapse;width:100%;font-size:14px;margin:20px 0;table-layout:auto;',th:'border:1px solid #ddd;background:#f2f2f2;font-weight:600;padding:9px 12px;',td:'border:1px solid #ddd;padding:9px 12px;',
 pre:`margin:20px 0;padding:16px;background:${dark?'#25272b':'#f5f5f5'};color:${dark?'#e2e4e8':'#373a40'};font-size:13px;line-height:1.7;white-space:pre;overflow-x:auto;border-radius:3px;font-family:Consolas,Menlo,monospace;tab-size:4;`,
 code:'font-family:Consolas,Menlo,monospace;font-size:0.88em;background:#f0f0ef;padding:2px 4px;border-radius:3px;',
 img:'height:auto;max-width:100%;display:block;margin:20px auto;',
 };
 for(const el of root.querySelectorAll<HTMLElement>('*')) {
  if(el.namespaceURI==='http://www.w3.org/2000/svg')continue;
  const existingAlign=el.style.textAlign;const imageWidth=el.tagName==='IMG'?el.getAttribute('data-width'):null;
  el.removeAttribute('style');const style=rules[el.tagName.toLowerCase()];if(style)el.setAttribute('style',style);
  if(existingAlign && ['left','right','center'].includes(existingAlign))el.style.textAlign=existingAlign;
  if(imageWidth) {el.style.width=imageWidth+'%';el.removeAttribute('data-width');}
  if(el.matches('pre code'))el.setAttribute('style','display:block;white-space:pre;font-family:inherit;font-size:inherit;background:transparent;padding:0;color:inherit;');
  if(el.tagName==='SPAN' && el.className.includes('hljs')) {
   const c=el.className;const palette=dark?['#a5d6ff','#ff7b72','#a5d6ff','#d2a8ff','#79c0ff','#8b949e']:['#a6493d','#9a3754','#31599c','#7650a8','#80572a','#83888f'];
   const index=/comment|quote/.test(c)?5:/keyword|selector|literal/.test(c)?1:/string|regexp/.test(c)?0:/number|attr/.test(c)?2:/title|function/.test(c)?3:4;
   el.setAttribute('style',`color:${palette[index]};${index===5?'font-style:italic;':''}`);
  }
  el.removeAttribute('class');
 }
 // Resolve typography before export: WeChat can normalize unitless/inherited
 // line-height differently during paste. Every text element carries pixel values,
 // including inline marks and highlight tokens, without changing source Markdown.
 for(const el of root.querySelectorAll<HTMLElement>('*')) {
  if(el.namespaceURI!=='http://www.w3.org/1999/xhtml'||el.matches('img,hr'))continue;
  const parent=el.parentElement!;
  const parentSize=parseFloat(parent.style.fontSize)||s.fontSize;
  const parentLine=parseFloat(parent.style.lineHeight)||s.fontSize*s.lineHeight;
  const sizeValue=el.style.fontSize;
  const size=sizeValue.endsWith('px')?parseFloat(sizeValue):sizeValue.endsWith('em')?parentSize*parseFloat(sizeValue):parentSize;
  const lineValue=el.style.lineHeight;
  const line=lineValue.endsWith('px')?parseFloat(lineValue):lineValue&&lineValue!=='inherit'&&lineValue!=='normal'?size*parseFloat(lineValue):parentLine;
  el.style.fontSize=Number(size.toFixed(2))+'px';
  el.style.lineHeight=Number(Math.max(size,line).toFixed(2))+'px';
  if(el.matches('strong,em,s,a,code,span')&&!el.matches('pre code'))el.style.display='inline';
 }
 // Generated from Markdown token source, never from rendered editor DOM.
 for(const pre of root.querySelectorAll<HTMLElement>('pre[data-code-index]')) {
  const index=Number(pre.getAttribute('data-code-index'));pre.replaceWith(codeCard(codeSources[index],index,dark));
 }
 // Only remove a single paragraph from genuinely simple list items.
 for(const li of root.querySelectorAll('li'))if(li.children.length===1 && li.firstElementChild?.tagName==='P')li.firstElementChild.replaceWith(...li.firstElementChild.childNodes);
 // WeChat's older overlap checker miscounts mixed direct text + inline marks.
 // Keep rich text inline, but give direct text its own leaf span in mixed blocks.
 // Traverse DOM nodes (not Markdown) so nested lists and code stay intact.
 for(const block of root.querySelectorAll<HTMLElement>('p,li,h1,h2,h3,h4,h5,h6,blockquote')) {
  if(!block.children.length)continue;
  for(const node of Array.from(block.childNodes)) {
   if(node.nodeType!==Node.TEXT_NODE||!node.textContent?.trim())continue;
   const leaf=document.createElement('span');
   leaf.style.fontSize=block.style.fontSize;leaf.style.lineHeight=block.style.lineHeight;leaf.style.display='inline';
   node.replaceWith(leaf);leaf.appendChild(node);
  }
 }

 // The quote padding already provides bottom space; avoid stacking its last
 // child's normal paragraph/list/quote margin onto that padding.
 for(const quote of root.querySelectorAll('blockquote')){const last=quote.lastElementChild as HTMLElement|null;if(last)last.style.marginBottom='0';}

}
export function readableText(root:Node,codeSources:CodeSource[]=[]):string {
 function walk(node:Node,depth=0):string {
  if(node.nodeType===Node.TEXT_NODE)return node.textContent||'';
  if(!(node instanceof Element))return Array.from(node.childNodes,n=>walk(n,depth)).join('');
  const tag=node.tagName;
  if(tag==='BR')return '\n';
  if(node.hasAttribute('data-code-block'))return '\n'+(codeSources[Number(node.getAttribute('data-code-index'))]?.text||node.querySelector('code')?.textContent||'')+'\n\n';
  if(tag==='PRE')return '\n'+(node.textContent||'')+'\n\n';
  if(tag==='IMG')return '[图片：'+(node.getAttribute('alt')||'图片')+']\n';
  if(tag==='TR')return Array.from(node.children,n=>walk(n,depth).replace(/^\n+|\n+$/g,'')).join('\t')+'\n';
  if(tag==='UL'||tag==='OL') {
   const start=Number(node.getAttribute('start')||1);return '\n'+Array.from(node.children,(li,i)=>'  '.repeat(depth)+(tag==='OL'?`${start+i}. `:'• ')+Array.from(li.childNodes,n=>walk(n,depth+1)).join('').replace(/^\n+|\n+$/g,'')+'\n').join('')+'\n';
  }
  const content=Array.from(node.childNodes,n=>walk(n,depth)).join('');
  return /^(P|H[1-6]|BLOCKQUOTE|TABLE)$/.test(tag)?content+'\n\n':content;
 }
 return walk(root);
}
export async function renderArticle(markdown:string,s:Settings):Promise<Output> {
 const codeSources:CodeSource[]=[];
 const assets:Asset[]=[]; const errors:string[]=[]; const sources:string[]=[];const images:{src:string;alt:string;width:number}[]=[];
 const md=new MarkdownIt({html:false,linkify:false,breaks:false});
 md.validateLink=url=>safeURL(url)||url.startsWith('local-image:');
 md.renderer.rules.image=(tokens,i)=>{
  const t=tokens[i];const item={src:t.attrGet('src')||'',alt:t.content,width:widthFromTitle(t.attrGet('title')||'')};images.push(item);
  return `<span data-image-index="${images.length-1}"></span>`;
 };
 md.renderer.rules.fence=(tokens,i)=>{
  const t=tokens[i];const lang=t.info.trim().split(/\s+/)[0];
  if(lang==='mermaid'){sources.push(t.content);return `<section data-diagram-index="${sources.length-1}"></section>`;}
  const code=escapeHTML(t.content);
  codeSources.push({text:t.content,language:lang});return `<pre data-code-index="${codeSources.length-1}"><code>${code}</code></pre>`;
 };
 md.renderer.rules.code_block=md.renderer.rules.fence;
 // Task markers operate on list token content, never on the Markdown document.
 const original=md.renderer.rules.inline;
 md.renderer.rules.inline=(tokens,i,opts,env,self)=>{
  const t=tokens[i];if(t.children?.[0]?.type==='text') {
   const m=/^\[([ xX])\] /.exec(t.children[0].content);
   if(m)t.children[0].content=(m[1]===' '?'☐ ':'☑ ')+t.children[0].content.slice(m[0].length);
  }
  return original?original(tokens,i,opts,env,self):self.renderInline(t.children||[],opts,env);
 };
 const root=document.createElement('section');root.innerHTML=DOMPurify.sanitize(md.render(markdown),{ADD_ATTR:['data-image-index','data-diagram-index']});
 const clipboard=root.cloneNode(true) as HTMLElement;
 await Promise.all(images.map(async(img,i)=>{
  const previewTarget=root.querySelector(`[data-image-index="${i}"]`)!;const copyTarget=clipboard.querySelector(`[data-image-index="${i}"]`)!;
  if(img.src.startsWith('local-image:')) {
   let url='';try{url=await imageURL(img.src);}catch{}assets.push({kind:'image',label:img.alt||`本地图片 ${i+1}`,src:img.src,missing:!url});
   const placeholder=document.createElement('p');placeholder.textContent=`[请在此处上传本地图片：${img.alt||`图片 ${i+1}`}]`;copyTarget.replaceWith(placeholder);
   if(url){const image=document.createElement('img');image.src=url;image.alt=img.alt;image.setAttribute('data-width',String(img.width));previewTarget.replaceWith(image);}
   else {const missing=document.createElement('p');missing.textContent=`[本地图片缺失：${img.alt||img.src}]`;previewTarget.replaceWith(missing);}
  } else if(/^https?:\/\//i.test(img.src)) {
   const image=document.createElement('img');image.src=img.src;image.alt=img.alt;image.setAttribute('data-width',String(img.width));previewTarget.replaceWith(image);copyTarget.replaceWith(image.cloneNode(true));
  } else { previewTarget.remove();copyTarget.remove(); }
 }));
 await Promise.all(sources.map(async(source,i)=>{
  const target=root.querySelector(`[data-diagram-index="${i}"]`)!;const copy=clipboard.querySelector(`[data-diagram-index="${i}"]`)!;
  assets.push({kind:'diagram',label:`Mermaid 图形 ${i+1}`,source});
  try {target.innerHTML=await diagram(source);const svg=target.querySelector('svg');if(svg){svg.style.maxWidth='100%';svg.style.height='auto';}}
  catch {errors.push(`Mermaid 图形 ${i+1} 语法错误，请修正源码。`);target.textContent=errors.at(-1)!;}
  target.removeAttribute('data-diagram-index');const p=document.createElement('p');p.textContent=`[请在此处插入 Mermaid 图形 ${i+1}，先下载 PNG 并上传到公众号]`;copy.replaceWith(p);
 }));
 inlineStyles(root,s,codeSources);inlineStyles(clipboard,s,codeSources);addCodeDecorations(root);
 // Strip every SVG from the sanitized output, then insert only our fixed local
 // decoration. User/imported SVG and Mermaid SVG never enter clipboard HTML.
 const sanitized=DOMPurify.sanitize(clipboard.outerHTML,{FORBID_TAGS:['script','style','svg','input','button','iframe'],FORBID_ATTR:['id','class'],ADD_ATTR:['style','data-code-block']});
 const clean=document.createElement('div');clean.innerHTML=sanitized;addCodeDecorations(clean);const html=clean.innerHTML;
 return {html,previewHTML:root.outerHTML,text:readableText(clean,codeSources),assets,errors,key:outputKey(markdown,s)};
}
export async function copyRich(output:Output) {
 if(!window.isSecureContext)throw new Error('富文本复制需要 HTTPS 独立网页，请在安全页面中打开后重试。');
 if(!navigator.clipboard?.write || !window.ClipboardItem)throw new Error('当前浏览器不支持富文本剪贴板写入，请使用支持此功能的 HTTPS 独立网页。');
 try {await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([output.html],{type:'text/html'}),'text/plain':new Blob([output.text],{type:'text/plain'})})]);}
 catch(e){throw new Error(`复制失败：${e instanceof DOMException?e.name:'写入未完成'}。请允许剪贴板权限，或在 HTTPS 独立网页中打开后点击重试。`);}
}
export async function copyText(text:string) { if(!navigator.clipboard?.writeText)throw new Error('当前浏览器不支持现代剪贴板 API。');await navigator.clipboard.writeText(text); }
