import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
async function ready(page:Page){await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await expect(page).toHaveTitle('墨笺 · Markdown 公众号排版');await expect(page.locator('.workspace')).toBeVisible();await expect(page.locator('vite-error-overlay')).toHaveCount(0);}
async function setDoc(page:Page,text:string){await page.evaluate(text=>(window as any).__mojian.setMarkdown(text),text);}
async function content(page:Page){return page.evaluate(()=>(window as any).__mojian.getMarkdown());}
async function box(page:Page){if(!await page.getByRole('complementary',{name:'文章导航'}).isVisible())await page.getByRole('button',{name:'展开侧栏',exact:true}).click();if(await page.getByRole('button',{name:'切换到草稿',exact:true}).isVisible())await page.getByRole('button',{name:'切换到草稿',exact:true}).click();if(!await page.getByRole('textbox',{name:'搜索草稿标题',exact:true}).isVisible())await page.getByRole('button',{name:'搜索草稿',exact:true}).click();await expect(page.getByRole('region',{name:'草稿箱',exact:true})).toBeVisible();}

test('drafts preserve immediate edits, titles, settings and active article across refresh; search and deletion',async({page})=>{
 test.setTimeout(60000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errors.push(m.text());});
 await ready(page);await setDoc(page,'# 第一篇\n\n第一篇正文');await page.getByRole('button',{name:'公众号预览',exact:true}).click();await page.getByRole('button',{name:'雅致',exact:true}).click();await page.getByRole('button',{name:'关闭预览',exact:true}).first().click();await box(page);await page.getByRole('button',{name:'新建文章',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect.poll(()=>content(page)).toBe('');
 await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();await page.getByRole('textbox',{name:'Markdown 源码正文',exact:true}).fill('# 第二篇\n\n第二篇正文');await page.getByRole('button',{name:'公众号预览',exact:true}).click();await page.getByRole('button',{name:'简约',exact:true}).click();await page.getByRole('button',{name:'关闭预览',exact:true}).first().click();
 await box(page);await expect(page.locator('.draft-list li')).toHaveCount(2);
 await page.locator('.draft-select').filter({hasText:'第一篇'}).click();await expect.poll(()=>content(page)).toContain('第一篇正文');expect(await page.evaluate(()=>(window as any).__mojian.getSettings().theme)).toBe('elegant');
 await page.getByRole('button',{name:'所见即所得',exact:true}).click();await expect(page.locator('.article-editor h1')).toHaveText('第一篇');await page.keyboard.press('Control+z');await expect.poll(()=>content(page)).toContain('第一篇正文');
 await box(page);await page.getByRole('button',{name:'重命名 第一篇',exact:true}).click();await page.getByRole('textbox',{name:'文章标题',exact:true}).fill('写作笔记');await page.getByRole('button',{name:'保存标题',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'重命名文章'})).toHaveCount(0);await page.getByRole('textbox',{name:'搜索草稿标题'}).fill('写作');await expect(page.locator('.draft-list li')).toHaveCount(1);await expect(page.locator('.draft-select')).toContainText('写作笔记');
 await page.screenshot({path:'/tmp/mojian-drafts-desktop.png'});await page.keyboard.press('Escape');await page.reload();await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await expect(page.locator('.article-editor h1')).toHaveText('第一篇');
 await box(page);await page.getByRole('button',{name:'删除 写作笔记',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.draft-list li')).toHaveCount(2);
 await page.getByRole('button',{name:'删除 写作笔记',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await expect(page.locator('.draft-list li')).toHaveCount(1);await expect.poll(()=>content(page)).toContain('第二篇正文');
 await page.keyboard.press('Escape');await page.reload();await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await expect(page.locator('.article-editor h1')).toHaveText('第二篇');
 await box(page);await page.getByRole('button',{name:'删除 第二篇',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await expect(page.locator('.draft-list li')).toHaveCount(1);await expect.poll(()=>content(page)).toBe('');
 expect(errors).toEqual([]);
});

test('legacy draft and local images migrate without replacing content or settings',async({page})=>{
 await page.route('**/seed-empty',r=>r.fulfill({contentType:'text/html',body:'<html><title>seed</title></html>'}));await page.goto('/seed-empty');
 await page.evaluate(async()=>{
  await new Promise<void>((resolve,reject)=>{const req=indexedDB.deleteDatabase('mojian-v1');req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);});
  await new Promise<void>((resolve,reject)=>{const req=indexedDB.open('mojian-v1',1);req.onupgradeneeded=()=>{req.result.createObjectStore('draft');req.result.createObjectStore('images');};req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result;const tx=db.transaction(['draft','images'],'readwrite');tx.objectStore('draft').put({markdown:'# 旧文章\n\n![旧图片](local-image:old-image)',settings:{theme:'elegant',color:'#123456',fontSize:18,lineHeight:2,codeTheme:'dark'},version:1,savedAt:1},'current');tx.objectStore('images').put(new Blob(['old image bytes'],{type:'image/png'}),'old-image');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
 });
 await ready(page);await expect(page.locator('.article-editor h1')).toHaveText('旧文章');await expect.poll(()=>page.evaluate(()=>(window as any).__mojian.getSettings().fontSize)).toBe(18);await box(page);await expect(page.locator('.draft-list li')).toHaveCount(1);await expect(page.locator('.draft-select')).toContainText('旧文章');
 expect(await page.evaluate(async()=>{const {imageBlob}=await import('/src/storage.ts');return (await imageBlob('local-image:old-image'))?.size;})).toBe(15);
});

test('failed save blocks switching and creation, preserving current content',async({page})=>{
 await ready(page);await setDoc(page,'# 不能丢失\n\n尚未保存的正文');
 await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:any[]){if(this.name==='draft')throw new DOMException('quota','QuotaExceededError');return (original as any).apply(this,args);};});
 await box(page);await page.getByRole('button',{name:'新建文章',exact:true}).click();await expect(page.locator('.toast')).toContainText(/操作未完成|保存失败/);await expect(page.locator('.draft-list li')).toHaveCount(1);await expect.poll(()=>content(page)).toContain('尚未保存的正文');await expect(page.getByRole('region',{name:'草稿箱'})).toBeVisible();
});

test('Mermaid editor switches diagram/code while article preview shows diagrams only; mobile drawer fits',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errors.push(m.text());});await ready(page);
 await setDoc(page,'```mermaid\nflowchart LR\nA-->B\n```\n\n```mermaid\nflowchart LR\nC-->D\n```');const blocks=page.locator('.code-node');await expect(blocks.first().locator('.diagram svg')).toBeVisible();await expect(blocks.first().locator('pre')).toBeHidden();
 const before=await content(page);await blocks.first().getByRole('button',{name:'展示代码',exact:true}).click();await expect(blocks.first().locator('pre')).toBeVisible();await expect(blocks.first().locator('.mermaid-editor-preview')).toHaveCount(0);await expect(blocks.nth(1).locator('.diagram svg')).toBeVisible();await blocks.first().getByRole('button',{name:'复制代码',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('flowchart LR\nA-->B');expect(await content(page)).toBe(before);
 await page.getByRole('button',{name:'公众号预览',exact:true}).click();const preview=page.locator('[data-mermaid-block]').first();await expect(preview.locator('svg')).toBeVisible();await expect(preview.locator('button,pre')).toHaveCount(0);await expect(page.locator('[data-mermaid-block]').nth(1).locator('svg')).toBeVisible();await preview.getByRole('button',{name:'预览 Mermaid 图表',exact:true}).click();await expect(page.getByRole('region',{name:'图表预览'}).locator('img')).toBeVisible();await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>(window as any).__mojian.getOutput().html)).not.toContain('data-mermaid-view');
 await page.screenshot({path:'/tmp/mojian-mermaid-toggle.png'});await page.getByRole('button',{name:'关闭预览',exact:true}).first().click();await setDoc(page,'```mermaid\ninvalid syntax !!!\n```');await expect(page.locator('.diagram-error')).toContainText('语法有误');await expect(page.locator('.code-node pre')).toBeVisible();
 await page.setViewportSize({width:390,height:844});await expect(page.locator('.document-sidebar')).toHaveCount(0);await box(page);await expect(page.getByRole('button',{name:'新建文章'})).toBeVisible();const bounds=await page.locator('.document-sidebar').boundingBox();const body=await page.locator('.writing-body').boundingBox();expect(bounds!.x).toBe(body!.x);expect(bounds!.y).toBe(body!.y);expect(bounds!.width).toBeLessThanOrEqual(390);await page.screenshot({path:'/tmp/mojian-drafts-mobile.png'});await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);expect(errors).toEqual([]);
});

