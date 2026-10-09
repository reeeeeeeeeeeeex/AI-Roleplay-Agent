# AI Roleplay Agent

**与角色共同创作，让故事沿着不同的选择继续。**

**Write with your characters. Explore where each choice leads.**

[中文](#zh-cn) · [English](#english) · [架构 / Architecture](docs/ARCHITECTURE.md) · [MIT License](LICENSE)

<a id="zh-cn"></a>

## 中文

AI Roleplay Agent 是一个本地优先的 AI 角色扮演与故事创作工具。你可以扮演主角，与角色和旁白共同推进剧情；也可以写下每个人的发言，独自完成整个故事。

它把角色资料、世界设定、长期记忆和剧情分支放在同一个工作区里。故事变长后，你仍然可以查看发生过什么、调整接下来的方向，或从某次选择出发，写出另一条独立的故事线。

项目遵循 **Minimalist**：内容直接编辑，常用操作靠近正文，复杂设置按需展开。界面支持**中文和英文**，目前处于 **Alpha**，功能与数据格式仍在演进。

### 为故事而设计

| 能力 | 用途 |
| --- | --- |
| **角色与主角** | 用角色卡描述人物，以 Persona 定义你扮演的主角；支持单聊、群聊和常驻旁白。 |
| **平行故事** | 从一条角色回复创建独立分支，保留原故事，随时切换不同走向；也可改写回复或生成其他版本。 |
| **长期记录** | 世界书提供背景，Memory 保存阶段记忆，主角状态记录当前事实；重要设定可以固定，交由你维护。 |
| **创作控制** | 每个聊天独立的作者注释、可保存的提示词预设，以及保护主角、共同创作或不附加控制提示词的选项。 |
| **请求可见** | 发送前预览实际请求与上下文来源，生成后查看 Trace 和供应商用量，了解模型读到了什么。 |
| **数据可带走** | 导出 Markdown 或含本地图片的故事包，也可导入支持的 SillyTavern 角色卡、聊天和世界书。 |

### 按自己的方式创作

**连接 API，共同写作。** 发送主角行动或用户旁白，让模型接着回应。默认使用普通写作；需要时可选择 Writer Agent 或 Planner＋Writer，使用选人、规划与工具辅助创作。支持 **Chat Completions、Anthropic Messages、OpenAI Responses** 三种协议。

**手动录入，掌握每一句话。** 开启输入框上方的「单人创作／网页聊天手动输入」，主角、用户旁白和角色发言都只保存消息。可以连续输入同一种身份，无须强制交替。

**使用 AI 网页，再把回复带回来。** 在预览中复制整理好的网页提示词，手动粘贴到 Gemini、ChatGPT、Claude 等网页，再把回复填入「角色」并发送。复制会同步保存尚未发送的 User 草稿，避免历史缺少这一轮输入。复制出的内容是普通文本，不是网页端真正的 System 消息。

手动模式只改变消息发送行为。主动生成行动选项、续写或改写仍会请求模型；开启自动更新后，Memory 和主角状态也会按各自间隔调用记录模型。两者可以共用一个独立的模型连接。

### 快速开始

准备 **Node.js 24** 和 **pnpm 11**。pnpm 的具体版本见 [package.json](package.json) 中的 `packageManager`。

下载或克隆仓库后，在项目根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

打开 **[http://127.0.0.1:4310](http://127.0.0.1:4310)**。Windows 用户完成安装和构建后，也可双击 [Start.cmd](Start.cmd) 启动。

1. **选择语言。** 打开左下角「设置 / Settings → 语言 / Language」，选择中文或 English，点击「保存 / Save」。语言只保存在当前浏览器，不改变故事内容或模型提示词。
2. **准备角色。** 创建角色和主角资料，或导入已有内容，然后开启一个故事。
3. **开始创作。** 使用 API 时，先在「设置 → 模型」添加并选择连接；手动创作时，开启输入框上方的手动输入开关。世界书、场景和作者注释可以随故事逐步补充。

想先看看界面？安装依赖并构建后运行 `pnpm demo`，访问 [http://127.0.0.1:5173](http://127.0.0.1:5173)；Windows 也可使用 [Demo.cmd](Demo.cmd)，访问 4310。演示使用独立数据和假模型，回复是测试文本，不需要 API 密钥。演示与正式服务默认共用后端端口，请勿同时启动。

### 编辑、保存与数据

正文和资料通常直接点击编辑，失焦自动保存；设置和提示词使用显式保存。载入提示词预设只填入草稿，点击「保存提示词」后才生效。

导入 SillyTavern 数据时，请填写自己的数据目录；也可通过 `SILLYTAVERN_DATA_PATH` 设置默认路径。

「设置 → 外观」提供石墨黑、午夜蓝、暖墨棕和纸白配色，并搭配对应的文字颜色。可以选择正文字体和 12–28 px 字号，先预览再保存；偏好仅保存在当前浏览器。字体使用设备已安装的字体及回退，不需要下载字体文件。

**分支用于探索另一种走向，删除用于回到之前。** 分支会复制截至所选消息的故事和记录，原聊天保持不变。删除会永久移除当前聊天中所选消息及后续内容，包括对应位置之后的旧版本，并恢复保留位置的记录；其他独立聊天不受影响。

聊天和设定默认存放在本机的 `apps/server/data/`。备份时先停止服务，再复制整个目录。故事包适合迁移单个故事，不代替整库备份。使用 API 时，选入请求的内容会发送给你配置的服务商。

API 密钥保存在本地 SQLite，数据库未加密。公开项目时不要上传数据库、`.env` 或私人故事数据。默认仅监听本机；安装为 PWA 后，仍需要本地服务运行。

更新代码后运行 `pnpm build`，重启服务，再刷新或重开应用。

### 开发与贡献

项目采用全 TypeScript monorepo：**React + Vite** 构建界面，**Fastify** 提供 API，**SQLite + Drizzle** 保存数据，独立的 Agent Runtime 负责提示词组装和模型适配。

运行 `pnpm dev` 启动开发环境。模块结构、请求流程、分支和记录机制见 [架构与开发说明](docs/ARCHITECTURE.md#zh-cn)；贡献约定见 [AGENTS.md](AGENTS.md)。反馈问题时，请附上复现步骤、使用协议和脱敏后的错误信息。

这是独立实现的项目。SillyTavern 导入支持不包含其全部扩展与宏行为；项目不附带模型，也不提供云端多用户托管服务。

使用 **[MIT 许可证](LICENSE)**。第三方依赖及其许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

<a id="english"></a>

## English

AI Roleplay Agent is a local-first tool for AI roleplay and storytelling. Play the protagonist and develop a story with characters and a narrator, or write every voice yourself.

Character profiles, worldbuilding, long-term records, and story branches live in one workspace. As a story grows, you can review what happened, shape what comes next, or revisit a choice and build an independent storyline from it.

The project follows a **Minimalist** approach: edit content directly, keep everyday actions close to the story, and reveal advanced settings when needed. The interface supports **Chinese and English**. It is currently **Alpha**, with features and data formats still evolving.

### Built around your story

| Feature | What it helps you do |
| --- | --- |
| **Characters and protagonist** | Define your cast with character cards and your own role with a Persona. Write in solo or group chats with a persistent narrator. |
| **Parallel stories** | Branch from a character reply into an independent chat, keep the original, and switch between outcomes. Rewrite individual replies or generate alternate versions. |
| **Long-term records** | Use lorebooks for background, Memory for stage summaries, and protagonist state for current facts. Pin important facts and maintain them yourself. |
| **Creative control** | Set a per-chat author's note, save prompt presets, and choose protagonist protection, coauthoring, or no added protagonist-control instructions. |
| **Visible requests** | Preview the actual request and context sources before sending. Inspect generation traces and provider-reported usage afterward. |
| **Portable data** | Export Markdown or story packages with local images. Import supported SillyTavern character cards, chats, and lorebooks. |

### Write your way

**Connect an API and write together.** Send a protagonist action or user narration, then let the model respond. Plain writing is the default. Writer Agent and Planner＋Writer offer speaker selection, planning, and tool-assisted writing when needed. Supported protocols are **Chat Completions, Anthropic Messages, and OpenAI Responses**.

**Enter every voice manually.** Enable the manual-input switch above the composer to save protagonist, user-narrator, and character messages without generating story text. Any voice can send consecutive messages; alternating roles is optional.

**Use an AI website and bring the reply back.** Copy the formatted web prompt from the preview, paste it into a website such as Gemini, ChatGPT, or Claude, then paste the response into the Character input and send. Copying also saves an unsent User draft so that the input remains in your history. The copied prompt is ordinary text, not a real System-role message in the website.

Manual mode changes message sending only. Explicit actions such as generating choices, continuing, or rewriting still request a model. When automatic updates are enabled, Memory and protagonist state also call the record model at their respective intervals. Both can share a separate model connection.

### Quick start

Install **Node.js 24** and **pnpm 11**. The exact pnpm version is pinned in the `packageManager` field of [package.json](package.json).

Download or clone the repository, then run from its root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open **[http://127.0.0.1:4310](http://127.0.0.1:4310)**. On Windows, you can also use [Start.cmd](Start.cmd) after installing dependencies and building.

1. **Choose your language.** Open **设置 / Settings → 语言 / Language**, choose 中文 or English, then select **保存 / Save**. The preference stays in this browser and does not alter story content or model prompts.
2. **Prepare your cast.** Create character and protagonist profiles, or import existing content, then start a story.
3. **Start writing.** For API writing, add and select a connection in **Settings → Models**. For manual writing, enable the switch above the composer. Add lorebooks, scene details, and an author's note as your story develops.

Want to explore first? After installing dependencies and building, run `pnpm demo` and visit [http://127.0.0.1:5173](http://127.0.0.1:5173). On Windows, [Demo.cmd](Demo.cmd) serves the built app on port 4310. The demo uses separate data and a fake model with test replies; no API key is needed. Demo and normal mode share the backend port by default, so run only one at a time.

### Editing, saving, and data

Most content is edited directly and saved on blur. Settings and prompts have explicit save actions. Loading a prompt preset fills the draft; **Save prompts** applies it.

To import SillyTavern data, enter your own data directory. You can optionally set its default with `SILLYTAVERN_DATA_PATH`.

**Settings → Appearance** offers Graphite, Midnight blue, Warm dark, and Paper white palettes with matching text colors. Preview a story font and size from 12–28 px before saving. Preferences stay in this browser; fonts come from your device with automatic fallbacks, without font downloads.

**Branch to explore another outcome; delete to return to an earlier point.** Branching copies the story and records through the selected message into a separate chat, leaving the original unchanged. Deletion permanently removes the selected message and later content in the current chat, including alternate versions at those later positions, and restores records for the retained history. Other independent chats are unaffected.

Chats and settings are stored locally in `apps/server/data/` by default. Stop the server before backing up the whole directory. Story packages transfer individual stories and do not replace full database backups. When you use an API, the context selected for the request is sent to your configured provider.

API keys are stored in local SQLite; the database is not encrypted. Keep databases, `.env`, and private story data out of public repositories. The server listens on localhost by default. Installing the PWA still requires the local server to run.

After updating the code, run `pnpm build`, restart the server, and refresh or reopen the app.

### Development and contributions

The project is an all-TypeScript monorepo: **React + Vite** for the interface, **Fastify** for the API, **SQLite + Drizzle** for persistence, and a separate Agent Runtime for prompt assembly and model adapters.

Run `pnpm dev` for development. Read the [architecture and development guide](docs/ARCHITECTURE.md#english) for module boundaries, request flow, branches, and records. Follow [AGENTS.md](AGENTS.md) when contributing. Issue reports should include reproduction steps, the protocol used, and sanitized error details.

This is an independent implementation. SillyTavern import support does not cover all of its extensions or macro behavior. No model is bundled, and there is no hosted multi-user service.

Licensed under **[MIT](LICENSE)**. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party dependencies and their licenses.
