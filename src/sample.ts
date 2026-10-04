export const SAMPLE = `# 写作，从一张白纸开始

好的表达，不需要复杂的工具。让想法自然流动，让文字有自己的呼吸。

## 让表达回归简单

墨笺是一张安静的白纸。你可以直接写作，也可以切换到 Markdown 源码，让每一个细节都在掌握之中。

> 写作，是把心里的声音，慢慢变成看得见的文字。

### 从这里开始

1. **写下你的想法**，不用急着排版。
2. 用标题、列表和引用，让内容更有层次。
   - 保持简洁，也保留 *恰当的强调*。
   - 试试 [Markdown 指南](https://www.markdownguide.org/)，或写一段 \`行内代码\`。
3. 打开公众号预览，选择喜欢的排版，最后复制。

### 一份小小的写作清单

- [x] 留下一个有吸引力的标题
- [x] 让段落长短有节奏
- [ ] 完成之后，再认真读一遍

## 为文字安排合适的位置

| 功能 | 写作方式 | 输出 |
| :--- | :---: | ---: |
| 正文 | 所见即所得 | 公众号排版 |
| 代码 | 保留原始格式 | 完整高亮 |
| 草稿 | 浏览器本地保存 | UTF-8 Markdown |

### 代码也可以很好看

\`\`\`javascript
/* 一段多行注释，
   也有自己的节奏。 */
function hello(name) {
\tconst message = "你好，" + name;

\tconsole.log(message); // 连续空格、空行与 Tab 都保留
\treturn "这一行稍微长一些，用来检查代码的横向滚动，而不让整个页面变得更宽。";
}
\`\`\`

### 让思路变成图形

\`\`\`mermaid
flowchart LR
  A[写下想法] --> B[整理结构]
  B --> C[预览排版]
  C --> D[分享文字]
\`\`\`

图形可以下载后上传到公众号，复制时会保留对应的插入位置说明。

## 图片，也属于你的表达

![Markdown 标志](https://raw.githubusercontent.com/github/explore/main/topics/markdown/markdown.png "width=35%")

这是一张公开 URL 图片，选中后可以拖拽调整尺寸。也可以通过工具栏插入本地图片。图片只保存在当前浏览器，迁移到公众号时需要重新上传。

---

愿每一次落笔，都更接近你想说的话。
`;
export type Settings = { theme: 'default' | 'simple' | 'elegant'; color: string; fontSize: number; lineHeight: number; codeTheme: 'light' | 'dark' };
export const DEFAULT_SETTINGS: Settings = { theme:'default', color:'#a6493d', fontSize:16, lineHeight:1.85, codeTheme:'light' };
