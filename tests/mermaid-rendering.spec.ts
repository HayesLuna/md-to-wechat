import { test, expect } from './fixtures';

test('mixed-case Mermaid fences render in editor, article preview and enlarged view',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);
 const markdown='```Mermaid\nflowchart LR\nA[开始] --> B[完成]\n```';
 await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();await page.getByRole('textbox',{name:'Markdown 源码正文'}).fill(markdown);
 await page.getByRole('button',{name:'所见即所得',exact:true}).click();await expect(page.locator('.diagram svg')).toBeVisible();
 await page.getByRole('button',{name:'预览 Mermaid 图表',exact:true}).click();await expect(page.getByRole('dialog',{name:'图表预览'}).locator('img')).toBeVisible();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'公众号预览',exact:true}).click();await expect(page.locator('[data-mermaid-block] svg')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__mojian.getMarkdown())).toBe(markdown);
});

test('common Mermaid diagram types render with visible SVG dimensions and recover after invalid syntax',async({page})=>{
 test.setTimeout(60000);await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);
 const results=await page.evaluate(async()=>{
  const {diagram}=await import('/src/mermaid.ts');
  const sources=['flowchart TD\nA[开始] --> B{选择}\nB --> C[完成]','sequenceDiagram\n用户->>服务: 请求\n服务-->>用户: 响应','classDiagram\nAnimal <|-- Duck','stateDiagram-v2\n[*] --> Active\nActive --> [*]','erDiagram\nUSER ||--o{ ORDER : places','pie title 比例\n"写作" : 60\n"排版" : 40','mindmap\n  root((文章))\n    写作\n    排版'];
  const sizes=[];
  try{await diagram('invalid syntax !!!');}catch{}
  for(const source of sources){const svg=await diagram(source);const el=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;const box=(el.getAttribute('viewBox')||'').split(/[ ,]+/).map(Number);sizes.push({width:box[2],height:box[3],unsafe:!!el.querySelector('script,foreignObject')});}
  return sizes;
 });
 expect(results).toHaveLength(7);for(const result of results){expect(result.width).toBeGreaterThan(0);expect(result.height).toBeGreaterThan(0);expect(result.unsafe).toBe(false);}
});

test('user fare-date Gantt inside a numbered list renders in editor and preview',async({page})=>{
 test.setTimeout(60000);await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);
 const source=`gantt
    title 固定运价与销售时间轴逻辑约束图 (横向)
    dateFormat  YYYY-MM-DD
    axisFormat  %m-%d

    %% 1. 产品层 (最大范围)
    section 产品层 (最大范围)
    产品生效~截止 (包含主表) :active, p1, 2024-01-01, 2024-12-31

    %% 2. 固定运价主表层
    section 固定运价主表层
    固定运价主表-生效~截止 (覆盖详情) :o1, 2024-02-01, 2024-10-31

    %% 3. 固定运价详情层 (包含详情自身、旅行、销售)
    section 固定运价详情层
    固定运价详情-生效~截止 :d1, 2024-03-01, 2024-09-30
    固定运价详情-最早~最晚旅行 :t1, 2024-04-01, 2024-08-31
    固定运价详情-最早~最晚销售 :s1, 2024-03-15, 2024-05-31`;
 const markdown='2. 固定运价这里的日期进行校验。\n\n   日期的范围大概如图：\n\n   ```mermaid\n'+source.split('\n').map(line=>'   '+line).join('\n')+'\n   ```\n\n   方案：先新建固定运价主表，填写生效日期和截止日期要求先选择产品。\n\n3. 产品类型管理中儿童价格策略、婴儿价格策略都添加选项。';
 await page.getByRole('button',{name:'Markdown 源码',exact:true}).click();await page.getByRole('textbox',{name:'Markdown 源码正文'}).fill(markdown);await page.getByRole('button',{name:'所见即所得',exact:true}).click();
 await expect(page.locator('.diagram svg')).toBeVisible();await expect(page.locator('.diagram svg')).toContainText('固定运价与销售时间轴');
 expect(await page.locator('.diagram svg rect[class*=task]').count()).toBeGreaterThanOrEqual(5);
 await page.getByRole('button',{name:'展示代码',exact:true}).click();await expect(page.locator('.code-node pre')).toContainText(source);await page.getByRole('button',{name:'展示图表',exact:true}).click();
 await page.getByRole('button',{name:'公众号预览',exact:true}).click();await expect(page.locator('[data-mermaid-block] svg')).toBeVisible();await expect(page.locator('[data-mermaid-block] svg')).toContainText('固定运价与销售时间轴');
 await page.locator('.diagram').click();const dialog=page.getByRole('dialog',{name:'图表预览'});await expect(dialog.locator('img')).toBeVisible();expect(await dialog.locator('img').evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBeGreaterThan(0);
 await page.screenshot({path:'/tmp/mojian-user-gantt.png'});
});

test('Typora-style HTML paste retains Mermaid language and source',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__mojian?.editor);
 await page.evaluate(()=>(window as any).__mojian.setMarkdown(''));
 await page.locator('.article-editor').click();
 await page.locator('.article-editor').evaluate(el=>{
  const data=new DataTransfer();data.setData('text/html','<ol start="2"><li><p>日期范围</p><pre lang="mermaid">gantt\n  dateFormat YYYY-MM-DD\n  section 产品\n  生效日期 :p1, 2024-01-01, 2024-12-31</pre></li></ol>');
  data.setData('text/plain','日期范围');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
 });
 await expect(page.locator('.diagram svg')).toBeVisible();await expect(page.getByRole('textbox',{name:'代码语言'})).toHaveValue('mermaid');
 const markdown=await page.evaluate(()=>(window as any).__mojian.getMarkdown());expect(markdown).toContain('```mermaid');expect(markdown).toContain('2024-12-31');
});
