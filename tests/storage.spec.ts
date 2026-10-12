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
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=open('mojian-v1',2);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise<void>((resolve,reject)=>{const tx=database.transaction('images','readwrite');tx.objectStore('images').put(blob,'restored');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});database.close();
  const recovered=await storage.imageURL('local-image:restored');
  // This upgrade would hang if the app kept any old connections open.
  await new Promise<void>((resolve,reject)=>{const request=open('mojian-v1',3);request.onsuccess=()=>{request.result.close();resolve();};request.onerror=()=>reject(request.error);});
  return {opens,saveImageReads,imageReads,uniqueURLs:new Set(urls).size,bytes:loaded.size,expectedBytes:blob.size,markdown:restored.drafts[0].markdown,expectedMarkdown:draft.markdown,missing,recovered};
 });
 expect(result.opens).toBe(1);expect(result.saveImageReads).toBe(0);expect(result.imageReads).toBe(1);expect(result.uniqueURLs).toBe(1);expect(result.bytes).toBe(result.expectedBytes);expect(result.markdown).toBe(result.expectedMarkdown);expect(result.missing).toBe('');expect(result.recovered).toMatch(/^blob:/);
});
