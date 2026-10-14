import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function ready(page:Page,markdown:string) {
 await page.goto('/');
 await page.waitForFunction(()=>!!(window as any).__mojian?.editor);
 await page.evaluate(markdown=>(window as any).__mojian.setMarkdown(markdown),markdown);
}
async function select(page:Page,first:string,last=first,backward=false) {
 await page.evaluate(({first,last,backward})=>{
  const editor=(window as any).__mojian.editor;let from=0,to=0;
  editor.state.doc.descendants((node:any,pos:number)=>{
   if(node.isText&&node.text===first)from=pos;
   if(node.isText&&node.text===last)to=pos+(first===last?0:node.text.length);
  });
  editor.commands.setTextSelection(backward?{from:to,to:from}:{from,to});editor.commands.focus();
 },{first,last,backward});
 await expect(page.locator('.article-editor')).toBeFocused();
}
const code='\n\n```js\nconst untouched = true;\n```';
for(const modifier of ['Control','Meta'])for(const [name,doc,text] of [
 ['bullet','- 父项\n- 第二项','第二项'],
 ['ordered','1. 父项\n2. 第二项','第二项'],
 ['task','- [x] 父项\n- [ ] 第二项','第二项'],
 ['code','```js\nfirst\nsecond\n```','first\nsecond'],
])test(`${modifier}+Z undoes ${name} indentation and Shift+Z redoes it`,async({page})=>{
 await ready(page,doc);await select(page,text);
 const before=await page.evaluate(()=>(window as any).__mojian.editor.getJSON());
 await page.keyboard.press('Tab');
 const indented=await page.evaluate(()=>(window as any).__mojian.editor.getJSON());expect(indented).not.toEqual(before);
 await page.keyboard.press(`${modifier}+z`);
 await expect.poll(()=>page.evaluate(()=>(window as any).__mojian.editor.getJSON())).toEqual(before);await expect(page.locator('.article-editor')).toBeFocused();
 await page.keyboard.press(`${modifier}+Shift+z`);
 await expect.poll(()=>page.evaluate(()=>(window as any).__mojian.editor.getJSON())).toEqual(indented);await expect(page.locator('.article-editor')).toBeFocused();
});
for(const [name,list,tag] of [['bullet','- 父项\n- 第二项\n- 第三项\n- 第四项','ul'],['ordered','1. 父项\n2. 第二项\n3. 第三项\n4. 第四项','ol'],['task','- [x] 父项\n- [ ] 第二项\n- [x] 第三项\n- [ ] 第四项','ul']] as const) {
 test(`${name}: Tab indents current item, Shift+Tab restores it, undo preserves content`,async({page})=>{
  await ready(page,list+code);await select(page,'第二项');
  await page.keyboard.press('Tab');
  await expect(page.locator(`.article-editor ${tag} ${tag} > li > p, .article-editor ${tag} ${tag} > li > div > p`)).toHaveText(['第二项']);
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator(`.article-editor > ${tag} > li`)).toHaveCount(4);
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator(`.article-editor ${tag} ${tag} > li > p, .article-editor ${tag} ${tag} > li > div > p`)).toHaveText(['第二项']);
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator(`.article-editor > ${tag} > li`)).toHaveCount(4);
  await expect(page.locator('.article-editor')).toBeFocused();
  await expect(page.getByLabel('代码语言',{exact:true})).toHaveValue('js');
  await expect(page.locator('.article-editor pre')).toContainText('const untouched = true;');
 });
 for(const backward of [false,true])test(`${name}: Tab indents selected items (${backward?'backward':'forward'} selection)`,async({page})=>{
  await ready(page,list+code);await select(page,'第二项','第三项',backward);
  await page.keyboard.press('Tab');
  await expect(page.locator(`.article-editor ${tag} ${tag} > li > p, .article-editor ${tag} ${tag} > li > div > p`)).toHaveText(['第二项','第三项']);
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator(`.article-editor > ${tag} > li`)).toHaveCount(4);
  await expect(page.locator('.article-editor')).toBeFocused();
 });
 for(const selected of [false,true])test(`${name}: first item has no parent to indent under (${selected?'multiple items selected':'caret'})`,async({page})=>{
  await ready(page,list+code);await select(page,'父项',selected?'第二项':'父项');const before=await page.evaluate(()=>(window as any).__mojian.editor.getJSON());const raw=await page.evaluate(()=>(window as any).__mojian.getMarkdown());
  await page.keyboard.press('Tab');await page.keyboard.press('Tab');await expect(page.locator('.article-editor')).toBeFocused();await expect(page.getByLabel('代码语言',{exact:true})).not.toBeFocused();expect(await page.evaluate(()=>(window as any).__mojian.editor.getJSON())).toEqual(before);expect(await page.evaluate(()=>(window as any).__mojian.getMarkdown())).toBe(raw);await expect(page.locator('[data-indent-wrapper]')).toHaveCount(0);
 });
}

test('nested lists sink and lift at the current level; task lists retain checked state',async({page})=>{
 await ready(page,'- 外层\n  - 内层首项\n  - 内层次项\n- 末项'+code);await select(page,'内层次项');
 await page.keyboard.press('Tab');await expect(page.locator('.article-editor ul ul ul > li')).toHaveText(['内层次项']);
 await page.keyboard.press('Shift+Tab');await expect(page.locator('.article-editor ul ul > li')).toHaveText(['内层首项','内层次项']);
 await ready(page,'- [ ] 父项\n- [x] 第二项'+code);await select(page,'第二项');await page.keyboard.press('Tab');
 await expect(page.locator('.article-editor ul ul input')).toBeChecked();await expect(page.locator('.article-editor')).toBeFocused();
});

