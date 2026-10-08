import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
async function ready(page:Page) {await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);}
async function setDoc(page:Page,text:string) {await page.evaluate(text=>(window as any).__mojian.setMarkdown(text),text);}
async function markdown(page:Page) {return page.evaluate(()=>(window as any).__mojian.getMarkdown());}
async function cursor(page:Page,text:string,offset=1) {await page.evaluate(({text,offset})=>{const e=(window as any).__mojian.editor;let p=1;e.state.doc.descendants((n:any,pos:number)=>{if(n.isText&&n.text.includes(text))p=pos+offset;});e.commands.setTextSelection(p);e.commands.focus();},{text,offset});await expect(page.locator('.article-editor')).toBeFocused();}
async function selection(page:Page) {return page.evaluate(()=>{const s=(window as any).__mojian.editor.state.selection;return {type:s.toJSON().type,from:s.from,to:s.to,node:s.node?.type.name,text:s.forEachCell?(()=>{const texts:string[]=[];s.forEachCell((n:any)=>texts.push(n.textContent));return texts.join('|');})():(window as any).__mojian.editor.state.doc.textBetween(s.from,s.to,'|')};});}
async function prepared(page:Page) {await page.waitForFunction(()=>{const m=(window as any).__mojian;const o=m.getOutput();return o&&o.key===JSON.stringify([m.getMarkdown(),m.getSettings()]);});}

test('Chinese line shortcuts, composition guard, undo and literal symbols',async({page})=>{
 await ready(page);await setDoc(page,'正常的》与···java不应变化\n\n');
 await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.focus('end');e.commands.insertContent('》');});await page.keyboard.press('Space');
 await expect(page.locator('.article-editor blockquote')).toHaveCount(1);
 await page.keyboard.insertText('引用中文');await expect.poll(()=>markdown(page)).toContain('引用中文');
 expect(await markdown(page)).toContain('正常的》与···java不应变化');
 await setDoc(page,'···java');await cursor(page,'···java',7);await page.keyboard.press('Enter');await expect.poll(()=>markdown(page)).toContain('```java');
 await page.keyboard.press('Control+z');await expect.poll(()=>markdown(page)).toContain('···java');
 await setDoc(page,'···mermaid');await cursor(page,'···mermaid',10);
 await page.locator('.article-editor').dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});expect(await markdown(page)).toBe('···mermaid');
 await page.keyboard.press('Enter');await expect.poll(()=>markdown(page)).toContain('```mermaid');
});

test('progressive select lists, nested lists, code and normal text; movement resets',async({page})=>{
 await ready(page);await setDoc(page,'- 外层\n  - 内层\n    - 子项\n  - 同层\n- 第二项\n\n普通正文\n\n```java\nline one\n\tline two\n```');
 await cursor(page,'内层');await page.keyboard.press('Control+a');let s=await selection(page);expect(s.node).toBe('listItem');expect(s.text).toContain('子项');
 await page.keyboard.press('Control+a');s=await selection(page);expect(s.node).toBe('bulletList');expect(s.text).toContain('同层');expect(s.text).not.toContain('第二项');
 await page.keyboard.press('Control+a');s=await selection(page);expect(s.node).toBe('bulletList');expect(s.text).toContain('第二项');
 await page.keyboard.press('Control+a');expect((await selection(page)).type).toBe('all');await page.keyboard.press('Control+a');expect((await selection(page)).type).toBe('all');
 await cursor(page,'内层');await page.keyboard.press('Control+a');expect((await selection(page)).node).toBe('listItem');
 await cursor(page,'line one');await page.keyboard.press('Control+a');s=await selection(page);expect(s.type).toBe('text');expect(s.text).toBe('line one\n\tline two');await page.keyboard.press('Control+a');expect((await selection(page)).type).toBe('all');
 await cursor(page,'普通正文');await page.keyboard.press('Control+a');expect((await selection(page)).type).toBe('all');
});

test('table progressive selection, two-stage deletion, undo, header and last column protection',async({page})=>{
 await ready(page);await setDoc(page,'| 表头A | 表头B |\n| --- | --- |\n| 行一 | 单元格 |\n| 行二 | 单元格二 |\n\n之后');await cursor(page,'行一');
 await page.keyboard.press('Control+a');let s=await selection(page);expect(s.type).toBe('cell');expect(s.text).not.toContain('行二');
 await page.keyboard.press('Control+a');s=await selection(page);expect(s.type).toBe('cell');expect(s.text).toContain('行二');
 await page.keyboard.press('Backspace');expect(await page.locator('.article-editor table').count()).toBe(1);expect(await page.locator('.article-editor table').innerText()).not.toContain('表头');
 await page.keyboard.press('Backspace');expect(await page.locator('.article-editor table').count()).toBe(0);
 await page.keyboard.press('Control+z');await expect(page.locator('.article-editor table')).toHaveCount(1);await page.keyboard.press('Control+z');await expect(page.locator('.article-editor th').first()).toContainText('表头A');
 await cursor(page,'表头A');await page.getByRole('button',{name:'删除当前行',exact:true}).click();await expect(page.locator('.toast')).toContainText('表头行需要保留');expect(await page.locator('.article-editor tr').count()).toBe(3);
 await cursor(page,'行一');await page.getByRole('button',{name:'下方添加行',exact:true}).click();expect(await page.locator('.article-editor tr').count()).toBe(4);
 await page.getByRole('button',{name:'右侧添加列',exact:true}).click();expect(await page.locator('.article-editor th').count()).toBe(3);
 await page.getByRole('button',{name:'删除当前列',exact:true}).click();await page.getByRole('button',{name:'删除当前列',exact:true}).click();await page.getByRole('button',{name:'删除当前列',exact:true}).click();await expect(page.locator('.toast')).toContainText('最后一列');expect(await page.locator('.article-editor th').count()).toBe(1);
});

test('partial table selection does not remove skeleton and movement cancels pending removal',async({page})=>{
 await ready(page);await setDoc(page,'| H1 | H2 |\n| --- | --- |\n| text | other |');await cursor(page,'text');await page.keyboard.press('Control+a');await page.keyboard.press('Backspace');expect(await page.locator('.article-editor table').count()).toBe(1);await expect(page.locator('.article-editor th').first()).toHaveText('H1');
 await cursor(page,'H1');await page.keyboard.press('Control+a');await page.keyboard.press('Control+a');await page.keyboard.press('Backspace');await page.keyboard.press('ArrowRight');await page.keyboard.press('Backspace');expect(await page.locator('.article-editor table').count()).toBe(1);
});

test('link uses original selection, cancel preserves content and modal select-all stays local',async({page})=>{
 await ready(page);await setDoc(page,'原有文字 后面的文字');await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection({from:1,to:5});e.commands.focus();});
 await page.getByRole('button',{name:'插入链接',exact:true}).click();const input=page.getByRole('textbox',{name:'链接地址'});await input.fill('javascript:alert(1)');await input.press('Control+a');expect(await input.evaluate((e:HTMLInputElement)=>e.selectionEnd!-e.selectionStart!)).toBe('javascript:alert(1)'.length);
 await page.getByRole('button',{name:'插入链接',exact:true}).last().click();await expect(page.locator('.form-error')).toContainText('禁止危险协议');await input.fill('https://example.com');await page.getByRole('button',{name:'插入链接',exact:true}).last().click();await expect(page.locator('.article-editor a')).toHaveText('原有文字');
 const before=await markdown(page);await page.getByRole('button',{name:'插入链接',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();expect(await markdown(page)).toBe(before);
});

