import { openDB } from 'idb';
import { headings } from './headings';
import type { Settings } from './sample';
export type Draft = { id: string; title: string; customTitle?: boolean; markdown: string; settings: Settings; version: number; createdAt: number; savedAt: number };
export function compareDraftCreation(a:Draft,b:Draft) {return a.createdAt===b.createdAt?a.id.localeCompare(b.id):b.createdAt-a.createdAt;}
export function draftTitle(markdown: string) { return headings(markdown).find(heading=>heading.level===1)?.text.slice(0,100) || '未命名文章'; }
export function newDraft(markdown: string, settings: Settings): Draft {
 const now=Date.now();
 return {id:crypto.randomUUID(),title:draftTitle(markdown),markdown,settings,version:now,createdAt:now,savedAt:now};
}
let connection: ReturnType<typeof openDB> | undefined;
function db() {
 if(connection)return connection;
 const pending=openDB('mojian-v1', 3, {upgrade(db, oldVersion, _newVersion, tx) {
 if(oldVersion<1){db.createObjectStore('draft');db.createObjectStore('images');}
 if(oldVersion<2){
  db.createObjectStore('meta');
  const store=tx.objectStore('draft');
  void store.get('current').then(async legacy=>{
   if(!legacy)return;
   const draft={...legacy,id:crypto.randomUUID(),title:draftTitle(legacy.markdown),createdAt:Date.now()};
   await store.put(draft,draft.id);await tx.objectStore('meta').put(draft.id,'active');await store.delete('current');
  });
 }
},blocking(){
 // Release the connection when another tab upgrades the database.
 if(connection===pending)connection=undefined;
 void pending.then(database=>database.close());
},terminated(){if(connection===pending)connection=undefined;}});
 connection=pending;
 void pending.catch(()=>{if(connection===pending)connection=undefined;});
 return pending;
}
export async function loadDrafts(): Promise<{drafts:Draft[];activeId:string|undefined}> {
 const d=await db();const tx=d.transaction(['draft','meta']);
 const [drafts,activeId]=await Promise.all([tx.objectStore('draft').getAll(),tx.objectStore('meta').get('active')]);
 await tx.done;return {drafts:drafts.map((draft:Draft)=>draft.customTitle?draft:{...draft,title:draftTitle(draft.markdown)}).sort(compareDraftCreation),activeId};
}
export async function saveDraft(draft: Draft) {
 const d = await db(); const tx = d.transaction(['draft','meta'],'readwrite');
 const previous = await tx.objectStore('draft').get(draft.id);
 if(!previous || previous.version <= draft.version) await tx.objectStore('draft').put({...draft,createdAt:previous?.createdAt??draft.createdAt},draft.id);
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
const urls = new Map<string,Promise<string>>();
export async function imageURL(src: string) {
 if(!src.startsWith('local-image:')) return /^https?:\/\//i.test(src) ? src : '';
 if(urls.has(src)) return urls.get(src)!;
 // Share in-flight reads between the editor and article preview.
 const pending=(async()=>{
  const blob=await (await db()).get('images',src.slice(12));
  return blob?URL.createObjectURL(blob):'';
 })();
 urls.set(src,pending);
 try {
  const url=await pending;
  if(!url)urls.delete(src);
  return url;
 } catch(error) {urls.delete(src);throw error;}
}
export async function imageBlob(src: string): Promise<Blob | undefined> { return (await db()).get('images',src.slice(12)); }
export function download(blob: Blob, filename: string) { const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
export async function downloadImage(src: string, name: string) {
 const blob=await imageBlob(src); if(!blob) throw new Error('本地图片资源缺失。');
 const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'} as Record<string,string>)[blob.type] || 'png'; download(blob,name+'.'+extension);
}
