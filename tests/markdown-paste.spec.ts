import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const sample=readFileSync(new URL('./fixtures/typora-paste.md',import.meta.url),'utf8');
async function ready(page:Page,text=''){await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await page.evaluate(text=>(window as any).__mojian.setMarkdown(text),text);await page.locator('.article-editor').click();}
async function paste(page:Page,text:string,html=''){await page.evaluate(({text,html})=>{const data=new DataTransfer();data.setData('text/plain',text);if(html)data.setData('text/html',html);(window as any).__mojian.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},{text,html});}
for(const wrapper of [false,true])test(`Typora Markdown paste renders the reported document ${wrapper?'with a plain HTML wrapper':'as plain text'}`,async({page})=>{
 await ready(page);const html=wrapper?'<div>'+sample.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')+'</div>':'';await paste(page,sample,html);
 await expect(page.locator('.article-editor h1')).toHaveText('添加底价需求');await expect(page.locator('.article-editor h2')).toHaveText('共同理解摘要');await expect(page.locator('.article-editor h3')).toHaveText(['已确认','数据','本期不做']);await expect(page.locator('.article-editor li')).toHaveCount(12);await expect(page.locator('.article-editor p code')).toHaveCount(9);
 const before=await page.evaluate(()=>(window as any).__mojian.getMarkdown());await page.keyboard.press('ControlOrMeta+z');await expect(page.locator('.article-editor h1')).toHaveCount(0);await page.keyboard.press('ControlOrMeta+Shift+z');await expect(page.locator('.article-editor h1')).toHaveText('添加底价需求');
 await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();expect(await page.getByRole('textbox',{name:'Markdown 源码正文'}).inputValue()).toBe(before);await page.getByRole('button',{name:'所见即所得',exact:true}).click();await expect(page.locator('.article-editor li')).toHaveCount(12);
});
test('paste replaces only selected text, and rich HTML and code pastes retain their behavior',async({page})=>{
 await ready(page,'前面 中间 后面');await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection({from:4,to:6});});await paste(page,'**替换**');await expect(page.locator('.article-editor strong')).toHaveText('替换');await expect(page.locator('.article-editor')).toContainText('前面');await expect(page.locator('.article-editor')).toContainText('后面');
 await page.evaluate(()=>(window as any).__mojian.setMarkdown(''));await paste(page,'# 字面文本','<p><strong># 字面文本</strong></p>');await expect(page.locator('.article-editor strong')).toHaveText('# 字面文本');await expect(page.locator('.article-editor h1')).toHaveCount(0);
 await page.evaluate(()=>(window as any).__mojian.setMarkdown('```txt\n代码\n```'));await page.locator('.code-node pre').click();await page.keyboard.press('End');await paste(page,'\n# 保持代码\n- 列表');await expect(page.locator('.code-node pre')).toContainText('# 保持代码');await expect(page.locator('.article-editor h1,.article-editor ul')).toHaveCount(0);
});

