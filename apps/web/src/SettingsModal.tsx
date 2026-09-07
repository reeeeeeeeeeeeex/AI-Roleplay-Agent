import { useState } from 'react';
import { X, Plus, Image, Feather, Settings2, FileText } from 'lucide-react';
import { defaultPromptSettings, type NarratorProfile, type PromptSettings } from '@new-ai-chat/contracts';

export type AvatarMode = 'compact' | 'large' | 'full';
export type AvatarFit = 'cover' | 'contain';

export default function SettingsModal({
  open,
  onClose,
  narratorDefaults,
  onSaveNarrator,
  connections,
  defaultConnectionId,
  onSaveDefaultConnection,
  onEditConnection,
  onDeleteConnection,
  onTestConnection,
  promptSettings,
  onSavePrompts,
  avatarMode,
  setAvatarMode,
  avatarFit,
  setAvatarFit,
  initialTab = 'appearance',
}: {
  open: boolean;
  onClose: () => void;
  narratorDefaults: NarratorProfile;
  onSaveNarrator: (value: NarratorProfile) => Promise<void>;
  connections: any[];
  defaultConnectionId: string | null;
  onSaveDefaultConnection: (connectionId: string | null) => Promise<void>;
  onEditConnection: (connection?: any) => void;
  onDeleteConnection: (connection: any) => Promise<void>;
  onTestConnection: (id: string) => Promise<void>;
  promptSettings: PromptSettings;
  onSavePrompts: (value: PromptSettings) => Promise<void>;
  avatarMode: AvatarMode;
  setAvatarMode: (mode: AvatarMode) => void;
  avatarFit: AvatarFit;
  setAvatarFit: (fit: AvatarFit) => void;
  initialTab?: 'appearance' | 'narrator' | 'connections' | 'prompts';
}) {
  const [tab, setTab] = useState<'appearance' | 'narrator' | 'connections' | 'prompts'>(initialTab);
  const [narrator, setNarrator] = useState<NarratorProfile>(narratorDefaults);
  const [prompts, setPrompts] = useState<PromptSettings>(promptSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleSavePrompts = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { await onSavePrompts(prompts); setNotice('提示词已保存。'); }
    catch (err: any) { setError(err.message || '保存失败'); }
    finally { setBusy(false); }
  };

  if (!open) return null;

  const handleSaveNarrator = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await onSaveNarrator(narrator);
      setNotice('默认旁白已保存。');
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-shade">
      <section className="modal settings-modal" role="dialog" aria-modal="true" aria-label="设置">
        <header>
          <h2>设置</h2>
          <button aria-label="关闭设置" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <nav className="settings-nav">
          <button
            className={tab === 'appearance' ? 'active' : ''}
            onClick={() => { setTab('appearance'); setError(''); setNotice(''); }}
          >
            <Image size={14} />外观与显示
          </button>
          <button
            className={tab === 'prompts' ? 'active' : ''}
            onClick={() => { setTab('prompts'); setError(''); setNotice(''); }}
          >
            <FileText size={14} />提示词
          </button>
          <button
            className={tab === 'narrator' ? 'active' : ''}
            onClick={() => { setTab('narrator'); setError(''); setNotice(''); }}
          >
            <Feather size={14} />默认旁白
          </button>
          <button
            className={tab === 'connections' ? 'active' : ''}
            onClick={() => { setTab('connections'); setError(''); setNotice(''); }}
          >
            <Settings2 size={14} />模型连接 {connections.length}
          </button>
        </nav>

        <div className="settings-content">
          {error && <div className="banner error" style={{ margin: '0 0 12px' }}>{error}</div>}
          {notice && <div className="banner" style={{ margin: '0 0 12px' }}>{notice}</div>}

          {tab === 'appearance' && (
            <div className="settings-section">
              <div className="settings-group">
                <label className="settings-label">角色图片 / 头像显示尺寸</label>
                <p className="muted" style={{ marginBottom: 10 }}>
                  控制聊天窗口中角色立绘与头像的显示大小与完整度。
                </p>
                <div className="settings-options-grid">
                  <button
                    type="button"
                    className={`option-card ${avatarMode === 'compact' ? 'active' : ''}`}
                    onClick={() => { setAvatarMode('compact'); localStorage.setItem('avatar-mode', 'compact'); }}
                  >
                    <strong>紧凑标准</strong>
                    <small>32×32 正方形经典头像，适合专注文字叙事</small>
                  </button>
                  <button
                    type="button"
                    className={`option-card ${avatarMode === 'large' ? 'active' : ''}`}
                    onClick={() => { setAvatarMode('large'); localStorage.setItem('avatar-mode', 'large'); }}
                  >
                    <strong>大图立绘（推荐）</strong>
                    <small>60×80 纵向大图，展现角色服饰与神态，少裁剪</small>
                  </button>
                  <button
                    type="button"
                    className={`option-card ${avatarMode === 'full' ? 'active' : ''}`}
                    onClick={() => { setAvatarMode('full'); localStorage.setItem('avatar-mode', 'full'); }}
                  >
                    <strong>完整卡片</strong>
                    <small>80×110 宽广立绘，最大化展示卡片原图形象</small>
                  </button>
                </div>
              </div>

              <div className="settings-group" style={{ marginTop: 16 }}>
                <label className="settings-label">图片裁剪方式</label>
                <div className="settings-options-grid">
                  <button
                    type="button"
                    className={`option-card ${avatarFit === 'cover' ? 'active' : ''}`}
                    onClick={() => { setAvatarFit('cover'); localStorage.setItem('avatar-fit', 'cover'); }}
                  >
                    <strong>智能填充（少裁剪）</strong>
                    <small>聚焦头像顶部与半身，自然充满显示区域</small>
                  </button>
                  <button
                    type="button"
                    className={`option-card ${avatarFit === 'contain' ? 'active' : ''}`}
                    onClick={() => { setAvatarFit('contain'); localStorage.setItem('avatar-fit', 'contain'); }}
                  >
                    <strong>完全无裁剪</strong>
                    <small>按原图完整比例内嵌展示，原汁原味保留全部画面</small>
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'narrator' && (
            <form onSubmit={handleSaveNarrator} className="settings-form">
              <p className="muted" style={{ marginBottom: 12 }}>
                新故事将默认应用该配置；已有聊天可在聊天设置中独立调整。
              </p>
              <label>
                显示名称
                <input
                  required
                  value={narrator.name}
                  onChange={(e) => setNarrator({ ...narrator, name: e.target.value })}
                />
              </label>
              <label>
                写作风格
                <textarea
                  rows={4}
                  value={narrator.style}
                  onChange={(e) => setNarrator({ ...narrator, style: e.target.value })}
                />
              </label>
              <label>
                旁白头像（本地资产路径）
                <input
                  value={narrator.avatarPath ?? ''}
                  onChange={(e) => setNarrator({ ...narrator, avatarPath: e.target.value || null })}
                />
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="primary" disabled={busy} type="submit">
                  {busy ? '保存中…' : '保存默认旁白'}
                </button>
              </div>
            </form>
          )}

          {tab === 'connections' && (
            <div className="settings-section">
              <div className="settings-group">
                <label>
                  所有聊天的默认模型
                  <select value={defaultConnectionId ?? ''} disabled={busy} onChange={async e => {
                    setBusy(true); setError(''); setNotice('');
                    try {
                      await onSaveDefaultConnection(e.target.value || null);
                      setNotice('默认模型已保存。');
                    } catch (err: any) { setError(err.message || '保存失败'); }
                    finally { setBusy(false); }
                  }}>
                    <option value="">未设置</option>
                    {connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name} · {connection.model}</option>)}
                  </select>
                </label>
                <p className="muted">未单独指定连接的新旧聊天都会使用此模型；聊天设置中仍可单独覆盖。</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span className="muted">管理 OpenAI、Anthropic、OpenAI Responses 模型端点</span>
                <button className="primary" onClick={() => onEditConnection()}>
                  <Plus size={14} />创建模型连接
                </button>
              </div>

              <div className="resource-list">
                {connections.map((v) => (
                  <article className="resource-item" key={v.id}>
                    <div className="resource-main">
                      <div className="resource-info">
                        <h3 className="resource-title">{v.name}</h3>
                        <p className="resource-desc">{v.model} · {v.baseUrl}</p>
                      </div>
                    </div>
                    <div className="resource-meta">
                      <span>{v.protocol}</span>
                    </div>
                    <div className="resource-actions">
                      <button onClick={() => onEditConnection(v)}>编辑</button>
                      <button onClick={() => onTestConnection(v.id)}>测试连接</button>
                      <button className="danger" onClick={() => onDeleteConnection(v)}>删除</button>
                    </div>
                  </article>
                ))}
                {!connections.length && (
                  <div className="empty" style={{ padding: '30px 10px' }}>
                    暂无模型连接。点击上方按钮添加你的第一个连接。
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'prompts' && (
            <form onSubmit={handleSavePrompts} className="settings-form">
              <p className="muted" style={{ marginBottom: 12 }}>只编辑三段写作意图；角色卡、历史、工具定义和权限规则仍由系统稳定组装。</p>
              <label>写作主指令<textarea rows={6} value={prompts.mainInstruction} onChange={e => setPrompts({ ...prompts, mainInstruction: e.target.value })} /></label>
              <label>Writer Agent 行为指令<textarea rows={7} value={prompts.writerInstruction} onChange={e => setPrompts({ ...prompts, writerInstruction: e.target.value })} /></label>
              <label>Planner 指令<textarea rows={6} value={prompts.plannerInstruction} onChange={e => setPrompts({ ...prompts, plannerInstruction: e.target.value })} /></label>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
                <button type="button" onClick={() => setPrompts(defaultPromptSettings)}>恢复默认</button>
                <button className="primary" disabled={busy} type="submit">{busy ? '保存中…' : '保存提示词'}</button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
