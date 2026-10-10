import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
async function ready(page:Page){await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await expect(page).toHaveTitle('墨笺 · Markdown 公众号排版');await expect(page.locator('.workspace')).toBeVisible();await expect(page.locator('vite-error-overlay')).toHaveCount(0);}
async function setDoc(page:Page,text:string){await page.evaluate(text=>(window as any).__mojian.setMarkdown(text),text);}
async function content(page:Page){return page.evaluate(()=>(window as any).__mojian.getMarkdown());}
async function box(page:Page){await page.getByRole('button',{name:'草稿箱',exact:true}).click();await expect(page.getByRole('dialog',{name:'草稿箱',exact:true})).toBeVisible();}

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
 await box(page);await page.getByRole('button',{name:'新建文章',exact:true}).click();await expect(page.locator('.toast')).toContainText(/操作未完成|保存失败/);await expect(page.locator('.draft-list li')).toHaveCount(1);await expect.poll(()=>content(page)).toContain('尚未保存的正文');await expect(page.getByRole('dialog',{name:'草稿箱'})).toBeVisible();
});

test('Mermaid blocks independently switch diagram/code, copy raw source and recover from errors; mobile drawer fits',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errors.push(m.text());});await ready(page);
 await setDoc(page,'```mermaid\nflowchart LR\nA-->B\n```\n\n```mermaid\nflowchart LR\nC-->D\n```');const blocks=page.locator('.code-node');await expect(blocks.first().locator('.diagram svg')).toBeVisible();await expect(blocks.first().locator('pre')).toBeHidden();
 const before=await content(page);await blocks.first().getByRole('button',{name:'展示代码',exact:true}).click();await expect(blocks.first().locator('pre')).toBeVisible();await expect(blocks.first().locator('.mermaid-editor-preview')).toHaveCount(0);await expect(blocks.nth(1).locator('.diagram svg')).toBeVisible();await blocks.first().getByRole('button',{name:'复制代码',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('flowchart LR\nA-->B');expect(await content(page)).toBe(before);
 await page.getByRole('button',{name:'公众号预览',exact:true}).click();const preview=page.locator('[data-mermaid-block]').first();await expect(preview.locator('svg')).toBeVisible();await preview.getByRole('button',{name:'代码',exact:true}).click();await expect(preview.locator('.mermaid-preview-code')).toBeVisible();await expect(preview.locator('svg')).toBeHidden();await expect(page.locator('[data-mermaid-block]').nth(1).locator('svg')).toBeVisible();await preview.getByRole('button',{name:'复制代码',exact:true}).click();expect((await page.evaluate(()=>navigator.clipboard.readText())).trim()).toBe('flowchart LR\nA-->B');
 expect(await page.evaluate(()=>(window as any).__mojian.getOutput().html)).not.toContain('data-mermaid-view');
 await page.screenshot({path:'/tmp/mojian-mermaid-toggle.png'});await page.getByRole('button',{name:'关闭预览',exact:true}).first().click();await setDoc(page,'```mermaid\ninvalid syntax !!!\n```');await expect(page.locator('.diagram-error')).toContainText('语法有误');await expect(page.locator('.code-node pre')).toBeVisible();
 await page.setViewportSize({width:390,height:844});await box(page);await expect(page.getByRole('button',{name:'新建文章'})).toBeVisible();const bounds=await page.locator('.draft-drawer').boundingBox();expect(bounds!.x).toBe(0);expect(bounds!.width).toBeLessThanOrEqual(390);await page.screenshot({path:'/tmp/mojian-drafts-mobile.png'});await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);expect(errors).toEqual([]);
});
