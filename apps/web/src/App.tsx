import { useEffect, useRef, useState } from 'react';
import { MessageSquare, PanelRightClose, PanelRightOpen, Plus, Send, Settings2, Square, Upload, Users, ChevronLeft, ChevronRight, RotateCw, GitBranch, PanelLeftClose, PanelLeft, Library } from 'lucide-react';
import { defaultGeneralSettings, defaultPromptSettings, type GeneralSettings, type Conversation, type MessageNode, type SpeakerRef, type ImportPreview, type PromptSettings } from '@new-ai-chat/contracts';
import { api, ApiError, streamTurn } from './api.js';
import Editor, { defaults, titles, type Collection } from './Editor.js';
import PersonaPicker from './PersonaPicker.js';
import Records from './Records.js';
import SettingsModal, { type AvatarMode, type AvatarFit } from './SettingsModal.js';
import './branches.css';

const collections: Collection[] = ['conversations', 'characters', 'personas', 'groups', 'lorebooks', 'connections'];
const studioCollections: Collection[] = ['characters', 'personas', 'groups', 'lorebooks'];
const prettyJson = (body: string) => { try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; } };

export default function App() {
  const [data, setData] = useState<Record<string, any[]>>({});
  const [chatId, setChatId] = useState<string | null>(null);
  const chatRef = useRef(chatId);
  chatRef.current = chatId;

  const [page, setPage] = useState<'chat' | Collection | 'import'>('chat');
  const [branch, setBranch] = useState<MessageNode[]>([]);
  const [nodes, setNodes] = useState<MessageNode[]>([]);
  const [editor, setEditor] = useState<{ kind: Collection; value: any } | null>(null);
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const text = chatId ? inputDrafts[chatId] ?? '' : '';
  const setText = (value: string) => { if (chatId) setInputDrafts(old => ({ ...old, [chatId]: value })); };
  const [sending, setSending] = useState(false);
  const sendPending = useRef(false);
  const [voice, setVoice] = useState('protagonist');
  const [replyTarget, setReplyTarget] = useState('auto');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [turn, setTurn] = useState<{ id: string; chatId: string } | null>(null);
  type LiveDraft = { speaker: SpeakerRef; outputIndex: number; text: string; thinking: string };
  const [draft, setDraft] = useState<LiveDraft | null>(null);
  const pendingDraft = useRef<LiveDraft | null>(null);
  const draftFrame = useRef<number | null>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [agentThinking, setAgentThinking] = useState('');
  const [phase, setPhase] = useState('');
  const [recordsVersion, setRecordsVersion] = useState(0);
  const [session, setSession] = useState<any>(null);
  const [paired, setPaired] = useState(true);
  const [token, setToken] = useState('');

  const [importPath, setImportPath] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const [generalSettings, setGeneralSettings] = useState<GeneralSettings>(defaultGeneralSettings);
  const [promptSettings, setPromptSettings] = useState<PromptSettings>(defaultPromptSettings);
  const [promptPreview, setPromptPreview] = useState<any | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPersona, setShowPersona] = useState(false);
  const [personaSaving, setPersonaSaving] = useState(false);
  const [personaCreateTarget, setPersonaCreateTarget] = useState<'global' | 'chat' | null>(null);
  const [showBranches, setShowBranches] = useState(false);

  // Avatar display preferences
  const [avatarMode, setAvatarMode] = useState<AvatarMode>(() => (localStorage.getItem('avatar-mode') as AvatarMode) || 'large');
  const [avatarFit, setAvatarFit] = useState<AvatarFit>(() => (localStorage.getItem('avatar-fit') as AvatarFit) || 'cover');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const bottom = useRef<HTMLDivElement>(null);
  const streamAbort = useRef<AbortController | null>(null);

  const queueDraft = (next: LiveDraft | null | ((current: LiveDraft | null) => LiveDraft | null)) => {
    pendingDraft.current = typeof next === 'function' ? next(pendingDraft.current) : next;
    if (draftFrame.current !== null) return;
    draftFrame.current = requestAnimationFrame(() => { draftFrame.current = null; setDraft(pendingDraft.current); });
  };

  const chat = (data.conversations ?? []).find((v) => v.id === chatId) as Conversation | undefined;
  const activePersona = data.personas?.find(p => p.id === (chat?.personaId ?? generalSettings.defaultPersonaId));
  const cast = chat?.kind === 'group'
    ? (data.groups ?? []).find((v) => v.id === chat.groupId)?.memberIds ?? []
    : chat?.characterId ? [chat.characterId] : [];

  const speakerName = (speaker: SpeakerRef | null) =>
    speaker?.kind === 'narrator'
      ? generalSettings.narrator.name ?? '旁白'
      : (data.characters ?? []).find((c) => c.id === (speaker?.kind === 'character' ? speaker.characterId : ''))?.name ?? '角色';

  const act = (promise: Promise<unknown>) => {
    setError('');
    void promise.catch((err: Error) => setError(err.message));
  };

  const avatarFor = (message: MessageNode): string | undefined =>
    message.role === 'user'
      ? activePersona?.avatarPath ?? undefined
      : message.speaker?.kind === 'narrator'
      ? generalSettings.narrator.avatarPath ?? undefined
      : data.characters?.find((c) => c.id === (message.speaker?.kind === 'character' ? message.speaker.characterId : null))?.avatarPath ?? undefined;

  async function refresh() {
    const [values, general, prompts] = await Promise.all([
      Promise.all(collections.map((kind) => api(`/${kind}`))),
      api('/settings/general'),
      api('/settings/prompts'),
    ]);
    setGeneralSettings(general);
    setPromptSettings(prompts);
    setData(Object.fromEntries(collections.map((kind, index) => [kind, values[index]])));
  }

  async function refreshMessages(id: string) {
    const value = await api(`/conversations/${id}/messages`);
    if (chatRef.current === id) {
      setBranch(value.branch);
      setNodes(value.nodes);
    }
  }

  async function savePersona(personaId: string | null, global: boolean) {
    setPersonaSaving(true);
    try {
      if (global) setGeneralSettings(await api('/settings/general', 'PUT', { ...generalSettings, defaultPersonaId: personaId }));
      else if (chat) {
        const updated = await api(`/conversations/${chat.id}`, 'PUT', { ...chat, personaId });
        setData(old => ({ ...old, conversations: old.conversations!.map(c => c.id === updated.id ? updated : c) }));
      }
      setPromptPreview(null);
    } finally { setPersonaSaving(false); }
  }

  useEffect(() => {
    void api('/session')
      .then((value) => {
        setSession(value);
        setImportPath(value.defaultImportPath);
        return refresh();
      })
      .catch((err) => {
        setPaired(!(err instanceof ApiError && err.status === 401));
        setError(err instanceof ApiError && err.status === 404
          ? '页面与服务版本不一致，请按 Ctrl+F5 刷新；若仍失败，请更新后重启。'
          : err.message);
      });
    return () => { streamAbort.current?.abort(); if (draftFrame.current !== null) cancelAnimationFrame(draftFrame.current); };
  }, []);

  useEffect(() => {
    setBranch([]);
    setNodes([]);
    setDraft(null);
    pendingDraft.current = null;
    setActivity([]);
    setAgentThinking('');
    setReplyTarget('auto');
    if (chatId) act(refreshMessages(chatId));
  }, [chatId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [branch.length, draft?.text]);

  async function selectChat(id: string) {
    if (turn) {
      await api(`/turns/${turn.id}/cancel`, 'POST', {});
      streamAbort.current?.abort();
      setTurn(null);
    }
    setChatId(id);
    setPage('chat');
    setMobileNav(false);
  }

  async function follow(id: string, currentChat: string) {
    const controller = new AbortController();
    streamAbort.current?.abort();
    streamAbort.current = controller;
    setTurn({ id, chatId: currentChat });
    localStorage.setItem('active-turn', JSON.stringify({ id, chatId: currentChat }));
    let finished = false;
    try {
      await streamTurn(id, (event) => {
        if (chatRef.current !== currentChat) return;
        const p = event.payload;
        if (!['writer.delta', 'thinking.delta', 'writer.snapshot'].includes(event.type)) setActivity((old) => [...old.slice(-79), event]);
        if (event.type === 'turn.started') { setAgentThinking(''); setPhase(generalSettings.generationMode === 'plain' ? '普通写作 · 准备上下文' : generalSettings.generationMode === 'planner' ? 'Planner · 规划' : 'Writer Agent · 选择发言者'); }
        if (event.type === 'agent.phase') setPhase(p.phase === 'selection' ? 'Writer Agent · 选择发言者' : 'Writer Agent · 写作');
        if (event.type === 'agent.thinking') setPhase('Writer Agent · 思考');
        if (event.type === 'writer.started') {
          setPhase(`Writer · ${p.outputIndex + 1}`);
          queueDraft({ speaker: p.speaker, outputIndex: p.outputIndex, text: '', thinking: '' });
        }
        if (event.type === 'writer.delta') {
          queueDraft((old) => { const same = old && old.outputIndex === p.outputIndex ? old : null; return { speaker: p.speaker, outputIndex: p.outputIndex, text: (same?.text ?? '') + p.delta, thinking: same?.thinking ?? '' }; });
        }
        if (event.type === 'thinking.delta') {
          if (generalSettings.generationMode === 'plain') queueDraft((old) => old ? { ...old, thinking: old.thinking + p.delta } : old);
          else setAgentThinking((old) => old + p.delta);
          setPhase(generalSettings.generationMode === 'plain' ? '普通写作 · 思考' : 'Writer Agent · 思考');
        }
        if (event.type === 'writer.snapshot') {
          const latest = [...(p.outputs ?? [])].sort((a, b) => a.outputIndex - b.outputIndex).at(-1);
          if (latest) queueDraft(latest);
        }
        if (event.type === 'message.completed') {
          queueDraft(null);
          act(refreshMessages(currentChat));
        }
        if (event.type === 'turn.failed' || event.type === 'postprocess.failed') {
          setError(p.error ?? '生成失败');
        }
      }, controller.signal);
      finished = true;
      await refreshMessages(currentChat);
      await refresh();
      setRecordsVersion((v) => v + 1);
    } finally {
      if (streamAbort.current === controller) {
        setTurn(null);
        queueDraft(null);
        setPhase('');
        if (finished || controller.signal.aborted) localStorage.removeItem('active-turn');
      }
    }
  }

  useEffect(() => {
    if (!Object.keys(data).length || turn) return;
    const saved = localStorage.getItem('active-turn');
    if (!saved) return;
    try {
      const pending = JSON.parse(saved);
      chatRef.current = pending.chatId;
      setChatId(pending.chatId);
      act(follow(pending.id, pending.chatId));
    } catch {
      localStorage.removeItem('active-turn');
    }
  }, [Object.keys(data).length]);

  function turnPayload(trigger: 'normal' | 'auto' | 'regenerate' | 'continue', targetMessageId?: string) {
    const replyTargetValue = replyTarget === 'auto'
      ? { mode: 'auto' as const }
      : { mode: 'explicit' as const, speaker: replyTarget === 'narrator' ? { kind: 'narrator' as const } : { kind: 'character' as const, characterId: replyTarget } };
    return {
      conversationId: chat!.id,
      trigger,
      replyTarget: replyTargetValue,
      ...(targetMessageId ? { targetMessageId } : {}),
      ...(trigger === 'normal' ? { input: { voice, text } } : {}),
    };
  }

  async function send(trigger: 'normal' | 'auto' | 'regenerate' | 'continue' = 'normal', targetMessageId?: string) {
    if (!chat || turn || sendPending.current) return;
    sendPending.current = true;
    setSending(true);
    setError('');
    setNotice('');
    try {
      const result = await api('/turns', 'POST', turnPayload(trigger, targetMessageId));
      // Clear only the accepted draft, never newer typing or another chat's input.
      if (trigger === 'normal') setInputDrafts(old => old[chat.id] === text ? { ...old, [chat.id]: '' } : old);
      if (chatRef.current !== chat.id) return;
      await refreshMessages(chat.id);
      await follow(result.id, chat.id);
    } finally {
      sendPending.current = false;
      setSending(false);
    }
  }

  async function swipe(message: MessageNode) {
    const result = await api(`/messages/${message.id}/swipe`, 'POST', {});
    await follow(result.id, message.conversationId);
  }

  async function setHead(messageId: string | null) {
    await api(`/conversations/${chatId}/head`, 'POST', { messageId });
    await refreshMessages(chatId!);
    await refresh();
    setRecordsVersion((v) => v + 1);
  }

  async function showPromptPreview() {
    if (!chat) return;
    const trigger = text.trim() ? 'normal' : 'auto';
    const { conversationId: _conversationId, ...payload } = turnPayload(trigger);
    try { setPromptPreview(await api(`/conversations/${chat.id}/prompt-preview`, 'POST', payload)); }
    catch (err: any) { setError(err.message || '预览失败'); }
  }

  const edit = (kind: Collection, value: any = defaults[kind]) =>
    setEditor({ kind, value });

  async function save(value: any) {
    if (!editor) return;
    const input = { ...value };
    if (editor.kind === 'connections' && value.id && !input.apiKey) delete input.apiKey;
    const saved = await api(`/${editor.kind}${value.id ? `/${value.id}` : ''}`, value.id ? 'PUT' : 'POST', input);
    await refresh();
    setEditor(null);
    if (editor.kind === 'conversations') await selectChat(saved.id);
    if (editor.kind === 'personas' && personaCreateTarget) {
      if (personaCreateTarget === 'global') {
        await savePersona(saved.id, true);
      } else if (personaCreateTarget === 'chat') {
        await savePersona(saved.id, false);
      }
      setPersonaCreateTarget(null);
      setShowPersona(true);
    }
  }

  async function remove(kind: Collection, value: any) {
    if (!window.confirm(`删除「${value.name ?? value.title}」？`)) return;
    await api(`/${kind}/${value.id}`, 'DELETE');
    await refresh();
    if (chatId === value.id) setChatId(null);
  }

  async function runImport(execute = false) {
    setImportBusy(true);
    try {
      if (execute && preview) {
        const report = await api('/imports/execute', 'POST', { sourcePath: preview.sourcePath, sourceHash: preview.sourceHash });
        setNotice(report.alreadyImported ? '这批文件已导入，没有重复创建。' : '导入完成。所有聊天统一使用通用设置中的模型。');
        await refresh();
        setPreview(report);
      } else {
        setPreview(await api('/imports/preview', 'POST', { sourcePath: importPath }));
      }
    } finally {
      setImportBusy(false);
    }
  }

  const newChat = () =>
    edit('conversations', {
      ...defaults.conversations,
      characterId: data.characters?.[0]?.id ?? null,
    });

  if (!paired) {
    return (
      <div className="pair-screen">
        <h1>连接空间</h1>
        <p>请输入后端配置的配对令牌。</p>
        <form onSubmit={(e) => {
          e.preventDefault();
          act(api('/pair', 'POST', { token }).then(async () => {
            await refresh();
            setPaired(true);
            setError('');
          }));
        }}>
          <input aria-label="配对令牌" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="primary">配对</button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className={`app ${panel ? 'with-panel' : ''}`}>
      <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'} ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="brand">
          <div className="brand-title">
            <span>New AI Chat</span>
          </div>
          <button className="sidebar-toggle-btn" title="收起侧栏" aria-label="收起侧栏" onClick={() => setSidebarOpen(false)}>
            <PanelLeftClose size={15} />
          </button>
          <button className="mobile-only" onClick={() => setMobileNav(false)}>✕</button>
        </div>

        <button className="new-story primary" onClick={newChat}>
          <Plus size={15} />开启新故事
        </button>

        <div className="nav-label">
          <span>故事列表</span>
          <span>{data.conversations?.length ?? 0}</span>
        </div>
        <nav className="story-list">
          {data.conversations?.map((c) => (
            <button className={page === 'chat' && c.id === chatId ? 'selected' : ''} key={c.id} onClick={() => act(selectChat(c.id))}>
              <MessageSquare size={14} />
              <span>
                {c.title}
                <small>{c.kind === 'group' ? '群聊' : '单聊'} · {{ plain: '普通写作', 'writer-agent': 'Writer Agent', planner: 'Planner＋Writer' }[generalSettings.generationMode]}</small>
              </span>
            </button>
          ))}
          {!data.conversations?.length && <p className="muted" style={{ padding: '4px 8px' }}>暂无故事</p>}
        </nav>

        <div className="nav-label">
          <span>资源管理</span>
        </div>
        <nav className="studio-nav">
          {studioCollections.map((kind) => (
            <button className={page === kind ? 'selected' : ''} key={kind} onClick={() => { setPage(kind); setMobileNav(false); }}>
              {kind === 'groups' ? <Users size={14} /> : <Library size={14} />}
              {titles[kind]} <span>{data[kind]?.length ?? 0}</span>
            </button>
          ))}
          <button onClick={() => { setShowSettings(true); setMobileNav(false); }}>
            <Settings2 size={14} />通用设置
          </button>
          <button onClick={() => { setShowPersona(true); setMobileNav(false); }}>
            <Users size={14} />主角：{activePersona?.name ?? '未选择'}
          </button>
          <button className={page === 'import' ? 'selected' : ''} onClick={() => { setPage('import'); setMobileNav(false); }}>
            <Upload size={14} />导入 SillyTavern
          </button>
        </nav>

        <div className="local-status">
          <i /> 本地 {session?.fakeModel ? '离线演示' : 'v0.1'}
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="topbar-left">
            {!sidebarOpen && (
              <button className="sidebar-toggle-btn" title="展开侧栏" aria-label="展开侧栏" onClick={() => setSidebarOpen(true)}>
                <PanelLeft size={16} />
              </button>
            )}
            <button className="mobile-only" aria-label="打开导航" onClick={() => setMobileNav(true)}>☰</button>
            <h1>{page === 'chat' ? chat?.title ?? '新故事' : page === 'import' ? '导入 SillyTavern' : titles[page]}</h1>
          </div>
          <div className="top-actions">
            {chat && page === 'chat' && (
              <>
                <button title="故事分支" aria-label="故事分支" onClick={() => setShowBranches(true)}>
                  <GitBranch size={16} />
                </button>
                <button title="故事资料" aria-label="故事资料" onClick={() => edit('conversations', chat)}>
                  <Settings2 size={16} />
                </button>
                <button title="记录面板" aria-label="记录面板" onClick={() => setPanel(!panel)}>
                  {panel ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                </button>
                <button title="发送前预览提示词" aria-label="发送前预览提示词" onClick={() => act(showPromptPreview())}>预览</button>
              </>
            )}
          </div>
        </header>

        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')}>✕</button>
          </div>
        )}
        {notice && (
          <div className="banner">
            <span>{notice}</span>
            <button onClick={() => setNotice('')}>✕</button>
          </div>
        )}

        {page === 'chat' && !chat && (
          <section className="welcome">
            <h2>开启一段新故事</h2>
            <div className="welcome-actions">
              <button className="primary" onClick={newChat}>
                <Plus size={15} /> 开启新故事
              </button>
              <button onClick={() => setPage('import')}>
                <Upload size={15} /> 导入旧故事
              </button>
            </div>
          </section>
        )}

        {page === 'chat' && chat && (
          <>
            <div className="cast-strip">
              <span><i className="dot narrator" />{generalSettings.narrator.name}</span>
              {cast.map((id: string) => (
                <span key={id}><i className="dot" />{data.characters?.find((c) => c.id === id)?.name}</span>
              ))}
              <small>{generalSettings.agencyMode === 'protected' ? '主角保护' : '共同创作'}</small>
            </div>

            <section className={`messages avatar-${avatarMode} avatar-fit-${avatarFit}`} aria-label="聊天记录">
              {!branch.length && (
                <div className="scene-start">
                  <p>输入第一条消息开始对话。</p>
                </div>
              )}
              {branch.map((m) => {
                const swipes = nodes.filter((n) => n.parentId === m.parentId && n.role === m.role);
                const index = swipes.findIndex((n) => n.id === m.id);
                const narrator = m.authorKind === 'narrator' || m.authorKind === 'user_narrator';
                const avatar = avatarFor(m);
                const info = m.generationInfo;
                const totalInput = info?.usage ? info.usage.input + info.usage.cacheRead + info.usage.cacheWrite : null;
                const cacheRate = totalInput && info?.usage ? Math.round(info.usage.cacheRead / totalInput * 100) : 0;
                return (
                  <article className={`message ${m.role === 'user' ? 'user' : ''} ${narrator ? 'narration' : ''}`} key={m.id}>
                    <div
                      className={`avatar ${avatar ? 'clickable' : ''}`}
                      onClick={() => { if (avatar) setPreviewImage(avatar); }}
                      title={avatar ? '点击查看大图立绘' : undefined}
                    >
                      {avatar ? (
                        <img src={avatar} alt="" loading="lazy" />
                      ) : narrator ? (
                        '旁'
                      ) : m.role === 'user' ? (
                        '你'
                      ) : (
                        speakerName(m.speaker).slice(0, 1)
                      )}
                    </div>
                    <div className="message-body">
                      <header>
                        <strong>
                          {m.role === 'user'
                            ? m.authorKind === 'user_narrator'
                              ? '你 · 旁白'
                              : activePersona?.name ?? '你'
                            : speakerName(m.speaker)}
                        </strong>
                        <span>{narrator ? '旁白' : m.role === 'user' ? '主角' : 'Writer'}</span>
                      </header>
                      {m.role === 'assistant' && info?.mode === 'plain' && <details className="message-thinking" open>
                        <summary>模型思考</summary>
                        <pre>{info.thinking || '模型未返回可见思考内容。'}</pre>
                      </details>}
                      <div className="prose">{m.content}</div>
                      {m.role === 'assistant' && <small className="generation-info">{info
                        ? `${info.model} · 输入 ${totalInput ?? '未返回'} · 输出 ${info.usage?.output ?? '未返回'} · 缓存 ${info.usage?.cacheRead ?? '未返回'}${info.usage ? ` (${cacheRate}%)` : ''}`
                        : '生成信息不可用（旧消息）'}</small>}
                      <div className="message-actions">
                        {swipes.length > 1 && (
                          <>
                            <button title="上一个版本" disabled={!!turn || index <= 0} onClick={() => act(setHead(swipes[index - 1]!.id))}>
                              <ChevronLeft size={13} />
                            </button>
                            <small>{index + 1}/{swipes.length}</small>
                            <button title="下一个版本" disabled={!!turn || index >= swipes.length - 1} onClick={() => act(setHead(swipes[index + 1]!.id))}>
                              <ChevronRight size={13} />
                            </button>
                          </>
                        )}
                        {m.role === 'assistant' && (
                          <>
                            <button disabled={!!turn} title="生成新 Swipe" onClick={() => act(swipe(m))}>
                              <RotateCw size={12} />新版本
                            </button>
                            <button disabled={!!turn} onClick={() => act(send('regenerate', m.id))}>重做整轮</button>
                            <button disabled={!!turn} onClick={() => act(send('continue', m.id))}>续写</button>
                          </>
                        )}
                        <button disabled={!!turn} title="从此处分支" onClick={() => act(setHead(m.id))}>
                          <GitBranch size={12} />
                        </button>
                        <button disabled={!!turn} onClick={() => {
                          const content = window.prompt('编辑内容（创建新分支版本）', m.content);
                          if (content !== null) act(api(`/messages/${m.id}/edit`, 'POST', { content }).then(() => refreshMessages(chat.id)));
                        }}>
                          编辑
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {draft && (
                <article className="message streaming">
                  <div className="avatar">...</div>
                  <div className="message-body">
                    <header>
                      <strong>{speakerName(draft.speaker)}</strong>
                      <span>Writing</span>
                    </header>
                    {generalSettings.generationMode === 'plain' && <details className="message-thinking" open>
                      <summary>模型思考</summary><pre>{draft.thinking || '模型尚未返回可见思考内容。'}</pre>
                    </details>}
                    <div className="prose">{draft.text}<span className="caret">▍</span></div>
                  </div>
                </article>
              )}
              <div ref={bottom} />
            </section>

            <div className="composer-wrap">
              {turn && <div className="generation-status"><i />{phase || '正在生成…'}</div>}
              <form className="composer" onSubmit={(e) => {
                e.preventDefault();
                act(send());
              }}>
                <textarea
                  aria-label="输入消息"
                  placeholder={voice === 'narrator' ? '以旁白推动场景或描写事件…' : '输入主角的行动或对白…'}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (text.trim() && !turn) act(send());
                    }
                  }}
                />
                <div className="composer-controls">
                  <div className="voice-switch">
                    <button type="button" className={voice === 'protagonist' ? 'active' : ''} onClick={() => setVoice('protagonist')}>
                      主角
                    </button>
                    <button type="button" className={voice === 'narrator' ? 'active' : ''} onClick={() => setVoice('narrator')}>
                      用户旁白
                    </button>
                  </div>
                  <label className="reply-select">
                    由谁回复
                    <select aria-label="回复者" value={replyTarget} onChange={(e) => setReplyTarget(e.target.value)}>
                      <option value="auto">自动选择</option>
                      <option value="narrator">{generalSettings.narrator.name}</option>
                      {cast.map((id: string) => (
                        <option value={id} key={id}>{data.characters?.find((c) => c.id === id)?.name}</option>
                      ))}
                    </select>
                  </label>
                  {turn ? (
                    <button type="button" className="send stop" aria-label="停止生成" onClick={() => act(api(`/turns/${turn.id}/cancel`, 'POST', {}))}>
                      <Square size={14} />
                    </button>
                  ) : (
                    <button type="submit" className="send primary" aria-label="发送" disabled={sending || !text.trim()}>
                      <Send size={15} />
                    </button>
                  )}
                </div>
              </form>
              <div className="composer-hint">
                <button disabled={sending || !!turn} onClick={() => act(send('auto'))}>让故事继续 →</button>
              </div>
            </div>
          </>
        )}

        {page !== 'chat' && page !== 'import' && (
          <section className="management">
            <header>
              <button className="primary" onClick={() => edit(page)}>
                <Plus size={14} />创建{titles[page]}
              </button>
            </header>
            <div className="management-content">
              {page === 'characters' || page === 'personas' ? (
                <div className="character-grid">
                  {data[page]?.map((v) => (
                    <article className="character-card" key={v.id}>
                      <div
                        className="character-card-image-wrap"
                        onClick={() => { if (v.avatarPath) setPreviewImage(v.avatarPath); }}
                        title={v.avatarPath ? '点击查看高清原图' : undefined}
                      >
                        {v.avatarPath ? (
                          <>
                            <img className="character-card-bg-blur" src={v.avatarPath} alt="" aria-hidden="true" />
                            <img className="character-card-img" src={v.avatarPath} alt={v.name} loading="lazy" />
                          </>
                        ) : (
                          <div className="character-card-placeholder">
                            {v.name?.slice(0, 1) || '卡'}
                          </div>
                        )}
                      </div>
                      <div className="character-card-body">
                        <h3 className="character-card-title">{v.name}</h3>
                        <p className="character-card-desc">{v.description || v.scenario || '暂无描述'}</p>
                        <div className="character-card-footer">
                          {page === 'characters' && (
                            <button
                              className="primary"
                              onClick={() => edit('conversations', {
                                ...defaults.conversations,
                                title: `与 ${v.name} 的故事`,
                                characterId: v.id,
                              })}
                            >
                              开始聊天
                            </button>
                          )}
                          <button onClick={() => edit(page, v)}>编辑</button>
                          <button className="danger" onClick={() => act(remove(page, v))}>删除</button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="resource-list">
                  {data[page]?.map((v) => (
                    <article className="resource-item" key={v.id}>
                      <div className="resource-main">
                        <div className="resource-info">
                          <h3 className="resource-title">{v.name ?? v.title}</h3>
                          {(v.model || v.description || v.scenario) && (
                            <p className="resource-desc">{v.model ?? v.description ?? v.scenario}</p>
                          )}
                        </div>
                      </div>
                      <div className="resource-meta">
                        <span>{v.protocol ?? (v.entries ? `${v.entries.length} 个条目` : v.memberIds ? `${v.memberIds.length} 位成员` : '')}</span>
                      </div>
                      <div className="resource-actions">
                        <button onClick={() => edit(page, v)}>编辑</button>
                        <button className="danger" onClick={() => act(remove(page, v))}>删除</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {!data[page]?.length && <div className="empty">暂无{titles[page]}。点击右上角按钮创建。</div>}
            </div>
          </section>
        )}

        {page === 'import' && (
          <section className="import-page">
            <h2>导入 SillyTavern 数据</h2>
            <p className="muted">扫描角色卡、世界书、聊天、群组、Memory 与主角状态。不会修改源文件。</p>
            <label>
              SillyTavern 用户数据目录
              <input value={importPath} onChange={(e) => { setImportPath(e.target.value); setPreview(null); }} />
            </label>
            <button className="primary" disabled={importBusy} onClick={() => act(runImport())}>
              {importBusy ? '处理中…' : '扫描并预览'}
            </button>
            {preview && (
              <div className="import-preview">
                <h3>导入预览</h3>
                <div className="count-grid">
                  {Object.entries(preview.counts).map(([key, value]) => (
                    <span key={key}><b>{value}</b>{key}</span>
                  ))}
                </div>
                {preview.warnings.map((warning, i) => (
                  <p className="warning" key={i}>{warning}</p>
                ))}
                <button className="primary" disabled={importBusy} onClick={() => act(runImport(true))}>
                  确认导入
                </button>
              </div>
            )}
          </section>
        )}
      </main>

      {page === 'chat' && chat && panel && (
        <Records
          chat={chat}
          generationMode={generalSettings.generationMode}
          version={recordsVersion}
          activity={activity}
          liveThinking={agentThinking}
          disabled={!!turn}
          onError={setError}
          onChanged={() => setRecordsVersion((v) => v + 1)}
          onClose={() => setPanel(false)}
        />
      )}

      {showSettings && <SettingsModal
        onClose={() => setShowSettings(false)}
        generalSettings={generalSettings}
        onSaveGeneral={async value => { setGeneralSettings(await api('/settings/general', 'PUT', value)); }}
        generationActive={sending || !!turn}
        connections={data.connections ?? []}
        onEditConnection={(conn) => edit('connections', conn ?? defaults.connections)}
        onDeleteConnection={(conn) => remove('connections', conn)}
        onTestConnection={async (id) => {
          await api(`/connections/${id}/test`, 'POST', {});
        }}
        avatarMode={avatarMode}
        setAvatarMode={setAvatarMode}
        avatarFit={avatarFit}
        setAvatarFit={setAvatarFit}
        promptSettings={promptSettings}
        onSavePrompts={async value => { setPromptSettings(await api('/settings/prompts', 'PUT', value)); }}
      />}

      {editor && (
        <Editor
          key={`${editor.kind}:${editor.value.id ?? 'new'}`}
          kind={editor.kind}
          initial={editor.value}
          data={data}
          defaultPersonaId={generalSettings.defaultPersonaId}
          onPersonaCreated={(newPersona) => {
            setData((old) => ({ ...old, personas: [...(old.personas ?? []), newPersona] }));
          }}
          onClose={() => {
            setEditor(null);
            if (personaCreateTarget) {
              setPersonaCreateTarget(null);
              setShowPersona(true);
            }
          }}
          onSave={save}
        />
      )}

      {showBranches && chat && (
        <div className="modal-shade">
          <section className="modal" role="dialog" aria-modal="true" aria-label="故事分支">
            <header>
              <h2>故事分支</h2>
              <button aria-label="关闭" onClick={() => setShowBranches(false)}>✕</button>
            </header>
            <div className="branch-picker">
              <p className="muted" style={{ marginBottom: 12 }}>切换到旧分支会同时恢复该分支的消息与状态记录。</p>
              {nodes.filter((node) => !nodes.some((child) => child.parentId === node.id)).map((node) => (
                <button key={node.id} disabled={!!turn} onClick={() => act(setHead(node.id).then(() => setShowBranches(false)))}>
                  <GitBranch size={15} />
                  <span>
                    {node.id === chat.headMessageId ? '当前分支 · ' : ''}
                    {node.role === 'user' ? '用户' : speakerName(node.speaker)}
                    <small>{node.content.slice(0, 100)}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {previewImage && (
        <div className="lightbox-modal" onClick={() => setPreviewImage(null)} title="点击关闭大图">
          <img className="lightbox-content" src={previewImage} alt="角色大图立绘" />
        </div>
      )}
      {showPersona && <div className="modal-shade" onClick={() => setShowPersona(false)}>
        <section className="modal" role="dialog" aria-modal="true" aria-label="主角身份" onClick={e => e.stopPropagation()}>
          <header><h2>主角身份</h2><button aria-label="关闭主角身份" onClick={() => setShowPersona(false)}>✕</button></header>
          <div className="settings-content settings-section">
            <label>全局默认主角
              <PersonaPicker
                value={generalSettings.defaultPersonaId ?? null}
                personas={data.personas ?? []}
                emptyLabel="未选择"
                disabled={!!turn || sending || personaSaving}
                onChange={(id) => act(savePersona(id, true))}
                onCreatePersona={() => {
                  setShowPersona(false);
                  setPersonaCreateTarget('global');
                  edit('personas');
                }}
              />
            </label>
            {chat && <label>当前故事：{chat.title}
              <PersonaPicker
                value={chat.personaId ?? null}
                personas={data.personas ?? []}
                emptyLabel="跟随全局默认"
                defaultPersonaId={generalSettings.defaultPersonaId ?? null}
                disabled={!!turn || sending || personaSaving}
                onChange={(id) => act(savePersona(id, false))}
                onCreatePersona={() => {
                  setShowPersona(false);
                  setPersonaCreateTarget('chat');
                  edit('personas');
                }}
              />
            </label>}
            <p className="muted">新故事和未绑定的故事使用全局默认主角；绑定后切换故事会恢复各自的身份。</p>
            {error && <p className="banner error" role="alert">{error}</p>}
          </div>
        </section>
      </div>}

      {promptPreview && (
        <div className="modal-shade" style={{ zIndex: 130 }} onClick={() => setPromptPreview(null)}>
          <section className="modal prompt-preview" role="dialog" aria-modal="true" aria-label="提示词预览" onClick={e => e.stopPropagation()}>
            <header><h2>发送前提示词预览</h2><button aria-label="关闭" onClick={() => setPromptPreview(null)}>✕</button></header>
            <p className="muted">动作：{promptPreview.action === 'auto' ? '自动继续' : '普通发送'} · 模式：{promptPreview.generationMode} · 阶段：{promptPreview.phase} · 协议：{promptPreview.protocol}</p>
            {promptPreview.action === 'auto' && <p className="muted">草稿为空，正在预览自动继续；自动继续不重复上一轮用户输入。输入草稿后预览可查看本轮输入锚点。</p>}
            <p className="muted">身份：{promptPreview.pendingSelection ? '待选择' : promptPreview.speaker?.kind === 'narrator' ? generalSettings.narrator.name : speakerName(promptPreview.speaker)} · 主角：{promptPreview.personaName ?? '未选择（请求使用 Protagonist）'}{promptPreview.clipped ? ' · 已按上下文预算裁剪' : ''}</p>
            <details className="prompt-json" open><summary>实际首请求 Body（未发送）</summary><pre>{prettyJson(promptPreview.requestBody)}</pre></details>
          </section>
        </div>
      )}
    </div>
  );
}