test('source remains raw, refresh persists settings and Markdown structure',async({page})=>{
 await ready(page);const raw='# 标题\n\n- **粗体**\n  - 子列表\n\n| A | B |\n| :--- | ---: |\n| `a\\|b` | 2 |\n\n```unknown\n\tblank  spaces\n\nlast\n```\n\n![图](https://example.com/a.png "width=43%")\n\n```mermaid\nflowchart LR\nA-->B\n```';
 await setDoc(page,raw);await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();const area=page.getByRole('textbox',{name:'Markdown 源码正文'});await expect(area).toHaveValue(raw);await area.fill(raw+'\n\n[未完成');expect(await markdown(page)).toBe(raw+'\n\n[未完成');
 await page.keyboard.press('Control+s');await expect(page.locator('.save-indicator')).toContainText('已保存');await page.reload();await page.waitForFunction(()=>!!(window as any).__mojian?.editor);expect(await markdown(page)).toBe(raw+'\n\n[未完成');
 await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();await expect(page.getByRole('textbox',{name:'Markdown 源码正文'})).toHaveValue(raw+'\n\n[未完成');await page.getByRole('button',{name:'所见即所得',exact:true}).click();await expect(page.locator('.article-editor table')).toHaveCount(1);expect(await page.locator('.image-box').getAttribute('style')).toContain('43%');
});

test('clipboard has actual HTML and plain formats, and refusal never falls back',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await ready(page);await setDoc(page,'# 标题\n\n文字 & 中文\n\n3. **粗体**和[外链](https://example.com)\n   - 子列表\n\n| A | B |\n| --- | --- |\n| 字 | 2 |\n\n```java\n/* comment\n multiline */\n\t  a\n\n  b\n```');await prepared(page);
 await page.getByRole('button',{name:'复制到公众号',exact:true}).click();await expect(page.locator('.toast')).toContainText('已复制排版内容');
 const clip=await page.evaluate(async()=>{const items=await navigator.clipboard.read();return {types:items[0].types,html:await(await items[0].getType('text/html')).text(),text:await(await items[0].getType('text/plain')).text()};});
 expect(clip.types).toEqual(expect.arrayContaining(['text/html','text/plain']));expect(clip.html).toContain('font-family:');expect(clip.html).toContain('<table');expect(clip.html).not.toContain('<button');expect(clip.html).not.toContain('class="hljs');expect(clip.text).toContain('文字 & 中文');expect(clip.text).toContain('3. 粗体和外链');expect(clip.text).toContain('\t  a\n\n  b');expect(clip.text).toContain('A\tB');
 await page.evaluate(()=>{(window as any).__fallback=0;Object.defineProperty(navigator.clipboard,'write',{configurable:true,value:()=>Promise.reject(new DOMException('Denied','NotAllowedError'))});Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:()=>{(window as any).__fallback++;return Promise.resolve();}});document.execCommand=()=>{(window as any).__fallback++;return true;};});
 await page.getByRole('button',{name:'复制到公众号',exact:true}).click();await expect(page.locator('.toast')).toContainText('复制失败');expect(await page.evaluate(()=>(window as any).__fallback)).toBe(0);expect(await markdown(page)).toContain('文字 & 中文');
});

test('outline duplicates and code exclusions, full screen and Esc layering; mobile is single pane',async({page})=>{
 await ready(page);await setDoc(page,'# 重复\n\n'+Array(12).fill('段落\n\n').join('')+'## 重复\n\n```\n# 假标题\n```');await page.getByRole('button',{name:'大纲',exact:true}).click();expect(await page.locator('.outline-panel>div>button').count()).toBe(2);await page.locator('.outline-panel>div>button').nth(1).click();expect((await selection(page)).from).toBeGreaterThan(20);
 await page.getByRole('button',{name:'全屏写作',exact:true}).click();await expect(page.locator('.app')).toHaveClass(/fullscreen/);await page.getByRole('button',{name:'插入链接',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.app')).toHaveClass(/fullscreen/);await page.keyboard.press('Escape');await expect(page.locator('.app')).not.toHaveClass(/fullscreen/);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'公众号预览',exact:true}).click();await expect(page.locator('.writing-pane')).toBeHidden();await expect(page.locator('.preview-pane')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);await page.getByRole('button',{name:'关闭预览',exact:true}).click();await expect(page.locator('.writing-pane')).toBeVisible();await page.screenshot({path:'/tmp/mojian-mobile.png'});
});

test('context menu retargets outside selection and stays in viewport',async({page})=>{
 await ready(page);await setDoc(page,'第一段\n\n第二段');await cursor(page,'第一段');const p=page.locator('.article-editor p').nth(1);await p.click({button:'right'});await expect(page.locator('.context-menu')).toBeVisible();expect((await selection(page)).from).toBeGreaterThan(4);const box=await page.locator('.context-menu').boundingBox();expect(box!.x+box!.width).toBeLessThanOrEqual(1440);await page.keyboard.press('Escape');await expect(page.locator('.context-menu')).toHaveCount(0);
 // Short menus should remain at the pointer well below the old fixed 360px cutoff.
 await setDoc(page,Array(35).fill('可右键的正文段落').join('\n\n'));
 const check=async(x:number,y:number)=>{x=Math.floor(x);y=Math.floor(y);await page.mouse.click(x,y,{button:'right'});const menu=page.locator('.context-menu');await expect(menu).toBeVisible();const box=(await menu.boundingBox())!;const viewport=page.viewportSize()!;expect(box.x).toBeCloseTo(Math.max(8,Math.min(x,viewport.width-box.width-8)),0);expect(box.y).toBeCloseTo(Math.max(8,Math.min(y,viewport.height-box.height-8)),0);return box;};
 const editorBounds=(await page.locator('.article-editor').boundingBox())!;
 let actual=await check(editorBounds.x+30,700);expect(actual.y).toBe(700);await page.screenshot({path:'/tmp/mojian-context-position.png'});await page.keyboard.press('Escape');
 actual=await check(editorBounds.x+editorBounds.width-20,940);expect(actual.x+actual.width).toBeLessThanOrEqual(1432);expect(actual.y+actual.height).toBeLessThanOrEqual(992);
 await page.setViewportSize({width:900,height:600});await expect.poll(async()=>{const b=(await page.locator('.context-menu').boundingBox())!;return b.x+b.width;}).toBeLessThanOrEqual(892);await expect.poll(async()=>{const b=(await page.locator('.context-menu').boundingBox())!;return b.y+b.height;}).toBeLessThanOrEqual(592);await page.keyboard.press('Escape');
 await setDoc(page,'| A | B |\n| --- | --- |\n| 当前行 | 内容 |');const cell=page.locator('.article-editor td').first();await cell.scrollIntoViewIfNeeded();const target=(await cell.boundingBox())!;await check(target.x+20,target.y+10);await expect(page.locator('.context-menu')).toContainText('删除整表');await page.keyboard.press('Escape');
});

test('code copy is raw, fold keeps Markdown and output; Mermaid errors recover to latest source',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await ready(page);await setDoc(page,'```unknown\n\ta  b\n\n/* multiline\ncomment */\n```\n\n```mermaid\nflowchart LR\nA-->B\n```');await expect(page.locator('.diagram svg')).toBeVisible({timeout:15000});
 const before=await markdown(page);await page.getByRole('button',{name:'复制代码',exact:true}).first().click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('\ta  b\n\n/* multiline\ncomment */');await page.getByRole('button',{name:'折叠代码',exact:true}).first().click();expect(await markdown(page)).toBe(before);await prepared(page);expect(await page.evaluate(()=>(window as any).__mojian.getOutput().text)).toContain('\ta  b\n\n/* multiline\ncomment */');
 await setDoc(page,'```mermaid\ninvalid diagram !!!\n```');await expect(page.locator('.diagram-error')).toContainText('语法有误');expect(await markdown(page)).toContain('invalid diagram !!!');await setDoc(page,'```mermaid\nflowchart LR\n最新-->结果\n```');await expect(page.locator('.diagram svg')).toContainText('最新');await expect(page.locator('.diagram-error')).toHaveCount(0);
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'PNG',exact:true}).click();const file=await dl;expect(file.suggestedFilename()).toMatch(/\.png$/);const pngStream=await file.createReadStream();const pngChunks:Buffer[]=[];for await(const chunk of pngStream!)pngChunks.push(chunk);const png=Buffer.concat(pngChunks);expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(png.readUInt32BE(16)).toBeGreaterThan(50);expect(png.readUInt32BE(20)).toBeGreaterThan(20);
});

