# 第三方与来源说明

本项目从零实现角色扮演流程；没有复制 D:\re-sillytavern 中的 SillyTavern 源文件、浏览器扩展或测试执行代码。字段名和导入数据格式用于数据兼容。导入的角色卡和文本仍属于其原作者/用户，导入不授予重新分发权。

主要运行依赖：

- @earendil-works/pi-ai 0.85.0、@earendil-works/pi-agent-core 0.85.0：MIT，Mario Zechner / Earendil Works。[上游仓库](https://github.com/earendil-works/pi)。
- React / React DOM：MIT。
- Fastify / @fastify/static：MIT。
- Drizzle ORM：Apache-2.0。
- better-sqlite3：MIT；SQLite 核心为 public domain。
- Zod：MIT；Lucide 图标：ISC。
- Vite、vite-plugin-pwa 等构建依赖遵循各自许可证。

精确的传递依赖版本记录在 pnpm-lock.yaml。这里只是开发来源清单，不是完整的再分发许可证包。项目当前为 private，尚未选定项目许可证；对外发布前应生成完整依赖清单、保留第三方许可证与声明，并审核导入内容的使用权。

OpenAI API 接口实现参照官方文档并由 Pi 协议适配器承接；未嵌入 OpenAI Codex、SillyTavern 或 DeepSeek Harness 的应用运行时代码。
