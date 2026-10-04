import { test, expect } from './fixtures';
test('first screen and preview',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{name:'墨笺',exact:true})).toBeVisible();
 await expect(page.locator('.article-editor h1')).toHaveText('写作，从一张白纸开始');
 await page.getByRole('button',{name:'公众号预览',exact:true}).click();
 await expect(page.locator('.preview-paper h1')).toHaveText('写作，从一张白纸开始');
 await expect(page.locator('.mermaid-editor-preview .diagram svg')).toBeVisible({timeout:20000});
 await page.screenshot({path:'/tmp/mojian-desktop.png'});
 expect(errors).toEqual([]);
});