test('another tab update cannot be reported saved or discarded by switching',async({page,context})=>{
 await ready(page);await setDoc(page,'# 不能丢失');await page.keyboard.press('ControlOrMeta+s');await expect(page.locator('.save-indicator')).toContainText('已保存');
 const tab=await context.newPage();await tab.route('**/other-tab',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await tab.goto(new URL('/other-tab',page.url()).href);
 await tab.evaluate(async()=>{const s=await import('/src/storage.ts');const lib=await s.loadDrafts();const d=lib.drafts.find(d=>d.id===lib.activeId)!;await s.saveDraft({...d,markdown:'# 其他页面的新稿',title:'其他页面的新稿',version:d.version+100},d.version);});
 await page.bringToFront();await setDoc(page,'# 本页未保存内容');await page.keyboard.press('ControlOrMeta+s');await expect(page.locator('.save-indicator')).toContainText('保存失败');await expect(page.locator('.toast')).toContainText('其他页面更新');
 await box(page);await page.getByRole('button',{name:'新建文章',exact:true}).click();expect(await content(page)).toBe('# 本页未保存内容');await expect(page.locator('.draft-list li')).toHaveCount(1);
 expect(await tab.evaluate(async()=>{const s=await import('/src/storage.ts');return (await s.loadDrafts()).drafts[0].markdown;})).toBe('# 其他页面的新稿');
});

test('queued saves retain the last edit and selecting a draft reads another tab latest content',async({page,context})=>{
 await ready(page);await setDoc(page,'# 第一篇');await page.keyboard.press('ControlOrMeta+s');await expect(page.locator('.save-indicator')).toContainText('已保存');
 await box(page);await page.getByRole('button',{name:'新建文章',exact:true}).click();await expect.poll(()=>content(page)).toBe('');
 // Queue all snapshots in one event loop turn, before IndexedDB can complete the first write.
 await page.evaluate(()=>{for(const text of ['# 第二篇','## 连续修改一','## 连续修改二']){(window as any).__mojian.setMarkdown(text);window.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true}));}});
 await expect(page.locator('.save-indicator')).toContainText('已保存');expect(await page.evaluate(async()=>{const s=await import('/src/storage.ts');const lib=await s.loadDrafts();return lib.drafts.find(d=>d.id===lib.activeId)!.markdown;})).toBe('## 连续修改二');
 const tab=await context.newPage();await tab.route('**/other-tab',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await tab.goto(new URL('/other-tab',page.url()).href);
 await tab.evaluate(async()=>{const s=await import('/src/storage.ts');const d=(await s.loadDrafts()).drafts.find(d=>d.title==='第一篇')!;await s.saveDraft({...d,markdown:'# 第一篇\n\n另一页面修改',version:d.version+100},d.version);});
 await page.bringToFront();await page.locator('.draft-select').filter({hasText:'第一篇'}).click();await expect.poll(()=>content(page)).toContain('另一页面修改');await expect(page.locator('.save-indicator')).toContainText('已保存');
});

