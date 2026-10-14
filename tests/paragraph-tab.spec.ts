import { test, expect } from './fixtures';

test('Tab in a bold numbered paragraph keeps focus in the editor before a nested Mermaid block',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);
 await page.evaluate(()=>{const editor=(window as any).__mojian.editor;(window as any).__mojian.setMarkdown('# 新开航线简要需求理解\n\n以下是最新精简稿，仅在对话中输出，供你核对。\n\n**1. 签注与日期**\n\n- 批量添加将舱位行 EI 项写入详情签注，空值保持为空。\n- 批量添加六日期按表单原值落库。\n  ```mermaid\n  gantt\n      title 日期约束\n      dateFormat YYYY-MM-DD\n      section 产品\n      产品有效期 :active, p1, 2024-01-01, 2024-12-31\n  ```\n\n**2. 儿童、婴儿策略**');let at=0;editor.state.doc.descendants((node:any,pos:number)=>{if(node.isText&&node.text.includes('1. 签注与日期'))at=pos+3;});editor.commands.setTextSelection(at);editor.commands.focus();});
 await expect(page.locator('.article-editor')).toBeFocused();await page.keyboard.press('Tab');await expect(page.locator('.article-editor')).toBeFocused();await expect(page.getByRole('textbox',{name:'代码语言'})).not.toBeFocused();await expect(page.locator('.article-editor strong').first()).toHaveText('1. \t签注与日期');
});

test('plain paragraphs insert a literal Tab at the caret, preserving marks, undo and Markdown roundtrip',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await page.evaluate(()=>{const e=(window as any).__mojian.editor;(window as any).__mojian.setMarkdown('**1. 签注与日期**\n\n后面的段落\n\n```js\nconst value = 1;\n```');e.commands.setTextSelection(4);e.commands.focus();});
 const title=page.locator('.article-editor p').first();const before=await title.textContent();await page.keyboard.press('Tab');await expect(title.locator('strong')).toHaveText('1. \t签注与日期');await expect(page.locator('.article-editor [data-paragraph-indent]')).toHaveCount(0);
 await page.keyboard.press('ControlOrMeta+z');expect(await title.textContent()).toBe(before);await page.keyboard.press('ControlOrMeta+Shift+z');await expect(title.locator('strong')).toHaveText('1. \t签注与日期');
 await page.keyboard.press('Shift+Tab');expect(await title.textContent()).toBe(before);await page.keyboard.press('Tab');
 const raw=await page.evaluate(()=>(window as any).__mojian.getMarkdown());expect(raw).toContain('**1. \t签注与日期**');expect(raw).not.toContain('&emsp;');
 await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();await page.getByRole('button',{name:'所见即所得',exact:true}).click();await expect(title.locator('strong')).toHaveText('1. \t签注与日期');await expect(page.locator('.code-node')).toHaveCount(1);
 await page.keyboard.press('ControlOrMeta+s');await expect(page.locator('.save-indicator')).toContainText('已保存');await page.reload();await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await expect(title.locator('strong')).toHaveText('1. \t签注与日期');
});

test('Tab replaces selected paragraph text and Shift+Tab at the beginning never moves focus',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await page.evaluate(()=>{const e=(window as any).__mojian.editor;(window as any).__mojian.setMarkdown('前面选中后面');e.commands.setTextSelection({from:3,to:5});e.commands.focus();});await expect(page.locator('.article-editor')).toBeFocused();await page.keyboard.press('Tab');await expect(page.locator('.article-editor p')).toHaveText('前面\t后面');await page.keyboard.press('ControlOrMeta+z');await expect(page.locator('.article-editor p')).toHaveText('前面选中后面');
 await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection(1);e.commands.focus();});await page.keyboard.press('Shift+Tab');await expect(page.locator('.article-editor')).toBeFocused();await expect(page.locator('.article-editor p')).toHaveText('前面选中后面');
});

for(const [name,markdown,kind,position] of [
 ['bold paragraph start','**1. 签注与日期**','paragraph',1],
 ['heading start','## 标题','heading',1],
 ['heading end','## 标题','heading',3],
 ['plain paragraph start','普通段落','paragraph',1],
] as const)test(`${name}: Tab survives source switching and refresh without changing node type`,async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await page.evaluate(({markdown,position})=>{const e=(window as any).__mojian.editor;(window as any).__mojian.setMarkdown(markdown);e.commands.setTextSelection(position);e.commands.focus();},{markdown,position});await expect(page.locator('.article-editor')).toBeFocused();await page.keyboard.press('Tab');
 const snapshot=await page.evaluate(()=>{const e=(window as any).__mojian.editor;return {node:e.state.doc.firstChild.toJSON(),text:e.state.doc.firstChild.textContent,markdown:e.getMarkdown()};});expect(snapshot.text).toContain('\t');expect(snapshot.markdown).toContain('&#9;');expect(snapshot.node.type).toBe(kind);
 await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();await page.getByRole('button',{name:'所见即所得',exact:true}).click();expect(await page.evaluate(()=>{const node=(window as any).__mojian.editor.state.doc.firstChild;return {type:node.type.name,text:node.textContent,level:node.attrs.level};})).toEqual({type:kind,text:snapshot.text,level:snapshot.node.attrs?.level});if(name==='bold paragraph start')await expect(page.locator('.article-editor strong')).toHaveText('1. 签注与日期');
 await page.keyboard.press('ControlOrMeta+s');await expect(page.locator('.save-indicator')).toContainText('已保存');await page.reload();await page.waitForFunction(()=>!!(window as any).__mojian?.editor);expect(await page.evaluate(()=>{const node=(window as any).__mojian.editor.state.doc.firstChild;return {type:node.type.name,text:node.textContent,level:node.attrs.level};})).toEqual({type:kind,text:snapshot.text,level:snapshot.node.attrs?.level});if(name==='bold paragraph start')await expect(page.locator('.article-editor strong')).toHaveText('1. 签注与日期');
});

test('literal numeric entity text and code tabs are not decoded twice or changed',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await page.evaluate(()=>(window as any).__mojian.setMarkdown('字面 &amp;#9;\n\n`\tinline\t`\n\n```txt\n\tcode\n```'));
 const before=await page.evaluate(()=>(window as any).__mojian.editor.getJSON());const raw=await page.evaluate(()=>(window as any).__mojian.getMarkdown());await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();await page.getByRole('button',{name:'所见即所得',exact:true}).click();expect(await page.evaluate(()=>(window as any).__mojian.editor.getJSON())).toEqual(before);expect(await page.evaluate(()=>(window as any).__mojian.getMarkdown())).toBe(raw);
});
