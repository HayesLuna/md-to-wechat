import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection, NodeSelection } from '@tiptap/pm/state';
import { Upload, Download, Copy, CheckCircle2, Loader2, PanelRight, ListTree, Maximize2, Minimize2, X, Save, LockKeyhole, ChevronDown, FileText, ImagePlus, ExternalLink, AlertCircle, Trash2, RotateCcw, HelpCircle } from 'lucide-react';
import { SAMPLE, DEFAULT_SETTINGS, type Settings } from './sample';
import { loadDraft, saveDraft, storeImage, download, downloadImage } from './storage';
import { renderArticle, outputKey, headings, safeURL, copyRich, copyText, type Output } from './output';
import { downloadDiagram } from './mermaid';
import { EditorPane, replaceDocument } from './EditorPane';
import { Toolbar, type Operation } from './Toolbar';
import { SettingsPanel } from './SettingsPanel';
import { Dialog } from './Dialog';
import { captureTarget, protectedDeleteRow, protectedDeleteColumn, ancestor, alignTableColumns, insertCenteredTable } from './editorExtensions';
type Modal = {type:'link'|'image'|'assets'|'downloads'|'help'} | {type:'confirm';title:string;message:string;action:()=>void};
type SaveStatus='saving'|'saved'|'failed';
function validSettings(s?:Settings):Settings {
 if(!s)return DEFAULT_SETTINGS;return {...DEFAULT_SETTINGS,theme:['default','simple','elegant'].includes(s.theme)?s.theme:'default',color:/^#[0-9a-f]{6}$/i.test(s.color)?s.color:DEFAULT_SETTINGS.color,fontSize:Math.max(14,Math.min(20,s.fontSize||16)),lineHeight:Math.max(1.5,Math.min(2.3,s.lineHeight||1.85)),codeTheme:s.codeTheme==='dark'?'dark':'light'};
}
export default function App() {
 const [ready,setReady]=useState(false);const [markdown,setMarkdown]=useState('');const [initial,setInitial]=useState('');const [settings,setSettings]=useState(DEFAULT_SETTINGS);
 const [editor,setEditor]=useState<Editor|null>(null);const [mode,setMode]=useState<'wysiwyg'|'source'>('wysiwyg');const [preview,setPreview]=useState(false);
 const [outline,setOutline]=useState(false);const [fullscreen,setFullscreen]=useState(false);const [menu,setMenu]=useState(false);const [modal,setModal]=useState<Modal|null>(null);
 const [context,setContext]=useState<{x:number;y:number}|null>(null);const [notice,setNotice]=useState('');const [saveStatus,setSaveStatus]=useState<SaveStatus>('saving');
 const [output,setOutput]=useState<Output|null>(null);const [preparing,setPreparing]=useState(true);const [renderError,setRenderError]=useState('');const [selectionTick,setSelectionTick]=useState(0);
 const [url,setURL]=useState('');const [label,setLabel]=useState('');const [dialogError,setDialogError]=useState('');const [processing,setProcessing]=useState(false);
 const [copying,setCopying]=useState(false);const [saveTime,setSaveTime]=useState(0);
 const current=useRef({markdown,settings});current.current={markdown,settings};const version=useRef(Date.now());const saveQueue=useRef<Promise<void>>(Promise.resolve());
 const statusRef=useRef(saveStatus);statusRef.current=saveStatus;const target=useRef<ReturnType<typeof captureTarget>|null>(null);const imageRequest=useRef(0);
 const fileInput=useRef<HTMLInputElement>(null);const imageInput=useRef<HTMLInputElement>(null);const source=useRef<HTMLTextAreaElement>(null);const writingScroll=useRef<HTMLDivElement>(null);
 const fullRestore=useRef<{body:string;scroll:number;sourceScroll:number;page:number}|null>(null);
 const contextElement=useRef<HTMLDivElement>(null);
 const notify=useCallback((s:string)=>setNotice(s),[]);
 useEffect(()=>{let active=true;loadDraft().then(d=>{if(!active)return;const text=d?d.markdown:SAMPLE;setMarkdown(text);setInitial(text);setSettings(validSettings(d?.settings));version.current=Math.max(Date.now(),(d?.version||0)+1);setSaveTime(d?.savedAt||0);setReady(true);}).catch(()=>{if(active){setMarkdown(SAMPLE);setInitial(SAMPLE);setReady(true);notify('无法读取本地存储；请保留内容并导出 Markdown。');}});return()=>{active=false;};},[notify]);
 const changed=(text:string)=>{current.current={...current.current,markdown:text};version.current++;setMarkdown(text);setSaveStatus('saving');};
 const changeSettings=(s:Settings)=>{current.current={...current.current,settings:s};version.current++;setSettings(s);setSaveStatus('saving');};
 const saveNow=useCallback((manual=false)=>{
  const v=version.current;const draft={...current.current,version:v,savedAt:Date.now()};setSaveStatus('saving');
  const pending=saveQueue.current.catch(()=>{}).then(()=>saveDraft(draft));saveQueue.current=pending;
  pending.then(()=>{if(v===version.current){setSaveStatus('saved');setSaveTime(draft.savedAt);if(manual)notify('草稿已保存到当前浏览器');}}).catch(()=>{if(v===version.current){setSaveStatus('failed');notify('保存失败：浏览器存储不可用或空间不足。正文仍在，请重试或导出。');}});
  return pending;
 },[notify]);
 useEffect(()=>{if(!ready)return;const timer=setTimeout(()=>void saveNow(),600);return()=>clearTimeout(timer);},[markdown,settings,ready,saveNow]);
 useEffect(()=>{const listener=(e:Event)=>notify((e as CustomEvent).detail);window.addEventListener('mojian-notice',listener);return()=>window.removeEventListener('mojian-notice',listener);},[notify]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6500);return()=>clearTimeout(timer);},[notice]);
 useEffect(()=>{if(!ready)return;let active=true;setPreparing(true);setRenderError('');const timer=setTimeout(()=>{renderArticle(markdown,settings).then(result=>{if(active){setOutput(result);setPreparing(false);}}).catch(e=>{if(active){setPreparing(false);setRenderError('排版准备失败，请重试：'+e.message);}});},250);return()=>{active=false;clearTimeout(timer);};},[markdown,settings,ready]);
 const closeModal=()=>{imageRequest.current++;setProcessing(false);target.current?.cancel();target.current=null;setModal(null);setDialogError('');editor?.commands.focus();};
 const restoreTarget=()=>{target.current?.restore();target.current=null;};
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   if(e.isComposing||e.keyCode===229||editor?.view.composing)return;
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void saveNow(true);return;}
   if(e.key==='Escape') {if(modal){e.preventDefault();closeModal();}else if(context){e.preventDefault();setContext(null);}else if(menu){e.preventDefault();setMenu(false);}else if(outline){e.preventDefault();setOutline(false);}else if(fullscreen){e.preventDefault();setFullscreen(false);}}
  };
  const unload=(e:BeforeUnloadEvent)=>{if(statusRef.current!=='saved'){e.preventDefault();e.returnValue='';}};
  const visibility=()=>{if(document.visibilityState==='hidden'&&ready)void saveNow();};
  window.addEventListener('keydown',key);window.addEventListener('beforeunload',unload);document.addEventListener('visibilitychange',visibility);
  return()=>{window.removeEventListener('keydown',key);window.removeEventListener('beforeunload',unload);document.removeEventListener('visibilitychange',visibility);};
 },[modal,context,menu,outline,fullscreen,editor,saveNow,ready]);
 useEffect(()=>{
  if(fullscreen){document.body.style.overflow='hidden';if(mode==='wysiwyg')editor?.commands.focus(undefined,{scrollIntoView:false});else source.current?.focus({preventScroll:true});}
  else if(fullRestore.current){const previous=fullRestore.current;document.body.style.overflow=previous.body;requestAnimationFrame(()=>{if(mode==='wysiwyg')editor?.commands.focus(undefined,{scrollIntoView:false});else source.current?.focus({preventScroll:true});if(writingScroll.current)writingScroll.current.scrollTop=previous.scroll;if(source.current)source.current.scrollTop=previous.sourceScroll;window.scrollTo(0,previous.page);});fullRestore.current=null;}
  return()=>{if(fullRestore.current)document.body.style.overflow=fullRestore.current.body;};
 },[fullscreen]);
 useEffect(()=>{if(!context&&!menu)return;const outside=(e:PointerEvent)=>{if(!(e.target as Element).closest('.floating-menu,.more-trigger')){setContext(null);setMenu(false);}};window.addEventListener('pointerdown',outside);return()=>window.removeEventListener('pointerdown',outside);},[context,menu]);
 useEffect(()=>{if(!import.meta.env.DEV)return;Object.assign(window,{__mojian:{editor,getMarkdown:()=>current.current.markdown,getSettings:()=>current.current.settings,getOutput:()=>output,setMarkdown:(text:string)=>{if(editor)replaceDocument(editor,text);changed(text);}}});},[editor,output]);
 const headingList=useMemo(()=>headings(markdown),[markdown]);const words=Array.from(markdown.replace(/\s/g,'')).length;
 const switchMode=(next:'wysiwyg'|'source')=>{if(processing){notify('图片处理中，请完成或取消后切换模式。');return;}if(next===mode)return;if(next==='wysiwyg'&&editor)replaceDocument(editor,current.current.markdown);setMode(next);requestAnimationFrame(()=>next==='source'?source.current?.focus():editor?.commands.focus());};
 const tableActions=(action:'row'|'col'|'deleteRow'|'deleteCol'|'delete')=>{if(!editor)return;setContext(null);if(action==='row')editor.chain().focus().addRowAfter().run();if(action==='col')editor.chain().focus().addColumnAfter().run();if(action==='deleteRow')protectedDeleteRow(editor,notify);if(action==='deleteCol')protectedDeleteColumn(editor,notify);if(action==='delete')editor.chain().focus().deleteTable().run();};
 const open=(op:Operation)=>{
  setContext(null);setMenu(false);if(!editor)return;
  if(op==='table'){insertCenteredTable(editor);return;}
  if(op==='more'){setMenu(true);return;}
  if(op==='link'&&editor.isActive('link'))editor.commands.extendMarkRange('link');
  target.current?.cancel();target.current=captureTarget(editor);setURL(op==='link'?editor.getAttributes('link').href||'':'');setLabel(editor.state.doc.textBetween(editor.state.selection.from,editor.state.selection.to,' '));setDialogError('');setModal({type:op});
 };
 const insertLink=()=>{
  if(!editor)return;if(!safeURL(url.trim())){setDialogError('请输入完整的 HTTP、HTTPS、mailto 或 tel 地址，禁止危险协议。');return;}
  restoreTarget();const text=editor.state.doc.textBetween(editor.state.selection.from,editor.state.selection.to,' ');
  if(text)editor.chain().focus().setLink({href:url.trim(),target:'_blank',rel:'noopener noreferrer'}).run();
  else editor.chain().focus().insertContent({type:'text',text:label.trim()||url.trim(),marks:[{type:'link',attrs:{href:url.trim(),target:'_blank',rel:'noopener noreferrer'}}]}).run();
  setModal(null);setDialogError('');
 };
 const insertURLImage=async()=>{
  if(!editor||processing)return;const address=url.trim();if(!/^https?:\/\//i.test(address)||!safeURL(address)){setDialogError('图片地址必须是公开 HTTP 或 HTTPS URL。');return;}
  const savedTarget=target.current||captureTarget(editor);target.current=savedTarget;const req=++imageRequest.current;setProcessing(true);setDialogError('');
  try {await new Promise<void>((resolve,reject)=>{const image=new Image();const timer=setTimeout(()=>{image.src='';reject(new Error('图片加载超时，请检查公开地址后重试。'));},15000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new Error('图片无法加载，地址可能失效或禁止外部访问。正文未改变。'));};image.src=address;});
   if(req!==imageRequest.current)return;savedTarget.restore();target.current=null;editor.chain().focus().insertContent({type:'image',attrs:{src:address,alt:label.trim()||'图片',percent:100}}).run();setModal(null);
  } catch(e){if(req===imageRequest.current)setDialogError((e as Error).message);}finally{if(req===imageRequest.current)setProcessing(false);}
 };
 const insertFile=async(file:File,fromPaste=false)=>{
  if(processing||!editor)return;
  if(fromPaste){target.current?.cancel();target.current=captureTarget(editor);}
  const savedTarget=target.current||captureTarget(editor);target.current=savedTarget;const req=++imageRequest.current;setProcessing(true);setDialogError('');notify('正在检查并保存本地图片…');
  try{const src=await storeImage(file);if(req!==imageRequest.current)return;savedTarget.restore();target.current=null;editor.chain().focus().insertContent({type:'image',attrs:{src,alt:file.name||'剪贴板图片',percent:100}}).run();setModal(null);notify('本地图片已插入，迁移到公众号时需要重新上传。');}
  catch(e){if(req===imageRequest.current){setDialogError((e as Error).message);notify((e as Error).message);}}
  finally{if(req===imageRequest.current)setProcessing(false);}
 };
 const contextMenu=(event:MouseEvent,e:Editor)=>{
  if(window.matchMedia('(pointer: coarse)').matches)return false;event.preventDefault();
  const hit=e.view.posAtCoords({left:event.clientX,top:event.clientY});if(hit){const s=e.state.selection;if(s.empty||hit.pos<s.from||hit.pos>s.to){const image=(event.target as Element).closest('.image-node');if(image){const pos=e.view.posAtDOM(image,0);const n=e.state.doc.nodeAt(pos);if(n?.type.name==='image')e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc,pos)));else e.view.dispatch(e.state.tr.setSelection(TextSelection.near(e.state.doc.resolve(hit.pos))));}else e.view.dispatch(e.state.tr.setSelection(TextSelection.near(e.state.doc.resolve(hit.pos))));}}
  setSelectionTick(n=>n+1);setContext({x:event.clientX,y:event.clientY});return true;
 };
 const replaceArticle=(text:string)=>{if(editor)replaceDocument(editor,text);changed(text);setModal(null);setMenu(false);setOutline(false);editor?.commands.focus('start');};
 const askReplace=(title:string,message:string,action:()=>void)=>{setMenu(false);setModal({type:'confirm',title,message,action});};
 const importFile=async(file:File)=>{
  if(!/\.md$/i.test(file.name)){notify('请选择 .md Markdown 文件。');return;}if(file.size>10*1024*1024){notify('Markdown 文件不能超过 10 MB。');return;}
  try {const buffer=await file.arrayBuffer();const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);askReplace('导入 Markdown','导入会替换当前正文。建议先导出当前草稿；取消会保留全部内容。',()=>{replaceArticle(text);notify('Markdown 已导入，本地图片资源如缺失会在对应位置提示。');});}catch{notify('导入失败：无法读取 UTF-8 Markdown 文件，当前草稿已保留。');}
 };
 const exportMD=()=>{const title=headingList.find(h=>h.level===1)?.text||'墨笺草稿';download(new Blob([current.current.markdown],{type:'text/markdown;charset=utf-8'}),title.replace(/[<>:"/\\|?*]/g,'').slice(0,70)+'.md');if(current.current.markdown.includes('local-image:')){setModal({type:'downloads'});notify('已导出 Markdown。单独的 .md 不包含本地图片，请同时下载图片资源。');}else notify('已导出 UTF-8 Markdown');};
 const outputCurrent=()=>output&&!preparing&&output.key===outputKey(current.current.markdown,current.current.settings);
 const doCopy=async()=>{
  if(!outputCurrent()||!output){notify('内容已变化，正在重新准备排版；完成后请再次点击复制。');return;}
  if(output.errors.length){notify(output.errors.join(' '));return;}setCopying(true);
  try{await copyRich(output);setModal(null);notify('已复制排版内容');}catch(e){notify((e as Error).message);}finally{setCopying(false);}
 };
 const requestCopy=()=>{if(!outputCurrent()){notify(renderError||'正在准备最新排版，完成后请再次点击复制。');return;}if(output!.errors.length){notify(output!.errors.join(' '));return;}if(output!.assets.length)setModal({type:'assets'});else void doCopy();};
 const copySource=()=>void copyText(current.current.markdown).then(()=>notify('已复制 Markdown 源码')).catch(()=>notify('Markdown 复制失败，请检查浏览器剪贴板权限。'));
 const jump=(index:number)=>{
  if(mode==='source'){const line=headingList[index].line;const at=markdown.split('\n').slice(0,line).join('\n').length+(line?1:0);source.current?.focus();source.current?.setSelectionRange(at,at);if(source.current)source.current.scrollTop=Math.max(0,line*25-80);}
  else if(editor){let i=0;let pos=0;editor.state.doc.descendants((node,p)=>{if(node.type.name==='heading'){if(i===index)pos=p;i++;}});editor.commands.setTextSelection(pos+1);const dom=editor.view.nodeDOM(pos) as HTMLElement;dom?.scrollIntoView({block:'start',behavior:'smooth'});editor.commands.focus(undefined,{scrollIntoView:false});}
  setOutline(false);
 };
 const toggleFullscreen=()=>{if(!fullscreen)fullRestore.current={body:document.body.style.overflow,scroll:writingScroll.current?.scrollTop||0,sourceScroll:source.current?.scrollTop||0,page:window.scrollY};setFullscreen(f=>!f);};
 const tableAlign=(align:'left'|'center'|'right')=>{if(editor){setContext(null);alignTableColumns(editor,align);}};
 const inTable=editor?.isActive('table');const imageSelected=editor?.isActive('image');const linkActive=editor?.isActive('link');void selectionTick;
 useLayoutEffect(()=>{
  if(!context)return;
  const position=()=>{
   const el=contextElement.current;if(!el)return;
   // Measure away from the edge, where fixed-position auto widths can shrink.
   el.style.left='8px';el.style.top='8px';
   const {width,height}=el.getBoundingClientRect();
   el.style.left=Math.max(8,Math.min(context.x,window.innerWidth-width-8))+'px';
   el.style.top=Math.max(8,Math.min(context.y,window.innerHeight-height-8))+'px';
  };
  position();window.addEventListener('resize',position);
  return()=>window.removeEventListener('resize',position);
 },[context,inTable,imageSelected]);
 const localAssets=output?.assets.filter(a=>a.kind==='image')||[];
 useEffect(()=>{const listener=(e:Event)=>{const {event,editor}=(e as CustomEvent).detail;contextMenu(event,editor);};window.addEventListener('mojian-context',listener);return()=>window.removeEventListener('mojian-context',listener);},[editor]);
 const assetDownloads=(assets=output?.assets||[])=>assets.length?assets.map((a,i)=><li key={i}><div><strong>{a.label}</strong><small>{a.kind==='diagram'?'下载 PNG 后在公众号手动插入':a.missing?'资源缺失，请重新选择图片':'仅保存在当前浏览器 · 需要重新上传'}</small></div><button disabled={a.missing} onClick={()=>{const task=a.kind==='diagram'?downloadDiagram(a.source!):downloadImage(a.src!,a.label);void task.catch(e=>notify(e.message));}}><Download size={15}/>{a.kind==='diagram'?'PNG':'下载'}</button></li>):<li>暂无本地图片</li>;
 if(!ready)return <div className="loading"><Loader2 className="spin"/>正在恢复本地草稿…</div>;
 return <div className={`app ${fullscreen?'fullscreen':''} ${preview?'has-preview':''}`}>
  <header className="app-header"><div className="brand"><img className="brand-mark" src={`${import.meta.env.BASE_URL}mojian-brand-icon.svg`} width="39" height="39" alt=""/><h1>墨笺</h1><span className="brand-description">Markdown 公众号排版</span></div>
   <div className={`save-indicator ${saveStatus}`} role="status">{saveStatus==='saved'?<CheckCircle2 size={14}/>:saveStatus==='saving'?<Loader2 className="spin" size={14}/>:<AlertCircle size={14}/>}<span>{saveStatus==='saved'?`已保存到本地${saveTime?' '+new Date(saveTime).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):''}`:saveStatus==='saving'?'保存中…':'保存失败'}</span>{saveStatus==='failed'&&<button onClick={()=>void saveNow(true)}>重试</button>}</div>
   <nav className="header-actions"><button className="import-export" onClick={()=>fileInput.current?.click()}><Upload size={16}/><span>导入 Markdown</span></button><button className="import-export" onClick={exportMD}><Download size={16}/><span>导出 Markdown</span></button><button className="mobile-save" title="保存草稿" onClick={()=>void saveNow(true)}><Save size={17}/></button><button className="primary copy-main" onClick={requestCopy} disabled={copying}>{copying?<Loader2 size={16} className="spin"/>:<Copy size={16}/>}<span>{copying?'复制中…':'复制到公众号'}</span></button></nav>
  </header>
  <main className="workspace"><section className={`writing-pane ${preview?'mobile-hidden':''}`}>
   <div className="pane-tabs"><div className="mode-tabs"><button className={mode==='wysiwyg'?'active':''} onClick={()=>switchMode('wysiwyg')}>所见即所得</button><button className={mode==='source'?'active':''} onClick={()=>switchMode('source')}>Markdown 源码</button></div><div className="pane-actions"><button title="大纲" className={outline?'active':''} onClick={()=>setOutline(o=>!o)}><ListTree size={17}/><span>大纲</span></button><button title={fullscreen?'退出全屏':'全屏写作'} aria-pressed={fullscreen} onMouseDown={e=>e.preventDefault()} onClick={toggleFullscreen}>{fullscreen?<Minimize2 size={17}/>:<Maximize2 size={17}/>}<span className="fullscreen-label">{fullscreen?'退出全屏':''}</span></button><button className="preview-trigger" title={preview?'关闭预览':'公众号预览'} onClick={()=>setPreview(p=>!p)}><PanelRight size={17}/><span>{preview?'关闭预览':'公众号预览'}</span></button></div></div>
   <Toolbar editor={editor} onOpen={open} source={mode==='source'} onCopySource={copySource}/>
   <div className="writing-body">
   <div className="context-overlay">
   {mode==='wysiwyg'&&inTable&&<div className="context-tools" aria-label="表格操作"><span>表格</span><label className="column-align">列对齐<select aria-label="当前列对齐" value={editor?.getAttributes('tableCell').align||editor?.getAttributes('tableHeader').align||'left'} onChange={e=>tableAlign(e.target.value as 'left'|'center'|'right')}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label><button onMouseDown={e=>e.preventDefault()} onClick={()=>tableActions('row')}>下方添加行</button><button onMouseDown={e=>e.preventDefault()} onClick={()=>tableActions('col')}>右侧添加列</button><button onMouseDown={e=>e.preventDefault()} onClick={()=>tableActions('deleteRow')}>删除当前行</button><button onMouseDown={e=>e.preventDefault()} onClick={()=>tableActions('deleteCol')}>删除当前列</button><button onMouseDown={e=>e.preventDefault()} onClick={()=>tableActions('delete')}>删除整表</button></div>}
   {mode==='wysiwyg'&&linkActive&&<div className="context-tools link-tools" aria-label="链接操作"><span>链接</span><button onMouseDown={e=>e.preventDefault()} onClick={()=>open('link')}>编辑链接</button><button onClick={()=>{const href=editor?.getAttributes('link').href;if(safeURL(href))window.open(href,'_blank','noopener,noreferrer');}}>新标签页打开 <ExternalLink size={12}/></button><button onMouseDown={e=>e.preventDefault()} onClick={()=>editor?.chain().focus().extendMarkRange('link').unsetLink().run()}>移除链接</button></div>}
   </div>
   <div ref={writingScroll} className="writing-scroll"><div className="editor-host" style={{display:mode==='wysiwyg'?'block':'none'}}><EditorPane initial={initial} onReady={setEditor} onChange={changed} onSelection={()=>setSelectionTick(n=>n+1)} onContext={contextMenu} onPasteImage={file=>void insertFile(file,true)}/></div>{mode==='source'&&<textarea ref={source} className="source-editor" aria-label="Markdown 源码正文" spellCheck={false} value={markdown} onChange={e=>changed(e.target.value)}/>}</div>
   </div>
  </section>
  {preview&&<aside className="preview-pane"><div className="preview-header"><h2>公众号预览</h2><span>{preparing?'准备排版…':'与复制使用同一排版'}</span><button aria-label="关闭预览" title="关闭预览" onClick={()=>setPreview(false)}><X size={18}/></button></div><div className="preview-scroll"><SettingsPanel settings={settings} onChange={changeSettings}/><div className="preview-explanation">手机阅读宽度 · 图片与图形迁移前需确认</div>{renderError?<p className="output-error">{renderError}</p>:<div className={`preview-paper ${preparing?'preparing':''}`} aria-label="公众号排版正文" dangerouslySetInnerHTML={{__html:output?.previewHTML||''}}/>}</div></aside>}
  </main>
  <footer className="app-footer"><span>字数：{words.toLocaleString()}<i/>预计阅读：{Math.max(1,Math.ceil(words/500))} 分钟</span><span><LockKeyhole size={12}/>草稿仅保存在当前浏览器，清除站点数据可能丢失。</span><button title="帮助与快捷键" onClick={()=>setModal({type:'help'})}><HelpCircle size={15}/></button></footer>
  {outline&&<aside className="outline-panel" aria-label="文章大纲"><header><strong>文章大纲</strong><button title="关闭大纲" onClick={()=>setOutline(false)}><X size={17}/></button></header><div>{headingList.length?headingList.map((h,i)=><button key={i} style={{paddingLeft:16+(h.level-1)*14}} onClick={()=>jump(i)}><span>{h.text||'无标题'}</span><small>{i+1}</small></button>):<p>暂无标题</p>}</div></aside>}
  {menu&&<div className="floating-menu more-menu"><button onClick={()=>{void saveNow(true);setMenu(false);}}><Save size={16}/>保存本地草稿</button><button onClick={()=>{copySource();setMenu(false);}}><FileText size={16}/>复制 Markdown 源码</button><button onClick={()=>{setModal({type:'downloads'});setMenu(false);}}><ImagePlus size={16}/>下载本地图片</button><button onClick={()=>askReplace('替换为示例文章','这会替换当前正文和结构，取消保持当前草稿。',()=>replaceArticle(SAMPLE))}><RotateCcw size={16}/>替换为示例文章</button><button onClick={()=>askReplace('清空草稿','正文会清空。建议先导出 Markdown，本地图片资源仍会保留。',()=>replaceArticle(''))}><Trash2 size={16}/>清空草稿</button><button onClick={()=>{setModal({type:'help'});setMenu(false);}}><HelpCircle size={16}/>使用说明与快捷键</button></div>}
  {context&&<div ref={contextElement} className="floating-menu context-menu" style={{left:context.x,top:context.y}}><button onClick={()=>open('link')}>插入链接</button><button onClick={()=>open('table')}>插入 3×3 表格</button><button onClick={()=>open('image')}>插入图片</button>{inTable&&<><hr/><button onClick={()=>tableAlign('left')}>当前列左对齐</button><button onClick={()=>tableAlign('center')}>当前列居中</button><button onClick={()=>tableAlign('right')}>当前列右对齐</button><hr/><button onClick={()=>tableActions('row')}>下方添加行</button><button onClick={()=>tableActions('col')}>右侧添加列</button><button onClick={()=>tableActions('deleteRow')}>删除当前行</button><button onClick={()=>tableActions('deleteCol')}>删除当前列</button><button onClick={()=>tableActions('delete')}>删除整表</button></>}{imageSelected&&<><hr/><button onClick={()=>{editor?.chain().focus().deleteSelection().run();setContext(null);}}>删除选中图片</button><button onClick={()=>{setContext(null);editor?.commands.focus();notify('点击图片后可拖拽右下角手柄，或输入 1%–200% 宽度。');}}>调整图片尺寸</button></>}</div>}
  {modal&&<Dialog title={modal.type==='link'?'插入链接':modal.type==='image'?'插入图片':modal.type==='assets'?'复制前：这些图片需要手动上传':modal.type==='downloads'?'下载本地图片':modal.type==='help'?'写作说明':modal.type==='confirm'?modal.title:'操作'} onClose={closeModal}>
   {modal.type==='link'&&<form onSubmit={e=>{e.preventDefault();insertLink();}}><label>链接地址<input autoFocus aria-label="链接地址" type="text" placeholder="https://example.com" value={url} onChange={e=>setURL(e.target.value)}/></label><label>显示文字<input aria-label="链接显示文字" value={label} onChange={e=>setLabel(e.target.value)}/></label><p className="muted">有选中文字时，链接应用到原文字；无选区时使用显示文字。</p>{dialogError&&<p className="form-error">{dialogError}</p>}<div className="dialog-actions"><button type="button" onClick={closeModal}>取消</button><button className="primary" type="submit">插入链接</button></div></form>}
   {modal.type==='image'&&<form onSubmit={e=>{e.preventDefault();void insertURLImage();}}><label>公开图片 URL<input aria-label="图片地址" placeholder="https://…" value={url} onChange={e=>setURL(e.target.value)}/></label><label>图片说明<input aria-label="图片说明" value={label} onChange={e=>setLabel(e.target.value)}/></label><div className="image-upload"><button type="button" disabled={processing} onClick={()=>imageInput.current?.click()}>{processing?<Loader2 className="spin" size={17}/>:<Upload size={17}/>} {processing?'图片处理中…':'选择本地图片'}</button><p>PNG / JPEG / WebP / GIF，最大 10 MB。<br/>不上传到服务器，仅保存在当前浏览器。</p></div>{dialogError&&<p className="form-error">{dialogError}</p>}<div className="dialog-actions"><button type="button" onClick={closeModal}>取消</button><button className="primary" type="submit" disabled={processing}>插入 URL 图片</button></div></form>}
   {modal.type==='assets'&&<><p>本地图片和 Mermaid 图形不能保证随富文本迁移。请下载后上传到公众号；复制正文会在对应位置保留静态占位说明。</p><p className="muted">公开网络图片也可能受公众号防盗链限制，粘贴后请检查。</p><ul className="asset-list">{assetDownloads()}</ul><div className="dialog-actions"><button onClick={closeModal}>返回写作</button><button className="primary" disabled={copying||!outputCurrent()} onClick={()=>void doCopy()}>{preparing?'重新准备中…':'确认复制正文与占位说明'}</button></div></>}
   {modal.type==='downloads'&&<><p>单独的 .md 文件不包含图片二进制。请分别下载图片；在其他浏览器导入时，缺失资源会显示提示。</p><ul className="asset-list">{assetDownloads(localAssets)}</ul><div className="dialog-actions"><button onClick={closeModal}>完成</button></div></>}
   {modal.type==='confirm'&&<><p>{modal.message}</p><div className="dialog-actions"><button onClick={closeModal}>取消</button><button className="primary" onClick={modal.action}>确认{modal.title.includes('清空')?'清空':'替换'}</button></div></>}
   {modal.type==='help'&&<div className="help-content"><p>在左侧写作，按需打开公众号预览。复制时仅使用现代 Clipboard API，同时写入 HTML 和纯文本；失败会保留草稿并显示原因。</p><dl><dt>保存</dt><dd>Ctrl / ⌘ + S，或“更多 → 保存本地草稿”</dd><dt>逐级全选</dt><dd>Ctrl / ⌘ + A：列表项 → 当前列表 → 外层列表 → 全文；表格行 → 整表 → 全文；代码 → 全文。引用内先选择当前引用，再逐级选择外层引用，最后全文；引用中的列表、表格和代码先按对应规则选择。</dd><dt>中文快捷输入</dt><dd>正文行首“》”后按空格成为引用；“···java”或“···mermaid”后按 Enter 成为代码块。</dd><dt>表格删除</dt><dd>整表选中后 Delete/Backspace 先清空全部单元格，再次按删除键移除空表；移动光标后重新开始。</dd><dt>图片尺寸</dt><dd>以 Markdown 图片标题 <code>"width=80%"</code> 保存。普通标题不代表尺寸，默认 100%。本地资源标识为 <code>local-image:UUID</code>。</dd><dt>网页全屏</dt><dd>工具栏“全屏写作”，Esc 先关闭弹窗或菜单，再退出全屏。</dd></dl><p className="muted">草稿仅属于当前浏览器和站点。请定期导出正文并下载本地图片。公众号中的外链、图片、代码和复杂结构仍需粘贴后核对。</p></div>}
  </Dialog>}
  {notice&&<div className="toast" role="status"><span>{notice}</span><button title="关闭提示" onClick={()=>setNotice('')}><X size={16}/></button></div>}
  <input ref={fileInput} type="file" accept=".md,text/markdown" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void importFile(file);}}/>
  <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void insertFile(file);}}/>
 </div>;
}
