# 第三方与来源说明

本项目从零实现角色扮演流程；没有复制 SillyTavern 源文件、浏览器扩展或测试执行代码。字段名和导入数据格式用于数据兼容。导入的角色卡和文本仍属于其原作者/用户，导入不授予重新分发权。

主要运行依赖：

- @earendil-works/pi-ai 0.85.0、@earendil-works/pi-agent-core 0.85.0：MIT，Mario Zechner / Earendil Works。[上游仓库](https://github.com/earendil-works/pi)。
- React / React DOM：MIT。
- Fastify / @fastify/static：MIT。
- Drizzle ORM：Apache-2.0。
- better-sqlite3：MIT；SQLite 核心为 public domain。
- Zod：MIT；Lucide 图标：ISC。
- Vite、vite-plugin-pwa 等构建依赖遵循各自许可证。

精确的传递依赖版本记录在 pnpm-lock.yaml。这里只是开发来源清单，不是完整的再分发许可证包。项目原创代码采用 [MIT 许可证](LICENSE)。第三方依赖保留各自的许可证与声明；发布分发包时应包含适用的第三方许可，并审核随包内容的使用权。package.json 的 private 字段仅用于防止意外发布 npm 包。

OpenAI API 接口实现参照官方文档并由 Pi 协议适配器承接；未嵌入 OpenAI Codex、SillyTavern 或 DeepSeek Harness 的应用运行时代码。

字体 / Fonts：界面通过 CSS 字体列表引用设备上已安装的字体及通用回退，不附带、复制或下载字体文件。字体本身仍受各自许可证约束；项目的 MIT 许可证不适用于这些字体。微软允许网页在 CSS 字体列表中指定 Windows 字体，但从系统复制字体用于网页托管或随应用分发需要另外核对授权。参见 [Microsoft font redistribution FAQ](https://learn.microsoft.com/en-us/typography/fonts/font-faq#web)。

The interface uses locally installed fonts through CSS font stacks and generic fallbacks. No font files are bundled, copied, or downloaded. Fonts retain their own licenses and are not covered by this project's MIT license. Microsoft's FAQ permits naming Windows fonts in CSS stacks; hosting or redistributing the font files is a separate licensing matter.

## Pi 许可全文 / Pi license

以下版权及许可文本来自 [Pi v0.85.0](https://github.com/earendil-works/pi/blob/v0.85.0/LICENSE)，适用于所使用的 `@earendil-works/pi-ai` 和 `@earendil-works/pi-agent-core`。分发包含这些依赖的整合包时，须保留此声明。

The following copyright and license text is from Pi v0.85.0 and applies to the Pi dependencies used here. Keep this notice when distributing a package that includes them.

```text
MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
