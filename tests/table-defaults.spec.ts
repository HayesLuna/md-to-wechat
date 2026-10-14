import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
const raw=(page:Page)=>page.evaluate(()=>(window as any).__mojian.getMarkdown());
async function setDoc(page:Page,text:string){await page.evaluate((text:string)=>(window as any).__mojian.setMarkdown(text),text);}
test('new tables, added rows and columns default to center with undo and Markdown persistence',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await setDoc(page,'');
 const cells=page.locator('.article-editor th,.article-editor td');const centered=async()=>expect(await cells.evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).textAlign==='center'))).toBe(true);
 await page.getByRole('button',{name:'插入表格',exact:true}).click();await expect(cells).toHaveCount(9);await centered();
 await cells.nth(3).click();await page.getByRole('button',{name:'下方添加行',exact:true}).click();await expect(cells).toHaveCount(12);await centered();await page.keyboard.press('ControlOrMeta+z');await expect(cells).toHaveCount(9);
 await setDoc(page,'| 左 | 右 |\n| :--- | ---: |\n| 甲 | 乙 |');await page.locator('.article-editor td').first().click();
 await page.getByRole('button',{name:'右侧添加列',exact:true}).click();await expect(cells).toHaveCount(6);
 expect(await cells.evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).textAlign))).toEqual(['left','center','right','left','center','right']);expect(await raw(page)).toContain(':---:');
 await page.keyboard.press('ControlOrMeta+z');await expect(cells).toHaveCount(4);await expect(page.locator('.article-editor th').last()).toHaveCSS('text-align','right');
 await page.locator('.article-editor td').first().click();await page.getByRole('button',{name:'下方添加行',exact:true}).click();await expect(cells).toHaveCount(6);await centered();expect((await raw(page)).match(/:---:/g)).toHaveLength(2);
 await page.keyboard.press('ControlOrMeta+z');await expect(cells).toHaveCount(4);await expect(page.locator('.article-editor th').last()).toHaveCSS('text-align','right');
 await page.locator('.article-editor td').first().click();await page.getByRole('button',{name:'下方添加行',exact:true}).click();
 const markdown=await raw(page);await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();await page.getByRole('button',{name:'所见即所得',exact:true}).click();expect(await raw(page)).toBe(markdown);await centered();
 await page.keyboard.press('ControlOrMeta+s');await expect(page.locator('.save-indicator')).toContainText('已保存');await page.reload();await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await centered();await expect(cells).toHaveCount(6);
 await page.getByRole('button',{name:'公众号预览',exact:true}).click();await expect(page.locator('.preview-paper th').first()).toHaveCSS('text-align','center');await expect(page.locator('.preview-paper td').first()).toHaveCSS('text-align','center');
});
test('Tab at the last table cell creates a centered row in one undoable edit',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await setDoc(page,'| 标题 |\n| --- |\n| 正文 |');const before=await page.evaluate(()=>(window as any).__mojian.editor.state.doc.firstChild.toJSON());
 await page.locator('.article-editor td').click();await page.keyboard.press('End');await page.keyboard.press('Tab');await expect(page.locator('.article-editor tr')).toHaveCount(3);
 expect(await page.locator('.article-editor th,.article-editor td').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).textAlign==='center'))).toBe(true);
 await page.keyboard.press('ControlOrMeta+z');await expect(page.locator('.article-editor tr')).toHaveCount(2);expect(await page.evaluate(()=>(window as any).__mojian.editor.state.doc.firstChild.toJSON())).toEqual(before);
});
