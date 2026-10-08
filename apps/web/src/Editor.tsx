import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api';
import AvatarField from './AvatarField';
import PersonaPicker from './PersonaPicker';
import LorebookEditor from './LorebookEditor';
import { useContentAutosave } from './useContentAutosave';
import { useBackdropClose } from './useBackdropClose';

export type Collection = 'characters' | 'personas' | 'connections' | 'lorebooks' | 'groups' | 'conversations';

export const titles: Record<Collection, string> = {
  characters: '角色',
  personas: '主角',
  connections: '模型连接',
  lorebooks: '世界书',
  groups: '群组',
  conversations: '故事资料',
};

export const defaults: Record<Collection, any> = {
  characters: { name: '', avatarPath: null, description: '', personality: '', scenario: '', firstMessage: '', exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '' },
  personas: { name: '', avatarPath: null, description: '', stateTemplate: { gender_age: '', appearance: '', occupation: '', personality: '', current_outfit: '', past_experience_before_story: '', skills: [] } },
  connections: {
    name: '',
    protocol: 'openai-chat-completions',
    baseUrl: 'https://api.deepseek.com',
    model: '',
    apiKey: '',
    temperature: 1,
    maxTokens: 50000,
    contextWindow: 1000000,
    historyMessageLimit: 0,
    reasoning: 'high',
    headers: {},
  },
  lorebooks: { name: '', description: '', entries: [] },
  groups: { name: '', avatarPath: null, memberIds: [], scenario: '' },
  conversations: {
    title: '新的故事',
    authorNote: '',
    kind: 'solo',
    characterId: null,
    groupId: null,
    personaId: null,
    lorebookIds: [],
  },
};