test('security cleaning strips executable HTML, dangerous links and output controls',async({page})=>{
 await ready(page);await setDoc(page,'# 安全\n\n<script>window.pwned=true</script>\n\n[坏链接](javascript:alert(1))\n\n<img src=x onerror="window.pwned=true">\n\n```html\n<script>literal</script>\n```');await prepared(page);const result=await page.evaluate(()=>({html:(window as any).__mojian.getOutput().html,pwned:(window as any).pwned}));expect(result.pwned).toBeUndefined();expect(result.html).not.toContain('<script>');expect(result.html).not.toContain('href="javascript:');expect(result.html).not.toContain('<input');expect(result.html).toContain('&lt;script&gt;');
});

test('local image async bookmark maps with edits, percent survives roundtrip/reload and missing resources are explicit',async({page})=>{
 await ready(page);await setDoc(page,'目标位置\n\n后文');await cursor(page,'目标位置',4);await page.getByRole('button',{name:'插入图片',exact:true}).click();
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=50;c.getContext('2d')!.fillRect(0,0,100,50);return c.toDataURL().split(',')[1];});
 await page.evaluate(()=>{const original=createImageBitmap;window.createImageBitmap=(...args:any[])=>new Promise(resolve=>setTimeout(()=>resolve((original as any)(...args)),300)) as any;});
 await page.locator('input[type=file][accept^="image/"]').setInputFiles({name:'本地测试.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.insertContentAt(1,'前插');});
 await expect(page.locator('.image-box img')).toBeVisible();let text=await markdown(page);expect(text.indexOf('前插')).toBeLessThan(text.indexOf('local-image:'));expect(text.indexOf('local-image:')).toBeLessThan(text.indexOf('后文'));expect(text).not.toContain('blob:');
 await page.locator('.image-box img').click();await page.getByRole('spinbutton',{name:'图片宽度百分比'}).fill('45');await expect.poll(()=>markdown(page)).toContain('width=45%');
 await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();expect(await markdown(page)).toContain('width=45%');await page.getByRole('button',{name:'所见即所得',exact:true}).click();expect(await page.locator('.image-box').getAttribute('style')).toContain('45%');await page.keyboard.press('Control+s');await expect(page.locator('.save-indicator')).toContainText('已保存');await page.reload();await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await expect(page.locator('.image-box img')).toBeVisible();expect(await markdown(page)).toContain('width=45%');
 await prepared(page);await page.getByRole('button',{name:'复制到公众号',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('本地测试.png');await page.getByRole('button',{name:'返回写作',exact:true}).click();
 await setDoc(page,'![丢失资源](local-image:missing-resource "width=25%")');await expect(page.locator('.missing-image')).toContainText('本地图片缺失');await prepared(page);const out=await page.evaluate(()=>(window as any).__mojian.getOutput());expect(out.html).toContain('请在此处上传本地图片：丢失资源');expect(out.html).not.toContain('blob:');
});

test('import cancel, UTF-8 export, reimport dimensions and draft settings persistence',async({page})=>{
 await ready(page);await setDoc(page,'# 当前正文\n\n![图](https://example.com/image.png "width=38%")\n\n```java\n\t x\n\n y\n```');
 const before=await markdown(page);await page.locator('input[type=file][accept^=".md"]').setInputFiles({name:'import.md',mimeType:'text/markdown',buffer:Buffer.from('# 导入正文')});await page.getByRole('button',{name:'取消',exact:true}).click();expect(await markdown(page)).toBe(before);
 const promise=page.waitForEvent('download');await page.getByRole('button',{name:'导出 Markdown',exact:true}).click();const d=await promise;const stream=await d.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(chunk);const content=Buffer.concat(chunks);expect(content.toString()).toBe(before);
 await page.locator('input[type=file][accept^=".md"]').setInputFiles({name:'roundtrip.md',mimeType:'text/markdown',buffer:content});await page.getByRole('button',{name:'确认替换',exact:true}).click();expect(await markdown(page)).toBe(before);expect(await page.locator('.image-box').getAttribute('style')).toContain('38%');
 await page.getByRole('button',{name:'公众号预览',exact:true}).click();await page.getByRole('button',{name:'雅致',exact:true}).click();await page.getByRole('slider',{name:'正文字号'}).fill('18');await page.keyboard.press('Control+s');await expect(page.locator('.save-indicator')).toContainText('已保存');await page.reload();await page.waitForFunction(()=>!!(window as any).__mojian?.editor);const settings=await page.evaluate(()=>(window as any).__mojian.getSettings());expect(settings.theme).toBe('elegant');expect(settings.fontSize).toBe(18);
});

test('rich clipboard unsupported has no writeText fallback and prepares fresh snapshots',async({page})=>{
 await ready(page);await setDoc(page,'第一版');await prepared(page);await page.evaluate(()=>{(window as any).__fallback=0;Object.defineProperty(navigator.clipboard,'write',{configurable:true,value:undefined});Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:()=>{(window as any).__fallback++;return Promise.resolve();}});});await page.getByRole('button',{name:'复制到公众号',exact:true}).click();await expect(page.locator('.toast')).toContainText('不支持富文本');expect(await page.evaluate(()=>(window as any).__fallback)).toBe(0);
 await setDoc(page,'最新版本');await page.getByRole('button',{name:'复制到公众号',exact:true}).click();await expect(page.locator('.toast')).toContainText('准备');await prepared(page);expect(await page.evaluate(()=>(window as any).__mojian.getOutput().text)).toContain('最新版本');
});

test('drag image resize is one undoable action, preserve context selection, normal Markdown input and save failure retains draft',async({page})=>{
 await ready(page);await setDoc(page,'![公开图片](https://example.com/x.png "width=65%")\n\n测试正文');
 await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.setNodeSelection(0);e.commands.focus();});await expect(page.getByRole('button',{name:'拖拽调整图片宽度'})).toBeVisible();const handle=await page.getByRole('button',{name:'拖拽调整图片宽度'}).boundingBox();
 await page.mouse.move(handle!.x+6,handle!.y+6);await page.mouse.down();await page.mouse.move(handle!.x-90,handle!.y+6,{steps:5});await page.mouse.up();expect(await markdown(page)).not.toContain('width=65%');await page.keyboard.press('Control+z');await expect.poll(()=>markdown(page)).toContain('width=65%');
 await setDoc(page,'测试正文');await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection({from:1,to:5});e.commands.focus();});await page.locator('.article-editor p').first().click({button:'right',position:{x:15,y:8}});expect((await selection(page)).text).toBe('测试正文');await page.keyboard.press('Escape');
 await setDoc(page,'');await page.locator('.article-editor').click();await page.keyboard.type('## ');await page.keyboard.insertText('快捷标题');await expect(page.locator('.article-editor h2')).toHaveText('快捷标题');await page.keyboard.press('Enter');await page.keyboard.type('- ');await page.keyboard.insertText('列表项');await expect(page.locator('.article-editor ul li')).toContainText('列表项');
 const text=await markdown(page);await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:any[]){if(this.name==='draft')throw new DOMException('quota','QuotaExceededError');return (original as any).apply(this,args);};});await page.keyboard.press('Control+s');await expect(page.locator('.save-indicator')).toContainText('保存失败');expect(await markdown(page)).toBe(text);await expect(page.locator('.toast')).toContainText('正文仍在');
});

