import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
async function ready(page:Page){await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await expect(page).toHaveTitle('墨笺 · Markdown 公众号排版');await expect(page.locator('vite-error-overlay')).toHaveCount(0);}
async function setDoc(page:Page,text:string){await page.evaluate(text=>(window as any).__mojian.setMarkdown(text),text);}
async function markdown(page:Page){return page.evaluate(()=>(window as any).__mojian.getMarkdown());}

test('Esc closes a diagram preview without scrolling to a distant editor caret',async({page})=>{
 await ready(page);await setDoc(page,Array.from({length:8},(_,i)=>`开头段落 ${i}`).join('\n\n')+'\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n'+Array.from({length:100},(_,i)=>`后面的段落 ${i}`).join('\n\n'));
 const trigger=page.getByRole('button',{name:'预览 Mermaid 图表',exact:true});await expect(trigger.locator('svg')).toBeVisible();
 await page.evaluate(()=>(window as any).__mojian.editor.commands.focus('end'));await expect(page.locator('.article-editor')).toBeFocused();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await trigger.scrollIntoViewIfNeeded();const scroll=page.locator('.writing-scroll');const before=await scroll.evaluate(el=>el.scrollTop);
 const selection=await page.evaluate(()=>(window as any).__mojian.editor.state.selection.toJSON());
 await trigger.click();await expect(page.getByRole('region',{name:'图表预览'}).locator('img')).toBeVisible();await page.keyboard.press('Escape');
 await expect(page.locator('.media-preview-screen')).toHaveCount(0);await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBe(before);
 expect(await page.evaluate(()=>(window as any).__mojian.editor.state.selection.toJSON())).toEqual(selection);
});

test('bare image preview preserves content, Ctrl-wheel zooms, normal wheel scrolls, drag pans and closing restores focus',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
 const src=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=900;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#e8f2ff';ctx.fillRect(0,0,1600,900);const blob=await new Promise<Blob>(r=>canvas.toBlob(b=>r(b!)));const {storeImage}=await import('/src/storage.ts');return storeImage(blob);});
 await setDoc(page,`![本地图](${src} "width=40%")`);const before=await markdown(page);
 await page.locator('.image-box img').click();const screen=page.getByRole('region',{name:'图片预览',exact:true});const image=screen.locator('img');await expect(image).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(screen.getByRole('button')).toHaveCount(1);await expect(screen.getByRole('spinbutton')).toHaveCount(0);await expect(screen.locator('.media-preview-toolbar')).toHaveCount(0);await expect(screen).toHaveCSS('background-color','rgba(0, 0, 0, 0.86)');
 const bounds=await screen.boundingBox();expect(bounds!.width).toBe(1440);expect(bounds!.height).toBe(1000);
 const selection=await page.evaluate(()=>(window as any).__mojian.editor.state.selection.toJSON());const width=()=>image.evaluate(img=>img.getBoundingClientRect().width);const initial=await width();
 await page.mouse.move(900,550);await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.keyboard.up('Control');await expect.poll(width).toBeGreaterThan(initial);const enlarged=await width();await page.mouse.wheel(0,120);expect(await width()).toBe(enlarged);
 await page.keyboard.down('Control');for(let i=0;i<3;i++)await page.mouse.wheel(0,-120);await page.keyboard.up('Control');await expect.poll(width).toBeGreaterThan(1600);
 const view=screen.locator('.media-preview-viewport');const left=await view.evaluate(el=>el.scrollLeft);await page.mouse.move(900,500);await page.mouse.down();await page.mouse.move(800,450,{steps:4});await page.mouse.up();await expect.poll(()=>view.evaluate(el=>el.scrollLeft)).toBeGreaterThan(left);await expect(screen).toBeVisible();
 await image.click();await expect(screen).toBeVisible();expect(await markdown(page)).toBe(before);await page.keyboard.press('Escape');await expect(screen).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__mojian.editor.state.selection.toJSON())).toEqual(selection);
 await expect(page.getByRole('spinbutton',{name:'图片宽度百分比'})).toBeVisible();expect(errors).toEqual([]);
});

test('Mermaid and article media use the same uncluttered preview on desktop and mobile',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);await setDoc(page,'# 点击预览\n\n![网络图片](https://raw.githubusercontent.com/github/explore/main/topics/markdown/markdown.png)\n\n```mermaid\nflowchart TD\n打开草稿-->编辑文章-->预览图表-->发布文章\n```');
 const trigger=page.getByRole('button',{name:'预览 Mermaid 图表',exact:true});await expect(trigger.locator('svg')).toBeVisible();await trigger.focus();await page.keyboard.press('Enter');const screen=page.getByRole('region',{name:'图表预览',exact:true});await expect(screen.locator('img')).toBeVisible();await expect(screen.getByRole('button')).toHaveCount(1);await expect(page.getByRole('dialog')).toHaveCount(0);await screen.getByRole('button',{name:'关闭预览'}).click();await expect(trigger).toBeFocused();
 await page.getByRole('button',{name:'公众号预览',exact:true}).click();const paper=page.getByLabel('公众号排版正文',{exact:true});await expect(paper.locator('[data-media-preview=diagram] svg')).toBeVisible();const before=await markdown(page);
 await paper.getByRole('button',{name:'预览图片：网络图片',exact:true}).click();await expect(page.getByRole('region',{name:'图片预览'}).locator('img')).toBeVisible();await page.locator('.media-preview-content').click({position:{x:2,y:2}});await expect(page.locator('.media-preview-screen')).toHaveCount(0);
 await paper.getByRole('button',{name:'预览 Mermaid 图表',exact:true}).focus();await page.keyboard.press('Space');await expect(screen.locator('img')).toBeVisible();await page.keyboard.press('Tab');expect(await screen.evaluate(el=>el.contains(document.activeElement))).toBe(true);await page.screenshot({path:'/tmp/mojian-media-desktop.png'});
 await page.setViewportSize({width:390,height:844});await expect(screen.locator('img')).toBeVisible();const bounds=await screen.boundingBox();expect(bounds!.x).toBe(0);expect(bounds!.y).toBe(0);expect(bounds!.width).toBe(390);expect(bounds!.height).toBe(844);await expect.poll(()=>screen.locator('img').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThanOrEqual(844);await page.screenshot({path:'/tmp/mojian-media-mobile.png'});await page.keyboard.press('Escape');await expect(screen).toHaveCount(0);
 expect(await markdown(page)).toBe(before);const html=await page.evaluate(()=>(window as any).__mojian.getOutput().html);expect(html).not.toContain('data-media-preview');expect(html).not.toContain('role="button"');expect(html).not.toContain('media-preview');expect(errors).toEqual([]);
});
