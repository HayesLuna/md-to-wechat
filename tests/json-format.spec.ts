import { test, expect } from './fixtures';

test('JSON indentation preserves every value and escape without validating JSON', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { indentJSON } = await import('/src/jsonIndentation.ts');
    const source = '{ "id":9007199254740993,"id":1,"negative":-0,"exp":1e+09,"text":"\\u4e2d {[,] : \\\"quote\\\" \\\\ \\t", "empty": [ {},[] ], "values":[true,false,null,1.2300] }';
    const result = indentJSON(source);
    const formatted = result.text;
    const opaque = '{unquoted:tru e,"value":unknown}';
    return {
      source, formatted, again: indentJSON(formatted).text,
      selections: Array.from(source.matchAll(/"(?:\\.|[^"\\])*"|[^\s{}\[\],:]+/g), match => ({
        before: match[0], after: formatted.slice(result.mapOffset(match.index!, 1), result.mapOffset(match.index! + match[0].length, -1)),
      })),
      opaque: indentJSON(opaque).text,
      unfinished: ['{"text":"unfinished', '{"a":1', '[1}'].map(text => ({text, formatted:indentJSON(text).text})),
    };
  });
  const tokens = (text: string) => text.match(/"(?:\\.|[^"\\])*"|[^\s]/g);
  expect(tokens(result.formatted)).toEqual(tokens(result.source));
  expect(result.formatted).toContain('\n  "id": 9007199254740993,\n  "id": 1,');
  expect(result.formatted).toContain('"values": [\n    true,\n    false,\n    null,\n    1.2300\n  ]');
  expect(result.again).toBe(result.formatted);
  for (const selection of result.selections) expect(selection.after).toBe(selection.before);
  expect(result.opaque).toBe('{\n  unquoted: tru e,\n  "value": unknown\n}');
  for (const entry of result.unfinished) expect(entry.formatted).toBe(entry.text);
});

test('formatting is exposed only for explicit JSON and never runs on typing', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  const source = '{"items":[1,2]}';
  await page.evaluate(source => {
    const m=(window as any).__mojian;
    m.setMarkdown(['', 'jsonc', 'javascript', 'txt', 'JSON'].map(language => '```'+language+'\n'+source+'\n```').join('\n\n'));
  }, source);
  const blocks=page.locator('.code-node');
  await expect(page.getByRole('button',{name:'格式化 JSON',exact:true})).toHaveCount(1);
  for (let i=0;i<5;i++) await expect(blocks.nth(i).locator('pre')).toHaveText(source);
  await blocks.last().getByRole('textbox',{name:'代码语言',exact:true}).fill('txt');
  await expect(page.getByRole('button',{name:'格式化 JSON',exact:true})).toHaveCount(0);
  await blocks.last().getByRole('textbox',{name:'代码语言',exact:true}).fill('json');
  await page.evaluate(() => (window as any).__mojian.editor.commands.focus('end'));
  await expect(page.locator('.article-editor')).toBeFocused();
  await page.keyboard.type(' ');
  await expect(blocks.last().locator('pre')).toHaveText(source+' ');
  await blocks.last().getByRole('button',{name:'格式化 JSON',exact:true}).click();
  await expect(blocks.last().locator('pre')).toHaveText('{\n  "items": [\n    1,\n    2\n  ]\n}');
  await expect(blocks.first().locator('pre')).toHaveText(source);
  await page.evaluate(() => { const m=(window as any).__mojian;m.setMarkdown('```json\n\n```'); });
  await expect(page.getByRole('button',{name:'格式化 JSON',exact:true})).toBeDisabled();
});