test('local placeholders are confirmed then written in both clipboard formats',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await ready(page);await setDoc(page,'# 含图片\n\n![缺失但保留位置](local-image:missing "width=30%")\n\n```mermaid\nflowchart LR\nA-->B\n```');await prepared(page);await page.getByRole('button',{name:'复制到公众号',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Mermaid 图形 1');await page.getByRole('button',{name:'确认复制正文与占位说明',exact:true}).click();await expect(page.locator('.toast')).toContainText('已复制排版内容');
 const clip=await page.evaluate(async()=>{const item=(await navigator.clipboard.read())[0];return {html:await(await item.getType('text/html')).text(),text:await(await item.getType('text/plain')).text(),types:item.types};});expect(clip.types).toEqual(expect.arrayContaining(['text/html','text/plain']));expect(clip.html).toContain('缺失但保留位置');expect(clip.text).toContain('请在此处插入 Mermaid 图形 1');expect(clip.html).not.toContain('blob:');expect(clip.html).not.toContain('data:');expect(clip.html).not.toContain('<svg');
});

test('public URL images load before insertion; failed URL and canceled loading leave draft unchanged',async({page})=>{
 await ready(page);await setDoc(page,'公开图片测试');await cursor(page,'公开图片测试',6);await page.getByRole('button',{name:'插入图片',exact:true}).click();await page.getByRole('textbox',{name:'图片地址',exact:true}).fill('https://raw.githubusercontent.com/github/explore/main/topics/markdown/markdown.png');await page.getByRole('button',{name:'插入 URL 图片',exact:true}).click();await expect(page.locator('.image-box img')).toBeVisible();expect(await page.locator('.image-box img').evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBeGreaterThan(0);
 await page.locator('.image-box img').click({button:'right'});await expect(page.locator('.context-menu')).toContainText('删除选中图片');await page.keyboard.press('Escape');
 const before=await markdown(page);await page.route('https://example.com/missing-image.png',r=>r.fulfill({status:404,body:'missing'}));await page.getByRole('button',{name:'插入图片',exact:true}).click();await page.getByRole('textbox',{name:'图片地址',exact:true}).fill('https://example.com/missing-image.png');await page.getByRole('button',{name:'插入 URL 图片',exact:true}).click();await expect(page.locator('.form-error')).toContainText('无法加载');expect(await markdown(page)).toBe(before);await page.getByRole('button',{name:'取消',exact:true}).click();
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=20;c.height=20;return c.toDataURL().split(',')[1];});
 await page.route('https://example.com/slow-image.png',async r=>{await new Promise(resolve=>setTimeout(resolve,500));await r.fulfill({status:200,contentType:'image/png',body:Buffer.from(png,'base64')});});
 await page.getByRole('button',{name:'插入图片',exact:true}).click();await page.getByRole('textbox',{name:'图片地址',exact:true}).fill('https://example.com/slow-image.png');await page.getByRole('button',{name:'插入 URL 图片',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();await page.waitForTimeout(700);expect(await markdown(page)).toBe(before);
});

for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
 test(`fullscreen visibly expands writing and restores focus/scroll at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);await ready(page);
  await setDoc(page,'# 全屏写作\n\n'+Array(80).fill('长文段落用于检查滚动位置。\n\n').join(''));
  await cursor(page,'长文段落');
  await page.locator('.writing-scroll').evaluate(e=>e.scrollTop=500);
  const scroll=await page.locator('.writing-scroll').evaluate(e=>e.scrollTop);
  const selected=await selection(page);const before=await page.locator('.writing-pane').boundingBox();
  const content=await markdown(page);
  await page.screenshot({path:`/tmp/mojian-fullscreen-before-${viewport.width}.png`});
  await page.getByRole('button',{name:'全屏写作',exact:true}).click();
  await expect(page.locator('.app-header')).toBeHidden();await expect(page.locator('.app-footer')).toBeHidden();
  const expanded=await page.locator('.writing-pane').boundingBox();expect(expanded!.y).toBe(0);expect(expanded!.height).toBe(viewport.height);expect(expanded!.height).toBeGreaterThan(before!.height+80);
  const exit=page.getByRole('button',{name:'退出全屏',exact:true});await expect(exit).toBeVisible();await expect(exit).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe('hidden');expect(await selection(page)).toEqual(selected);
  await page.screenshot({path:`/tmp/mojian-fullscreen-after-${viewport.width}.png`});
  await page.getByRole('button',{name:'插入链接',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(exit).toBeVisible();
  await exit.click();await expect(page.locator('.app-header')).toBeVisible();await expect(page.locator('.app-footer')).toBeVisible();
  await expect.poll(()=>page.locator('.writing-scroll').evaluate(e=>e.scrollTop)).toBe(scroll);
  expect(await page.locator('.article-editor').evaluate(e=>e===document.activeElement)).toBe(true);expect(await selection(page)).toEqual(selected);expect(await markdown(page)).toBe(content);
  await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();const source=page.getByRole('textbox',{name:'Markdown 源码正文'});
  await source.evaluate((e:HTMLTextAreaElement)=>{e.setSelectionRange(20,30);e.scrollTop=300;});
  const sourceScroll=await source.evaluate(e=>e.scrollTop);await page.getByRole('button',{name:'全屏写作',exact:true}).click();
  await source.dispatchEvent('keydown',{key:'Escape',code:'Escape',isComposing:true});await expect(exit).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('.app-header')).toBeVisible();await expect(source).toBeFocused();
  await expect.poll(()=>source.evaluate(e=>e.scrollTop)).toBe(sourceScroll);expect(await source.evaluate((e:HTMLTextAreaElement)=>[e.selectionStart,e.selectionEnd])).toEqual([20,30]);
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe('');
 });
}

test('WeChat typography uses explicit pixel line heights in lists and inline marks',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await ready(page);
 const raw='# 标题\n\n1. **写下你的想法**，不用急着排版。\n2. 用标题、列表和引用，让内容更有层次。\n   - 保持简洁，也保留 *恰当的强调*。\n   - 试试 [Markdown 指南](https://www.markdownguide.org/)，或写一段 `行内代码`。\n\n- 第一段\n\n  第二段\n\n  > 引用\n\n| A | B |\n| --- | --- |\n| 中文 | **粗体** |\n\n```java\n/* 多行\n注释 */\n\t  code\n\n  end\n```';
 await setDoc(page,raw);await prepared(page);await page.getByRole('button',{name:'公众号预览',exact:true}).click();
 await page.getByRole('button',{name:'复制到公众号',exact:true}).click();await expect(page.locator('.toast')).toContainText('已复制排版内容');
 const result=await page.evaluate(async()=>{
  const items=await navigator.clipboard.read();const html=await(await items[0].getType('text/html')).text();const root=document.createElement('div');root.innerHTML=html;
  const textElements=Array.from(root.querySelectorAll<HTMLElement>('section,p,h1,ul,ol,li,strong,em,a,code,span,pre,table,th,td,blockquote'));
  const invalid=textElements.filter(e=>!e.closest('[data-code-block]')&&e.textContent?.trim()&&(!e.style.fontSize.endsWith('px')||!e.style.lineHeight.endsWith('px')||parseFloat(e.style.lineHeight)<parseFloat(e.style.fontSize))).map(e=>e.outerHTML);
  return {types:items[0].types,html,invalid,marks:Array.from(root.querySelectorAll<HTMLElement>('li strong,li em,li a,li code')).map(e=>({tag:e.tagName,display:e.style.display,line:e.style.lineHeight})),paragraphs:root.querySelectorAll('li>p').length,code:(window as any).__mojian.getOutput().text};
 });
 expect(result.types).toEqual(expect.arrayContaining(['text/html','text/plain']));expect(result.invalid).toEqual([]);expect(result.marks.map(e=>e.tag)).toEqual(expect.arrayContaining(['STRONG','EM','A','CODE']));expect(result.marks.every(e=>e.display==='inline')).toBe(true);expect(result.paragraphs).toBeGreaterThan(1);expect(result.code).toContain('\t  code\n\n  end');expect(await markdown(page)).toBe(raw);
 // Same HTML in preview and clipboard for articles without local assets or diagrams.
 expect(await page.locator('.preview-paper').innerHTML()).toBe(result.html);
 await page.getByLabel('正文字号',{exact:true}).focus();await page.keyboard.press('End');
 await page.getByLabel('行距',{exact:true}).focus();await page.keyboard.press('Home');await prepared(page);
 await expect(page.locator('.preview-paper li').first()).toHaveCSS('font-size','20px');await expect(page.locator('.preview-paper li').first()).toHaveCSS('line-height','30px');
 await page.setViewportSize({width:390,height:844});await expect(page.locator('.writing-pane')).toBeHidden();await expect(page.locator('.preview-paper li strong').first()).toHaveCSS('display','inline');
 await page.screenshot({path:'/tmp/mojian-wechat-lineheight.png'});
});

test('mixed rich text avoids legacy WeChat fragment-count overlap warnings',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await ready(page);
 const raw='**写下你的想法**，不用急着排版。\n\n3. 用标题、列表和引用，让内容更有层次。\n   - 保持简洁，也保留 *恰当的强调*。\n   - 试试 [Markdown 指南](https://www.markdownguide.org/)，或写一段 `行内代码`。\n\n- **第一段**，这是多段列表项。\n\n  第二段 *强调*，保持独立段落。\n\n  > **引用**与正文。';
 await setDoc(page,raw);await prepared(page);await page.getByRole('button',{name:'公众号预览',exact:true}).click();await page.getByRole('button',{name:'复制到公众号',exact:true}).click();await expect(page.locator('.toast')).toContainText('已复制排版内容');
 const result=await page.evaluate(async()=>{
  const items=await navigator.clipboard.read();const html=await(await items[0].getType('text/html')).text();const text=await(await items[0].getType('text/plain')).text();
  // Reproduce the direct-text fallback and Range fragment counting in official
  // 0.2.16 (96eca1a), not a claim to replace the full official verifier.
  const legacy=(html:string,width:number)=>{const root=document.createElement('div');root.style.width=width+'px';root.innerHTML=html;document.body.append(root);
   const warnings=Array.from(root.querySelectorAll<HTMLElement>('p,li,h1,h2,h3,h4,h5,h6,div,section,td,a')).filter(el=>{
    if(!Array.from(el.childNodes).some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent?.trim()))return false;
    const range=document.createRange();range.selectNodeContents(el);const count=Array.from(range.getClientRects()).filter(r=>r.height>0).length;
    return count>=2&&range.getBoundingClientRect().height/count<parseFloat(getComputedStyle(el).fontSize)*.95;
   }).map(el=>el.textContent);root.remove();return warnings;
  };
  const baseline='<ol><li style="font-size:16px;line-height:29.6px"><strong>写下你的想法</strong>，不用急着排版。</li></ol>';
  return {html,text,baseline:legacy(baseline,677),warnings:[320,375,677].map(width=>legacy(html,width))};
 });
 expect(result.baseline.length).toBeGreaterThan(0);expect(result.warnings).toEqual([[],[],[]]);expect(result.text).toContain('写下你的想法，不用急着排版。');expect(result.text).toContain('3. 用标题、列表和引用');expect(result.text).toContain('保持简洁，也保留 恰当的强调。');expect(result.text).toContain('Markdown 指南，或写一段 行内代码');expect(await markdown(page)).toBe(raw);
 await expect(page.locator('.preview-paper ol')).toHaveAttribute('start','3');await expect(page.locator('.preview-paper ol ul li')).toHaveCount(2);await expect(page.locator('.preview-paper li>p')).toHaveCount(2);await expect(page.locator('.preview-paper strong').first()).toHaveCSS('display','inline');
 await page.setViewportSize({width:390,height:844});await page.locator('.preview-scroll').evaluate(e=>e.scrollTop=380);await page.screenshot({path:'/tmp/mojian-wechat-compatible-mobile.png'});
});

test('fixed SVG code cards and per-line NBSP output preserve raw clipboard code',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await ready(page);
 const code='  /* 中文多行注释\n    第二行 */\n\t  const value = "a  b & <tag> &nbsp; '+('long_token_'.repeat(30))+'";\n\n    console.log(value);  ';
 const unknown='  plain    text\n\n\tend\n';const raw='# 代码示例\n\n```javascript\n'+code+'\n```\n\n```unknown\n'+unknown+'\n```\n\n<svg onload="window.pwned=true"><script>alert(1)</script></svg>';
 await setDoc(page,raw);await prepared(page);await page.getByRole('button',{name:'复制代码',exact:true}).first().click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(code);
 await page.getByRole('button',{name:'公众号预览',exact:true}).click();await expect(page.locator('.preview-paper [data-code-chrome] svg')).toHaveCount(2);
 for(const theme of ['浅色','深色']){
  await page.getByRole('button',{name:theme,exact:true}).click();await prepared(page);await expect(page.locator('.preview-paper')).not.toHaveClass(/preparing/);
  const card=page.locator('.preview-paper [data-code-block] > pre').first();await expect(card).toHaveCSS('background-color',theme==='深色'?'rgb(13, 17, 23)':'rgb(248, 250, 252)');await expect(card).toHaveCSS('border-radius','8px');
  await expect(card.locator('svg')).toHaveCSS('width','45px');await expect(card.locator('svg')).toHaveCSS('height','13px');
  await page.getByRole('button',{name:'复制到公众号',exact:true}).click();await expect(page.locator('.toast')).toContainText('已复制排版内容');
  const clip=await page.evaluate(async()=>{const items=await navigator.clipboard.read();const html=await(await items[0].getType('text/html')).text();const root=document.createElement('div');root.innerHTML=html;const svg=root.querySelector('svg')!;const lineElements=Array.from(root.querySelectorAll('[data-code-block]')).map(block=>Array.from(block.querySelectorAll('[data-code-line]')));
   return {types:items[0].types,html,text:await(await items[0].getType('text/plain')).text(),svg:{width:svg.getAttribute('width'),height:svg.getAttribute('height'),viewBox:svg.getAttribute('viewBox'),namespace:svg.namespaceURI,ellipses:Array.from(svg.children,e=>Object.fromEntries(Array.from(e.attributes,a=>[a.name,a.value])))},lines:lineElements.map(lines=>lines.map(e=>e.textContent)),comments:lineElements[0].slice(0,2).map(e=>e.querySelector('span[style]')?.getAttribute('style')),unsafe:root.querySelectorAll('script,foreignObject,svg [onload],svg [href]').length,svgCount:root.querySelectorAll('svg').length};});
  expect(clip.types).toEqual(expect.arrayContaining(['text/html','text/plain']));expect(clip.svg).toEqual({width:'45px',height:'13px',viewBox:'0 0 450 130',namespace:'http://www.w3.org/2000/svg',ellipses:[{cx:'50',cy:'65',rx:'50',ry:'52',stroke:'rgb(220,60,54)','stroke-width':'2',fill:'rgb(237,108,96)'},{cx:'225',cy:'65',rx:'50',ry:'52',stroke:'rgb(218,151,33)','stroke-width':'2',fill:'rgb(247,193,81)'},{cx:'400',cy:'65',rx:'50',ry:'52',stroke:'rgb(27,161,37)','stroke-width':'2',fill:'rgb(100,200,86)'}]});
  const expected=(text:string)=>text.replace(/\t/g,'    ').split('\n').map(line=>line?line.replace(/ /g,'\u00a0'):'\u00a0');expect(clip.lines[0]).toEqual(expected(code));expect(clip.lines[1]).toEqual(expected(unknown));
  expect(clip.text).toContain(code);expect(clip.text).toContain(unknown);expect(clip.text).not.toContain('\u00a0');expect(clip.text).not.toContain('代码块装饰');expect(clip.html).toContain('&nbsp;');expect(clip.html).not.toContain('<button');expect(clip.unsafe).toBe(0);expect(clip.svgCount).toBe(2);expect(clip.comments[0]).toContain('color:');expect(clip.comments[1]).toBe(clip.comments[0]);expect(await page.locator('.preview-paper').innerHTML()).toBe(clip.html);
 }
 await page.screenshot({path:'/tmp/mojian-svg-code-desktop.png'});
 for(const width of [390,320]){await page.setViewportSize({width,height:844});const card=page.locator('.preview-paper [data-code-block]').first();expect(await card.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);const scroll=card.locator('[data-code-scroll]');expect(await scroll.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);await scroll.evaluate(e=>e.scrollLeft=100);expect(await scroll.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);await expect(card.locator('svg')).toHaveCSS('height','13px');}
 await page.locator('.preview-scroll').evaluate(e=>e.scrollTop=330);await page.screenshot({path:'/tmp/mojian-svg-code-mobile.png'});expect(await markdown(page)).toBe(raw);
 await setDoc(page,'```unknown\n\n\t  last  \n\n```');await prepared(page);expect(await page.evaluate(()=>(window as any).__mojian.getOutput().text)).toContain('\n\t  last  \n\n');
});

test('mixed table cells and long identifiers stay readable in rich clipboard on narrow screens',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await ready(page);
 const identifier='assertThatVeryLongFactoryMethodName'.repeat(5);
 const raw=`### 场景对比表\n\n| 场景 | 对比说明 |\n| :--- | ---: |\n| **中文场景**与普通正文 | 使用\`行内代码\`和*强调*，${'中文说明保持正常行距。'.repeat(12)} |\n\n### 内置断言工厂表\n\n| 工厂方法 | 说明 | 参数 |\n| --- | --- | --- |\n| \`${identifier}\` | **工厂**返回值与[说明链接](https://example.com/) | ${'unbroken_parameter_'.repeat(12)} |\n\n| A | B | C | D | E | F | G | H |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |`;
 await setDoc(page,raw);await prepared(page);await page.getByRole('button',{name:'公众号预览',exact:true}).click();await page.getByRole('button',{name:'复制到公众号',exact:true}).click();await expect(page.locator('.toast')).toContainText('已复制排版内容');
 const clip=await page.evaluate(async()=>{const item=(await navigator.clipboard.read())[0];return {types:item.types,html:await(await item.getType('text/html')).text(),text:await(await item.getType('text/plain')).text()};});
 expect(clip.types).toEqual(expect.arrayContaining(['text/html','text/plain']));expect(clip.text).toContain(identifier);expect(await markdown(page)).toBe(raw);expect(await page.locator('.preview-paper').innerHTML()).toBe(clip.html);
 const measured=await page.evaluate(html=>[320,375,677].map(width=>{
  // Detached from app CSS: verify the actual pasted HTML with inline styles only.
  const host=document.createElement('div');host.style.width=width+'px';host.innerHTML=html;document.body.append(host);
  const wrappers=Array.from(host.querySelectorAll<HTMLElement>('[data-table-scroll]'));
  const normalTables=Array.from(host.querySelectorAll<HTMLTableElement>('table')).slice(0,2);
  const overflowingCells=Array.from(host.querySelectorAll<HTMLElement>('th,td')).filter(cell=>{const r=document.createRange();r.selectNodeContents(cell);return Array.from(r.getClientRects()).some(rect=>rect.right>cell.getBoundingClientRect().right+1);}).map(cell=>cell.textContent);
  const legacyWarnings=Array.from(host.querySelectorAll<HTMLElement>('th,td')).filter(cell=>{if(!Array.from(cell.childNodes).some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent?.trim()))return false;const r=document.createRange();r.selectNodeContents(cell);const count=Array.from(r.getClientRects()).filter(r=>r.height>0).length;return count>=2&&r.getBoundingClientRect().height/count<parseFloat(getComputedStyle(cell).fontSize)*.95;}).map(cell=>cell.textContent);
  const result={width,wrapperWidths:wrappers.map(e=>e.getBoundingClientRect().width),tableWidths:normalTables.map(e=>e.getBoundingClientRect().width),overflowingCells,legacyWarnings,wideScroll:wrappers[2].scrollWidth>wrappers[2].clientWidth,alignments:Array.from(host.querySelectorAll('table:first-of-type th')).slice(0,2).map(e=>getComputedStyle(e).textAlign)};host.remove();return result;
 }),clip.html);
 for(const result of measured){expect(result.wrapperWidths.every(w=>w<=result.width+1)).toBe(true);expect(result.tableWidths.every(w=>w<=result.width+1)).toBe(true);expect(result.overflowingCells).toEqual([]);expect(result.legacyWarnings).toEqual([]);expect(result.alignments).toEqual(['left','right']);if(result.width<640)expect(result.wideScroll).toBe(true);}
 await page.setViewportSize({width:390,height:844});await page.locator('.preview-scroll').evaluate(e=>e.scrollTop=e.scrollHeight);await page.screenshot({path:'/tmp/mojian-table-compatibility.png'});
 await import('node:fs/promises').then(fs=>fs.writeFile('/tmp/mojian-table-clipboard.html',clip.html));
});