test('first item node selection stays unchanged; old empty-parent indentation can still outdent',async({page})=>{
 await ready(page,'- 父项\n- 第二项\n- 末项'+code);await select(page,'父项');await page.keyboard.press('ControlOrMeta+a');const before=await page.evaluate(()=>(window as any).__mojian.editor.getJSON());await page.keyboard.press('Tab');expect(await page.evaluate(()=>(window as any).__mojian.editor.getJSON())).toEqual(before);await expect(page.locator('.article-editor')).toBeFocused();
 await ready(page,'-\n  - 父项\n  - 第二项\n- 末项'+code);await expect(page.locator('[data-indent-wrapper]')).toHaveCount(1);await select(page,'父项');await page.keyboard.press('Shift+Tab');await expect(page.locator('[data-indent-wrapper]')).toHaveCount(0);await expect(page.locator('.article-editor > ul > li')).toHaveCount(2);await expect(page.locator('.article-editor ul ul > li')).toHaveText(['第二项']);
});

test('composition guard and table Tab navigation remain intact',async({page})=>{
 await ready(page,'- 父项\n- 第二项'+code);await select(page,'第二项');
 await page.locator('.article-editor').dispatchEvent('keydown',{key:'Tab',code:'Tab',isComposing:true});
 await expect(page.locator('.article-editor ul ul')).toHaveCount(0);
 await ready(page,'| A | B |\n| --- | --- |\n| C | D |');await select(page,'C');await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>{const editor=(window as any).__mojian.editor;return editor.state.selection.$from.parent.textContent;})).toBe('D');
 await expect(page.locator('.article-editor')).toBeFocused();
});

for(const backward of [false,true])test(`code Tab indents selected lines and Shift+Tab restores them (${backward?'backward':'forward'})`,async({page})=>{
 await ready(page,'```js\nfirst\nsecond\nthird\n```');
 await page.evaluate(backward=>{const e=(window as any).__mojian.editor;let base=0;e.state.doc.descendants((n:any,p:number)=>{if(n.type.name==='codeBlock')base=p+1;});e.commands.setTextSelection(backward?{from:base+13,to:base}:{from:base,to:base+13});e.commands.focus();},backward);
 await page.keyboard.press('Tab');await expect(page.locator('.article-editor pre')).toHaveText('\tfirst\n\tsecond\n\tthird');
 await expect(page.locator('.article-editor')).toBeFocused();
 await page.keyboard.press('Shift+Tab');await expect(page.locator('.article-editor pre')).toHaveText('first\nsecond\nthird');
 await expect(page.locator('.article-editor')).toBeFocused();await expect(page.getByLabel('代码语言',{exact:true})).toHaveValue('js');
});

test('code cursor Tab, empty lines, undo and mixed whitespace outdent',async({page})=>{
 await ready(page,'```js\nfirst\n\n    second\n\tthird\n```');await select(page,'first\n\n    second\n\tthird');
 await page.keyboard.press('Tab');await expect(page.locator('.article-editor pre')).toHaveText('\tfirst\n\n    second\n\tthird');
 await page.keyboard.press('ControlOrMeta+z');await expect(page.locator('.article-editor pre')).toHaveText('first\n\n    second\n\tthird');
 await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection(8);e.commands.focus();});
 await page.keyboard.press('Tab');await expect(page.locator('.article-editor pre')).toHaveText('first\n\t\n    second\n\tthird');
 await page.keyboard.press('Shift+Tab');await expect(page.locator('.article-editor pre')).toHaveText('first\n\n    second\n\tthird');
 await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection({from:1,to:e.state.doc.firstChild.nodeSize-1});e.commands.focus();});
 await page.keyboard.press('Shift+Tab');await expect(page.locator('.article-editor pre')).toHaveText('first\n\nsecond\nthird');await expect(page.locator('.article-editor')).toBeFocused();
});

test('code selection ending at next line start only indents selected lines',async({page})=>{
 await ready(page,'```js\nfirst\nsecond\nthird\n```');
 await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection({from:1,to:14});e.commands.focus();});
 await expect(page.locator('.article-editor')).toBeFocused();await page.keyboard.press('Tab');await expect.poll(()=>page.locator('.article-editor pre').textContent()).toBe('\tfirst\n\tsecond\nthird');await expect(page.locator('.article-editor')).toBeFocused();
});

test('reported task checklist stays aligned on first-item Tab and nests later tasks like other lists',async({page})=>{
 await ready(page,'## 状态（维护人自填）\n\n- [ ] 开发完成\n- [ ] 环境 DDL 已同步（若适用）\n- [ ] 自动化测试通过（若适用）\n- [ ] 人工验收通过'+code);
 const positions=await page.locator('.article-editor ul[data-type=taskList]>li>label').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().left));expect(new Set(positions).size).toBe(1);
 await select(page,'开发完成');await page.keyboard.press('Tab');await expect(page.locator('.article-editor > ul[data-type=taskList]>li')).toHaveCount(4);await expect(page.locator('.article-editor ul ul')).toHaveCount(0);await expect(page.locator('.article-editor')).toBeFocused();
 await select(page,'环境 DDL 已同步（若适用）');await page.keyboard.press('Tab');await expect(page.locator('.article-editor ul ul>li')).toContainText('环境 DDL 已同步（若适用）');await page.keyboard.press('Shift+Tab');await expect(page.locator('.article-editor > ul[data-type=taskList]>li')).toHaveCount(4);expect(await page.locator('.article-editor ul[data-type=taskList]>li>label').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().left))).toEqual(positions);expect(await page.locator('.article-editor input[type=checkbox]').evaluateAll(nodes=>nodes.every(node=>!(node as HTMLInputElement).checked))).toBe(true);
});