for (const width of [1440,390]) test(`format current JSON block with a stable selection, undo and output at ${width}px`,async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.setViewportSize({width,height:900});
  await page.goto('/');
  await expect(page).toHaveTitle('墨笺 · Markdown 公众号排版');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.waitForFunction(()=>!!(window as any).__mojian?.editor);
  const original='{"name":"张三","id":9007199254740993,"city":"北京"}';
  const formatted='{\n  "name": "张三",\n  "id": 9007199254740993,\n  "city": "北京"\n}';
  const markdown='前面的正文\n\n```json\n'+original+'\n```\n\n```js\nconst untouched = 1;\n```\n\n后面的正文';
  await page.evaluate(({markdown,original})=>{
    const m=(window as any).__mojian;m.setMarkdown(markdown);
    const e=m.editor;let start=0;
    e.state.doc.descendants((node:any,pos:number)=>{if(node.type.name==='codeBlock'&&node.attrs.language==='json')start=pos+1;});
    const from=start+original.indexOf('"张三"');e.commands.setTextSelection({from,to:from+4});e.commands.focus();
    (window as any).__jsonUpdates=0;e.on('update',()=>{(window as any).__jsonUpdates++;});
  },{markdown,original});
  await expect(page.locator('.article-editor')).toBeFocused();
  const block=page.locator('.code-node[data-language=json]');
  const button=block.getByRole('button',{name:'格式化 JSON',exact:true});
  await expect(button).toBeVisible();
  const bounds=await button.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width);
  await button.click();
  await expect(block.locator('pre')).toHaveText(formatted);
  expect(await page.evaluate(()=>window.getSelection()?.toString())).toBe('"张三"');
  expect(await page.evaluate(()=>(window as any).__jsonUpdates)).toBe(1);
  await expect(page.locator('.code-node[data-language=js] pre')).toHaveText('const untouched = 1;');
  await expect(block.locator('.hljs-attr')).toHaveCount(3);
  await page.screenshot({path:`/tmp/mojian-json-format-editor-${width}.png`});
  await button.click();
  expect(await page.evaluate(()=>(window as any).__jsonUpdates)).toBe(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(block.locator('pre')).toHaveText(original);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(block.locator('pre')).toHaveText(formatted);
  await block.getByRole('button',{name:'复制代码',exact:true}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(formatted);
  const downloaded=page.waitForEvent('download');await block.getByRole('button',{name:'下载源码',exact:true}).click();
  const download=await downloaded;expect(download.suggestedFilename()).toBe('墨笺代码.json');
  const stream=await download.createReadStream();let downloadedText='';for await(const chunk of stream!)downloadedText+=chunk.toString();expect(downloadedText).toBe(formatted);
  await page.waitForFunction(()=>{const m=(window as any).__mojian;return m.getOutput()?.key===JSON.stringify([m.getMarkdown(),m.getSettings()]);});
  await page.getByRole('button',{name:'公众号预览',exact:true}).click();
  const lines=await page.locator('.preview-paper [data-code-index="0"] [data-code-line]').allTextContents();
  expect(lines.map(line=>line.replace(/\u00a0/g,' ')).join('\n')).toBe(formatted);
  await page.screenshot({path:`/tmp/mojian-json-format-${width}.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.reload();await page.waitForFunction(()=>!!(window as any).__mojian?.editor);
  await expect(page.locator('.code-node[data-language=json] pre')).toHaveText(formatted);
  expect(errors).toEqual([]);
});

test('size, expanded-line and nesting safeguards leave the document and undo history untouched',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);
  for(const source of ['{"text":"'+'中'.repeat(7000)+'"}', '['+'0,'.repeat(2000)+'0]', '['.repeat(65)+'0'+']'.repeat(65)]){
    await page.evaluate(source=>{const m=(window as any).__mojian;m.setMarkdown('```json\n'+source+'\n```');(window as any).__jsonUpdates=0;m.editor.on('update',()=>{(window as any).__jsonUpdates++;});},source);
    await page.getByRole('button',{name:'格式化 JSON',exact:true}).click();
    await expect(page.locator('.toast')).toContainText('原文已保留');
    expect(await page.evaluate(()=>(window as any).__mojian.editor.state.doc.firstChild.textContent)).toBe(source);
    expect(await page.evaluate(()=>(window as any).__jsonUpdates)).toBe(0);
  }
});

test('formatting the clicked block preserves outside edits and is separate from following typing in history',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);
  await page.evaluate(()=>{const m=(window as any).__mojian;m.setMarkdown('正文\n\n```json\n{"a":1}\n```');m.editor.commands.focus(2);});
  await expect(page.locator('.article-editor')).toBeFocused();await page.keyboard.insertText('输入');
  await page.getByRole('button',{name:'格式化 JSON',exact:true}).click();
  await expect(page.locator('.article-editor p').first()).toHaveText('正输入文');
  await expect(page.locator('.code-node pre')).toHaveText('{\n  "a": 1\n}');
  await page.keyboard.insertText('后');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.article-editor p').first()).toHaveText('正输入文');
  await expect(page.locator('.code-node pre')).toHaveText('{\n  "a": 1\n}');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.code-node pre')).toHaveText('{"a":1}');
  await expect(page.locator('.article-editor p').first()).toHaveText('正输入文');
});

test('formatting re-highlights only the changed JSON block; repeated formatting does no editor work',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);
  await page.evaluate(()=>{
    const m=(window as any).__mojian;
    m.setMarkdown(Array.from({length:12},(_,index)=>'```json\n{"value":'+index+'}\n```').join('\n\n'));
  });
  await expect(page.locator('.article-editor .hljs-attr')).toHaveCount(12);
  await page.evaluate(async()=>{
    const {lowlight}=await import('/src/syntax.ts');
    const highlight=lowlight.highlight;
    (window as any).__jsonHighlightCalls=[];
    lowlight.highlight=(...args)=>{(window as any).__jsonHighlightCalls.push(args[0]);return highlight(...args);};
    (window as any).__jsonUpdates=0;(window as any).__mojian.editor.on('update',()=>{(window as any).__jsonUpdates++;});
  });
  const button=page.getByRole('button',{name:'格式化 JSON',exact:true}).first();
  await button.click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__jsonHighlightCalls)).toEqual(['json']);
  await button.click();
  await page.waitForTimeout(180);
  expect(await page.evaluate(()=>(window as any).__jsonHighlightCalls)).toEqual(['json']);
  expect(await page.evaluate(()=>(window as any).__jsonUpdates)).toBe(1);
});