test('toolbar italic preserves selected Chinese text, toggles and persists into preview and clipboard',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await ready(page);await setDoc(page,'选中的中文 后面的文字');
 await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection({from:1,to:7});e.commands.focus();});
 const before=await selection(page);await page.getByRole('button',{name:'斜体',exact:true}).click();
 await expect(page.locator('.article-editor em')).toHaveText('选中的中文 ');await expect(page.locator('.article-editor em')).toHaveCSS('font-style','italic');await expect(page.locator('.article-editor em')).toHaveCSS('font-synthesis','style');expect((await selection(page)).from).toBe(before.from);expect((await selection(page)).to).toBe(before.to);expect(await markdown(page)).toContain('*选中的中文');
 await page.getByRole('button',{name:'斜体',exact:true}).click();await expect(page.locator('.article-editor em')).toHaveCount(0);await page.keyboard.press('Control+z');await expect(page.locator('.article-editor em')).toHaveCount(1);
 await prepared(page);await page.getByRole('button',{name:'公众号预览',exact:true}).click();await expect(page.locator('.preview-paper em')).toHaveCSS('font-synthesis','style');await expect(page.locator('.preview-paper em')).toHaveCSS('font-style','italic');await expect(page.locator('.preview-paper')).not.toHaveClass(/preparing/);await page.getByRole('button',{name:'复制到公众号',exact:true}).click();await expect(page.locator('.toast')).toContainText('已复制排版内容');
 const copied=await page.evaluate(async()=>{const item=(await navigator.clipboard.read())[0];const host=document.createElement('div');host.innerHTML=await(await item.getType('text/html')).text();const em=host.querySelector('em')!;return {text:em.textContent,style:em.style.fontStyle,synthesis:em.style.fontSynthesis,types:item.types};});expect(copied.text).toBe('选中的中文');expect(copied.style).toBe('italic');expect(copied.synthesis).toBe('style');expect(copied.types).toEqual(expect.arrayContaining(['text/html','text/plain']));await page.screenshot({path:'/tmp/mojian-italic.png'});
});

