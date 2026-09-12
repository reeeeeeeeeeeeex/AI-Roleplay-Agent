import { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { defaultPromptSettings, type GeneralSettings, type PromptSettings } from '@new-ai-chat/contracts';
import AvatarField from './AvatarField';

export type AvatarMode = 'compact' | 'large' | 'full';
export type AvatarFit = 'cover' | 'contain';

export default function SettingsModal({
  onClose, generalSettings, onSaveGeneral, generationActive, connections,
  onEditConnection, onDeleteConnection, onTestConnection, promptSettings, onSavePrompts,
  avatarMode, setAvatarMode, avatarFit, setAvatarFit,
}: {
  onClose: () => void;
  generalSettings: GeneralSettings;
  onSaveGeneral: (value: GeneralSettings) => Promise<void>;
  generationActive: boolean;
  connections: any[];
  onEditConnection: (connection?: any) => void;
  onDeleteConnection: (connection: any) => Promise<void>;
  onTestConnection: (id: string) => Promise<void>;
  promptSettings: PromptSettings;
  onSavePrompts: (value: PromptSettings) => Promise<void>;
  avatarMode: AvatarMode;
  setAvatarMode: (mode: AvatarMode) => void;
  avatarFit: AvatarFit;
  setAvatarFit: (fit: AvatarFit) => void;
}) {
  const [tab, setTab] = useState('connections');
  const [writing, setWriting] = useState(generalSettings);
  const [prompts, setPrompts] = useState(promptSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setWriting(generalSettings); }, [generalSettings]);
  const locked = busy || generationActive;

  async function save(action: () => Promise<void>, message: string) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(message); }
    catch (err) { setError(err instanceof Error ? err.message : '保存失败'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-shade">
      <section className="modal settings-modal" role="dialog" aria-modal="true" aria-label="通用设置">
        <header>
          <h2>通用设置</h2>
          <button aria-label="关闭设置" onClick={onClose}><X size={16} /></button>
        </header>
        <nav className="settings-nav">
          {([['connections', '模型'], ['writing', '写作'], ['prompts', '提示词'], ['appearance', '外观']] as const).map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setError(''); setNotice(''); }}>{label}</button>
          ))}
        </nav>
        <div className="settings-content">
          {error && <p className="banner error" role="alert">{error}</p>}
          {notice && <p className="banner" role="status">{notice}</p>}
          {generationActive && tab !== 'appearance' && <p className="muted">生成结束后可保存运行设置。</p>}

          {tab === 'connections' && <div className="settings-section">
            <label>当前模型连接
              <select value={generalSettings.connectionId ?? ''} disabled={locked} onChange={e => {
                const connectionId = e.target.value || null;
                void save(() => onSaveGeneral({ ...generalSettings, connectionId }), '模型已保存，所有聊天统一使用。');
              }}>
                <option value="">未设置</option>
                {connections.map(c => <option key={c.id} value={c.id}>{c.name} · {c.model}</option>)}
              </select>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={generalSettings.streaming} disabled={locked} onChange={e => {
                const streaming = e.target.checked;
                void save(() => onSaveGeneral({ ...generalSettings, streaming }), streaming ? '流式传输已开启。' : '流式传输已关闭，回复完成后一次显示。');
              }} />
              流式传输
            </label>
            <p className="muted">适用于所有新旧聊天。温度、输出上限等参数在连接中编辑。</p>
            <button className="primary" onClick={() => onEditConnection()}><Plus size={14} />创建模型连接</button>
            <div className="resource-list">
              {connections.map(c => <article className="resource-item" key={c.id}>
                <div className="resource-info"><h3>{c.name}</h3><p>{c.model} · {c.baseUrl}</p></div>
                <div className="resource-actions">
                  <button onClick={() => onEditConnection(c)}>编辑</button>
                  <button disabled={locked} onClick={() => void save(() => onTestConnection(c.id), '连接测试通过。')}>测试连接</button>
                  <button className="danger" disabled={locked} onClick={() => void save(() => onDeleteConnection(c), '连接已删除。')}>删除</button>
                </div>
              </article>)}
              {!connections.length && <p className="muted">创建一个模型连接即可开始聊天。</p>}
            </div>
          </div>}

          {tab === 'writing' && <form className="settings-form" onSubmit={e => {
            e.preventDefault();
            void save(() => onSaveGeneral({ ...writing, connectionId: generalSettings.connectionId }), '写作设置已保存，所有聊天统一使用。');
          }}>
            <label>生成模式
              <select value={writing.generationMode} onChange={e => setWriting({ ...writing, generationMode: e.target.value as GeneralSettings['generationMode'] })}>
                <option value="plain">普通写作</option>
                <option value="writer-agent">Writer Agent</option>
                <option value="planner">Planner＋Writer</option>
              </select>
            </label>
            <label>主角控制
              <select value={writing.agencyMode} onChange={e => setWriting({ ...writing, agencyMode: e.target.value as GeneralSettings['agencyMode'] })}>
                <option value="protected">保护主角：AI 不代替主角决定</option>
                <option value="coauthor">共同创作：AI 可描写主角行动和内心</option>
              </select>
            </label>
            <label>旁白名称<input required maxLength={100} value={writing.narrator.name} onChange={e => setWriting({ ...writing, narrator: { ...writing.narrator, name: e.target.value } })} /></label>
            <label>旁白风格<textarea rows={3} value={writing.narrator.style} onChange={e => setWriting({ ...writing, narrator: { ...writing.narrator, style: e.target.value } })} /></label>
            <AvatarField
              label="旁白头像"
              value={writing.narrator.avatarPath}
              disabled={locked}
              onChange={(url) => setWriting({ ...writing, narrator: { ...writing.narrator, avatarPath: url } })}
            />
            <div className="two-col">
              <label>Memory 自动更新间隔（0 关闭）<input type="number" required min={0} max={10000} step={1} value={writing.memoryTurnInterval} onChange={e => setWriting({ ...writing, memoryTurnInterval: Number(e.target.value) })} /></label>
              <label>状态自动更新间隔（0 关闭）<input type="number" required min={0} max={10000} step={1} value={writing.stateTurnInterval} onChange={e => setWriting({ ...writing, stateTurnInterval: Number(e.target.value) })} /></label>
            </div>
            <p className="muted">间隔按完整回合计算，每段故事分别记录进度。</p>
            <button className="primary" disabled={locked} type="submit">保存写作设置</button>
          </form>}

          {tab === 'prompts' && <form className="settings-form" onSubmit={e => {
            e.preventDefault(); void save(() => onSavePrompts(prompts), '提示词已保存。');
          }}>
            <label>写作主指令<textarea required rows={6} value={prompts.mainInstruction} onChange={e => setPrompts({ ...prompts, mainInstruction: e.target.value })} /></label>
            <label>群聊主指令<textarea required rows={5} value={prompts.groupInstruction} onChange={e => setPrompts({ ...prompts, groupInstruction: e.target.value })} /></label>
            <label>Writer Agent 行为指令<textarea required rows={7} value={prompts.writerInstruction} onChange={e => setPrompts({ ...prompts, writerInstruction: e.target.value })} /></label>
            <label>Planner 指令<textarea required rows={6} value={prompts.plannerInstruction} onChange={e => setPrompts({ ...prompts, plannerInstruction: e.target.value })} /></label>
            <div className="resource-actions">
              <button type="button" onClick={() => setPrompts(defaultPromptSettings)}>恢复默认</button>
              <button className="primary" disabled={locked} type="submit">保存提示词</button>
            </div>
          </form>}

          {tab === 'appearance' && <div className="settings-section">
            <label>头像尺寸
              <select value={avatarMode} onChange={e => {
                setAvatarMode(e.target.value as AvatarMode); localStorage.setItem('avatar-mode', e.target.value);
              }}>
                <option value="compact">紧凑标准</option>
                <option value="large">大图立绘</option>
                <option value="full">完整卡片</option>
              </select>
            </label>
            <label>图片裁剪方式
              <select value={avatarFit} onChange={e => {
                setAvatarFit(e.target.value as AvatarFit); localStorage.setItem('avatar-fit', e.target.value);
              }}>
                <option value="cover">填充显示</option>
                <option value="contain">完整显示</option>
              </select>
            </label>
          </div>}
        </div>
      </section>
    </div>
  );
}
