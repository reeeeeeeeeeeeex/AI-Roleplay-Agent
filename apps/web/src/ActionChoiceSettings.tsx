import { defaultActionChoicePrompt, type ActionChoiceSettings as Settings } from '@new-ai-chat/contracts';

export default function ActionChoiceSettings({ value, onChange, connections, currentConnectionId, streaming }: {
  value: Settings; onChange: (value: Settings) => void; connections: any[]; currentConnectionId: string | null; streaming: boolean;
}) {
  const connection = connections.find(item => item.id === (value.connectionId ?? currentConnectionId));
  const numeric = (key: 'temperature' | 'maxTokens' | 'contextWindow', label: string, min: number, max: number, step = 1) => <label>{label}
    <input type="number" min={min} max={max} step={step} value={value[key] ?? ''} placeholder={`继承：${connection?.[key] ?? '未配置'}`}
      onChange={event => onChange({ ...value, [key]: event.target.value === '' ? null : Number(event.target.value) })} />
    <small className="muted">留空表示继承所选连接；清空可恢复继承。</small>
  </label>;
  return <>
    <label>选项数量<select value={value.count} onChange={event => onChange({ ...value, count: Number(event.target.value) })}>
      {[1, 2, 3, 4].map(count => <option key={count} value={count}>{count} 个</option>)}
    </select></label>
    <label>行动选项模型<select value={value.connectionId ?? ''} onChange={event => onChange({ ...value, connectionId: event.target.value || null })}>
      <option value="">跟随当前聊天模型</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}
    </select></label>
    <label>发送最近多少条消息<input type="number" required min={0} max={10000} step={1} value={value.historyMessageLimit} onChange={event => onChange({ ...value, historyMessageLimit: Number(event.target.value) })} /></label>
    <p className="muted">默认 20 条。0 表示不限条数，仍受上下文容量限制。独立于正文发送条数，遵守故事的“从此处开始发送”。Memory 和主角状态遵守通用发送开关。</p>
    <div className="two-col">
      {numeric('temperature', '温度', 0, connection?.protocol === 'anthropic-messages' ? 1 : 2, 0.1)}
      {numeric('maxTokens', '最大输出 token', 32, 131072)}
      {numeric('contextWindow', '上下文窗口 token', 8192, 2000000)}
      <label>推理强度<select value={value.reasoning ?? ''} onChange={event => onChange({ ...value, reasoning: (event.target.value || null) as Settings['reasoning'] })}>
        <option value="">继承连接（{connection?.reasoning ?? '未配置'}）</option>
        {['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(level => <option key={level} value={level}>{level === 'off' ? '关闭' : level}</option>)}
      </select></label>
    </div>
    <label>流式输出<select value={value.streaming === null ? '' : String(value.streaming)} onChange={event => onChange({ ...value, streaming: event.target.value === '' ? null : event.target.value === 'true' })}>
      <option value="">跟随通用设置（{streaming ? '开启' : '关闭'}）</option><option value="true">开启</option><option value="false">关闭</option>
    </select></label>
    <p className="muted">流式过程可在 Trace 查看；候选气泡在完整结果通过校验后显示。</p>
    <label>生成提示词<textarea required maxLength={20000} rows={6} value={value.instruction} onChange={event => onChange({ ...value, instruction: event.target.value })} /></label>
    <button type="button" onClick={() => onChange({ ...value, instruction: defaultActionChoicePrompt })}>恢复默认生成提示词</button>
    <p className="muted">设置仅影响下次生成。展开已有选项或浏览旧组不会重新调用模型。</p>
  </>;
}