test('Ctrl and Cmd clicking editor links open actual new tabs without changing draft or selection',async({page,context})=>{
 await ready(page);const href='http://localhost:5173/?linked=1';await setDoc(page,`前面的正文 [打开页面](${href}) 后面的正文`);const raw=await markdown(page);const currentURL=page.url();
 const anchor=page.locator('.article-editor a');await anchor.click();await expect(page.getByRole('button',{name:'编辑链接',exact:true})).toBeVisible();expect(context.pages()).toHaveLength(1);expect(page.url()).toBe(currentURL);
 for(const modifier of ['Control','Meta'] as const){await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection({from:1,to:4});e.commands.focus();});const before=await selection(page);const popupEvent=page.waitForEvent('popup');await anchor.click({modifiers:[modifier]});const popup=await popupEvent;await popup.waitForLoadState('domcontentloaded');expect(popup.url()).toBe(href);expect(await popup.evaluate(()=>window.opener)).toBeNull();expect(await popup.evaluate(()=>document.referrer)).toBe('');expect(page.url()).toBe(currentURL);expect(await markdown(page)).toBe(raw);expect(await selection(page)).toEqual(before);await popup.close();}
 // The modifier handler also cancels native navigation for a dangerous href.
 await anchor.evaluate(a=>a.setAttribute('href','javascript:window.__unsafeLink=true'));await anchor.click({modifiers:['Control']});expect(await page.evaluate(()=>(window as any).__unsafeLink)).toBeUndefined();expect(context.pages()).toHaveLength(1);expect(await markdown(page)).toBe(raw);
});

