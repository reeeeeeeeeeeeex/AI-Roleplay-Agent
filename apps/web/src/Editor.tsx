import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import AvatarField from './AvatarField';
import PersonaPicker from './PersonaPicker';

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
  personas: { name: '', avatarPath: null, description: '' },
  connections: {
    name: '',
    protocol: 'openai-chat-completions',
    baseUrl: 'https://api.deepseek.com',
    model: '',
    apiKey: '',
    temperature: 0.8,
    maxTokens: 2048,
    contextWindow: 128000,
    historyMessageLimit: 0,
    reasoning: 'off',
    headers: {},
  },
  lorebooks: { name: '', description: '', entries: [] },
  groups: { name: '', memberIds: [], scenario: '' },
  conversations: {
    title: '新的故事',
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
  onSave: (value: any) => Promise<void>;
  defaultPersonaId?: string | null;
  onPersonaCreated?: (persona: any) => void;
  zIndex?: number;
}) {
  const [value, setValue] = useState<any>(() => ({ ...defaults[kind], ...initial }));
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

  const set = (key: string, v: any) => setValue((old: any) => ({ ...old, [key]: v }));

  const field = (key: string, label: string, multiline = false, type = 'text', bounds?: { min: number; max: number; step: number }) => (
    <label key={key}>
      {label}
      {multiline ? (
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
      <select value={value[key] ?? ''} onChange={(event) => set(key, event.target.value || null)}>
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
                  : (value[key] ?? []).filter((id: string) => id !== item.id)
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

  return (
    <>
      <div className="modal-shade" style={{ zIndex }}>
        <section className="modal" role="dialog" aria-modal="true" aria-label={`编辑${titles[kind]}`}>
          <header>
            <h2>{initial?.id ? '编辑' : '创建'}{titles[kind]}</h2>
            <button onClick={onClose} aria-label="关闭">✕</button>
          </header>

          <form
            onSubmit={(e) => {
              e.preventDefault();
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
                    onChange={(id) => set('personaId', id)}
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
              onChange={(url) => set('avatarPath', url)}
            />
          )}

          {(kind === 'characters' || kind === 'personas' || kind === 'lorebooks') && field('description', '描述', true)}

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
                {field('contextWindow', '上下文窗口 tokens（默认 128000）', false, 'number')}
                {field('historyMessageLimit', '历史消息数上限（0 不限）', false, 'number')}
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
              {choices('memberIds', '成员（按选择顺序）', data.characters ?? [])}
              {field('scenario', '群聊场景', true)}
            </>
          )}

          {kind === 'lorebooks' && (
            <>
              {json('entries', '条目 JSON')}
              <small className="muted">
                每项支持 keys、secondaryKeys、content、constant、enabled、order、position 和 depth。示例：<code>{'[{"keys":["森林"],"content":"森林中有一座灯塔。"}]'}</code>
              </small>
            </>
          )}

          {error && <p className="error">{error}</p>}

          <footer>
            <button type="button" onClick={onClose}>取消</button>
            <button className="primary" disabled={busy} type="submit">{busy ? '保存中…' : '保存'}</button>
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
          const saved = await api('/personas', 'POST', newPersona);
          if (data.personas) {
            data.personas.push(saved);
          }
          onPersonaCreated?.(saved);
          set('personaId', saved.id);
          setCreatingPersona(false);
        }}
      />
    )}
  </>
  );
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
