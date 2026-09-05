import { useState } from 'react';

export type Collection = 'characters' | 'personas' | 'connections' | 'lorebooks' | 'groups' | 'conversations';

export const titles: Record<Collection, string> = {
  characters: '角色',
  personas: '主角',
  connections: '模型连接',
  lorebooks: '世界书',
  groups: '群组',
  conversations: '聊天',
};

export const defaults: Record<Collection, any> = {
  characters: { name: '', description: '', personality: '', scenario: '', firstMessage: '', exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '' },
  personas: { name: '', description: '' },
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
    connectionId: null,
    lorebookIds: [],
    plannerEnabled: false,
    agencyMode: 'protected',
    narrator: { name: '旁白', style: '克制、具象、重视场景连续性，不替角色解释未表达的内心。', avatarPath: null },
    memoryTurnInterval: 10,
    stateTurnInterval: 0,
  },
};

export default function Editor({
  kind,
  initial,
  data,
  onClose,
  onSave,
}: {
  kind: Collection;
  initial: any;
  data: Record<string, any[]>;
  onClose: () => void;
  onSave: (value: any) => Promise<void>;
}) {
  const [value, setValue] = useState<any>(() => ({ ...defaults[kind], ...initial }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key: string, v: any) => setValue((old: any) => ({ ...old, [key]: v }));

  const field = (key: string, label: string, multiline = false, type = 'text') => (
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
    <div className="modal-shade">
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
              {select('connectionId', '模型连接', (data.connections ?? []).map((v) => [v.id, v.name]), true)}
              {select('personaId', '主角', (data.personas ?? []).map((v) => [v.id, v.name]), true)}
              {choices('lorebookIds', '关联世界书', data.lorebooks ?? [])}
              {field('scenario', '当前聊天场景（留空使用默认场景）', true)}
              <label className="check">
                <input type="checkbox" checked={value.plannerEnabled} onChange={(e) => set('plannerEnabled', e.target.checked)} />
                启用 Planner 规划（关闭时由 Writer 自动选择发言者）
              </label>
              {select('agencyMode', '主角控制', [
                ['protected', '保护主角：AI 不代替主角决定'],
                ['coauthor', '共同创作：AI 可描写主角行动和内心'],
              ])}
              <label>
                旁白名称
                <input value={value.narrator.name} onChange={(e) => set('narrator', { ...value.narrator, name: e.target.value })} />
              </label>
              <label>
                旁白风格
                <textarea rows={3} value={value.narrator.style} onChange={(e) => set('narrator', { ...value.narrator, style: e.target.value })} />
              </label>
              <label>
                旁白头像（本地资产地址）
                <input
                  value={value.narrator.avatarPath ?? ''}
                  onChange={(e) => set('narrator', { ...value.narrator, avatarPath: e.target.value || null })}
                />
              </label>
              <div className="two-col">
                {field('memoryTurnInterval', 'Memory 自动更新间隔（0 关闭）', false, 'number')}
                {field('stateTurnInterval', '状态自动更新间隔（0 关闭）', false, 'number')}
              </div>
            </>
          ) : (
            field('name', '名称')
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
              {field('model', '模型 ID')}
              {field('apiKey', initial?.id ? 'API Key（留空保留已保存值）' : 'API Key', false, 'password')}
              <div className="two-col">
                {field('temperature', '温度', false, 'number')}
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