export default function Editor({
  kind,
  initial,
  data,
  onClose,
  onSave,
  defaultPersonaId,
  onPersonaCreated,
  zIndex = 120,
}: {
  kind: Collection;
  initial?: any;
  data: Partial<Record<Collection, any[]>>;
  onClose: () => void;
  onSave: (value: any) => Promise<any>;
  defaultPersonaId?: string | null;
  onPersonaCreated?: (persona: any) => void;
  zIndex?: number;
}) {
  const record = useRef(initial);
  const automatic = kind !== 'connections' && kind !== 'lorebooks';
  const autosave = useContentAutosave<any>({ initial: { ...defaults[kind], ...initial }, draftKey: `${kind}:${initial?.id ?? 'new'}`, enabled: automatic,
    onSave: async draft => {
      if (!String(draft.name ?? draft.title ?? '').trim()) throw new Error('请填写名称。');
      record.current = await onSave({ ...draft, id: record.current?.id ?? draft.id, expectedUpdatedAt: record.current?.updatedAt ?? draft.updatedAt });
      return { saved: { ...draft, id: record.current.id, updatedAt: record.current.updatedAt } };
    },
  });
  const value = autosave.value;
  const setValue = autosave.change;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creatingPersona, setCreatingPersona] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsNotice, setModelsNotice] = useState('');
  const modelRequest = useRef(0);
  const temperatureMax = value.protocol === 'anthropic-messages' ? 1 : 2;

  useEffect(() => {
    modelRequest.current++;
    setModels([]);
    setModelsBusy(false);
    setModelsNotice('');
    return () => { modelRequest.current++; };
  }, [value.baseUrl, value.protocol, value.apiKey, value.headers]);

  async function fetchModels() {
    const request = ++modelRequest.current;
    setModelsBusy(true);
    setModelsNotice('');
    try {
      const result = await api<{ models: string[] }>('/connections/models', 'POST', {
        connectionId: initial?.id, protocol: value.protocol, baseUrl: value.baseUrl.trim(),
        apiKey: value.apiKey, headers: value.headers,
      });
      if (request !== modelRequest.current) return;
      setModels(result.models);
      setModelsNotice(result.models.length ? `已获取 ${result.models.length} 个模型；选择一个，也可继续手填。` : '未返回可用模型，请手动填写模型 ID。');
    } catch (error) {
      if (request === modelRequest.current) setModelsNotice(error instanceof Error ? error.message : '获取模型失败');
    } finally {
      if (request === modelRequest.current) setModelsBusy(false);
    }
  }

  const set = (key: string, v: any, immediate = false) => {
    setValue((old: any) => ({ ...old, [key]: v }));
    if (automatic && immediate) void autosave.flush();
  };
  async function close() {
    const createDefaults = !record.current?.id && !value.id && Boolean(String(value.name ?? value.title ?? '').trim());
    if (!automatic || await autosave.flush(createDefaults)) onClose();
  }
  const backdrop = useBackdropClose(close);

  const field = (key: string, label: string, multiline = false, type = 'text', bounds?: { min: number; max: number; step: number }) => (
    <label key={key}>
      {label}
      {multiline && kind === 'personas' ? <PersonaTextarea value={value[key] ?? ''} rows={6} onChange={text => set(key, text)} /> : multiline ? (
        <textarea
          rows={key === 'description' ? 5 : 3}
          value={value[key] ?? ''}
          onChange={(event) => set(key, event.target.value)}
        />
      ) : (
        <input
          type={type}
          step="any"
          {...bounds}
          autoComplete={type === 'password' ? 'new-password' : 'off'}
          value={value[key] ?? ''}
          onChange={(event) => set(key, type === 'number' ? Number(event.target.value) : event.target.value)}
        />
      )}
    </label>
  );

  const select = (key: string, label: string, options: Array<[string, string]>, empty = false) => (
    <label key={key}>
      {label}
      <select value={value[key] ?? ''} onChange={(event) => set(key, event.target.value || null, true)}>
        {empty && <option value="">未选择</option>}
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );

  const choices = (key: string, label: string, items: any[]) => (
    <fieldset key={key}>
      <legend>{label}</legend>
      {items.map((item) => (
        <label className="check" key={item.id}>
          <input
            type="checkbox"
            checked={(value[key] ?? []).includes(item.id)}
            onChange={(e) =>
              set(
                key,
                e.target.checked
                  ? [...(value[key] ?? []), item.id]
                  : (value[key] ?? []).filter((id: string) => id !== item.id), true
              )
            }
          />
          {item.name}
        </label>
      ))}
      {!items.length && <small className="muted">请先在资料管理中创建。</small>}
    </fieldset>
  );

  const json = (key: string, label: string) => (
    <JsonField key={key} label={label} initial={value[key]} onChange={(v) => set(key, v)} />
  );

  const template = value.stateTemplate ?? defaults.personas.stateTemplate;
  const templateField = (key: string, label: string, rows = 0) => <label key={key}>{label}
    {rows ? <PersonaTextarea rows={rows} value={template[key] ?? ''} onChange={text => set('stateTemplate', { ...template, [key]: text })} />
      : <input value={template[key] ?? ''} onChange={event => set('stateTemplate', { ...template, [key]: event.target.value })} />}
  </label>;

  if (kind === 'lorebooks') return <LorebookEditor initial={initial} onSave={onSave} onClose={onClose} zIndex={zIndex} />;

  return (
    <>
      <div className="modal-shade" style={{ zIndex }} {...backdrop}>
        <section className={`modal${kind === 'conversations' || kind === 'characters' || kind === 'personas' ? ' editor-wide-modal' : ''}`} role="dialog" aria-modal="true" aria-label={`编辑${titles[kind]}`}>
          <header>
            <h2>{record.current?.id ? titles[kind] : `创建${titles[kind]}`}</h2>
            <button onClick={() => void close()} aria-label="关闭">✕</button>
          </header>

          <form
            onBlur={() => { if (automatic) void autosave.flush(); }}
            onSubmit={(e) => {
              e.preventDefault();
              if (automatic) { void autosave.flush(); return; }
              setBusy(true);
              setError('');
              void onSave(value)
                .catch((error: Error) => setError(error.message))
                .finally(() => setBusy(false));
            }}
          >
            {kind === 'conversations' ? (
              <>
                {field('title', '故事标题')}
                {select('kind', '聊天类型', [
                  ['solo', '单聊'],
                  ['group', '群聊'],
                ])}
                {select(
                  value.kind === 'solo' ? 'characterId' : 'groupId',
                  value.kind === 'solo' ? '角色' : '群组',
                  (data[value.kind === 'solo' ? 'characters' : 'groups'] ?? []).map((v) => [v.id, v.name]),
                  true
                )}
                <label>
                  绑定主角（留空跟随全局默认）
                  <PersonaPicker
                    value={value.personaId ?? null}
                    personas={data.personas ?? []}
                    emptyLabel="跟随全局默认"
                    defaultPersonaId={defaultPersonaId}
                    disabled={busy}
                    onChange={(id) => set('personaId', id, true)}
                    onCreatePersona={() => setCreatingPersona(true)}
                  />
                </label>
                {choices('lorebookIds', '关联世界书', data.lorebooks ?? [])}
                {field('scenario', '当前聊天场景（留空使用默认场景）', true)}
              </>
            ) : (
              field('name', '名称')
            )}

          {(kind === 'characters' || kind === 'personas') && (
            <AvatarField
              label={kind === 'characters' ? '角色头像' : '主角头像'}
              value={value.avatarPath}
              disabled={busy}
              onChange={(url) => set('avatarPath', url, true)}
            />
          )}

          {(kind === 'characters' || kind === 'personas') && field('description', '描述', true)}

          {kind === 'personas' && <fieldset className="persona-state-template">
            <legend>初始主角状态</legend>
            <p className="muted">首次发送消息时复制到当前故事，之后由故事独立更新。姓名沿用上方名称。</p>
            {templateField('gender_age', '性别／年龄')}
            {templateField('appearance', '外貌', 4)}
            {templateField('occupation', 'Occupation / 身份与地位')}
            {templateField('personality', '性格', 4)}
            {templateField('current_outfit', 'Current Outfit / 当前穿搭', 4)}
            {templateField('past_experience_before_story', 'Past Experience Before Story / 故事前经历', 6)}
            <div className="persona-skills">
              <div className="persona-skills-header">
                <h3>初始技能</h3>
                <button type="button" onClick={() => set('stateTemplate', { ...template, skills: [...(template.skills ?? []), { skill_name: '', skill_type: '', skill_level: '', effect_description: '' }] })}>添加技能</button>
              </div>
            {(template.skills ?? []).map((skill: any, index: number) => <fieldset className="persona-skill" key={index}>
              <legend>技能 {index + 1}</legend>
              {([['skill_name', '技能名称'], ['skill_type', '技能类型'], ['skill_level', '等级／阶段'], ['effect_description', '效果描述']] as const).map(([key, label]) => {
                const change = (text: string) => {
                  const skills = [...template.skills]; skills[index] = { ...skill, [key]: text };
                  set('stateTemplate', { ...template, skills });
                };
                return <label key={key}>{label}{key === 'effect_description'
                  ? <PersonaTextarea rows={3} value={skill[key] ?? ''} onChange={change} />
                  : <input value={skill[key] ?? ''} onChange={event => change(event.target.value)} />}</label>;
              })}
              <button type="button" onClick={() => set('stateTemplate', { ...template, skills: template.skills.filter((_: any, i: number) => i !== index) })}>删除技能</button>
            </fieldset>)}
            </div>
          </fieldset>}

          {kind === 'characters' && (
            <>
              {field('personality', '性格', true)}
              {field('scenario', '场景', true)}
              {field('firstMessage', '开场白', true)}
              <details>
                <summary>高级角色指令</summary>
                {field('exampleDialogue', '示例对白', true)}
                {field('systemPrompt', '角色指令', true)}
                {field('postHistoryInstructions', '后置指令', true)}
              </details>
            </>
          )}

          {kind === 'connections' && (
            <>
              {select('protocol', 'API 协议', [
                ['openai-chat-completions', 'Chat Completions'],
                ['anthropic-messages', 'Anthropic Messages'],
                ['openai-responses', 'OpenAI Responses'],
              ])}
              {field('baseUrl', 'Base URL')}
              <div className="model-id-row">
                {field('model', '模型 ID')}
                <button type="button" onClick={() => void fetchModels()} disabled={modelsBusy || !value.baseUrl?.trim()}>
                  {modelsBusy ? '获取中…' : '自动获取'}
                </button>
              </div>
              {modelsNotice && <small className="muted" role="status">{modelsNotice}</small>}
              {models.length > 0 && <label>
                可用模型
                <select value={models.includes(value.model) ? value.model : ''} onChange={(e) => { if (e.target.value) set('model', e.target.value); }}>
                  <option value="">请选择模型</option>
                  {models.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </label>}
              {field('apiKey', initial?.id ? 'API Key（留空保留已保存值）' : 'API Key', false, 'password')}
              <div className="two-col">
                {field('temperature', `温度（0–${temperatureMax}）`, false, 'number', { min: 0, max: temperatureMax, step: 0.1 })}
                {field('maxTokens', '最大输出 tokens', false, 'number')}
                {field('contextWindow', '上下文窗口 tokens（默认 1000000）', false, 'number')}
              </div>
              {select(
                'reasoning',
                '推理强度',
                ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((v) => [v, v])
              )}
              {json('headers', '自定义请求头 JSON')}
            </>
          )}

          {kind === 'groups' && (
            <>
              <AvatarField
                label="群封面图片"
                value={value.avatarPath}
                disabled={busy}
                onChange={(url) => set('avatarPath', url, true)}
              />
              {choices('memberIds', '成员（按选择顺序）', data.characters ?? [])}
              {field('scenario', '群聊场景', true)}
            </>
          )}

          {error && <p className="error">{error}</p>}

          <footer>
            {automatic ? <>
              {autosave.error ? <p className="error" role="alert">{autosave.error}</p> : <small className="muted" role="status">{autosave.status === 'saving' ? '保存中…' : autosave.dirty ? '离开编辑框自动保存' : autosave.status === 'saved' ? '已自动保存' : '点击内容编辑，离开自动保存'}</small>}
              <button type="button" onClick={() => void close()}>关闭</button>
            </> : <><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={busy} type="submit">{busy ? '保存中…' : '保存'}</button></>}
          </footer>
        </form>
      </section>
    </div>

    {creatingPersona && (
      <Editor
        kind="personas"
        data={data}
        zIndex={zIndex + 20}
        onClose={() => setCreatingPersona(false)}
        onSave={async (newPersona) => {
          const saved = await api(`/personas${newPersona.id ? `/${newPersona.id}` : ''}`, newPersona.id ? 'PUT' : 'POST', newPersona, { keepalive: true });
          onPersonaCreated?.(saved);
          set('personaId', saved.id, true);
          return saved;
        }}
      />
    )}
  </>
  );
}

function PersonaTextarea({ value, rows, onChange }: { value: string; rows: number; onChange: (text: string) => void }) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = field.current!;
    const resize = () => {
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
    };
    resize();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== element.clientWidth) { width = element.clientWidth; resize(); }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [value, rows]);
  return <textarea className="persona-textarea" ref={field} rows={rows} value={value} onChange={event => onChange(event.target.value)} />;
}

export function JsonField({ label, initial, onChange }: { label: string; initial: any; onChange: (value: any) => void }) {
  const [text, setText] = useState(() => JSON.stringify(initial ?? {}, null, 2));
  const [error, setError] = useState('');
  return (
    <label>
      {label}
      <textarea
        className="code"
        rows={8}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setError('');
            e.target.setCustomValidity('');
          } catch {
            setError('JSON 格式不完整');
            e.target.setCustomValidity('Invalid JSON');
          }
        }}
      />
      {error && <small className="error">{error}</small>}
    </label>
  );
}
