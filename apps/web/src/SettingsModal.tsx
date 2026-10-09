import { t } from './i18n.js';
import { useEffect, useState, type CSSProperties } from 'react';
import { X, Plus } from 'lucide-react';
import { defaultAgencyPrompts, defaultPromptSettings, type GeneralSettings, type PromptSettings, type PromptPreset } from '@new-ai-chat/contracts';
import { api } from './api';
import AvatarField from './AvatarField';
import ActionChoiceSettings from './ActionChoiceSettings';
import { useLanguage } from './LanguageProvider.js';
import type { Locale } from './i18n.js';
import { readingThemes, readingFonts, type ReadingAppearance } from './appearance.js';

export type AvatarMode = 'compact' | 'large' | 'full';

export default function SettingsModal({
  onClose, generalSettings, onSaveGeneral, generationActive, connections,
  onEditConnection, onCopyConnection, onDeleteConnection, onTestConnection, promptSettings, onSavePrompts,
  avatarMode, setAvatarMode,
  messageDisplayLimit, setMessageDisplayLimit, plainThinkingExpanded, setPlainThinkingExpanded,
  readingAppearance, onSaveAppearance,
}: {
  onClose: () => void;
  generalSettings: GeneralSettings;
  onSaveGeneral: (value: GeneralSettings) => Promise<void>;
  generationActive: boolean;
  connections: any[];
  onEditConnection: (connection?: any) => void;
  onCopyConnection: (connection: any) => Promise<void>;
  onDeleteConnection: (connection: any) => Promise<void>;
  onTestConnection: (id: string) => Promise<void>;
  promptSettings: PromptSettings;
  onSavePrompts: (value: PromptSettings) => Promise<void>;
  avatarMode: AvatarMode;
  setAvatarMode: (mode: AvatarMode) => void;
  messageDisplayLimit: number;
  setMessageDisplayLimit: (limit: number) => void;
  plainThinkingExpanded: boolean;
  setPlainThinkingExpanded: (expanded: boolean) => void;
  readingAppearance: ReadingAppearance;
  onSaveAppearance: (value: ReadingAppearance) => void;
}) {
  const { locale, saveLanguage } = useLanguage();
  const [languageDraft, setLanguageDraft] = useState(locale);
  const [tab, setTab] = useState('language');
  const [writing, setWriting] = useState(generalSettings);
  const [prompts, setPrompts] = useState(promptSettings);
  const [promptBaseline, setPromptBaseline] = useState(promptSettings);
  const [presets, setPresets] = useState<PromptPreset[] | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [displayLimitDraft, setDisplayLimitDraft] = useState(String(messageDisplayLimit));
  const [readingDraft, setReadingDraft] = useState(readingAppearance);
  useEffect(() => { setWriting(generalSettings); }, [generalSettings]);
  useEffect(() => {
    if (tab !== 'prompts') return;
    let active = true;
    setPresets(null);
    void api<PromptPreset[]>('/settings/prompt-presets').then(value => { if (active) setPresets(value); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : t("读取预设失败")); });
    return () => { active = false; };
  }, [tab]);
  const locked = busy || generationActive;

  function saveDisplay(action: () => void) {
    setNotice('');
    try { action(); setError(''); }
    catch { setError(t('无法保存显示设置，当前设置未改变。请检查浏览器存储权限后重试。')); }
  }

  function selectPreset(presetId: string) {
    const dirty = (Object.keys(promptBaseline) as Array<keyof PromptSettings>).some(key => prompts[key] !== promptBaseline[key]);
    if (dirty && !window.confirm(t("有未保存的提示词修改，确定切换并放弃这些修改？"))) return;
    const preset = presets?.find(item => item.id === presetId);
    const value = preset?.prompts ?? promptSettings;
    setSelectedPresetId(presetId); setPresetName(preset?.name ?? '');
    setPrompts(value); setPromptBaseline(value); setNotice(''); setError('');
  }

  async function savePreset(action: 'create' | 'update' | 'rename') {
    const value = await api<PromptPreset>(`/settings/prompt-presets${action === 'create' ? '' : `/${selectedPresetId}`}`,
      action === 'create' ? 'POST' : 'PATCH', action === 'rename' ? { name: presetName } : action === 'update' ? { prompts } : { name: presetName, prompts });
    setPresets(items => action === 'create' ? [...(items ?? []), value] : (items ?? []).map(item => item.id === value.id ? value : item));
    setSelectedPresetId(value.id); setPresetName(value.name);
    if (action !== 'rename') setPromptBaseline(prompts);
  }

  async function save(action: () => Promise<void>, message: string) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(message); }
    catch (err) { setError(err instanceof Error ? err.message : t("保存失败")); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-shade">
      <section className="modal settings-modal" role="dialog" aria-modal="true" aria-label="设置 / Settings">
        <header>
          <h2>设置 / Settings</h2>
          <button aria-label={t("关闭设置")} disabled={busy} onClick={onClose}><X size={16} /></button>
        </header>
        <nav className="settings-nav">
          {([['language', '语言 / Language'], ['connections', t("模型")], ['writing', t("写作")], ['choices', t("行动选项")], ['prompts', t("提示词")], ['appearance', t("外观")]] as const).map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setError(''); setNotice(''); }}>{label}</button>
          ))}
        </nav>
        <div className="settings-content">
          {error && <p className="banner error" role="alert">{error}</p>}
          {notice && <p className="banner" role="status">{notice}</p>}
          {generationActive && !['appearance', 'language'].includes(tab) && <p className="muted">{t("生成结束后可保存运行设置。")}</p>}

          {tab === 'language' && <form className="settings-form" onSubmit={event => {
            event.preventDefault();
            try { saveLanguage(languageDraft); setError(''); setNotice(t('界面语言已保存。')); }
            catch { setNotice(''); setError(t('无法保存语言设置，当前语言未改变。请检查浏览器存储权限后重试。')); }
          }}>
            <label>语言 / Language<select value={languageDraft} onChange={event => setLanguageDraft(event.target.value as Locale)}>
              <option value="zh-CN">中文</option><option value="en">English</option>
            </select></label>
            <p className="muted">{t('仅影响当前浏览器的界面，刷新后保留。不会翻译故事内容或改变模型提示词。')}</p>
            <button type="submit" className="primary">保存 / Save</button>
          </form>}

          {tab === 'connections' && <div className="settings-section">
            <label>{t("当前模型连接")}<select value={generalSettings.connectionId ?? ''} disabled={locked} onChange={e => {
                const connectionId = e.target.value || null;
                void save(() => onSaveGeneral({ ...generalSettings, connectionId }), t("模型已保存，所有聊天统一使用。"));
              }}>
                <option value="">{t("未设置")}</option>
                {connections.map(c => <option key={c.id} value={c.id}>{c.name} · {c.model}</option>)}
              </select>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={generalSettings.streaming} disabled={locked} onChange={e => {
                const streaming = e.target.checked;
                void save(() => onSaveGeneral({ ...generalSettings, streaming }), streaming ? t("流式传输已开启。") : t("流式传输已关闭，回复完成后一次显示。"));
              }} />
              {t("流式传输")}</label>
            <p className="muted">{t("适用于所有新旧聊天。温度、输出上限等参数在连接中编辑。")}</p>
            <button className="primary" onClick={() => onEditConnection()}><Plus size={14} />{t("创建模型连接")}</button>
            <div className="resource-list">
              {connections.map(c => <article className="resource-item" key={c.id}>
                <div className="resource-info"><h3>{c.name}</h3><p>{c.model} · {c.baseUrl}</p></div>
                <div className="resource-actions">
                  <button onClick={() => onEditConnection(c)}>{t("编辑")}</button>
                  <button disabled={locked} onClick={() => void save(() => onCopyConnection(c), t('连接已复制，可编辑副本的模型和参数。'))}>{t('复制连接')}</button>
                  <button disabled={locked} onClick={() => void save(() => onTestConnection(c.id), t("连接测试通过。"))}>{t("测试连接")}</button>
                  <button className="danger" disabled={locked} onClick={() => void save(() => onDeleteConnection(c), t("连接已删除。"))}>{t("删除")}</button>
                </div>
              </article>)}
              {!connections.length && <p className="muted">{t("创建一个模型连接即可开始聊天。")}</p>}
            </div>
          </div>}

          {tab === 'writing' && <form className="settings-form" onSubmit={e => {
            e.preventDefault();
            void save(() => onSaveGeneral({ ...writing, connectionId: generalSettings.connectionId }), t("写作设置已保存，所有聊天统一使用。"));
          }}>
            <label>{t("生成模式")}<select value={writing.generationMode} onChange={e => setWriting({ ...writing, generationMode: e.target.value as GeneralSettings['generationMode'] })}>
                <option value="plain">{t("普通写作")}</option>
                <option value="writer-agent">Writer Agent</option>
                <option value="planner">Planner＋Writer</option>
              </select>
            </label>
            <label>{t("主角控制")}<select value={writing.agencyMode} onChange={e => setWriting({ ...writing, agencyMode: e.target.value as GeneralSettings['agencyMode'] })}>
                <option value="protected">{t("保护主角：AI 不代替主角决定")}</option>
                <option value="coauthor">{t("共同创作：AI 可描写主角行动和内心")}</option>
                <option value="none">{t("无：不发送主角控制提示词")}</option>
              </select>
            </label>
            <p className="muted">{t("User 指你控制的主角，Assistant 负责其他角色和旁白。发送时使用当前模式的提示词；选择“无”时不发送下方两段。支持")} {'{{user}}'}  {t("和")} {'{{char}}'}。</p>
            <label>{t("保护主角提示词")}<textarea required rows={5} maxLength={20000} value={writing.agencyPrompts.protected} onChange={e => setWriting({ ...writing, agencyPrompts: { ...writing.agencyPrompts, protected: e.target.value } })} /></label>
            <label>{t("共同创作提示词")}<textarea required rows={4} maxLength={20000} value={writing.agencyPrompts.coauthor} onChange={e => setWriting({ ...writing, agencyPrompts: { ...writing.agencyPrompts, coauthor: e.target.value } })} /></label>
            <div className="resource-actions"><button type="button" disabled={locked} onClick={() => setWriting({ ...writing, agencyPrompts: { ...defaultAgencyPrompts } })}>{t("恢复主角控制默认提示词")}</button></div>
            <label>{t("发送最近多少条消息（0 不限）")}<input type="number" required min={0} max={10000} step={1} value={writing.historyMessageLimit} onChange={e => setWriting({ ...writing, historyMessageLimit: Number(e.target.value) })} /></label>
            <p className="muted">{t("设为 0 表示不限制发送条数，仍受模型上下文预算限制。大于 0 时发送最近 N 条用户或 AI 消息，包含本次输入。故事设置固定发送起点后，优先发送从起点开始的全部消息。这里只控制发送范围，不删除聊天记录；Memory、主角状态和世界书仍按原规则加入。")}</p>
            <label className="checkbox-row"><input type="checkbox" checked={writing.sendMemory} onChange={e => setWriting({ ...writing, sendMemory: e.target.checked })} />{t("发送 Memory")}</label>
            <label className="checkbox-row"><input type="checkbox" checked={writing.sendProtagonistState} onChange={e => setWriting({ ...writing, sendProtagonistState: e.target.checked })} />{t("发送 Protagonist State")}</label>
            <p className="muted">{t("控制正文、Agent 工具和行动选项是否读取这些记录。关闭后仍独立维护记录；固定事实继续发送。")}</p>
            <label>{t("旁白名称")}<input required maxLength={100} value={writing.narrator.name} onChange={e => setWriting({ ...writing, narrator: { ...writing.narrator, name: e.target.value } })} /></label>
            <label>{t("旁白风格")}<textarea rows={3} value={writing.narrator.style} onChange={e => setWriting({ ...writing, narrator: { ...writing.narrator, style: e.target.value } })} /></label>
            <AvatarField
              label={t("旁白头像")}
              value={writing.narrator.avatarPath}
              disabled={locked}
              onChange={(url) => setWriting({ ...writing, narrator: { ...writing.narrator, avatarPath: url } })}
            />
            <label>{t("Memory / 主角状态模型")}<select value={writing.recordConnectionId ?? ''} onChange={e => setWriting({ ...writing, recordConnectionId: e.target.value || null })}>
                <option value="">{t("跟随当前模型")}</option>
                {connections.map(c => <option key={c.id} value={c.id}>{c.name} · {c.model}</option>)}
              </select>
            </label>
            <p className="muted">{t("Memory 和主角状态共用此模型，仍分别更新。生成参数使用所选连接，流式和历史范围遵循通用设置。")}</p>
            <div className="two-col">
              <label>{t("Memory 自动更新间隔（0 关闭）")}<input type="number" required min={0} max={10000} step={1} value={writing.memoryTurnInterval} onChange={e => setWriting({ ...writing, memoryTurnInterval: Number(e.target.value) })} /></label>
              <label>{t("状态自动更新间隔（0 关闭）")}<input type="number" required min={0} max={10000} step={1} value={writing.stateTurnInterval} onChange={e => setWriting({ ...writing, stateTurnInterval: Number(e.target.value) })} /></label>
            </div>
            <p className="muted">{t("以上两项设为 0 表示关闭对应的自动更新，仍可手动更新。大于 0 时按完整回合计算间隔，每段故事分别记录进度。")}</p>
            <button className="primary" disabled={locked} type="submit">{t("保存写作设置")}</button>
          </form>}

          {tab === 'choices' && <form className="settings-form" onSubmit={event => {
            event.preventDefault(); void save(() => onSaveGeneral({ ...generalSettings, actionChoices: writing.actionChoices }), t("行动选项设置已保存，下次生成时生效。"));
          }}>
            <ActionChoiceSettings value={writing.actionChoices} onChange={actionChoices => setWriting({ ...writing, actionChoices })} connections={connections} currentConnectionId={generalSettings.connectionId} streaming={generalSettings.streaming} />
            <button className="primary" disabled={locked} type="submit">{t("保存行动选项设置")}</button>
          </form>}

          {tab === 'prompts' && <form className="settings-form" onSubmit={e => {
            e.preventDefault(); void save(async () => { await onSavePrompts(prompts); setPromptBaseline(prompts); }, t("提示词已保存。"));
          }}>
            <label>{t("提示词预设")}<select value={selectedPresetId} disabled={locked || presets === null} onChange={e => selectPreset(e.target.value)}>
                <option value="">{t("当前提示词")}</option>
                {presets?.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </select>
            </label>
            <div className="two-col">
              <label>{t("预设名称")}<input maxLength={100} value={presetName} disabled={locked} onChange={e => setPresetName(e.target.value)} /></label>
              <div className="resource-actions">
                <button type="button" disabled={locked || presets === null || !presetName.trim()} onClick={() => void save(() => savePreset('create'), t("已另存为预设，当前生效提示词不变。"))}>{t("另存为预设")}</button>
                <button type="button" disabled={locked || presets === null || !selectedPresetId} onClick={() => void save(() => savePreset('update'), t("预设内容已更新，当前生效提示词不变。"))}>{t("更新预设")}</button>
              </div>
            </div>
            {selectedPresetId && <div className="resource-actions">
              <button type="button" disabled={locked || presets === null || !presetName.trim()} onClick={() => void save(() => savePreset('rename'), t("预设已重命名。"))}>{t("重命名预设")}</button>
              <button type="button" className="danger" disabled={locked || presets === null} onClick={() => {
                const selected = presets?.find(item => item.id === selectedPresetId);
                if (!window.confirm(t("删除预设“{0}”？编辑内容和当前生效提示词会保留。", selected?.name ?? presetName))) return;
                void save(async () => {
                  await api(`/settings/prompt-presets/${selectedPresetId}`, 'DELETE');
                  setPresets(items => (items ?? []).filter(item => item.id !== selectedPresetId));
                  setSelectedPresetId(''); setPresetName('');
                }, t("预设已删除，编辑内容和当前生效提示词已保留。"));
              }}>{t("删除预设")}</button>
            </div>}
            <p className="muted">{t("预设包含下方五项。选择后先载入编辑框，点击“保存提示词”才全局生效；更新预设只保存内容。")}</p>
            <label>{t("写作主指令")}<textarea required rows={6} value={prompts.mainInstruction} onChange={e => setPrompts({ ...prompts, mainInstruction: e.target.value })} /></label>
            <label>{t("附加指令")}<textarea rows={4} maxLength={20000} value={prompts.additionalInstruction} onChange={e => setPrompts({ ...prompts, additionalInstruction: e.target.value })} /></label>
            <p className="muted">{t("独立的 System 指令，对所有故事生效；留空不发送。")}</p>
            <label>{t("群聊主指令")}<textarea required rows={5} value={prompts.groupInstruction} onChange={e => setPrompts({ ...prompts, groupInstruction: e.target.value })} /></label>
            <label>{t("Writer Agent 行为指令")}<textarea required rows={7} value={prompts.writerInstruction} onChange={e => setPrompts({ ...prompts, writerInstruction: e.target.value })} /></label>
            <label>{t("Planner 指令")}<textarea required rows={6} value={prompts.plannerInstruction} onChange={e => setPrompts({ ...prompts, plannerInstruction: e.target.value })} /></label>
            <div className="resource-actions">
              <button type="button" disabled={locked} onClick={() => setPrompts(defaultPromptSettings)}>{t("恢复默认")}</button>
              <button className="primary" disabled={locked} type="submit">{t("保存提示词")}</button>
            </div>
          </form>}

          {tab === 'appearance' && <div className="settings-section">
            <form className="reading-settings" onSubmit={event => {
              event.preventDefault();
              try { onSaveAppearance(readingDraft); setError(''); setNotice(t('阅读外观已保存。')); }
              catch { setNotice(''); setError(t('无法保存阅读外观，当前外观未改变。你的选择已保留，请重试。')); }
            }}>
              <div className="two-col">
                <label>{t('阅读配色')}<select value={readingDraft.theme} onChange={event => setReadingDraft({ ...readingDraft, theme: event.target.value as ReadingAppearance['theme'] })}>
                  {readingThemes.map(theme => <option value={theme} key={theme}>{t(({ graphite: '石墨黑', midnight: '午夜蓝', warm: '暖墨棕', paper: '纸白' } as const)[theme])}</option>)}
                </select></label>
                <label>{t('正文字体')}<select value={readingDraft.font} onChange={event => setReadingDraft({ ...readingDraft, font: event.target.value as ReadingAppearance['font'] })}>
                  {readingFonts.map(font => <option value={font} key={font}>{t(({ sans: '系统黑体', serif: '宋体／衬线', mono: '等宽字体' } as const)[font])}</option>)}
                </select></label>
              </div>
              <label>{t('正文字号')}<div className="reading-size">
                <input type="range" min={12} max={28} step={1} value={readingDraft.fontSize} aria-label={t('正文字号')} onChange={event => setReadingDraft({ ...readingDraft, fontSize: Number(event.target.value) })} />
                <output>{readingDraft.fontSize} px</output>
              </div></label>
              <p className="muted">{t('配色同时调整背景、文字和按钮。字体与字号用于正文和输入框；仅保存在当前浏览器。')}</p>
              <div className="reading-preview" aria-label={t('阅读效果预览')} data-reading-theme={readingDraft.theme} data-reading-font={readingDraft.font}
                style={{ '--reading-font-size': `${readingDraft.fontSize}px` } as CSSProperties}>
                <p>{t('“雨停了，我们继续走吧。”')}</p>
                <p className="reading-narration">{t('远处的灯光映在石板路上，故事从这里继续。')}</p>
                <small>{t('旁白与辅助文字也会随配色调整。')}</small>
              </div>
              <small className="muted">{t('使用设备已安装字体；未安装时自动回退。不下载字体文件。')}</small>
              <button type="submit" className="primary">{t('保存阅读外观')}</button>
            </form>
            <label>{t("聊天显示条数")}<input type="number" min={1} max={1000} step={1} value={displayLimitDraft}
                onChange={event => setDisplayLimitDraft(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                onBlur={() => {
                  const value = Number(displayLimitDraft);
                  if (!Number.isInteger(value) || value < 1 || value > 1000) {
                    setDisplayLimitDraft(String(messageDisplayLimit)); setError(t("聊天显示条数请填写 1–1000 的整数。")); return;
                  }
                  saveDisplay(() => setMessageDisplayLimit(value));
                }} />
            </label>
            <p className="muted">{t("默认 100 条，可设置 1–1000；向上滚动继续加载，仅影响页面显示，不影响发送给模型的条数。")}</p>
            <label className="checkbox-row">
              <input type="checkbox" checked={plainThinkingExpanded} onChange={event => saveDisplay(() => setPlainThinkingExpanded(event.target.checked))} />
              {t("普通模式默认展开思考（CoT）")}</label>
            <label>{t("头像尺寸")}<select value={avatarMode} onChange={e => {
                saveDisplay(() => setAvatarMode(e.target.value as AvatarMode));
              }}>
                <option value="compact">{t("紧凑标准")}</option>
                <option value="large">{t("大图立绘")}</option>
                <option value="full">{t("完整卡片")}</option>
              </select>
            </label>
          </div>}
        </div>
      </section>
    </div>
  );
}
