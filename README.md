# 墨笺 · Markdown 公众号排版

纯浏览器中文单篇文章编辑工具：所见即所得写作 → 公众号排版预览 → 复制到微信公众号编辑器。采用 React、Vite、Tiptap / ProseMirror 和 GFM Markdown；没有后端、登录、数据库服务或图片上传服务器。

## 开源协议与贡献

本项目采用 [MIT License](LICENSE)，允许商用、修改和闭源分发；复制或分发本项目的软件或其重要部分时，须保留版权和许可声明。软件按原样提供，不附带担保。第三方依赖及资源仍遵循各自的许可。

欢迎提交 Issue 和 Pull Request，具体流程见 [贡献指南](CONTRIBUTING.md)。只有仓库所有者授权的协作者拥有本仓库的写入权限；其他人可以通过 Fork 和 PR 参与贡献。

## 运行

需要 Node.js 22.12+（本云环境为 Node.js 24）。

```sh
cd /workspace/md-to-wechat
npm ci --cache /tmp/mojian-npm-cache --no-audit --no-fund
npm run dev
```

开发服务监听 0.0.0.0:5173。生产构建运行 `npm run build`，将 `dist/` 部署到 HTTPS 静态站点即可使用。`npm run preview` 可检查生产构建。部署不需要服务器端应用。

`npm test` 运行 Chromium 中的实际交互测试。云环境公网示例图片由测试夹具通过已有 HTTPS 客户端代理获得真实且通过 TLS 校验的响应，再交给浏览器解码；这不代表 Chromium 直接公网访问已验证。未禁用 TLS/网页安全，也未修改持久证书信任。浏览器由带 npm integrity 校验的 `@sparticuz/chromium` 提供，不依赖环境中被拦截的 Playwright 浏览器下载域名。

## 内容与本地资源

- Markdown 是唯一持久化正文。源码模式保留原始输入，不在每次输入时格式化。切换到所见即所得时解析，编辑后按标准 Markdown 序列化；结构、列表层级、代码源码、语言和图片尺寸往返保存。
- 图片宽度约定：`![说明](https://example.com/image.png "width=80%")`。支持 10–100 整数百分比。没有宽度约定时默认为 100%。尺寸约定由编辑器、预览、导入与导出共同处理。
- 本地图片使用 `![说明](local-image:UUID "width=80%")`。二进制存储在当前站点的 IndexedDB，运行时 blob URL 不进入 Markdown。单独的 `.md` 不包含二进制；导出后请同时下载本地图片。其他浏览器导入时缺失资源明确显示。
- 草稿及排版设置保存在 IndexedDB。保存串行执行并带版本检查；图片写入成功后才插入正文，正文保存完成后才报告已保存。存储失败保留内容，允许重试和导出。清除站点数据会丢失草稿和本地图片。
- 代码折叠仅为界面状态。复制代码使用原始源码；未知语言显示纯代码。Mermaid 源码仍以 `mermaid` 围栏保存，异步渲染严格清理 SVG，过期结果不能替换当前图形。

## 公众号输出与剪贴板

预览和复制共享 `src/output.ts` 的 Markdown 快照解析、DOMPurify 清理、兼容处理及内联样式流程。普通公开图片进入输出，但其防盗链、下载与公众号迁移行为仍需检查。本地图片及 Mermaid 不被冒充为可迁移的图片：复制前展示清单、下载入口，确认后在对应位置输出静态说明。Mermaid 语法错误阻止复制。

公众号复制只通过一次 `navigator.clipboard.write` 写入一个同时含 `text/html` 和 `text/plain` 的 ClipboardItem。仅在 Promise 成功完成后报告成功；不支持、拒绝或写入失败只提示原因，没有 `execCommand`、`writeText` 或隐藏选区降级。正文纯文本从 DOM 结构生成，保留段落、列表序号、表格分隔和代码空白。复制源码及代码是独立的现代纯文本操作。

HTTPS 独立页面的富文本权限和支持度因浏览器而异，嵌入式预览可能受 Permissions Policy 限制。不要将 API 存在等同于复制成功。

## 测试范围

18 项 Chromium 浏览器测试覆盖中文符号快捷输入及 composition 事件保护、列表/表格/代码渐进选择、选区恢复、表格保护/增删/两阶段删除/撤销、异步图片位置映射、图片尺寸往返与拖拽撤销、存储失败保留内容、导入取消和 UTF-8 导出、Mermaid 错误恢复及 PNG 文件生成、重复标题大纲、网页全屏与 Esc 层级、390px 手机布局、实际双格式剪贴板及失败不降级、安全清理与新旧快照检查。

自动合成 composition 事件不能代替真实中文输入法。以下仍需人工验收：

1. Windows、macOS、iOS、Android 中文输入法组合输入，外接键盘与软键盘遮挡时的光标可见性。
2. Safari、Firefox 及各种手机/嵌入浏览器的富文本权限与粘贴支持。
3. 微信公众号编辑器中的外链可点击性、公开图片迁移、防盗链、手动上传位置、代码高亮/空行/缩进、嵌套列表与宽表格显示。

## 项目连接

源码位于本云环境的 `md-to-wechat` 仓库。当前会话没有可读取、更新或发布 `sites-project://appgprj_6ac1c592fc788191af0474cfb1405dd6` 的工具，所以不声称已同步到该 Sites 项目或已经获得公网网址。`dist/` 是可部署的完整静态构建产物。
