# New AI Chat · v0.2 Alpha

本地优先的 AI 角色扮演 WebUI。前端、后端、契约与 Agent 业务使用 TypeScript；原酒馆目录不被修改，不复制 SillyTavern 源码。

## 直接运行

安装依赖并构建后，双击 **Start.cmd**，会自动打开 [本地 WebUI](http://127.0.0.1:4310)。

第一次使用：

1. 在「导入故事」扫描 SillyTavern 数据目录，查看预览后确认导入。请填写自己的 SillyTavern 数据目录；也可导入本项目的原生故事包。
2. 在左下角「通用设置 → 模型」创建并选择连接，填写协议、Base URL、模型 ID 和你自己的 API Key。所有聊天统一使用它；导入不迁移旧 API Key。
3. 在左下角主角入口设置默认 Persona，或在「故事资料」绑定当前故事的主角。故事资料只保存角色、主角、世界书和场景等内容。
4. 默认普通写作、流式开启；单聊 Auto 使用当前角色，普通群聊需指定回复者。输入框可切换「主角 / 用户旁白」。
5. 需要工具选人或前置规划时，在「通用设置 → 写作」选择 Writer Agent 或 Planner＋Writer。

**Demo.cmd** 使用独立的演示数据库和假模型，完全不调用 API。演示中的回答是固定测试文本，不代表模型质量。真实模式与演示模式默认都占用 4310 端口，不能同时使用同一端口。

## 从源码运行

需要 Node.js 24、pnpm 11。命令在项目根目录执行：

~~~powershell
pnpm install --frozen-lockfile
pnpm build
pnpm start
~~~

开发：pnpm dev（前端 5173，后端 4310）；开发演示：pnpm demo。

关闭启动终端或按 Ctrl+C 可停止服务。项目代码变更后重新执行 pnpm build；Start.cmd 只在没有前端构建时自动构建。

## 已实现的主流程

- 三种协议：OpenAI Chat Completions、Anthropic Messages、OpenAI Responses。Pi AI / Pi Agent Core 精确固定为 0.85.0，隔离在 agent-runtime 包。
- 普通写作一次正文请求、不带工具；Writer Agent 同一会话选人与写作，Planner 可选。支持显式回复者、选人失败回退、取消和可重放 SSE。
- 每个聊天都有不可删除的旁白；名称、头像、风格和主角权限在通用设置统一控制。
- 「通用设置 → 写作」直接显示保护主角和共同创作的原始提示词，可分别编辑、恢复默认并保存；模型只收到当前模式的提示词。模型中的 User 指用户扮演的主角，Assistant 指其他角色和旁白。
- 用户旁白以 user 发送，AI 旁白以 assistant 发送；protected / coauthor 模式同时约束角色和旁白 Writer。
- 一轮最多两条连续消息，共享 storyTurnId；第二个 Writer 能读取第一个 Writer 的成文。
- 每条完整回复立即保存。第二条失败时保留第一条，可在原分支「重试剩余回复」；未完成片段只供查看和复制，不进入剧情。正文完成和 Memory／状态更新独立结算，重启不自动重发请求。
- 分支树、Swipe、整轮 regenerate、单消息 continue、消息编辑与旧分支恢复。旧节点不被覆盖。
- 回复可「按要求改写」为新 Swipe，旧文保留；书签引用原节点，切换时同时恢复该分支的 Memory、状态和固定事实。
- 按故事保留浏览器草稿；上翻阅读时暂停自动滚动，可一键回到最新。
- Lore 检索、七表主角状态及检查点、Planner 提案应用／拒绝／撤销。Memory 标注实际覆盖范围，只总结未覆盖的完整回合；用户维护的固定事实不被自动摘要覆盖。
- 默认读取最近两阶段 Memory 加最多三条本地关键词命中的旧记录；Agent 可用只读 search_memory。无向量数据库或额外检索模型调用。
- Memory 默认每 10 个完整回合更新；状态自动更新默认关闭。失败可重试，双输出不重复计数。
- 实际首请求预览和 Trace 展示 Gateway 捕获的原始 Body，旁边提供真实检索／裁剪产生的上下文说明；分项 token 为估算，供应商用量是实际统计。
- 「场景与书签」可导出当前分支 Markdown，或包含全部分支、生成信息、记录、书签、引用资料及本地图片的原生 JSON 包。导入先预览，在事务中新建故事，不覆盖原故事。
- V2/V3 PNG 角色卡、Persona、世界书、聊天、Swipe、群组、Memory、状态和旧 Narrative Agent 历史的只读导入；逐文件哈希去重。
- React 响应式界面与 PWA 静态应用外壳。没有聊天 API 离线缓存。

这是用于接真实模型和打磨行为的 **Alpha**，不是与旧酒馆全部功能等价的稳定版。固定事实是故事约束，不是严格的角色秘密隔离；本版没有后台自动调用或自动备份调度。

## 数据与安全

默认只监听 127.0.0.1。生产数据库在 apps/server/data/new-ai-chat.db，资源在 apps/server/data/assets；演示分别使用 demo.db、demo-assets。

可选配置放在根目录 .env，格式参考 .env.example。通过 pnpm start/dev/demo 或启动脚本运行时会加载它。相对数据路径以 apps/server 为基准。不要提交 .env 或 data。

API Key / 自定义请求头只存本机 SQLite，REST 列表不会返回其值，错误会脱敏。**本地数据库没有加密**，应保护系统账户与备份。停止服务后备份整个 apps/server/data 目录；运行中不要仅复制 .db 文件而忽略 WAL。

流式请求不向 CMD 打印 raw input/output；非流式打印实际原始 Body，始终不输出认证 Header。原生故事包不含连接、认证信息、Trace、任务或 opaque provider state，也不会抓取外部图片链接；它是故事迁移包，不是整库备份。

局域网需要显式设置 HOST=0.0.0.0 和 24–256 位 URL-safe PAIRING_TOKEN。客户端先配对，后续使用 HttpOnly / SameSite=Strict Cookie。默认 HTTP 不加密局域网流量，只适合可信网络；不要直接暴露公网，也不自动修改防火墙。

模型只会接收当前聊天的运行时故事上下文。Writer 不提供 Shell、文件系统、任意网络或 MCP 工具。导入不会加载扩展、主题、连接预设或运行时缓存；未知卡片/世界书字段保留为非运行时 legacyPayload。高级 Tavern 宏不执行。

## 验证命令

~~~powershell
pnpm typecheck
pnpm build
pnpm exec vitest run apps/server/src/services/core.test.ts -t "v0.2"
pnpm --filter @new-ai-chat/web exec playwright test --grep "v0.2"
~~~

v0.2 只运行七项核心场景和一条浏览器流程；旧重复场景已合并，不默认执行全量回归。Playwright 在 Windows 默认使用安装好的 Edge。其他环境可设置 PLAYWRIGHT_CHANNEL，并安装对应 Playwright 浏览器。端到端测试监听 4319，使用临时数据库与假模型。

真实模型测试默认跳过；只有显式设置 REAL_API_TESTS=1 以及 TEST_CHAT / TEST_ANTHROPIC / TEST_RESPONSES 三组 BASE_URL、MODEL、API_KEY 环境变量才运行。REAL_AGENCY_EVALS=1 还会额外启用主角权限模型评测，产生 Writer 和评判模型调用费用。不要把真实 Key 写进测试文件。

## 架构与扩展

见 [架构说明](docs/ARCHITECTURE.md) 和 [第三方说明](THIRD_PARTY_NOTICES.md)。这是新的本地项目，尚未选择对外发布许可证。