test('deleting another draft does not advance the current editor past an unseen concurrent update',async({page})=>{
 await ready(page);await setDoc(page,'# 保留文章');await page.keyboard.press('ControlOrMeta+s');await expect(page.locator('.save-indicator')).toContainText('已保存');await box(page);
 await page.getByRole('button',{name:'新建文章',exact:true}).click();await expect.poll(()=>content(page)).toBe('');await setDoc(page,'# 删除文章');await page.keyboard.press('ControlOrMeta+s');await expect(page.locator('.save-indicator')).toContainText('已保存');
 await page.locator('.draft-select').filter({hasText:'保留文章'}).click();await expect.poll(()=>content(page)).toBe('# 保留文章');
 await page.getByRole('button',{name:'删除 删除文章',exact:true}).click();
 await page.evaluate(async()=>{
  const s=await import('/src/storage.ts');const lib=await s.loadDrafts();const current=lib.drafts.find(d=>d.id===lib.activeId)!;
  const original=IDBDatabase.prototype.transaction;let writes=0;
  IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>){
   if(args[1]==='readwrite'&&Array.isArray(args[0])&&args[0].includes('draft')&&++writes===2){
    IDBDatabase.prototype.transaction=original;
    // Queue another tab's write immediately before the deletion transaction.
    const concurrent=original.call(this,['draft'],'readwrite');
    concurrent.objectStore('draft').put({...current,markdown:'# 并发更新的新稿',title:'并发更新的新稿',version:current.version+100},current.id);
   }
   return original.apply(this,args);
  };
 });
 await page.getByRole('button',{name:'确认删除',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.draft-list li')).toHaveCount(1);
 await page.keyboard.press('ControlOrMeta+s');await expect(page.locator('.save-indicator')).toContainText('保存失败');expect(await content(page)).toBe('# 保留文章');
 expect(await page.evaluate(async()=>{const s=await import('/src/storage.ts');return (await s.loadDrafts()).drafts[0].markdown;})).toBe('# 并发更新的新稿');
});
