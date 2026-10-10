import hljs from 'highlight.js/lib/common';

export type CodeSource={text:string;language:string};
// Fixed, local decoration only. No SVG markup, URLs or attributes come from Markdown.
export function codeDecoration():SVGSVGElement {
 const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');
 for(const [key,value] of Object.entries({xmlns:ns,width:'45px',height:'13px',viewBox:'0 0 450 130',role:'img','aria-label':'代码块装饰'}))svg.setAttribute(key,value);
 svg.setAttribute('style','width:45px;height:13px;max-width:none;flex-shrink:0;');
 for(const [cx,stroke,fill] of [['50','rgb(220,60,54)','rgb(237,108,96)'],['225','rgb(218,151,33)','rgb(247,193,81)'],['400','rgb(27,161,37)','rgb(100,200,86)']]){
  const ellipse=document.createElementNS(ns,'ellipse');for(const [key,value] of Object.entries({cx,cy:'65',rx:'50',ry:'52',stroke,'stroke-width':'2',fill}))ellipse.setAttribute(key,value);svg.append(ellipse);
 }
 return svg;
}
export function addCodeDecorations(root:HTMLElement) {
 for(const header of root.querySelectorAll('[data-code-block] > pre > [data-code-chrome]')){header.replaceChildren(codeDecoration());}
}
function highlightColor(className:string,dark:boolean) {
 const palette=dark?['#a5d6ff','#ff7b72','#a5d6ff','#d2a8ff','#79c0ff','#8b949e']:['#a6493d','#9a3754','#31599c','#7650a8','#80572a','#83888f'];
 const index=/comment|quote/.test(className)?5:/keyword|selector|literal/.test(className)?1:/string|regexp/.test(className)?0:/number|attr/.test(className)?2:/title|function/.test(className)?3:4;
 return `color:${palette[index]};${index===5?'font-style:italic;':''}`;
}
export function codeCard(source:CodeSource,index:number,dark:boolean):HTMLDivElement {
 const normalized=source.text.replace(/\r\n|\r/g,'\n').replace(/\t/g,'    ');
 const content=normalized.endsWith('\n')?normalized.slice(0,-1):normalized;
 const lines=content.split('\n');const fragments=lines.map(()=>document.createDocumentFragment());
 const highlighted=document.createElement('div');
 // Highlight the complete block before splitting DOM text into lines, so multi-line
 // comments/strings retain context. Only generated spans are copied into output.
 if(source.language&&hljs.getLanguage(source.language))highlighted.innerHTML=hljs.highlight(content,{language:source.language,ignoreIllegals:true}).value;
 else highlighted.textContent=content;
 let lineIndex=0;
 const visit=(node:Node,styles:string[])=>{
  if(node.nodeType===Node.TEXT_NODE){const parts=(node.textContent||'').split('\n');parts.forEach((part,i)=>{if(i)lineIndex++;if(!part)return;let parent:Node=fragments[lineIndex];for(const style of styles){const token=document.createElement('span');token.setAttribute('style',style);parent.appendChild(token);parent=token;}parent.appendChild(document.createTextNode(part));});return;}
  const next=node instanceof Element&&node.tagName==='SPAN'?[...styles,highlightColor(node.className,dark)]:styles;
  for(const child of node.childNodes)visit(child,next);
 };
 visit(highlighted,[]);
 const outer=document.createElement('div');outer.setAttribute('data-code-block','');outer.setAttribute('data-code-index',String(index));outer.setAttribute('style','margin:10px 8px;width:calc(100% - 16px);max-width:100%;box-sizing:border-box;');
 const pre=document.createElement('pre');pre.setAttribute('style',`display:block;width:100%;max-width:100%;border-radius:8px;margin:0;padding:0 !important;box-sizing:border-box;border:1px solid ${dark?'#30363d':'#dbe3ef'};background:${dark?'#0d1117':'#f8fafc'};color:${dark?'#c9d1d9':'#111827'};font-size:14px;line-height:1.75;white-space:normal;`);
 const header=document.createElement('span');header.setAttribute('data-code-chrome','');header.setAttribute('style','display:flex;padding:10px 14px 0;');
 const scroll=document.createElement('div');scroll.setAttribute('data-code-scroll','');scroll.setAttribute('data-ignore-width','');scroll.setAttribute('style','display:block;width:100%;max-width:100%;overflow-x:auto !important;-webkit-overflow-scrolling:touch;box-sizing:border-box;');
 const code=document.createElement('code');code.setAttribute('style','display:block;padding:0.5em 1em 1em;text-indent:0;text-align:left;line-height:1.75;font-family:Menlo,"Operator Mono",Consolas,Monaco,monospace;font-size:90%;margin:0;white-space:pre !important;word-break:normal !important;overflow-wrap:normal !important;min-width:max-content;');
 const container=document.createElement('div');container.setAttribute('data-code-lines','');container.setAttribute('style','display:block;box-sizing:border-box;min-width:max-content;padding:0;white-space:pre !important;');
 lines.forEach((line,i)=>{
  const section=document.createElement('section');section.setAttribute('data-code-line','');section.setAttribute('style','display:block;margin:0;padding:0;line-height:1.75;white-space:pre;word-break:normal;overflow-wrap:normal;');
  const indent=/^ */.exec(line)![0].length;let remaining=indent;
  const walker=document.createTreeWalker(fragments[i],NodeFilter.SHOW_TEXT);let text:Node|null;
  while((text=walker.nextNode())){const value=text.textContent||'';const remove=Math.min(remaining,value.length);remaining-=remove;text.textContent=value.slice(remove).replace(/ /g,'\u00a0');}
  if(indent)section.append(document.createTextNode('\u00a0'.repeat(indent)));
  section.append(fragments[i]);if(!section.textContent)section.append(document.createTextNode('\u00a0'));
  // Leaf spans retain inline flow and avoid the legacy verifier counting
  // mixed direct text and highlight fragments as separate visual lines.
  for(const node of Array.from(section.childNodes))if(node.nodeType===Node.TEXT_NODE){const leaf=document.createElement('span');leaf.textContent=node.textContent;node.replaceWith(leaf);}
  container.append(section);
 });
 code.append(container);scroll.append(code);pre.append(header,scroll);outer.append(pre);return outer;
}
