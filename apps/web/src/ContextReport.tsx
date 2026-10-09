import { t, diagnosticText, formatNumber } from './i18n.js';
import { sourceLabel } from './ui-labels.js';
import type { ContextReport as Report } from '@new-ai-chat/contracts';

export default function ContextReport({ report }: { report?: Report | null }) {
  if (!report) return <small className="muted">{t("上下文说明未记录。")}</small>;
  const selected = report.items.filter(item => item.included);
  return <details className="context-report">
    <summary>{t('上下文说明 · 历史 {0} 条 · 动态资料 {1} 项', formatNumber(selected.filter(item => item.source === 'history').length), formatNumber(selected.filter(item => ['lore', 'memory', 'state'].includes(item.source)).length))}</summary>
    <p className="muted">{t("以下是组装来源和估算 token，不是供应商用量；协议可能合并角色，最终结构以实际 Body 为准。")}</p>
    <ol>{report.items.map(item => <li key={`${item.source}:${item.id}`} className={item.included ? '' : 'muted'}>
      <strong>{item.included ? '✓' : '−'} {diagnosticText(item.titleText, item.title)}</strong>
      <small>{sourceLabel(item.source)} · {item.role}  {t("· 约")} {formatNumber(item.estimatedTokens)} token · {diagnosticText(item.reasonText, item.reason)}</small>
      <small>{t("来源：")}{item.id}{item.messageIds?.length ? t(" · 消息 {0}", item.messageIds.join(' → ')) : ''}</small>
    </li>)}</ol>
  </details>;
}