test('native paste renders Markdown while the plain-text paste shortcut stays literal',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await ready(page);await page.evaluate(()=>navigator.clipboard.writeText('# 快捷键粘贴\n\n- 项目'));await page.keyboard.press('ControlOrMeta+v');await expect(page.locator('.article-editor h1')).toHaveText('快捷键粘贴');await expect(page.locator('.article-editor li')).toHaveCount(1);
 await page.evaluate(()=>(window as any).__mojian.setMarkdown(''));await page.locator('.article-editor').click();await page.evaluate(()=>(window as any).__mojian.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'v',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true})));await paste(page,'# 快捷键粘贴\n\n- 项目');await expect(page.locator('.article-editor h1,.article-editor ul')).toHaveCount(0);await expect(page.locator('.article-editor')).toContainText('# 快捷键粘贴');
});
const producttypeSample=readFileSync(new URL('./fixtures/producttype-markdown-paste.md',import.meta.url),'utf8');
for(const flavor of ['plain','pre','markdown-code','highlighted'] as const)test(`reported producttype Markdown renders completely when pasted as ${flavor}`,async({page})=>{
 await ready(page);
 const expected=await page.evaluate(text=>{const e=(window as any).__mojian.editor;const parsed=e.markdown.parse(text);e.commands.setContent(parsed);const result=e.getJSON();(window as any).__mojian.setMarkdown('');return result;},producttypeSample);
 const escaped=producttypeSample.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 const html=flavor==='plain'?'':flavor==='pre'?`<pre>${escaped}</pre>`:flavor==='markdown-code'?`<pre><code class="language-markdown">${escaped}</code></pre>`:`<div><code>${escaped.replace(/\n/g,'<br>')}</code></div>`;
 await paste(page,producttypeSample,html);
 await expect(page.locator('.article-editor h1')).toHaveText('需求：产品类型管理 — 规则限制（导入取 IF_SAME_BASEFARE_RULE）');
 await expect(page.locator('.article-editor table')).toHaveCount(3);await expect(page.locator('.article-editor input[type=checkbox]')).toHaveCount(4);await expect(page.locator('.article-editor h2')).toHaveCount(7);
 expect(await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.state.doc.check();return e.getJSON();})).toEqual(expected);
 await page.keyboard.press('ControlOrMeta+z');await expect(page.locator('.article-editor h1')).toHaveCount(0);await page.keyboard.press('ControlOrMeta+Shift+z');await expect(page.locator('.article-editor table')).toHaveCount(3);
 await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();await page.getByRole('button',{name:'所见即所得',exact:true}).click();expect(await page.evaluate(()=>(window as any).__mojian.editor.getJSON())).toEqual(expected);
});
test('programming code HTML stays code and inline code can coexist with emphasis',async({page})=>{
 await ready(page);await paste(page,'# 注释\n\n- 字面文本','<pre><code class="language-python"># 注释\n\n- 字面文本</code></pre>');await expect(page.locator('.article-editor h1')).toHaveCount(0);await expect(page.locator('.code-node pre')).toContainText('# 注释');
 await page.evaluate(()=>(window as any).__mojian.setMarkdown(''));await page.locator('.article-editor').click();await paste(page,'**`加粗代码`**、*`斜体代码`*、~~`删除代码`~~');
 await expect(page.locator('.article-editor strong code')).toHaveText('加粗代码');await expect(page.locator('.article-editor em code,.article-editor code em')).toHaveText('斜体代码');await expect(page.locator('.article-editor s code,.article-editor code s')).toHaveText('删除代码');
 expect(await page.evaluate(()=>{(window as any).__mojian.editor.state.doc.check();return true;})).toBe(true);
 await page.keyboard.press('ControlOrMeta+z');await expect(page.locator('.article-editor code')).toHaveCount(0);await page.keyboard.press('ControlOrMeta+Shift+z');await expect(page.locator('.article-editor strong code')).toHaveText('加粗代码');
});
for(const wrapper of ['native','lang','data-language','mixed-pre'] as const)test(`Markdown-looking programming content stays code for ${wrapper} HTML`,async({page})=>{
 await ready(page);const text='# 第一段\n\n- [ ] 字面代码';
 const html=wrapper==='native'?`<pre data-pm-slice="0 0 []"><code>${text}</code></pre>`:wrapper==='lang'?`<pre lang="python"><code>${text}</code></pre>`:wrapper==='data-language'?`<pre><code data-language="python">${text}</code></pre>`:`<pre><code># 第一段\n</code></pre><p>\n</p><pre><code>- [ ] 字面代码</code></pre>`;
 await paste(page,text,html);await expect(page.locator('.article-editor h1')).toHaveCount(0);await expect(page.locator('.article-editor input[type=checkbox]')).toHaveCount(0);
 await expect(page.locator('.article-editor pre')).toHaveCount(wrapper==='mixed-pre'?2:1);
});
