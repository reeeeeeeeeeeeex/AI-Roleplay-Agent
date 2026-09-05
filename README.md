# New AI Chat · v0.1 Alpha

本地优先的 AI 角色扮演 WebUI。前端、后端、契约与 Agent 业务使用 TypeScript；原酒馆目录不被修改，不复制 SillyTavern 源码。

## 直接运行

本机已经安装依赖并构建。双击 **Start.cmd**，然后打开 [本地 WebUI](http://127.0.0.1:4310)。

第一次使用：

1. 在「导入 SillyTavern」扫描数据目录，查看预览后确认导入。请填写自己的 SillyTavern 数据目录。
2. 在「模型连接」创建连接，填写协议、Base URL、模型 ID 和你自己的 API Key，再点「测试连接」。
3. 打开一个聊天，在「聊天设置」里选择连接和主角；导入不会迁移任何旧 API Key。
4. 默认由 Writer 自动选择角色或旁白。输入框可切换「主角 / 用户旁白」，也能临时指定回复者。
5. 需要独立规划时，在聊天设置中打开 Planner。

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
- Planner 默认关闭；Writer 轻量路由、原生只读工具循环、显式回复者、失败回退、取消和可重放 SSE。
- 每个聊天都有不可删除的旁白；全局默认名称/头像/风格，以及独立的聊天级设置。
- 用户旁白以 user 发送，AI 旁白以 assistant 发送；protected / coauthor 模式同时约束角色和旁白 Writer。
- 一轮最多两条连续消息，共享 storyTurnId；第二个 Writer 能读取第一个 Writer 的成文。
- 分支树、Swipe、整轮 regenerate、单消息 continue、消息编辑与旧分支恢复。旧节点不被覆盖。
- Lore 核心检索、累计 Memory 基线、七表主角状态、状态检查点、Planner 提案应用/拒绝/安全撤销。
- Memory 默认每 10 个完整回合更新；状态自动更新默认关闭。失败可重试，双输出不重复计数。
- V2/V3 PNG 角色卡、Persona、世界书、聊天、Swipe、群组、Memory、状态和旧 Narrative Agent 历史的只读导入；逐文件哈希去重。
- React 响应式界面与 PWA 静态应用外壳。没有聊天 API 离线缓存。

这是用于接真实模型和打磨行为的 **Alpha**，不是宣称与旧酒馆全部功能等价的稳定版。完整边界和测试记录见 [验收说明](docs/ACCEPTANCE.md)。

## 数据与安全

默认只监听 127.0.0.1。生产数据库在 apps/server/data/new-ai-chat.db，资源在 apps/server/data/assets；演示分别使用 demo.db、demo-assets。

可选配置放在根目录 .env，格式参考 .env.example。通过 pnpm start/dev/demo 或启动脚本运行时会加载它。相对数据路径以 apps/server 为基准。不要提交 .env 或 data。

API Key / 自定义请求头只存本机 SQLite，REST 列表不会返回其值，错误会脱敏。**本地数据库没有加密**，应保护系统账户与备份。停止服务后备份整个 apps/server/data 目录；运行中不要仅复制 .db 文件而忽略 WAL。

局域网需要显式设置 HOST=0.0.0.0 和 24–256 位 URL-safe PAIRING_TOKEN。客户端先配对，后续使用 HttpOnly / SameSite=Strict Cookie。默认 HTTP 不加密局域网流量，只适合可信网络；不要直接暴露公网，也不自动修改防火墙。

模型只会接收当前聊天的运行时故事上下文。Writer 不提供 Shell、文件系统、任意网络或 MCP 工具。导入不会加载扩展、主题、连接预设或运行时缓存；未知卡片/世界书字段保留为非运行时 legacyPayload。高级 Tavern 宏不执行。

## 验证命令

~~~powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
~~~

Playwright 在 Windows 默认使用安装好的 Edge。其他环境可设置 PLAYWRIGHT_CHANNEL，并安装对应 Playwright 浏览器。端到端测试监听 4319，使用临时数据库与假模型。

真实模型测试默认跳过；只有显式设置 REAL_API_TESTS=1 以及 TEST_CHAT / TEST_ANTHROPIC / TEST_RESPONSES 三组 BASE_URL、MODEL、API_KEY 环境变量才运行。REAL_AGENCY_EVALS=1 还会额外启用主角权限模型评测，产生 Writer 和评判模型调用费用。不要把真实 Key 写进测试文件。

~~~powershell
# 可选：对实际旧数据进行临时数据库验收，不向正式库导入
$env:IMPORT_REAL_SOURCE='<SillyTavern-data-directory>'
pnpm test
~~~

## 架构与扩展

见 [架构说明](docs/ARCHITECTURE.md) 和 [第三方说明](THIRD_PARTY_NOTICES.md)。这是新的本地项目，尚未选择对外发布许可证。
