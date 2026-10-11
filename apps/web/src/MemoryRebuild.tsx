import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Conversation, MemoryRebuildDraft, MemoryRebuildOptions, MemoryRebuildPlan } from '@new-ai-chat/contracts';
import { api } from './api.js';
import { t, diagnosticText } from './i18n.js';
import { copyText } from './clipboard.js';
import { useBackdropClose } from './useBackdropClose.js';
import { flushContentEdits } from './useContentAutosave.js';
import MemoryContent from './MemoryContent.js';

type Result = { draft: MemoryRebuildDraft | null; plan: MemoryRebuildPlan | null };
const statuses = { running: '重建中', paused: '已暂停', failed: '本批失败', ready: '重建完成，尚未覆盖', stale: '来源已变化' } as const;

export default function MemoryRebuild({ chat, disabled, onClose, onChanged }: {
  chat: Conversation; disabled: boolean; onClose: () => void; onChanged: () => void;
}) {
  const endpoint = `/conversations/${chat.id}/memory/rebuild`;
  const [result, setResult] = useState<Result | null>(null);
  const [options, setOptions] = useState<MemoryRebuildOptions>({ rounds: 100, groups: 1, batchRounds: 10 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(true);
  const draft = result?.draft;
  const plan = draft?.plan ?? result?.plan;
  const backdrop = useBackdropClose(close);
  async function close() {
    try { await flushContentEdits(); onClose(); } catch (e) { setError((e as Error).message); }
  }
  async function load(parameters?: MemoryRebuildOptions) {
    const version = ++revision.current;
    setLoading(true);
    try {
      const query = parameters ? `?${new URLSearchParams(Object.entries(parameters).map(([key, value]) => [key, String(value)]))}` : '';
      const next = await api<Result>(endpoint + query);
      if (!mounted.current || version !== revision.current) return;
      setResult(next);
      if (!parameters && next.plan) setOptions(next.plan.options);
      setError('');
    } catch (e) { if (mounted.current && version === revision.current) setError((e as Error).message); }
    finally { if (mounted.current && version === revision.current) setLoading(false); }
  }
  useEffect(() => {
    if (!result || draft || Object.entries(options).every(([key, value]) => result.plan?.options[key as keyof MemoryRebuildOptions] === value)) return;
    const timer = setTimeout(() => void load(options), 250);
    return () => clearTimeout(timer);
  }, [options.rounds, options.groups, options.batchRounds, Boolean(result), Boolean(draft)]);
  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; revision.current++; };
  }, [chat.id]);
  useEffect(() => {
    if (draft?.status !== 'running') return;
    const timer = setTimeout(() => void load(), 1000);
    return () => clearTimeout(timer);
  }, [draft]);
  async function act(action: 'start' | 'resume' | 'stop' | 'apply' | 'discard' | 'copy') {
    if (busy) return;
    revision.current++;
    setBusy(true); setError('');
    try {
      if (action === 'start' || action === 'resume' || action === 'apply') await flushContentEdits();
      if (action === 'copy') {
        await copyText(draft!.stages.map((stage, index) => `[Stage ${index + 1}]:\n${stage.content}`).join('\n\n'));
        setCopied(true); return;
      }
      if (action === 'apply' && !confirm(t('覆盖后，当前全部 Memory 将替换为所选范围的新阶段，范围外的旧记忆不再发送。固定事实和主角状态不变。确认覆盖？'))) return;
      if (action === 'discard' && !confirm(t('丢弃这份重建草稿？当前生效的 Memory 不变。'))) return;
      if (action === 'start') {
        const current = await api<Conversation>(`/conversations/${chat.id}`);
        if (current.headMessageId !== chat.headMessageId) { await load(options); throw new Error(t('故事位置已变化，请重新打开并核对重建范围。')); }
        const saved = await api<MemoryRebuildDraft>(endpoint, 'POST', { options, head: current.headMessageId });
        setResult({ draft: saved, plan: null });
      } else if (draft) {
        await api(`${endpoint}/${draft.id}${action === 'discard' ? '' : `/${action}`}`, action === 'discard' ? 'DELETE' : 'POST', {});
        if (action === 'apply') { onChanged(); onClose(); return; }
        await load();
      }
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  const matches = plan && Object.entries(options).every(([key, value]) => plan.options[key as keyof MemoryRebuildOptions] === value);
  return createPortal(<div className="modal-shade" {...backdrop}>
    <section className="modal memory-rebuild" role="dialog" aria-modal="true" aria-label={t('手动重建 Memory')}
      onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); void close(); } }}>
      <header><h2>{t('手动重建 Memory')}</h2><button aria-label={t('关闭窗口')} onClick={() => void close()}>✕</button></header>
      <div className="memory-rebuild-content">
        <p className="muted">{t('先生成独立草稿，确认覆盖后才生效。旧 Memory 和当前主角状态不参与重建。关闭窗口不会停止任务。')}</p>
        {!draft && <form onSubmit={event => { event.preventDefault(); void act('start'); }}>
          <div className="memory-rebuild-options">{([['rounds', '最近多少轮'], ['groups', '分成几组'], ['batchRounds', '每批增加多少轮']] as const).map(([key, label]) => <label key={key}>{t(label)}<input type="number" min={1} step={1}
            max={key === 'rounds' ? plan?.availableRounds : key === 'groups' ? options.rounds : undefined}
            value={options[key]} disabled={busy || disabled} onChange={event => { setOptions({ ...options, [key]: Number(event.target.value) }); setError(''); }}
             /></label>)}</div>
          <p className="muted">{t('组内累计发送正文，换组后仅保留新 Memory；未回复的末尾 User 不计入轮数。')}</p>
          <button type="submit" disabled={busy || disabled || loading || !matches || !plan?.model}>{t('开始重建')}</button>
        </form>}
        {plan && <div className="memory-rebuild-plan">
          <p>{t('记录模型：{0}', plan.model ?? t('未配置'))}</p>
          <p>{t('可用 {0} 轮，选择最近 {1} 轮，分 {2} 组，预计 {3} 次请求。', plan.availableRounds, plan.options.rounds, plan.options.groups, plan.batches.length)}</p>
          <p>{t('起点')}：{plan.start.text}</p><p>{t('终点')}：{plan.end.text}</p>
          {plan.rounds.some(round => round.inferred) && <p className="muted">{t('部分旧回合按消息顺序临时识别，未修改历史。')}</p>}
          <details><summary>{t('分组范围（所选范围内的轮次）')}</summary><ol>{plan.groups.map((group, index) => <li key={index}>{t('第 {0} 组：第 {1}–{2} 轮', index + 1, group.from, group.to)}</li>)}</ol></details>
        </div>}
        {!plan && !loading && !error && <p>{t('没有可重建的完整回合。')}</p>}
        {draft && <>
          <p role="status">{t(statuses[draft.status])} · {t('已保存 {0} / {1} 个阶段', draft.stages.length, draft.plan.batches.length)}</p>
          {draft.status === 'running' && draft.plan.batches[draft.stages.length] && <p>{t('第 {0} 组：第 {1}–{2} 轮', draft.plan.batches[draft.stages.length]!.group, draft.plan.batches[draft.stages.length]!.from, draft.plan.batches[draft.stages.length]!.to)}</p>}
          <progress aria-label={t('重建进度')} max={draft.plan.batches.length} value={draft.stages.length} />
          {draft.error && <p className="error" role="alert">{diagnosticText(draft.errorText, draft.error)}</p>}
          <div className="memory-rebuild-actions">
            {draft.status === 'running' && <button disabled={busy} onClick={() => void act('stop')}>{t('停止')}</button>}
            {['paused', 'failed'].includes(draft.status) && <button disabled={busy || disabled} onClick={() => void act('resume')}>{t('继续重建')}</button>}
            {draft.status === 'ready' && <><button disabled={busy || disabled} onClick={() => void act('apply')}>{t('覆盖当前 Memory')}</button><button disabled={busy} onClick={() => void close()}>{t('暂不覆盖')}</button></>}
            <button disabled={busy || !draft.stages.length} onClick={() => void act('copy')}>{copied ? t('已复制') : t('复制新 Memory')}</button>
            <button disabled={busy} onClick={() => void act('discard')}>{t('丢弃草稿')}</button>
          </div>
          {draft.stages.map((stage, index) => <details key={index}><summary>{t('阶段 {0}', index + 1)}</summary>
            <MemoryContent draftKey={`rebuild:${draft.id}:${index}`} initial={stage.content} label={t('阶段 {0}', index + 1)} disabled onSave={async content => content} onError={setError} />
          </details>)}
        </>}
        {loading && !draft && <p role="status">{t('正在读取记录…')}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </section>
  </div>, document.body);
}
