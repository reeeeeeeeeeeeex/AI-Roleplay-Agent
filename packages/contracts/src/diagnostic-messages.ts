// Application diagnostics only; never translate provider payloads or model instructions.
export const diagnosticMessages = {
  '{0} was not called with a valid plan.': { original: '{0} was not called with a valid plan.', zh: '{0} 未返回有效计划。', en: '{0} was not called with a valid plan.' },
  'Generation failed.': { original: 'Generation failed.', zh: '生成失败。', en: 'Generation failed.' },
  'Writer Agent did not call select_output_voices with a valid selection.': { original: 'Writer Agent did not call select_output_voices with a valid selection.', zh: 'Writer Agent 未通过 select_output_voices 选择有效发言者。', en: 'Writer Agent did not call select_output_voices with a valid selection.' },
  'Writer Agent returned no visible text.': { original: 'Writer Agent returned no visible text.', zh: 'Writer Agent 未返回可见正文。', en: 'Writer Agent returned no visible text.' },
  'Writer Agent returned no visible text for the second voice.': { original: 'Writer Agent returned no visible text for the second voice.', zh: 'Writer Agent 未返回第二位发言者的可见正文。', en: 'Writer Agent returned no visible text for the second voice.' },
  'Record generation failed.': { original: 'Record generation failed.', zh: '记录生成失败。', en: 'Record generation failed.' },
  '行动选项返回空内容。': { original: '行动选项返回空内容。', zh: '行动选项返回空内容。', en: 'The action choices response was empty.' },
  'Record generation returned no text.': { original: 'Record generation returned no text.', zh: '记录生成未返回正文。', en: 'Record generation returned no text.' },
  'Connection test failed.': { original: 'Connection test failed.', zh: '连接测试失败。', en: 'Connection test failed.' },
  'connection.htmlResponse': { original: '接口返回了 HTML 网页（HTTP {0}），未收到模型响应。请检查 Base URL 是否为 API 地址（服务商可能要求 /v1），以及中转站是否正常。', zh: '接口返回了 HTML 网页（HTTP {0}），未收到模型响应。请检查 Base URL 是否为 API 地址（服务商可能要求 /v1），以及中转站是否正常。', en: 'The endpoint returned an HTML page (HTTP {0}) instead of a model response. Check that the Base URL is an API address (your provider may require /v1) and that the proxy is working.' },
  'Current state': { original: 'Current state', zh: '当前主角状态', en: 'Current state' },
  'Pinned Fact': { original: 'Pinned Fact', zh: '固定事实', en: 'Pinned fact' },
  'Applied world facts': { original: 'Applied world facts', zh: '已应用的世界事实', en: 'Applied world facts' },
  'Group Scenario': { original: 'Group Scenario', zh: '群组场景', en: 'Group scenario' },
  'Scenario': { original: 'Scenario', zh: '场景', en: 'Scenario' },
  "output.thinkingOnly": { "original": "模型仅返回了思考内容，没有返回正文（结束原因：{0}）。本次输出未保存，可重试。", "zh": "模型仅返回了思考内容，没有返回正文（结束原因：{0}）。本次输出未保存，可重试。", "en": "The model returned reasoning but no story text (stop reason: {0}). This output was not saved. You can retry." },
  "output.empty": { "original": "模型没有返回正文（结束原因：{0}）。本次输出未保存，可重试。", "zh": "模型没有返回正文（结束原因：{0}）。本次输出未保存，可重试。", "en": "The model returned no story text (stop reason: {0}). This output was not saved. You can retry." },
"固定发送起点之前": {"original":"固定发送起点之前","zh":"固定发送起点之前","en":"Before the fixed history start"},
"历史消息上限": {"original":"历史消息上限","zh":"历史消息上限","en":"History message limit"},
"固定发送起点": {"original":"固定发送起点","zh":"固定发送起点","en":"Fixed history start"},
"从选定位置开始，覆盖全局条数上限；超出上下文时提示调整起点": {"original":"从选定位置开始，覆盖全局条数上限；超出上下文时提示调整起点","zh":"从选定位置开始，覆盖全局条数上限；超出上下文时提示调整起点","en":"Starts at the selected message, overriding the global count; adjust the start if the context budget is exceeded"},
"行动选项以固定起点为最早边界，再取独立历史条数": {"original":"行动选项以固定起点为最早边界，再取独立历史条数","zh":"行动选项以固定起点为最早边界，再取独立历史条数","en":"Choices use their own history limit, no earlier than the fixed start"},
"非最近两阶段，且未进入相关旧记忆前三项": {"original":"非最近两阶段，且未进入相关旧记忆前三项","zh":"非最近两阶段，且未进入相关旧记忆前三项","en":"Outside the latest two stages and top three relevant older memories"},
"未匹配 Lore 关键词或超过检索上限": {"original":"未匹配 Lore 关键词或超过检索上限","zh":"未匹配 Lore 关键词或超过检索上限","en":"No lore keyword match or retrieval limit exceeded"},
"行动选项指令与身份": {"original":"行动选项指令与身份","zh":"行动选项指令与身份","en":"Action-choice instructions and identity"},
"固定指令、身份与主角权限": {"original":"固定指令、身份与主角权限","zh":"固定指令、身份与主角权限","en":"Fixed instructions, identity, and protagonist control"},
"固定前缀": {"original":"固定前缀","zh":"固定前缀","en":"Fixed prefix"},
"常驻资料": {"original":"常驻资料","zh":"常驻资料","en":"Constant context"},
"当前分支": {"original":"当前分支","zh":"当前分支","en":"Current branch"},
"上下文预算": {"original":"上下文预算","zh":"上下文预算","en":"Context budget"},
"用户固定事实": {"original":"用户固定事实","zh":"用户固定事实","en":"User-pinned facts"},
"动态资料": {"original":"动态资料","zh":"动态资料","en":"Dynamic context"},
"作者注释": {"original":"作者注释","zh":"作者注释","en":"Author's note"},
"聊天独有 · 前置 System；修改注释会影响后续前缀缓存": {"original":"聊天独有 · 前置 System；修改注释会影响后续前缀缓存","zh":"聊天独有 · 前置 System；修改注释会影响后续前缀缓存","en":"Per-chat System prefix; edits affect subsequent prefix caching"},
"后置指令、最新用户输入与 Current Speaker": {"original":"后置指令、最新用户输入与 Current Speaker","zh":"后置指令、最新用户输入与 Current Speaker","en":"Post-history instructions, latest User input, and Current Speaker"},
"最后的写作控制": {"original":"最后的写作控制","zh":"最后的写作控制","en":"Final writing instructions"},
"Agent 追加 · {0}": {"original":"Agent 追加 · {0}","zh":"Agent 追加 · {0}","en":"Agent append · {0}"},
"同一会话的工具结果或写作控制": {"original":"同一会话的工具结果或写作控制","zh":"同一会话的工具结果或写作控制","en":"Tool results or writing instructions in the same session"},
"Planner 规划控制": {"original":"Planner 规划控制","zh":"Planner 规划控制","en":"Planner instructions"},
"首请求规划": {"original":"首请求规划","zh":"首请求规划","en":"First-request planning"},
"Writer Agent 行为指令": {"original":"Writer Agent 行为指令","zh":"Writer Agent 行为指令","en":"Writer Agent behavior instructions"},
"行动选项数量与输出格式": {"original":"行动选项数量与输出格式","zh":"行动选项数量与输出格式","en":"Action-choice count and output format"},
"最后的生成控制": {"original":"最后的生成控制","zh":"最后的生成控制","en":"Final generation instructions"},
"Skipped external link: {0}": {"original":"Skipped external link: {0}","zh":"已跳过外部链接：{0}","en":"Skipped external link: {0}"},
"Unreadable or unsupported file: {0}": {"original":"Unreadable or unsupported file: {0}","zh":"无法读取或不支持的文件：{0}","en":"Unreadable or unsupported file: {0}"},
"Skipped link: {0}/{1}": {"original":"Skipped link: {0}/{1}","zh":"已跳过链接：{0}/{1}","en":"Skipped link: {0}/{1}"},
"Only core lore keyword/secondary-key/constant/order behavior runs in v0.1. Regex, recursion, probability, decorators and executable Tavern macros are preserved as legacy data, not executed.": {"original":"Only core lore keyword/secondary-key/constant/order behavior runs in v0.1. Regex, recursion, probability, decorators and executable Tavern macros are preserved as legacy data, not executed.","zh":"仅运行世界书的基本关键词、辅助关键词、常驻和排序行为。正则、递归、概率、装饰器及可执行酒馆宏保留为旧数据，不执行。","en":"Only core lore keyword, secondary-key, constant, and order behavior is supported. Regex, recursion, probability, decorators, and executable Tavern macros are preserved as legacy data, not executed."},
"Created placeholder for missing character: {0}": {"original":"Created placeholder for missing character: {0}","zh":"已为缺失角色创建占位资料：{0}","en":"Created placeholder for missing character: {0}"},
"State preserved as legacy data; needs repair: {0}": {"original":"State preserved as legacy data; needs repair: {0}","zh":"状态保留为旧数据，需要修复：{0}","en":"State preserved as legacy data; needs repair: {0}"},
"本地图片未打包，导入后留空：{0}": {"original":"本地图片未打包，导入后留空：{0}","zh":"本地图片未打包，导入后留空：{0}","en":"Local image not included; left blank after import: {0}"},
"导入为新故事，不覆盖现有内容；绑定导出时的主角，不修改全局设置。": {"original":"导入为新故事，不覆盖现有内容；绑定导出时的主角，不修改全局设置。","zh":"导入为新故事，不覆盖现有内容；绑定导出时的主角，不修改全局设置。","en":"Import as a new story without overwriting existing content. Keeps the exported protagonist binding and leaves global settings unchanged."},
"Stage {0}": {"original":"Stage {0}","zh":"阶段 {0}","en":"Stage {0}"},

  "Not found.": { "original": "Not found.", "zh": "内容不存在。", "en": "Not found." },
  "Untrusted host.": { "original": "Untrusted host.", "zh": "不受信任的主机。", "en": "Untrusted host." },
  "Untrusted origin.": { "original": "Untrusted origin.", "zh": "不受信任的请求来源。", "en": "Untrusted origin." },
  "Pair this device first.": { "original": "Pair this device first.", "zh": "请先配对此设备。", "en": "Pair this device first." },
  "Invalid pairing token.": { "original": "Invalid pairing token.", "zh": "配对令牌无效。", "en": "Invalid pairing token." },
  "Turn not found.": { "original": "Turn not found.", "zh": "回合不存在。", "en": "Turn not found." },
  "Trace not found.": { "original": "Trace not found.", "zh": "Trace 不存在。", "en": "Trace not found." },
  "预设不存在。": { "original": "预设不存在。", "zh": "预设不存在。", "en": "Preset not found." },
  "仅支持 PNG、JPEG 或 WebP 格式的图片。": { "original": "仅支持 PNG、JPEG 或 WebP 格式的图片。", "zh": "仅支持 PNG、JPEG 或 WebP 格式的图片。", "en": "Only PNG, JPEG, and WebP images are supported." },
  "validation.failed": { "original": "Invalid input: {0}", "zh": "输入格式无效，请检查：{0}。", "en": "Invalid input. Check: {0}." },
  "record.connectionMissing": { "original": "请在通用设置中配置 Memory / 主角状态使用的模型连接。", "zh": "请在设置中配置 Memory / 主角状态使用的模型连接。", "en": "Configure the Memory / State model connection in Settings." },
  "Server restarted during generation.": { "original": "Server restarted during generation.", "zh": "生成期间服务已重启。", "en": "Server restarted during generation." },
  "Invalid event cursor.": {
    "original": "Invalid event cursor.",
    "zh": "无效的事件游标。",
    "en": "Invalid event cursor."
  },
  "PAIRING_TOKEN must be 24–256 URL-safe letters, numbers, underscores or hyphens.": {
    "original": "PAIRING_TOKEN must be 24–256 URL-safe letters, numbers, underscores or hyphens.",
    "zh": "PAIRING_TOKEN 必须为 24–256 位 URL-safe 字母、数字、下划线或连字符。",
    "en": "PAIRING_TOKEN must be 24–256 URL-safe letters, numbers, underscores or hyphens."
  },
  "LAN mode requires PAIRING_TOKEN with at least 24 characters.": {
    "original": "LAN mode requires PAIRING_TOKEN with at least 24 characters.",
    "zh": "局域网模式需要配置至少 24 位的 PAIRING_TOKEN。",
    "en": "LAN mode requires PAIRING_TOKEN with at least 24 characters."
  },
  "Connection not found.": {
    "original": "Connection not found.",
    "zh": "模型连接不存在。",
    "en": "Connection not found."
  },
  "Memory / 主角状态连接不存在。": {
    "original": "Memory / 主角状态连接不存在。",
    "zh": "Memory / 主角状态连接不存在。",
    "en": "The Memory / State connection does not exist."
  },
  "Persona not found.": {
    "original": "Persona not found.",
    "zh": "主角资料不存在。",
    "en": "Persona not found."
  },
  "行动选项连接不存在。": {
    "original": "行动选项连接不存在。",
    "zh": "行动选项连接不存在。",
    "en": "The action-choice connection does not exist."
  },
  "Anthropic 的行动选项温度不能超过 1。": {
    "original": "Anthropic 的行动选项温度不能超过 1。",
    "zh": "Anthropic 的行动选项温度不能超过 1。",
    "en": "Anthropic action-choice temperature cannot exceed 1."
  },
  "预设名称已存在。": {
    "original": "预设名称已存在。",
    "zh": "预设名称已存在。",
    "en": "A preset with this name already exists."
  },
  "Cycle in message branch.": {
    "original": "Cycle in message branch.",
    "zh": "消息分支存在循环。",
    "en": "Cycle in message branch."
  },
  "Invalid branch head.": {
    "original": "Invalid branch head.",
    "zh": "无效的分支末尾节点。",
    "en": "Invalid branch head."
  },
  "Conversation not found.": {
    "original": "Conversation not found.",
    "zh": "聊天不存在。",
    "en": "Conversation not found."
  },
  "发送起点必须是当前分支中的故事消息。": {
    "original": "发送起点必须是当前分支中的故事消息。",
    "zh": "发送起点必须是当前分支中的故事消息。",
    "en": "The history start must be a story message on the current branch."
  },
  "Fact is not on the current branch.": {
    "original": "Fact is not on the current branch.",
    "zh": "该固定事实不在当前分支。",
    "en": "Fact is not on the current branch."
  },
  "Fact source is not on the current branch.": {
    "original": "Fact source is not on the current branch.",
    "zh": "固定事实的来源不在当前分支。",
    "en": "Fact source is not on the current branch."
  },
  "Bookmark target is not in this story.": {
    "original": "Bookmark target is not in this story.",
    "zh": "书签目标不在当前故事中。",
    "en": "Bookmark target is not in this story."
  },
  "Bookmark not found.": {
    "original": "Bookmark not found.",
    "zh": "书签不存在。",
    "en": "Bookmark not found."
  },
  "Invalid or duplicate group member.": {
    "original": "Invalid or duplicate group member.",
    "zh": "群组成员无效或重复。",
    "en": "Invalid or duplicate group member."
  },
  "群组至少需要一个有效角色，请重新选择。": {
    original: "群组至少需要一个有效角色，请重新选择。",
    zh: "群组至少需要一个有效角色，请重新选择。",
    en: "Select at least one existing character for this group."
  },
  "Character not found.": {
    "original": "Character not found.",
    "zh": "角色不存在。",
    "en": "Character not found."
  },
  "Group not found.": {
    "original": "Group not found.",
    "zh": "群组不存在。",
    "en": "Group not found."
  },
  "Lorebook not found.": {
    "original": "Lorebook not found.",
    "zh": "世界书不存在。",
    "en": "Lorebook not found."
  },
  "内容已在别处修改，草稿已保留，请重新打开后核对。": {
    "original": "内容已在别处修改，草稿已保留，请重新打开后核对。",
    "zh": "内容已在别处修改，草稿已保留，请重新打开后核对。",
    "en": "Content changed elsewhere. Your draft is kept. Reopen and compare it before saving."
  },
  "场景已在别处修改，未覆盖现有内容。": {
    "original": "场景已在别处修改，未覆盖现有内容。",
    "zh": "场景已在别处修改，未覆盖现有内容。",
    "en": "The scene changed elsewhere. Existing content was not overwritten."
  },
  "连接地址或协议已改变，请重新填写 API Key 和自定义请求头后获取模型。": {
    "original": "连接地址或协议已改变，请重新填写 API Key 和自定义请求头后获取模型。",
    "zh": "连接地址或协议已改变，请重新填写 API Key 和自定义请求头后获取模型。",
    "en": "The connection URL or protocol changed. Enter the API key and custom headers again before fetching models."
  },
  "Message not found.": {
    "original": "Message not found.",
    "zh": "消息不存在。",
    "en": "Message not found."
  },
  "分支已变化，未覆盖当前故事。请重新打开后核对草稿。": {
    "original": "分支已变化，未覆盖当前故事。请重新打开后核对草稿。",
    "zh": "分支已变化，未覆盖当前故事。请重新打开后核对草稿。",
    "en": "The branch changed. The current story was not overwritten. Reopen and check your draft."
  },
  "消息已变化，未覆盖现有内容。": {
    "original": "消息已变化，未覆盖现有内容。",
    "zh": "消息已变化，未覆盖现有内容。",
    "en": "The message changed. Existing content was not overwritten."
  },
  "记忆或分支已变化，请刷新后重试。未覆盖现有内容。": {
    "original": "记忆或分支已变化，请刷新后重试。未覆盖现有内容。",
    "zh": "记忆或分支已变化，请刷新后重试。未覆盖现有内容。",
    "en": "Memory or the branch changed. Refresh and retry. Existing content was not overwritten."
  },
  "书签已在别处修改，未覆盖现有内容。": {
    "original": "书签已在别处修改，未覆盖现有内容。",
    "zh": "书签已在别处修改，未覆盖现有内容。",
    "en": "The bookmark changed elsewhere. Existing content was not overwritten."
  },
  "分支已变化，未覆盖固定事实。": {
    "original": "分支已变化，未覆盖固定事实。",
    "zh": "分支已变化，未覆盖固定事实。",
    "en": "The branch changed. Pinned facts were not overwritten."
  },
  "固定事实已在别处修改，未覆盖现有内容。": {
    "original": "固定事实已在别处修改，未覆盖现有内容。",
    "zh": "固定事实已在别处修改，未覆盖现有内容。",
    "en": "The pinned fact changed elsewhere. Existing content was not overwritten."
  },
  "分支已变化，未写入其他分支。": {
    "original": "分支已变化，未写入其他分支。",
    "zh": "分支已变化，未写入其他分支。",
    "en": "The branch changed. No other branch was modified."
  },
  "Snapshot is not on the current branch.": {
    "original": "Snapshot is not on the current branch.",
    "zh": "检查点不在当前分支。",
    "en": "Snapshot is not on the current branch."
  },
  "状态或分支已变化，请刷新后重试。未覆盖现有内容。": {
    "original": "状态或分支已变化，请刷新后重试。未覆盖现有内容。",
    "zh": "状态或分支已变化，请刷新后重试。未覆盖现有内容。",
    "en": "State or the branch changed. Refresh and retry. Existing content was not overwritten."
  },
  "这条记录或分支已变化，未覆盖现有内容。请重新打开后核对。": {
    "original": "这条记录或分支已变化，未覆盖现有内容。请重新打开后核对。",
    "zh": "这条记录或分支已变化，未覆盖现有内容。请重新打开后核对。",
    "en": "This record or branch changed. Existing content was not overwritten. Reopen and compare."
  },
  "Proposal not found.": {
    "original": "Proposal not found.",
    "zh": "提案不存在。",
    "en": "Proposal not found."
  },
  "行动选项的故事位置不存在。": {
    "original": "行动选项的故事位置不存在。",
    "zh": "行动选项的故事位置不存在。",
    "en": "The story position for these choices does not exist."
  },
  "候选组不存在。": {
    "original": "候选组不存在。",
    "zh": "候选组不存在。",
    "en": "The choice group does not exist."
  },
  "行动选项不存在。": {
    "original": "行动选项不存在。",
    "zh": "行动选项不存在。",
    "en": "The action choice does not exist."
  },
  "选项已在别处修改，草稿已保留，请重新打开后核对。": {
    "original": "选项已在别处修改，草稿已保留，请重新打开后核对。",
    "zh": "选项已在别处修改，草稿已保留，请重新打开后核对。",
    "en": "The choice changed elsewhere. Your draft is kept. Reopen and compare."
  },
  "故事位置已改变，请重新展开行动选项。": {
    "original": "故事位置已改变，请重新展开行动选项。",
    "zh": "故事位置已改变，请重新展开行动选项。",
    "en": "The story position changed. Reopen action choices."
  },
  "行动选项正在生成。": {
    "original": "行动选项正在生成。",
    "zh": "行动选项正在生成。",
    "en": "Action choices are being generated."
  },
  "请在通用设置中配置行动选项使用的模型连接。": {
    "original": "请在通用设置中配置行动选项使用的模型连接。",
    "zh": "请在通用设置中配置行动选项使用的模型连接。",
    "en": "Configure the action-choice model connection in Settings."
  },
  "行动选项数量应为 {0}。": {
    "original": "行动选项数量应为 {0}。",
    "zh": "行动选项数量应为 {0}。",
    "en": "Expected {0} action choices."
  },
  "故事已改变，已丢弃过期行动选项。": {
    "original": "故事已改变，已丢弃过期行动选项。",
    "zh": "故事已改变，已丢弃过期行动选项。",
    "en": "The story changed. Stale action choices were discarded."
  },
  "固定发送起点不在当前分支，请重新选择起点或取消固定起点。": {
    "original": "固定发送起点不在当前分支，请重新选择起点或取消固定起点。",
    "zh": "固定发送起点不在当前分支，请重新选择起点或取消固定起点。",
    "en": "The fixed history start is not on this branch. Choose another start or clear it."
  },
  "Invalid PNG signature.": {
    "original": "Invalid PNG signature.",
    "zh": "PNG 文件签名无效。",
    "en": "Invalid PNG signature."
  },
  "Truncated PNG.": {
    "original": "Truncated PNG.",
    "zh": "PNG 文件不完整。",
    "en": "Truncated PNG."
  },
  "PNG contains no V2/V3 character metadata.": {
    "original": "PNG contains no V2/V3 character metadata.",
    "zh": "PNG 中没有 V2/V3 角色卡元数据。",
    "en": "PNG contains no V2/V3 character metadata."
  },
  "Import source must be a directory.": {
    "original": "Import source must be a directory.",
    "zh": "导入来源必须是目录。",
    "en": "Import source must be a directory."
  },
  "Import exceeds the 32 MB/file or 256 MB/batch limit.": {
    "original": "Import exceeds the 32 MB/file or 256 MB/batch limit.",
    "zh": "导入超过单文件 32 MB 或单批次 256 MB 的上限。",
    "en": "Import exceeds the 32 MB/file or 256 MB/batch limit."
  },
  "Source changed after preview. Scan it again.": {
    "original": "Source changed after preview. Scan it again.",
    "zh": "来源在预览后发生变化，请重新扫描。",
    "en": "Source changed after preview. Scan it again."
  },
  "获取模型失败（HTTP {0}），请检查 Base URL、API Key 和模型列表接口支持。": {
    "original": "获取模型失败（HTTP {0}），请检查 Base URL、API Key 和模型列表接口支持。",
    "zh": "获取模型失败（HTTP {0}），请检查 Base URL、API Key 和模型列表接口支持。",
    "en": "Failed to fetch models (HTTP {0}). Check the base URL, API key, and support for the model-list endpoint."
  },
  "服务未返回有效模型列表，请手动填写模型 ID。": {
    "original": "服务未返回有效模型列表，请手动填写模型 ID。",
    "zh": "服务未返回有效模型列表，请手动填写模型 ID。",
    "en": "The service did not return a valid model list. Enter the model ID manually."
  },
  "模型列表分页异常，请手动填写模型 ID。": {
    "original": "模型列表分页异常，请手动填写模型 ID。",
    "zh": "模型列表分页异常，请手动填写模型 ID。",
    "en": "Model-list pagination failed. Enter the model ID manually."
  },
  "获取模型超时，请重试或手动填写模型 ID。": {
    "original": "获取模型超时，请重试或手动填写模型 ID。",
    "zh": "获取模型超时，请重试或手动填写模型 ID。",
    "en": "Fetching models timed out. Retry or enter the model ID manually."
  },
  "无法获取模型列表，请检查连接地址与网络，或手动填写模型 ID。": {
    "original": "无法获取模型列表，请检查连接地址与网络，或手动填写模型 ID。",
    "zh": "无法获取模型列表，请检查连接地址与网络，或手动填写模型 ID。",
    "en": "Cannot fetch models. Check the connection URL and network, or enter the model ID manually."
  },
  "A record update is already running.": {
    "original": "A record update is already running.",
    "zh": "记录更新已在进行中。",
    "en": "A record update is already running."
  },
  "Memory 无法容纳一个完整回合，请增大历史消息上限或上下文窗口。": {
    "original": "Memory 无法容纳一个完整回合，请增大历史消息上限或上下文窗口。",
    "zh": "Memory 无法容纳一个完整回合，请增大历史消息上限或上下文窗口。",
    "en": "Memory cannot fit a complete turn. Increase the history limit or context window."
  },
  "Memory changed; discarded stale update.": {
    "original": "Memory changed; discarded stale update.",
    "zh": "Memory 已变化，过期更新已丢弃。",
    "en": "Memory changed; discarded stale update."
  },
  "Records changed; discarded stale update.": {
    "original": "Records changed; discarded stale update.",
    "zh": "记录已变化，过期更新已丢弃。",
    "en": "Records changed; discarded stale update."
  },
  "Only pending proposals can be rejected.": {
    "original": "Only pending proposals can be rejected.",
    "zh": "只能拒绝待处理提案。",
    "en": "Only pending proposals can be rejected."
  },
  "Proposal already handled.": {
    "original": "Proposal already handled.",
    "zh": "提案已处理。",
    "en": "Proposal already handled."
  },
  "Proposal belongs to an obsolete branch or has no bound source node. Replan before applying.": {
    "original": "Proposal belongs to an obsolete branch or has no bound source node. Replan before applying.",
    "zh": "提案属于过期分支或没有绑定来源节点。请重新规划后再应用。",
    "en": "Proposal belongs to an obsolete branch or has no bound source node. Replan before applying."
  },
  "Proposal belongs to another branch.": {
    "original": "Proposal belongs to another branch.",
    "zh": "提案属于其他分支。",
    "en": "Proposal belongs to another branch."
  },
  "Only applied proposals can be undone.": {
    "original": "Only applied proposals can be undone.",
    "zh": "只能撤销已应用的提案。",
    "en": "Only applied proposals can be undone."
  },
  "State or branch changed after application; refusing destructive undo.": {
    "original": "State or branch changed after application; refusing destructive undo.",
    "zh": "应用后状态或分支已变化，无法安全撤销。",
    "en": "State or branch changed after application; refusing destructive undo."
  },
  "World changed after application.": {
    "original": "World changed after application.",
    "zh": "应用后世界设定已变化。",
    "en": "World changed after application."
  },
  "故事包存在重复 ID。": {
    "original": "故事包存在重复 ID。",
    "zh": "故事包存在重复 ID。",
    "en": "The story package contains duplicate IDs."
  },
  "故事包缺少引用：{0}": {
    "original": "故事包缺少引用：{0}",
    "zh": "故事包缺少引用：{0}",
    "en": "The story package is missing a reference: {0}"
  },
  "故事包群组引用不一致。": {
    "original": "故事包群组引用不一致。",
    "zh": "故事包群组引用不一致。",
    "en": "The story package has inconsistent group references."
  },
  "故事包消息分支存在循环。": {
    "original": "故事包消息分支存在循环。",
    "zh": "故事包消息分支存在循环。",
    "en": "The story package contains a message-branch cycle."
  },
  "故事不存在。": {
    "original": "故事不存在。",
    "zh": "故事不存在。",
    "en": "Story not found."
  },
  "故事已变化，请刷新后重试。": {
    "original": "故事已变化，请刷新后重试。",
    "zh": "故事已变化，请刷新后重试。",
    "en": "The story changed. Refresh and retry."
  },
  "消息不属于当前故事。": {
    "original": "消息不属于当前故事。",
    "zh": "消息不属于当前故事。",
    "en": "The message does not belong to this story."
  },
  "只能删除当前历史中的消息。": {
    "original": "只能删除当前历史中的消息。",
    "zh": "只能删除当前历史中的消息。",
    "en": "Only messages on the current history path can be deleted."
  },
  "Generation is active. Stop it before editing this conversation.": {
    "original": "Generation is active. Stop it before editing this conversation.",
    "zh": "生成进行中，请停止后再修改聊天。",
    "en": "Generation is active. Stop it before editing this conversation."
  },
  "待回复的 User 消息已变化，请刷新后重试。": {
    "original": "待回复的 User 消息已变化，请刷新后重试。",
    "zh": "待回复的 User 消息已变化，请刷新后重试。",
    "en": "The pending User message changed. Refresh and retry."
  },
  "当前为手动输入模式，请保存消息或关闭手动输入后再生成回复。": {
    "original": "当前为手动输入模式，请保存消息或关闭手动输入后再生成回复。",
    "zh": "当前为手动输入模式，请保存消息或关闭手动输入后再生成回复。",
    "en": "Manual input is enabled. Save a message, or disable manual mode to generate a reply."
  },
  "请在左下角通用设置中选择模型连接。": {
    "original": "请在左下角通用设置中选择模型连接。",
    "zh": "请在左下角通用设置中选择模型连接。",
    "en": "Select a model connection in Settings at the bottom left."
  },
  "Speaker is not in this conversation.": {
    "original": "Speaker is not in this conversation.",
    "zh": "发言者不属于当前聊天。",
    "en": "Speaker is not in this conversation."
  },
  "Target must be an assistant message on the current branch.": {
    "original": "Target must be an assistant message on the current branch.",
    "zh": "目标必须是当前分支中的 Assistant 消息。",
    "en": "Target must be an assistant message on the current branch."
  },
  "目标消息位于固定发送起点之前，请先调整或取消起点。": {
    "original": "目标消息位于固定发送起点之前，请先调整或取消起点。",
    "zh": "目标消息位于固定发送起点之前，请先调整或取消起点。",
    "en": "The target message is before the fixed history start. Adjust or clear the start first."
  },
  "此回合没有可重试的输出。": {
    "original": "此回合没有可重试的输出。",
    "zh": "此回合没有可重试的输出。",
    "en": "This turn has no retryable outputs."
  },
  "当前分支已变化，请返回原分支后重试。": {
    "original": "当前分支已变化，请返回原分支后重试。",
    "zh": "当前分支已变化，请返回原分支后重试。",
    "en": "The current branch changed. Return to the original branch before retrying."
  },
  "当前消息位置已变化，请重新预览或核对后再保存。": {
    "original": "当前消息位置已变化，请重新预览或核对后再保存。",
    "zh": "当前消息位置已变化，请重新预览或核对后再保存。",
    "en": "The message position changed. Preview again or check it before saving."
  },
  "Prompt preview supports normal send and auto continue only.": {
    "original": "Prompt preview supports normal send and auto continue only.",
    "zh": "提示词预览仅支持普通发送和自动续写。",
    "en": "Prompt preview supports normal send and auto continue only."
  },
  "普通写作的群聊需要先手动选择角色或旁白。": {
    "original": "普通写作的群聊需要先手动选择角色或旁白。",
    "zh": "普通写作的群聊需要先手动选择角色或旁白。",
    "en": "Select a character or narrator first for plain writing in group chats."
  },
  "消息位置已变化，请重新预览。": {
    "original": "消息位置已变化，请重新预览。",
    "zh": "消息位置已变化，请重新预览。",
    "en": "The message position changed. Preview again."
  },
  "Branch changed; discarded stale generation.": {
    "original": "Branch changed; discarded stale generation.",
    "zh": "分支已变化，过期生成已丢弃。",
    "en": "Branch changed; discarded stale generation."
  },
  "Invalid output sequence.": {
    "original": "Invalid output sequence.",
    "zh": "输出顺序无效。",
    "en": "Invalid output sequence."
  },
  "Unknown state table.": {
    "original": "Unknown state table.",
    "zh": "未知的状态表。",
    "en": "Unknown state table."
  },
  "Singleton table cannot contain multiple rows.": {
    "original": "Singleton table cannot contain multiple rows.",
    "zh": "单行状态表不能包含多行。",
    "en": "Singleton table cannot contain multiple rows."
  },
  "Unknown column in {0}.": {
    "original": "Unknown column in {0}.",
    "zh": "{0} 中存在未知字段。",
    "en": "Unknown column in {0}."
  },
  "Singleton tables are update-only.": {
    "original": "Singleton tables are update-only.",
    "zh": "单行状态表只支持更新。",
    "en": "Singleton tables are update-only."
  },
  "Important characters cannot be deleted by the model.": {
    "original": "Important characters cannot be deleted by the model.",
    "zh": "模型不能删除重要角色。",
    "en": "Important characters cannot be deleted by the model."
  },
  "A row ID is required.": {
    "original": "A row ID is required.",
    "zh": "需要提供行 ID。",
    "en": "A row ID is required."
  },
  "Inserted row IDs are assigned locally.": {
    "original": "Inserted row IDs are assigned locally.",
    "zh": "新行 ID 由本地分配。",
    "en": "Inserted row IDs are assigned locally."
  },
  "Delete operations cannot supply cells.": {
    "original": "Delete operations cannot supply cells.",
    "zh": "删除操作不能携带字段内容。",
    "en": "Delete operations cannot supply cells."
  },
  "Cells are required.": {
    "original": "Cells are required.",
    "zh": "需要提供字段内容。",
    "en": "Cells are required."
  },
  "Unknown or immutable column: {0}": {
    "original": "Unknown or immutable column: {0}",
    "zh": "未知或不可修改的字段：{0}",
    "en": "Unknown or immutable column: {0}"
  },
  "Past Experience Before Story can only be edited by the user.": {
    "original": "Past Experience Before Story can only be edited by the user.",
    "zh": "故事前经历只能由用户编辑。",
    "en": "Past Experience Before Story can only be edited by the user."
  },
  "Unknown row.": {
    "original": "Unknown row.",
    "zh": "记录行不存在。",
    "en": "Unknown row."
  },
  "Missing identity field: {0}": {
    "original": "Missing identity field: {0}",
    "zh": "缺少身份字段：{0}",
    "en": "Missing identity field: {0}"
  },
  "Quantity must be a positive integer.": {
    "original": "Quantity must be a positive integer.",
    "zh": "数量必须为正整数。",
    "en": "Quantity must be a positive integer."
  },
  "is_dead must be 是, 否, or empty (unknown).": {
    "original": "is_dead must be 是, 否, or empty (unknown).",
    "zh": "死亡状态必须为“是”“否”或空白（未知）。",
    "en": "is_dead must be 是 (yes), 否 (no), or empty (unknown)."
  },
  "Duplicate identity.": {
    "original": "Duplicate identity.",
    "zh": "身份信息重复。",
    "en": "Duplicate identity."
  },
  "Author note must be text.": {
    "original": "Author note must be text.",
    "zh": "作者注释必须是文本。",
    "en": "Author note must be text."
  },
  "Unable to place System author note in model request.": {
    "original": "Unable to place System author note in model request.",
    "zh": "无法将作者注释放入模型请求的 System 指令。",
    "en": "Unable to place System author note in model request."
  },
  "Request preview captured.": {
    "original": "Request preview captured.",
    "zh": "请求预览已捕获。",
    "en": "Request preview captured."
  },
  "Unable to capture the model request body.": {
    "original": "Unable to capture the model request body.",
    "zh": "无法捕获模型请求正文。",
    "en": "Unable to capture the model request body."
  },
  "上下文预算不足：输入估算 {0} + 最大输出 {1} > 配置窗口 {2} token。请减少历史／工具返回内容，调低最大输出，或按模型实际支持的大小设置上下文窗口。输入为本地估算，不是供应商用量。": {
    "original": "上下文预算不足：输入估算 {0} + 最大输出 {1} > 配置窗口 {2} token。请减少历史／工具返回内容，调低最大输出，或按模型实际支持的大小设置上下文窗口。输入为本地估算，不是供应商用量。",
    "zh": "上下文预算不足：输入估算 {0} + 最大输出 {1} > 配置窗口 {2} token。请减少历史／工具返回内容，调低最大输出，或按模型实际支持的大小设置上下文窗口。输入为本地估算，不是供应商用量。",
    "en": "Context budget exceeded: estimated input {0} + maximum output {1} > configured window {2} tokens. Reduce history/tool results or output limit, or set a context window supported by the model. Input is a local estimate, not provider usage."
  },
  "Duplicate output speaker: {0}": {
    "original": "Duplicate output speaker: {0}",
    "zh": "输出发言者重复：{0}",
    "en": "Duplicate output speaker: {0}"
  },
  "Unknown character: {0}": {
    "original": "Unknown character: {0}",
    "zh": "未知角色：{0}",
    "en": "Unknown character: {0}"
  },
  "Stable prompt or latest input exceeds the context budget. Increase context window or shorten the cards/lore/input.": {
    "original": "Stable prompt or latest input exceeds the context budget. Increase context window or shorten the cards/lore/input.",
    "zh": "固定提示词或最新输入超过上下文预算。请增大窗口或缩短角色卡、世界书及输入。",
    "en": "Stable prompt or latest input exceeds the context budget. Increase context window or shorten the cards/lore/input."
  },
  "Memory 上下文预算不足，无法完整发送已选记忆：资料预算估算 {0} token；输入估算 {1}、最大输出 {2}、配置窗口 {3} token。请增大上下文窗口、调低最大输出，或关闭 Memory 发送后重试。": {
    "original": "Memory 上下文预算不足，无法完整发送已选记忆：资料预算估算 {0} token；输入估算 {1}、最大输出 {2}、配置窗口 {3} token。请增大上下文窗口、调低最大输出，或关闭 Memory 发送后重试。",
    "zh": "Memory 上下文预算不足，无法完整发送已选记忆：资料预算估算 {0} token；输入估算 {1}、最大输出 {2}、配置窗口 {3} token。请增大上下文窗口、调低最大输出，或关闭 Memory 发送后重试。",
    "en": "Selected Memory cannot fit in full: estimated material budget {0} tokens; estimated input {1}, maximum output {2}, configured window {3}. Increase the context window, lower maximum output, or disable Memory inclusion and retry."
  },
  "固定发送范围超过上下文预算，请向后调整发送起点、减少资料或增大上下文窗口。为保留固定前缀，未自动裁剪历史。": {
    "original": "固定发送范围超过上下文预算，请向后调整发送起点、减少资料或增大上下文窗口。为保留固定前缀，未自动裁剪历史。",
    "zh": "固定发送范围超过上下文预算，请向后调整发送起点、减少资料或增大上下文窗口。为保留固定前缀，未自动裁剪历史。",
    "en": "The fixed history range exceeds the context budget. Move the start forward, reduce context material, or increase the window. History was not automatically trimmed."
  },
  "{0}（结束原因：{1}）。本次输出未保存，可重试。": {
    "original": "{0}（结束原因：{1}）。本次输出未保存，可重试。",
    "zh": "{0}（结束原因：{1}）。本次输出未保存，可重试。",
    "en": "{0} (stop reason: {1}). This output was not saved. You can retry."
  },
  "行动选项数量必须为 1–4。": {
    "original": "行动选项数量必须为 1–4。",
    "zh": "行动选项数量必须为 1–4。",
    "en": "The number of action choices must be 1–4."
  },
  "模型应返回 {0} 个行动选项，实际返回 {1} 个。": {
    "original": "模型应返回 {0} 个行动选项，实际返回 {1} 个。",
    "zh": "模型应返回 {0} 个行动选项，实际返回 {1} 个。",
    "en": "Expected {0} action choices; the model returned {1}."
  },
  "Connection test ended without a response.": {
    "original": "Connection test ended without a response.",
    "zh": "连接测试结束，但未收到回复。",
    "en": "Connection test ended without a response."
  },
  "Text streaming succeeded, but tool calling was not confirmed.": {
    "original": "Text streaming succeeded, but tool calling was not confirmed.",
    "zh": "文本流式传输成功，但未能确认工具调用。",
    "en": "Text streaming succeeded, but tool calling was not confirmed."
  },
  "当前请求没有可复制的提示词。": {
    "original": "当前请求没有可复制的提示词。",
    "zh": "当前请求没有可复制的提示词。",
    "en": "There is no prompt to copy for this request."
  }
} as const;