test('link selection controls never shift text during boundary drag selection',async({page})=>{
 await ready(page);const raw='普通前行\n\n[这是链接中的文字](https://example.com/)\n\n普通后行';await setDoc(page,raw);
 const positions=await page.evaluate(()=>{const e=(window as any).__mojian.editor;let link=1;e.state.doc.descendants((n:any,pos:number)=>{if(n.isText&&n.marks.some((m:any)=>m.type.name==='link'))link=pos;});return {link};});
 const layout=()=>page.locator('.article-editor p').evaluateAll(elements=>elements.map(el=>({top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height})));
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection(1);e.commands.focus();});const baseline=await layout();
  for(let i=0;i<4;i++){
   await page.evaluate(pos=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection({from:pos+1,to:pos+4});e.commands.focus();},positions.link);await expect(page.getByRole('button',{name:'编辑链接',exact:true})).toBeVisible();expect(await layout()).toEqual(baseline);
   await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection(1);e.commands.focus();});await expect(page.getByRole('button',{name:'编辑链接',exact:true})).toHaveCount(0);expect(await layout()).toEqual(baseline);
  }
  const anchor=(await page.locator('.article-editor a').boundingBox())!;
  await page.mouse.move(anchor.x+5,anchor.y+anchor.height/2);await page.mouse.down();
  for(let i=0;i<6;i++){await page.mouse.move(anchor.x+55,anchor.y+anchor.height+5);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));expect(await layout()).toEqual(baseline);await page.mouse.move(anchor.x+55,anchor.y+anchor.height/2);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));expect(await layout()).toEqual(baseline);}
  await page.mouse.up();expect(await markdown(page)).toBe(raw);
 }
 await page.screenshot({path:'/tmp/mojian-link-selection-stable.png'});
});

test('separate link and table action row overlays without moving text or formatting toolbar',async({page})=>{
 await ready(page);const raw='普通前行\n\n| 表头 | 列二 |\n| --- | --- |\n| [表格链接](https://example.com/) | 单元格正文 |\n\n普通后行';await setDoc(page,raw);
 const positions=await page.evaluate(()=>{const e=(window as any).__mojian.editor;let link=1,cell=1;e.state.doc.descendants((n:any,pos:number)=>{if(n.isText&&n.marks.some((m:any)=>m.type.name==='link'))link=pos;if(n.isText&&n.text==='单元格正文')cell=pos;});return {link,cell};});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});await page.evaluate(()=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection(1);e.commands.focus();});
  const measure=()=>page.evaluate(()=>{const scroll=document.querySelector('.writing-scroll')!;const p=document.querySelector('.article-editor p')!;const table=document.querySelector('.article-editor table')!;const toolbar=document.querySelector('.toolbar')!;return {scrollTop:scroll.scrollTop,scrollY:scroll.getBoundingClientRect().top,textY:p.getBoundingClientRect().top,tableY:table.getBoundingClientRect().top,toolbarHeight:toolbar.getBoundingClientRect().height};});const baseline=await measure();
  for(const pos of [positions.cell,positions.link+1,1,positions.link+1,positions.cell,1]){
   await page.evaluate(pos=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection(pos);e.commands.focus();},pos);expect(await measure()).toEqual(baseline);
   if(pos!==1){await expect(page.locator('.context-overlay [aria-label="表格操作"]')).toBeVisible();expect(await page.locator('.toolbar .context-tools').count()).toBe(0);const row=(await page.locator('.context-overlay').boundingBox())!;expect(row.y+row.height).toBeLessThanOrEqual(baseline.textY);}
   if(pos===positions.link+1)await expect(page.locator('.context-overlay [aria-label="链接操作"]')).toBeVisible();
  }
  await page.evaluate(pos=>{const e=(window as any).__mojian.editor;e.commands.setTextSelection(pos);e.commands.focus();},positions.link+1);await page.screenshot({path:`/tmp/mojian-context-overlay-${width}.png`});
 }
 expect(await markdown(page)).toBe(raw);
});

test('image widths 1 to 200 survive source, refresh, and rich output with local overflow only',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await ready(page);await setDoc(page,'![尺寸测试](https://raw.githubusercontent.com/github/explore/main/topics/markdown/markdown.png "width=150%")');await page.locator('.image-box img').click();
 const input=page.getByRole('spinbutton',{name:'图片宽度百分比'});await expect(input).toHaveAttribute('min','1');await expect(input).toHaveAttribute('max','200');
 for(const width of [1,100,150,200]){await input.fill(String(width));await expect.poll(()=>markdown(page)).toContain(`width=${width}%`);expect(await page.locator('.image-box').evaluate(el=>parseFloat((el as HTMLElement).style.width))).toBe(width);}
 await input.fill('1');await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();await expect(page.locator('.source-editor')).toHaveValue(/width=1%/);expect(await markdown(page)).toContain('width=1%');await page.getByRole('button',{name:'所见即所得',exact:true}).click();await page.locator('.image-box img').click();await input.fill('200');await page.keyboard.press('Control+s');await expect(page.locator('.save-indicator')).toContainText('已保存');await page.reload();await page.waitForFunction(()=>!!(window as any).__mojian?.editor);expect(await markdown(page)).toContain('width=200%');
 await prepared(page);await page.getByRole('button',{name:'公众号预览',exact:true}).click();await expect(page.locator('.preview-paper [data-image-scroll] img')).toBeVisible();const dimensions=await page.locator('.preview-paper [data-image-scroll]').evaluate(el=>({frame:el.clientWidth,content:el.scrollWidth,image:el.querySelector('img')!.getBoundingClientRect().width}));expect(dimensions.content).toBeGreaterThan(dimensions.frame);expect(dimensions.image/dimensions.frame).toBeCloseTo(2,1);
 await page.getByRole('button',{name:'复制到公众号',exact:true}).click();const clip=await page.evaluate(async()=>{const item=(await navigator.clipboard.read())[0];const div=document.createElement('div');div.innerHTML=await(await item.getType('text/html')).text();return {types:item.types,width:(div.querySelector('img') as HTMLElement).style.width,scroll:!!div.querySelector('[data-image-scroll]')};});expect(clip.width).toBe('200%');expect(clip.scroll).toBe(true);expect(clip.types).toEqual(expect.arrayContaining(['text/html','text/plain']));await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);await page.screenshot({path:'/tmp/mojian-image-200.png'});
});

