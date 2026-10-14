import { test, expect } from './fixtures';

test('storage reuses connections, deduplicates image loads and releases connections for upgrades',async({page})=>{
 await page.route('**/storage-check',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));
 await page.goto('/storage-check');
 const result=await page.evaluate(async()=>{
  const storage=await import('/src/storage.ts');
  const {DEFAULT_SETTINGS}=await import('/src/sample.ts');
  const open=indexedDB.open.bind(indexedDB);let opens=0;
  indexedDB.open=((...args:Parameters<typeof open>)=>{opens++;return open(...args);}) as typeof open;
  const canvas=document.createElement('canvas');canvas.width=10;canvas.height=10;
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));
  const src=await storage.storeImage(blob);
  let reads=0;const get=IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get=function(key){if(this.name==='images')reads++;return get.call(this,key);};
  const draft=storage.newDraft('# Test\n\n![image]('+src+')',DEFAULT_SETTINGS);
  await storage.saveDraft(draft);await storage.saveDraft({...draft,version:draft.version+1});
  const saveImageReads=reads;
  const urls=await Promise.all(Array.from({length:8},()=>storage.imageURL(src)));
  const imageReads=reads;const loaded=await (await fetch(urls[0])).blob();
  const restored=await storage.loadDrafts();
  // A missing image must be retried if the resource becomes available later.
  const missing=await storage.imageURL('local-image:restored');
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=open('mojian-v1',3);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise<void>((resolve,reject)=>{const tx=database.transaction('images','readwrite');tx.objectStore('images').put(blob,'restored');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});database.close();
  const recovered=await storage.imageURL('local-image:restored');
  // This upgrade would hang if the app kept any old connections open.
  await new Promise<void>((resolve,reject)=>{const request=open('mojian-v1',4);request.onsuccess=()=>{request.result.close();resolve();};request.onerror=()=>reject(request.error);});
  return {opens,saveImageReads,imageReads,uniqueURLs:new Set(urls).size,bytes:loaded.size,expectedBytes:blob.size,markdown:restored.drafts[0].markdown,expectedMarkdown:draft.markdown,missing,recovered};
 });
 expect(result.opens).toBe(1);expect(result.saveImageReads).toBe(0);expect(result.imageReads).toBe(1);expect(result.uniqueURLs).toBe(1);expect(result.bytes).toBe(result.expectedBytes);expect(result.markdown).toBe(result.expectedMarkdown);expect(result.missing).toBe('');expect(result.recovered).toMatch(/^blob:/);
});

test('conflicting writes reject without changing content or active draft; deletion keeps the latest retained draft',async({page})=>{
 await page.route('**/storage-conflicts',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto('/storage-conflicts');
 const result=await page.evaluate(async()=>{
  const s=await import('/src/storage.ts');const {DEFAULT_SETTINGS}=await import('/src/sample.ts');
  const original={...s.newDraft('# 原稿',DEFAULT_SETTINGS),version:10};
  const other={...s.newDraft('# 其他文章',DEFAULT_SETTINGS),version:10};
  await s.saveDraft(original);await s.saveDraft(other);
  const latest={...original,markdown:'# 新内容',title:'新内容',version:20};await s.saveDraft(latest,10);await s.saveDraft(other,10);
  const conflicts:boolean[]=[];
  for(const [draft,expected] of [
   [{...original,markdown:'# 旧版本修改',version:11},undefined],
   [{...original,markdown:'# 相同版本修改',version:20},undefined],
   [{...original,markdown:'# 基于旧快照的新版本',version:30},10],
  ] as const){try{await s.saveDraft(draft,expected);conflicts.push(false);}catch(e){conflicts.push(e instanceof s.DraftConflictError);}}
  const before=await s.loadDrafts();const retained=await s.removeDraft(other.id,original);const after=await s.loadDrafts();
  await s.removeDraft(original.id,s.newDraft('',DEFAULT_SETTINGS));
  let deletedConflict=false;try{await s.saveDraft({...original,version:40},20);}catch(e){deletedConflict=e instanceof s.DraftConflictError;}
  return {conflicts,activeUnchanged:before.activeId===other.id,retained:retained.markdown,content:after.drafts[0].markdown,count:after.drafts.length,deletedConflict};
 });
 expect(result).toEqual({conflicts:[true,true,true],activeUnchanged:true,retained:'# 新内容',content:'# 新内容',count:1,deletedConflict:true});
});

test('local image URLs stay valid while owned and are released after all views close',async({page})=>{
 await page.route('**/image-lifecycle',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto('/image-lifecycle');await page.clock.install();
 await page.evaluate(async()=>{
  const s=await import('/src/storage.ts');const canvas=document.createElement('canvas');canvas.width=10;canvas.height=10;
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));
  const src=await s.storeImage(blob);const first=await s.acquireImageURL(src);const second=await s.acquireImageURL(src);const fullscreen=s.retainImageURL(first.url);
  const revoked:string[]=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{revoked.push(url);revoke(url);};
  Object.assign(window,{imageLifecycle:{src,first,second,fullscreen,revoked}});
 });
 await page.clock.fastForward(31_000);
 expect(await page.evaluate(()=>(window as any).imageLifecycle.revoked)).toEqual([]);
 await page.evaluate(()=>{const t=(window as any).imageLifecycle;t.first.release();t.first.release();t.second.release();});
 await page.clock.fastForward(31_000);
 expect(await page.evaluate(()=>(window as any).imageLifecycle.revoked)).toEqual([]);
 await page.evaluate(()=>(window as any).imageLifecycle.fullscreen());await page.clock.fastForward(31_000);
 const result=await page.evaluate(async()=>{const t=(window as any).imageLifecycle;const s=await import('/src/storage.ts');const renewed=await s.acquireImageURL(t.src);const bytes=(await(await fetch(renewed.url)).blob()).size;renewed.release();return {same:t.first.url===t.second.url,revoked:t.revoked,old:t.first.url,newURL:renewed.url,bytes};});
 expect(result.same).toBe(true);expect(result.revoked).toEqual([result.old]);expect(result.newURL).not.toBe(result.old);expect(result.bytes).toBeGreaterThan(0);
});
