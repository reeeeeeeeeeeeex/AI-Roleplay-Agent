import type { ContextReport as Report } from '@new-ai-chat/contracts';

export default function ContextReport({ report }: { report?: Report | null }) {
  if (!report) return <small className="muted">上下文说明未记录。</small>;
  const selected = report.items.filter(item => item.included);
  return <details className="context-report">
    <summary>上下文说明 · 历史 {selected.filter(item => item.source === 'history').length} 条 · 动态资料 {selected.filter(item => ['lore', 'memory', 'state'].includes(item.source)).length} 项</summary>
    <p className="muted">以下是组装来源和估算 token，不是供应商用量；协议可能合并角色，最终结构以实际 Body 为准。</p>
    <ol>{report.items.map(item => <li key={`${item.source}:${item.id}`} className={item.included ? '' : 'muted'}>
      <strong>{item.included ? '✓' : '−'} {item.title}</strong>
      <small>{item.source} · {item.role} · 约 {item.estimatedTokens} token · {item.reason}</small>
      <small>来源：{item.id}{item.messageIds?.length ? ` · 消息 ${item.messageIds.join(' → ')}` : ''}</small>
    </li>)}</ol>
  </details>;
}
