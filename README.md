# AI Roleplay Agent

**把角色、世界与平行故事，放进自己的创作空间。**

**A local workspace for characters, worlds, and parallel stories.**

[中文](#zh-cn) · [English](#english) · [Architecture / 架构](docs/ARCHITECTURE.md)

<a id="zh-cn"></a>

## 中文

AI Roleplay Agent 是一个**本地优先的角色扮演与长篇故事创作 WebUI**。它围绕角色、世界设定、剧情分支和长期记录组织写作，让故事可以持续发展，也可以随时探索另一种走向。

你可以连接模型 API 与角色共同创作，也可以自己写完整个故事，或将提示词复制到 AI 网页，再把回复粘贴回来。聊天、设定和记录保存在本机；使用 API 时，选入请求的内容会发送给你配置的服务商。

项目遵循 **Minimalist**：清楚的创作流程、直接的内容编辑，以及能解释来源的上下文。目前处于 **Alpha**，界面支持中文和英文，功能和数据格式仍在演进。

### 能用它做什么

- **围绕角色写故事**：角色卡、主角 Persona、群聊与常驻旁白共同构成场景；支持普通写作、Writer Agent 和 Planner＋Writer。
- **探索平行剧情**：从任意 Assistant 消息建立独立故事分支，在侧栏或分支列表切换；也可以为某条回复生成其他版本或定向改写。
- **维持长篇连续性**：世界书提供背景知识，Memory 保存阶段记忆，六张主角状态表记录当前事实；用户固定的事实由用户维护。
- **自由决定谁发言**：输入身份可选主角、用户旁白或角色。手动模式允许连续录入同一种身份，无须强制交替。
- **掌握写作方向**：每个故事有独立作者注释；主角控制可选保护主角、共同创作或“无”。五项通用提示词可以保存为预设。
- **看清实际请求**：预览 Gateway 捕获的原始请求 Body，查看上下文选择、生成 Trace 和供应商返回的用量；估算 token 与实际用量分开展示。
- **带走自己的故事**：支持 Markdown 导出、包含本地图片的原生故事包，以及 SillyTavern 角色卡、聊天、世界书等数据的只读导入。

### 快速开始

需要 **Node.js 24** 和 **pnpm 11**；具体 pnpm 版本以根目录 `package.json` 的 `packageManager` 为准。在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

打开 **[http://127.0.0.1:4310](http://127.0.0.1:4310)**。Windows 用户安装依赖并构建后，也可以双击 [`Start.cmd`](Start.cmd) 启动并自动打开页面。

在左下角 **设置 / Settings → 语言 / Language** 选择中文或 English，再点击 **保存 / Save**。语言仅影响当前浏览器的界面，刷新后保留；故事内容与模型提示词不会被翻译。

第一次使用：

1. 创建角色和主角资料，或从「导入故事」导入现有数据。
2. 使用 API 写作时，在「设置 → 模型」添加并选择连接。支持 **Chat Completions、Anthropic Messages、OpenAI Responses**；填写对应协议的实际 API Base URL、模型 ID 和自己的密钥。
3. 开启故事，按需要绑定主角、世界书和场景，在聊天顶部填写作者注释。
4. 发送主角行动或用户旁白，让角色回应；想手动创作时，开启输入框上方的全局手动输入开关。

**先体验、不接 API：** 运行 `pnpm demo`，打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)；Windows 也可双击 [`Demo.cmd`](Demo.cmd)，使用构建后的 4310 页面。两者使用独立演示数据和假模型，回复是测试文本。演示与真实服务默认共用后端端口 4310，请勿同时启动。

### 两种创作方式

| | API 写作 | 手动创作 / AI 网页回填 |
| --- | --- | --- |
| 主角、用户旁白发送 | 保存 User 消息，然后生成回复 | 只保存 User 消息 |
| 「角色」发送 | 保存手动 Assistant 正文 | 保存手动 Assistant 正文 |
| 主角／用户旁白身份下空白发送 | 回复末尾 User；否则新增续写 | 不执行动作 |
| 连续发言 | 可在任意末尾追加 User 输入 | 三种身份均可连续录入 |

网页回填流程：**填写输入 → 预览 → 复制网页提示词 → 手动粘贴到 AI 网页 → 将回复填入「角色」并发送**。复制成功时，尚未发送的 User 输入会同步保存；已保存的输入不会再复制成一条新消息。网页提示词是整理后的普通文本，不等同于网页产品真正的 System 消息。

手动输入开关**全局生效，默认关闭**，它只改变发送行为。主动点击行动选项生成、续写、改写或重试，仍可能调用 API；Memory／状态也会按各自的自动更新间隔调用记录模型。两者可共用一个独立记录模型连接。连续 User 在角色回复后结算为一轮，连续 Assistant 则每条另算一轮。Memory 默认每 10 轮更新，状态自动更新默认关闭。

### 日常使用与数据

内容通常直接点击编辑，失焦自动保存；通用设置和提示词保留显式保存。选择提示词预设只载入草稿，点击「保存提示词」后才生效。保存失败会保留编辑草稿。

**分支与删除不同：** 分支复制截至所选消息的故事与记录，原聊天继续保留；删除会永久移除当前聊天从该消息起的后续内容，包括同一聊天内对应位置之后的旧版本，并恢复保留位置的记录。其他独立聊天不受影响。

- 数据默认位于 `apps/server/data/`。备份前停止服务，复制整个目录；原生故事包用于迁移故事，不是整库备份。
- 密钥和自定义请求头保存在本地 SQLite，数据库**未加密**。不要公开数据库、`.env`、含故事正文的日志或私人导出包。
- 默认仅监听本机。局域网配置、配对和日志行为见[架构文档](docs/ARCHITECTURE.md#zh-cn)。PWA 可安装为应用外壳，聊天仍需要本地服务运行。
- 改动代码后重新运行 `pnpm build`，重启服务，并刷新或重开应用。`Start.cmd` 只在缺少网页构建时自动构建。

### 开发与项目状态

全 TypeScript monorepo：**React + Vite** 前端、**Fastify** 服务端、**SQLite + Drizzle** 存储，模型适配隔离在独立运行时包中。开发使用 `pnpm dev`，前端默认 5173、后端 4310。

模块结构、请求生命周期、分支与记录机制，以及验证方式见 **[架构与开发说明](docs/ARCHITECTURE.md#zh-cn)**。提交问题时，请提供复现步骤、使用协议和脱敏错误；提交改动时遵循 [AGENTS.md](AGENTS.md)，使用与改动相关的少量离线验证。

这是独立实现的项目，支持导入不代表完整复刻 SillyTavern 的扩展和宏行为。主角控制依靠提示词约束，模型结果仍需阅读检查。目前未提供第三方插件市场、云端多用户托管或内置离线模型。

本项目使用 **[MIT 许可证](LICENSE)**，允许修改、商用与再分发；分发时须保留版权和许可声明。 第三方依赖和来源信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

<a id="english"></a>

## English

AI Roleplay Agent is a **local-first WebUI for roleplay and long-form storytelling**. It brings characters, worldbuilding, parallel story branches, and persistent story records into one workspace, so you can develop a story over time and explore different outcomes.

Connect a model API to write with your characters, write every voice yourself, or copy a prompt to an AI website and paste the reply back. Chats, settings, and records are stored on your machine. When you use an API, the content selected for that request is sent to your configured provider.

The project follows a **Minimalist** approach: clear writing workflows, direct editing, and inspectable context. It is currently **Alpha**. The interface supports Chinese and English; features and data formats are still evolving.

### What you can do

- **Write with a cast:** character cards, a protagonist Persona, group chats, and a persistent narrator. Choose plain writing, Writer Agent, or Planner＋Writer.
- **Explore parallel stories:** branch from any Assistant message into an independent chat, switch between stories, or create alternate versions and targeted rewrites of individual replies.
- **Maintain continuity:** lorebooks supply world knowledge, Memory stores stage summaries, and six protagonist-state tables track current facts. Pinned facts remain under your control.
- **Choose who speaks:** enter protagonist actions, user narration, or character replies. Manual mode allows consecutive messages from the same voice.
- **Set the direction:** use a per-story author's note, protagonist protection / coauthor / none modes, and presets for the five general prompt fields.
- **Inspect requests:** preview the actual request body captured at the Gateway, examine context selection and generation traces, and distinguish token estimates from provider-reported usage.
- **Keep your stories portable:** export Markdown or native story packages with local images; import supported SillyTavern cards, chats, lorebooks, and related data without modifying the source directory.

### Quick start

Install **Node.js 24** and **pnpm 11**. The root `package.json` pins the pnpm version in `packageManager`. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open **[http://127.0.0.1:4310](http://127.0.0.1:4310)**. On Windows, after installing dependencies and building, [`Start.cmd`](Start.cmd) starts the app and opens the browser.

Choose Chinese or English in **设置 / Settings → 语言 / Language**, then select **保存 / Save**. The preference is saved in this browser. Story content and model prompts are not translated.

1. Create a character and protagonist profile, or import existing data through **Import Stories / 导入故事**.
2. For API writing, add and select a connection in **Settings → Models / 设置 → 模型**. Supported protocols are **Chat Completions, Anthropic Messages, and OpenAI Responses**. Supply the actual API base URL for that protocol, a model ID, and your own key.
3. Start a story, attach a Persona and lorebooks as needed, and add scene details or an author's note.
4. Send a protagonist action or user narration to generate a reply. Enable the global manual-input switch above the composer when writing manually.

**Try it without an API:** run `pnpm demo` and open [http://127.0.0.1:5173](http://127.0.0.1:5173). On Windows, [`Demo.cmd`](Demo.cmd) serves the built app on port 4310. Both use separate demo data and a fake model with test replies. Demo and real mode share backend port 4310 by default, so run only one at a time.

### Two ways to write

| | API writing | Manual writing / AI website workflow |
| --- | --- | --- |
| Send as protagonist or user narrator | Save a User message and generate a reply | Save a User message only |
| Send as character | Save a manually entered Assistant message | Save a manually entered Assistant message |
| Send an empty protagonist / narrator draft | Reply to the final User, or add a continuation otherwise | Do nothing |
| Consecutive messages | Add User input after either role | Enter any voice repeatedly |

Website workflow: **draft input → preview → copy the web prompt → paste it into an AI website → paste its reply into Character / 角色 and send**. Copying also saves an unsent User draft; it does not duplicate an already saved message. The web prompt is formatted text, not a real System-role message in the website's interface.

Manual mode is **global and off by default**. It changes message sending only. Explicitly generating action choices, continuing, rewriting, or retrying can still call an API. Memory and protagonist state also use API calls when their update intervals are due; they can share a separate record-model connection. Consecutive User messages form one turn with the following Assistant reply; each additional Assistant message counts as a new turn. Memory defaults to every 10 completed turns; automatic state updates default to off.

### Editing and data

Most content is edited directly and saved on blur. General settings and prompts use explicit save buttons. Loading a prompt preset fills the draft; **Save Prompts / 保存提示词** applies it. Failed saves preserve your draft.

**Branching and deletion have different effects.** Branching copies the story and records through the selected message into a separate chat. Deletion permanently removes that message and later content in the current chat, including alternate versions at those later positions, and restores records for the retained history. Other independent chats are unaffected.

- Data defaults to `apps/server/data/`. Stop the server before backing up the entire directory. A native story package is a story-transfer format, not a full database backup.
- API keys and custom headers are stored in local SQLite. The database is **not encrypted**. Keep databases, `.env`, story-bearing logs, and private exports out of public repositories.
- The server listens on localhost by default. See the [architecture guide](docs/ARCHITECTURE.md#english) for LAN pairing and logging details. The installable PWA is an app shell; chatting still requires the local server.
- After code changes, run `pnpm build`, restart the server, and refresh or reopen the app. `Start.cmd` builds automatically only when the web build is missing.

### Development and status

An all-TypeScript monorepo: **React + Vite** for the web app, **Fastify** for the server, and **SQLite + Drizzle** for storage. Model adapters live behind a dedicated runtime package. `pnpm dev` runs the frontend on port 5173 and the backend on 4310.

Read the **[architecture and development guide](docs/ARCHITECTURE.md#english)** for module boundaries, request flow, branch-aware records, and focused verification. When reporting an issue, include reproduction steps, the protocol used, and sanitized errors. Follow [AGENTS.md](AGENTS.md) for contributions and keep offline checks scoped to the change.

This is an independent implementation. Import support does not imply full compatibility with SillyTavern extensions or advanced macros. Protagonist-control modes are prompt instructions, so generated text still needs review. There is currently no third-party plugin marketplace, hosted multi-user service, or bundled offline model.

Licensed under **[MIT](LICENSE)**. Modification, commercial use, and redistribution are permitted with the copyright and license notice retained. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency and provenance information.
