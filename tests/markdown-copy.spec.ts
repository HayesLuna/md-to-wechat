import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
async function ready(page:Page,text:string){await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await page.evaluate(text=>(window as any).__mojian.setMarkdown(text),text);}
async function copy(page:Page,type='copy'){return page.evaluate(type=>{const editor=(window as any).__mojian.editor;editor.commands.focus(undefined,{scrollIntoView:false});const data=new DataTransfer();editor.view.dom.dispatchEvent(new ClipboardEvent(type,{clipboardData:data,bubbles:true,cancelable:true}));return {text:data.getData('text/plain'),html:data.getData('text/html'),markdown:(window as any).__mojian.getMarkdown()};},type);}
async function selectText(page:Page,text:string,start=0,end=text.length){await page.evaluate(({text,start,end})=>{const editor=(window as any).__mojian.editor;let from=-1;editor.state.doc.descendants((node:any,pos:number)=>{if(from<0&&node.isText&&node.text.includes(text))from=pos+node.text.indexOf(text);});if(from<0)throw new Error('Missing selection text');editor.commands.setTextSelection({from:from+start,to:from+end});},{text,start,end});}
test('WYSIWYG copy writes Markdown text and retains native rich HTML for a full selection',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await ready(page,'# 标题\n\n正文 **加粗** 和 *斜体*、[链接](https://example.com)\n\n- 项目一\n  - 嵌套项目\n\n1. 有序项\n\n> 引用\n\n| 名称 | 值 |\n| :---: | ---: |\n| 表格内容 | 123 |\n\n```js\nconst value = 1;\n```');
 const before=await page.evaluate(()=>(window as any).__mojian.getMarkdown());await page.locator('.article-editor').click();await page.evaluate(()=>(window as any).__mojian.editor.commands.selectAll());
 await page.keyboard.press('ControlOrMeta+c');
 const data=await page.evaluate(async()=>{const item=(await navigator.clipboard.read())[0];return {text:await(await item.getType('text/plain')).text(),html:await(await item.getType('text/html')).text()};});
 for(const part of ['# 标题','**加粗**','*斜体*','[链接](https://example.com)','- 项目一','嵌套项目','1. 有序项','> 引用','| 名称','```js','const value = 1;'])expect(data.text).toContain(part);
 expect(data.text).toMatch(/:\-{3,}:/);
 for(const tag of ['<h1','<strong','<ul','<ol','<table','<pre'])expect(data.html).toContain(tag);
 expect(await page.evaluate(()=>(window as any).__mojian.getMarkdown())).toBe(before);
});
test('partial selections copy only selected text while retaining heading, list and inline marks',async({page})=>{
 await ready(page,'## 大纲标题\n\n普通 **加粗文字** 段落\n\n- 第一项目\n- 第二项目\n\n```js\nconst first = 1;\nconst second = 2;\n```');
 await selectText(page,'加粗文字',1,3);expect((await copy(page)).text.trim()).toBe('**粗文**');
 await selectText(page,'大纲标题',0,2);expect((await copy(page)).text.trim()).toBe('## 大纲');
 await selectText(page,'第二项目');const list=await copy(page);expect(list.text).toContain('- 第二项目');expect(list.text).not.toContain('第一项目');
 await selectText(page,'const second = 2;');const code=await copy(page);expect(code.text).toContain('```js');expect(code.text).toContain('const second = 2;');expect(code.text).not.toContain('const first');
});
test('selected tables copy GFM alignment and cut keeps Markdown and undo behavior',async({page})=>{
 await ready(page,'| 名称 | 数值 |\n| :---: | ---: |\n| 项目 | 123 |\n\n前面 **剪切文字** 后面');
 await page.evaluate(()=>{const editor=(window as any).__mojian.editor;let pos=0;editor.state.doc.descendants((n:any,p:number)=>{if(n.type.name==='table')pos=p;});editor.commands.setNodeSelection(pos);});
 const table=await copy(page);expect(table.text).toContain('| 名称');expect(table.text).toContain(':---:');expect(table.text).toContain('---:');expect(table.html).toContain('<table');
 await selectText(page,'剪切文字');const cut=await copy(page,'cut');expect(cut.text.trim()).toBe('**剪切文字**');await expect(page.locator('.article-editor')).not.toContainText('剪切文字');await page.keyboard.press('ControlOrMeta+z');await expect(page.locator('.article-editor')).toContainText('剪切文字');
});

test('copied prose uses ordinary spaces while intentional code and source NBSP remain unchanged',async({page})=>{
 await ready(page,'# 标题\n\n正文\n\n```txt\n代码\n```');
 await page.evaluate(()=>{const editor=(window as any).__mojian.editor;editor.commands.setContent({type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'标题\u00a0文字'}]},{type:'paragraph',content:[{type:'text',text:'普通\u00a0\u00a0空格'},{type:'text',text:'加粗\u00a0文字',marks:[{type:'bold'}]},{type:'text',text:'inline\u00a0code',marks:[{type:'code'}]},{type:'text',text:'字面 &nbsp;'}]},{type:'codeBlock',attrs:{language:'txt'},content:[{type:'text',text:'code\u00a0space'}]}]});editor.commands.selectAll();});
 const before=await page.evaluate(()=>(window as any).__mojian.editor.getJSON());const result=await copy(page);
 expect(result.text).toContain('## 标题 文字');expect(result.text).toContain('普通  空格');expect(result.text).toContain('**加粗 文字**');expect(result.text).toContain('`inline\u00a0code`');expect(result.text).toContain('code\u00a0space');expect(result.text).toContain('nbsp;');
 expect(result.text.match(/\u00a0/g)).toHaveLength(2);expect(await page.evaluate(()=>(window as any).__mojian.editor.getJSON())).toEqual(before);
});