test('column alignment controls and context menu persist GFM header and data alignment',async({page})=>{
 await ready(page);await setDoc(page,'| 表头一 | 表头二 |\n| --- | --- |\n| 一 | 二 |\n| 三 | 四 |');await cursor(page,'一',1);
 const align=page.getByLabel('当前列对齐',{exact:true});await align.selectOption('right');await expect(page.locator('.article-editor th').first()).toHaveCSS('text-align','right');await expect(page.locator('.article-editor td').nth(2)).toHaveCSS('text-align','right');expect(await markdown(page)).toContain('---:');await page.keyboard.press('Control+z');await expect(page.locator('.article-editor th').first()).not.toHaveCSS('text-align','right');
 await cursor(page,'三');await align.selectOption('center');expect(await markdown(page)).toContain(':---:');await page.locator('.article-editor td').nth(1).click({button:'right'});await page.getByRole('button',{name:'当前列右对齐',exact:true}).click();await expect(page.locator('.article-editor th').nth(1)).toHaveCSS('text-align','right');
 const raw=await markdown(page);await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();await page.getByRole('button',{name:'所见即所得',exact:true}).click();expect(await markdown(page)).toBe(raw);await page.keyboard.press('Control+s');await expect(page.locator('.save-indicator')).toContainText('已保存');await page.reload();await page.waitForFunction(()=>!!(window as any).__mojian?.editor);await expect(page.locator('.article-editor th').first()).toHaveCSS('text-align','center');await prepared(page);await page.getByRole('button',{name:'公众号预览',exact:true}).click();await expect(page.locator('.preview-paper th').first()).toHaveCSS('text-align','center');await expect(page.locator('.preview-paper td').nth(1)).toHaveCSS('text-align','right');
});

test('task checkboxes align with first text line on desktop mobile and multiline nested lists',async({page})=>{
 await ready(page);await setDoc(page,'- [ ] 中文清单第一行\n- [x] '+ '较长的清单文字用于验证换行。'.repeat(8)+'\n  - [ ] 嵌套清单\n');
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});const diffs=await page.locator('.article-editor ul[data-type="taskList"] li').evaluateAll(items=>items.map(li=>{const checkbox=li.querySelector(':scope > label input')!;const p=li.querySelector(':scope > div > p')!;const r=document.createRange();r.setStart(p.firstChild!,0);r.setEnd(p.firstChild!,1);const text=r.getBoundingClientRect();const input=checkbox.getBoundingClientRect();return Math.abs((text.top+text.bottom)/2-(input.top+input.bottom)/2);}));expect(diffs.every(d=>d<=3)).toBe(true);await page.locator('.article-editor input[type=checkbox]').first().check();expect(await markdown(page)).toContain('- [x] 中文清单第一行');}
 await page.screenshot({path:'/tmp/mojian-task-alignment.png'});
});


test('quote Backspace joins preceding paragraph while empty Enter splits the quote, with undo and Markdown roundtrip',async({page})=>{
 await ready(page);await setDoc(page,'> 第一段 **粗体**\n>\n> 第二段\n>\n> 第三段');
 await cursor(page,'第二段',0);await page.keyboard.press('Backspace');
 await expect(page.locator('.article-editor blockquote')).toHaveCount(1);await expect(page.locator('.article-editor blockquote > p')).toHaveCount(2);await expect(page.locator('.article-editor blockquote > p').first()).toHaveText('第一段 粗体第二段');expect((await selection(page)).from).toBe(8);await expect(page.locator('.article-editor strong')).toHaveText('粗体');
 await page.keyboard.press('Control+z');await expect(page.locator('.article-editor blockquote > p')).toHaveCount(3);await page.keyboard.press('Control+Shift+z');await expect(page.locator('.article-editor blockquote > p')).toHaveCount(2);
 await cursor(page,'第三段',0);await page.keyboard.press('Enter');await expect(page.locator('.article-editor blockquote > p')).toHaveCount(3);
 // Position the empty paragraph explicitly; the physical arrow movement depends
 // on fonts/viewport, while the actual Backspace/Enter remains a browser event.
 await page.evaluate(()=>{const e=(window as any).__mojian.editor;let at=0;e.state.doc.descendants((n:any,pos:number,parent:any)=>{if(n.type.name==='paragraph'&&!n.content.size&&parent?.type.name==='blockquote')at=pos+1;});e.commands.setTextSelection(at);e.commands.focus();});await expect(page.locator('.article-editor')).toBeFocused();await page.keyboard.press('Backspace');await expect(page.locator('.article-editor blockquote')).toHaveCount(1);await expect(page.locator('.article-editor blockquote > p')).toHaveCount(2);expect((await selection(page)).from).toBe(11);
 await setDoc(page,'> 上半段\n>\n> 下半段');await cursor(page,'下半段',0);await page.keyboard.press('Enter');await page.evaluate(()=>{const e=(window as any).__mojian.editor;let at=0;e.state.doc.descendants((n:any,pos:number,parent:any)=>{if(n.type.name==='paragraph'&&!n.content.size&&parent?.type.name==='blockquote')at=pos+1;});e.commands.setTextSelection(at);e.commands.focus();});await expect(page.locator('.article-editor')).toBeFocused();await page.keyboard.press('Enter');
 await expect(page.locator('.article-editor > blockquote')).toHaveCount(2);await expect(page.locator('.article-editor > p').first()).toHaveText('');await expect(page.locator('.article-editor > blockquote').first()).toHaveText('上半段');await expect(page.locator('.article-editor > blockquote').nth(1)).toHaveText('下半段');expect((await selection(page)).from).toBe(8);
 await page.keyboard.press('Control+z');await expect(page.locator('.article-editor > blockquote')).toHaveCount(1);await page.keyboard.press('Control+Shift+z');await expect(page.locator('.article-editor > blockquote')).toHaveCount(2);await page.keyboard.insertText('退出引用的正文');await expect(page.locator('.article-editor > p').first()).toHaveText('退出引用的正文');
 const md=await markdown(page);await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();await page.getByRole('button',{name:'所见即所得',exact:true}).click();expect(await markdown(page)).toBe(md);await expect(page.locator('.article-editor > blockquote')).toHaveCount(2);
});

test('quote editing respects text deletion, first paragraph boundary, nested quotes and composition',async({page})=>{
 await ready(page);await setDoc(page,'> 第一段\n>\n> 第二段');await cursor(page,'第二段',2);await page.keyboard.press('Backspace');await expect(page.locator('.article-editor blockquote')).toHaveCount(1);await expect(page.locator('.article-editor blockquote > p').nth(1)).toHaveText('第段');
 await setDoc(page,'> 第一段\n>\n> 第二段');await cursor(page,'第二段',0);const before=await markdown(page);await page.locator('.article-editor').dispatchEvent('keydown',{key:'Backspace',code:'Backspace',isComposing:true});expect(await markdown(page)).toBe(before);
 await cursor(page,'第一段',0);await page.keyboard.press('Backspace');await expect(page.locator('.article-editor > p').first()).toHaveText('第一段');await expect(page.locator('.article-editor blockquote')).toHaveCount(1);await expect(page.locator('.article-editor blockquote')).toHaveText('第二段');
 await setDoc(page,'> 外层\n>\n> > 内层第一段\n> >\n> > 内层第二段');await cursor(page,'内层第二段',0);await page.keyboard.press('Backspace');await expect(page.locator('.article-editor > blockquote')).toHaveCount(1);await expect(page.locator('.article-editor blockquote blockquote')).toHaveCount(1);await expect(page.locator('.article-editor blockquote blockquote > p')).toHaveText('内层第一段内层第二段');
 await cursor(page,'内层第一段内层第二段',10);await page.keyboard.press('Enter');await page.keyboard.press('Enter');await expect(page.locator('.article-editor > blockquote')).toHaveCount(1);await expect(page.locator('.article-editor blockquote blockquote > p')).toHaveCount(1);expect(await page.evaluate(()=>(window as any).__mojian.editor.state.selection.$from.depth)).toBe(2);await page.keyboard.insertText('仍在外层引用');await expect(page.locator('.article-editor > blockquote > p').last()).toHaveText('仍在外层引用');
 await setDoc(page,'> 引用末尾');await cursor(page,'引用末尾',4);await page.keyboard.press('Enter');await page.keyboard.press('Enter');await expect(page.locator('.article-editor blockquote > p')).toHaveCount(1);await page.keyboard.insertText('普通正文');await expect(page.locator('.article-editor > p').first()).toHaveText('普通正文');

});
