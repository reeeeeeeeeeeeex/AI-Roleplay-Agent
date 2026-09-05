# v0.1 架构

## 模块边界

| 模块 | 职责 |
| --- | --- |
| apps/web | React/Vite 界面、SSE 消费、分支及记录操作；不持有模型 Key |
| apps/server | Fastify API、SQLite/Drizzle、事务、会话锁、导入器、记录与事件 |
| packages/contracts | Zod 契约、身份类型、七表原子校验器 |
| packages/agent-runtime | 自有 AgentRuntime / ModelGateway 语义，Pi 适配与原生工具循环 |
| packages/plugin-sdk | 可信内置插件的六个注册点 |

只有 agent-runtime 依赖 Pi 类型。没有依赖 DeepSeek Harness 预览运行时，也没有通用代码执行 Agent。

## 一个回合

保存用户节点 → 显式身份或 Planner/Writer 路由 → 1–2 个身份受限 Writer → 完成节点 → 逻辑回合结算 → 一次 Memory/状态后处理 → 终止事件。

Planner 通过 submit_turn_plan 结束，轻量路由通过 select_output_voices 结束。Planner 最多 3 次模型调用、6 次读取和 1 次终止调用，45 秒；Writer 最多 4 次模型调用、6 次读取，180 秒。重复相同工具调用受限。Writer 只允许 read_recent_story、search_lore、read_memory、read_state、read_cast。

用户显式指定身份会跳过规划/路由。路由异常回退到当前可用角色（群组的默认首位成员）；没有可用角色时仍可由旁白输出。Writer 异常不会删除已保存的用户消息。

## 提示与协议

稳定工具定义、Main Instruction、主角权限、Persona、按固定顺序的角色卡、旁白、常驻 Lore 放在稳定前缀。历史之后才加入动态 Lore/Memory/状态、输出 brief、最新用户输入锚点和 Current Speaker。

常用 user/char/charIfNotGroup 宏在生成时纯文本替换。角色卡内 char 使用该卡身份；公共块使用有序成员列表。群聊只使用会话覆盖场景或群组场景，不拼接每个成员的单聊场景。

Provider 的推理签名、加密 reasoning item 和 tool result 在原生 Agent 循环内保留；不把它们改名、插标签或跨 Writer 重放。跨身份历史只使用规范成文，隐藏 providerState 不通过聊天 API 返回。Responses 的 reasoning 与工具结果连续回传规则依据 [OpenAI 官方 Function calling 文档](https://developers.openai.com/api/docs/guides/function-calling) 核查，并由三协议离线回放测试覆盖。

上下文窗口由连接设置提供，默认 128000。使用保守估算而非精确 tokenizer；先预算稳定部分和最新输入，再选动态内容与完整历史消息。工具结果使后续请求超出预算时明确报错，不截断签名或偷偷扩大窗口。历史消息数上限同时影响常规上下文、Lore 扫描、Memory/状态的历史范围。

## 事实、分支与事件

SQLite 是事实来源。MessageNode.parentId 是不可变消息树；改写产生兄弟节点。旁白 + 角色是父子节点而非一个字符串。Swipe 第一条会离开原第二条，旧链可从分支选择器恢复。

Memory、状态和世界事件都绑定检查点所在的分支。导入的旧 Memory 是累计快照：最新导入/手工基线 + 后续生成阶段才进入运行时；历史快照仍保存。空基线也有效。

状态编辑先复制再按顺序验证整个批次。未知表/列/行、结构化单元格、身份冲突、非法数量及禁止的删除都拒绝整批。Planner 状态操作作为一个提案原子应用。世界提案未应用前不是事实；已应用且属于当前分支的世界事件才进入动态上下文。Undo 不覆盖较新的状态或分支。

SessionEvent 是追加式的回合日志，SSE 可用递增游标重放。不是把所有 CRUD 改成全量事件溯源：实体和检查点仍有 SQL 事实表。启动时把中断的任务标记为失败，不静默重新向模型收费。

## 内部 SDK

createApp 的第三个参数是静态可信 bootstrap，可使用 registerTool、registerContextProvider、registerTurnHook、registerProjection、registerSettingsSchema、registerUiPanel。

v0.1 中工具注册仅可细化五种只读能力，不开放任意新工具。上下文需通过来源/长度校验；整轮 hook 在后处理阶段调用一次；投影可以从持久事件重算。设置 schema 和 UI 面板元数据可查询，但具体设置编辑器/面板模块需要前端静态集成。不会自动加载模块 URL、磁盘插件或远程代码。SDK 不是隔离不可信代码的安全沙箱。

插件拿不到核心消息写入、分支更换、事务或提案应用接口。插件 hook 失败被记录，不回滚已完成的故事。没有跨重启后台插件任务重试机制。

## 导入

白名单扫描 → 大小/路径校验 → 哈希预览 → 确认后重新扫描 → 不可变内容寻址资源 → 一次 SQLite 事务 → 报告。

只读扫描 characters/worlds/chats/group chats/groups/User Avatars，以及 settings 中的 Persona/世界书绑定。整批哈希防止预览过期；文件级哈希避免新增一个文件时重复导入已存在内容。变更后的聊天文件创建新的导入副本，不覆盖用户在新项目中的编辑。

资产不属于 SQLite 事务。SQL 失败时可能留下未引用的内容寻址副本；不会删除原有资源，更不会写回或清理原酒馆目录。
