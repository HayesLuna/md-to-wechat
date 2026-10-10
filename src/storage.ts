import { openDB } from 'idb';
import type { Settings } from './sample';
export type Draft = { id: string; title: string; customTitle?: boolean; markdown: string; settings: Settings; version: number; savedAt: number };
export function draftTitle(markdown: string) { return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0,100) || '未命名文章'; }
export function newDraft(markdown: string, settings: Settings): Draft {
 return {id:crypto.randomUUID(),title:draftTitle(markdown),markdown,settings,version:Date.now(),savedAt:Date.now()};
}
const db = () => openDB('mojian-v1', 2, {upgrade(db, oldVersion, _newVersion, tx) {
 if(oldVersion<1){db.createObjectStore('draft');db.createObjectStore('images');}
 if(oldVersion<2){
  db.createObjectStore('meta');
  const store=tx.objectStore('draft');
  void store.get('current').then(async legacy=>{
   if(!legacy)return;
   const draft={...legacy,id:crypto.randomUUID(),title:draftTitle(legacy.markdown)};
   await store.put(draft,draft.id);await tx.objectStore('meta').put(draft.id,'active');await store.delete('current');
  });
 }
}});
export async function loadDrafts(): Promise<{drafts:Draft[];activeId:string|undefined}> {
 const d=await db();const tx=d.transaction(['draft','meta']);
 const [drafts,activeId]=await Promise.all([tx.objectStore('draft').getAll(),tx.objectStore('meta').get('active')]);
 await tx.done;return {drafts:drafts.sort((a:Draft,b:Draft)=>b.savedAt-a.savedAt),activeId};
}
export async function saveDraft(draft: Draft) {
 const d = await db(); const tx = d.transaction(['draft','images','meta'],'readwrite');
 const ids = new Set(Array.from(draft.markdown.matchAll(/local-image:([a-zA-Z0-9-]+)/g), m=>m[1]));
 for(const id of ids) { await tx.objectStore('images').get(id); }
 const previous = await tx.objectStore('draft').get(draft.id);
 if(!previous || previous.version <= draft.version) await tx.objectStore('draft').put(draft,draft.id);
 await tx.objectStore('meta').put(draft.id,'active');await tx.done;
}
export async function removeDraft(id:string, next:Draft) {
 const d=await db();const tx=d.transaction(['draft','meta'],'readwrite');
 await tx.objectStore('draft').delete(id);await tx.objectStore('draft').put(next,next.id);
 await tx.objectStore('meta').put(next.id,'active');await tx.done;
}
export async function storeImage(file: Blob) {
 if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)) throw new Error('仅支持 PNG、JPEG、WebP、GIF 图片。');
 if(file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10 MB，请压缩后重试。');
 const bitmap = await createImageBitmap(file); bitmap.close();
 const id = crypto.randomUUID(); await (await db()).put('images',file,id); return 'local-image:'+id;
}
const urls = new Map<string,string>();
export async function imageURL(src: string) {
 if(!src.startsWith('local-image:')) return /^https?:\/\//i.test(src) ? src : '';
 if(urls.has(src)) return urls.get(src)!;
 const blob = await (await db()).get('images',src.slice(12));
 if(!blob) return '';
 const url = URL.createObjectURL(blob); urls.set(src,url); return url;
}
export async function imageBlob(src: string): Promise<Blob | undefined> { return (await db()).get('images',src.slice(12)); }
export function download(blob: Blob, filename: string) { const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
export async function downloadImage(src: string, name: string) {
 const blob=await imageBlob(src); if(!blob) throw new Error('本地图片资源缺失。');
 const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'} as Record<string,string>)[blob.type] || 'png'; download(blob,name+'.'+extension);
}
