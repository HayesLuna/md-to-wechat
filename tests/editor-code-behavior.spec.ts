import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
async function ready(page:Page,text:string){await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await page.evaluate(text=>(window as any).__mojian.setMarkdown(text),text);}
for(const [name,text] of [['paragraph','前面后面'],['bold','**前面后面**'],['heading','## 前面后面'],['bullet','- 前面后面'],['ordered','1. 前面后面'],['task','- [ ] 前面后面']])test(`${name}: Tab moves the visible caret and subsequent typing follows the tab`,async({page})=>{
 await ready(page,text);const from=await page.evaluate(()=>{const e=(window as any).__mojian.editor;let at=-1;e.state.doc.descendants((n:any,p:number)=>{if(n.isText&&n.text==='前面后面')at=p+2;});e.commands.setTextSelection(at);e.commands.focus();return at;});
 await expect(page.locator('.article-editor')).toBeFocused();const before=await page.evaluate(()=>window.getSelection()!.getRangeAt(0).getBoundingClientRect().left);await page.keyboard.press('Tab');
 const first=await page.evaluate(()=>({position:(window as any).__mojian.editor.state.selection.from,caret:window.getSelection()!.getRangeAt(0).getBoundingClientRect().left}));
 expect(first.position).toBe(from+1);expect(first.caret).toBeGreaterThan(before);
 await page.keyboard.press('Tab');expect(await page.evaluate(()=>(window as any).__mojian.editor.state.selection.from)).toBe(from+2);
 await page.keyboard.type('X');expect(await page.evaluate(()=>(window as any).__mojian.editor.state.doc.textContent)).toBe('前面\t\tX后面');expect(await page.evaluate(()=>(window as any).__mojian.editor.state.selection.from)).toBe(from+3);
});
for(const language of ['js','mermaid'])test(`${language}: Ctrl+A in the code view copies only raw code; cut and undo remain scoped`,async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);const source=language==='js'?'const first = 1;\nconst second = 2;':'graph LR\n  A[开始] --> B[结束]';
 await ready(page,`前面的正文\n\n\`\`\`${language}\n${source}\n\`\`\`\n\n后面的正文`);
 if(language==='mermaid')await page.getByRole('button',{name:'展示代码',exact:true}).click();
 await page.evaluate(()=>{const e=(window as any).__mojian.editor;let at=0;e.state.doc.descendants((n:any,p:number)=>{if(n.type.name==='codeBlock')at=p+1;});e.commands.setTextSelection(at);e.commands.focus();});await expect(page.locator('.article-editor')).toBeFocused();await page.keyboard.press('ControlOrMeta+a');await page.keyboard.press('ControlOrMeta+c');
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(source);
 await page.keyboard.press('ControlOrMeta+x');expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(source);await expect(page.locator('.article-editor pre')).toHaveText('');await expect(page.locator('.article-editor')).toContainText('前面的正文');await page.keyboard.press('ControlOrMeta+z');await expect(page.locator('.article-editor pre')).toHaveText(source);
 await page.evaluate(()=>(window as any).__mojian.editor.commands.selectAll());await page.keyboard.press('ControlOrMeta+c');const article=await page.evaluate(()=>navigator.clipboard.readText());expect(article).toContain('```'+language);expect(article).toContain('前面的正文');expect(article).toContain('后面的正文');
});
test('code view uses GitHub light highlighting while Mermaid diagram stays light',async({page})=>{
 await ready(page,'```js\n// 注释\nconst text = "hello";\nconsole.log(text);\n```\n\n```mermaid\ngraph LR\n  A --> B\n```');
 const code=page.locator('.code-node').first();await expect(code).toHaveClass(/code-theme-github/);
 await expect(code.locator('.hljs-keyword')).toHaveCSS('color','rgb(215, 58, 73)');
 const colors=await code.evaluate(el=>({background:getComputedStyle(el).backgroundColor,text:getComputedStyle(el.querySelector('pre')!).color,keyword:getComputedStyle(el.querySelector('.hljs-keyword')!).color,string:getComputedStyle(el.querySelector('.hljs-string')!).color,header:getComputedStyle(el.querySelector('.code-header')!).backgroundColor}));
 expect(colors).toEqual({background:'rgb(255, 255, 255)',text:'rgb(36, 41, 46)',keyword:'rgb(215, 58, 73)',string:'rgb(3, 47, 98)',header:'rgb(246, 248, 250)'});
 const mermaid=page.locator('.code-node').nth(1);await expect(mermaid).not.toHaveClass(/code-theme-github/);await mermaid.getByRole('button',{name:'展示代码',exact:true}).click();await expect(mermaid).toHaveClass(/code-theme-github/);await mermaid.getByRole('button',{name:'展示图表',exact:true}).click();await expect(mermaid).not.toHaveClass(/code-theme-github/);
});
for(const [name,markdown,from,to,expected] of [
 ['empty paragraph','',1,1,'\tX'],
 ['paragraph end','正文',3,3,'正文\tX'],
 ['heading end','## 标题',3,3,'标题\tX'],
 ['selected text','前面选中后面',3,5,'前面\tX后面'],
] as const)test(`${name}: Tab collapses the caret after insertion and typing follows it`,async({page})=>{
 await ready(page,markdown);await page.evaluate(({from,to})=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection({from,to});e.commands.focus();},{from,to});await expect(page.locator('.article-editor')).toBeFocused();await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>(window as any).__mojian.editor.state.selection.from)).toBe(from+1);
 const caret=await page.evaluate(()=>{const e=(window as any).__mojian.editor;const selection=window.getSelection()!;return {dom:selection.getRangeAt(0).getBoundingClientRect().left,model:e.view.coordsAtPos(e.state.selection.from).left};});expect(Math.abs(caret.dom-caret.model)).toBeLessThan(1);
 await page.keyboard.type('X');expect(await page.evaluate(()=>(window as any).__mojian.editor.state.doc.textContent)).toBe(expected);
});
test('backward code selection preserves tabs, NBSP and literal Markdown fences in copied text',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);const source='first\n\tcode\u00a0space\n```mermaid\nlast';await ready(page,'````txt\n'+source+'\n````');
 await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection({from:e.state.doc.firstChild.nodeSize-1,to:1});e.commands.focus();});await expect(page.locator('.article-editor')).toBeFocused();await page.keyboard.press('ControlOrMeta+c');expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(source);
});
