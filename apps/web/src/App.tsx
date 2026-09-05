import { useEffect, useRef, useState } from 'react';
import { BookOpen, MessageSquare, PanelRightClose, PanelRightOpen, Plus, Send, Settings2, Square, Upload, Users, ChevronLeft, ChevronRight, RotateCw, GitBranch, PanelLeftClose, PanelLeft, Library } from 'lucide-react';
import type { Conversation, MessageNode, SpeakerRef, ImportPreview } from '@new-ai-chat/contracts';
import { api, streamTurn } from './api.js';
import Editor, { defaults, titles, type Collection } from './Editor.js';
import Records from './Records.js';
import NarratorSettings from './NarratorSettings.js';
import './branches.css';

const collections: Collection[] = ['conversations', 'characters', 'personas', 'groups', 'lorebooks', 'connections'];

export default function App() {
  const [data, setData] = useState<Record<string, any[]>>({});
  const [chatId, setChatId] = useState<string | null>(null);
  const chatRef = useRef(chatId);
  chatRef.current = chatId;

  const [page, setPage] = useState<'chat' | Collection | 'import'>('chat');
  const [branch, setBranch] = useState<MessageNode[]>([]);
  const [nodes, setNodes] = useState<MessageNode[]>([]);
  const [editor, setEditor] = useState<{ kind: Collection; value: any } | null>(null);
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('protagonist');
  const [replyTarget, setReplyTarget] = useState('auto');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [turn, setTurn] = useState<{ id: string; chatId: string } | null>(null);
  const [draft, setDraft] = useState<{ speaker: SpeakerRef; text: string } | null>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [phase, setPhase] = useState('');
  const [recordsVersion, setRecordsVersion] = useState(0);
  const [session, setSession] = useState<any>(null);
  const [paired, setPaired] = useState(true);
  const [token, setToken] = useState('');

  const [importPath, setImportPath] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const [narratorDefaults, setNarratorDefaults] = useState(defaults.conversations.narrator);
  const [editNarrator, setEditNarrator] = useState(false);
  const [showBranches, setShowBranches] = useState(false);

  const bottom = useRef<HTMLDivElement>(null);
  const streamAbort = useRef<AbortController | null>(null);

  const chat = (data.conversations ?? []).find((v) => v.id === chatId) as Conversation | undefined;
  const cast = chat?.kind === 'group'
    ? (data.groups ?? []).find((v) => v.id === chat.groupId)?.memberIds ?? []
    : chat?.characterId ? [chat.characterId] : [];

  const speakerName = (speaker: SpeakerRef | null) =>
    speaker?.kind === 'narrator'
      ? chat?.narrator.name ?? '旁白'
      : (data.characters ?? []).find((c) => c.id === (speaker?.kind === 'character' ? speaker.characterId : ''))?.name ?? '角色';

  const act = (promise: Promise<unknown>) => {
    setError('');
    void promise.catch((err: Error) => setError(err.message));
  };

  const avatarFor = (message: MessageNode): string | undefined =>
    message.role === 'user'
      ? data.personas?.find((p) => p.id === chat?.personaId)?.avatarPath ?? undefined
      : message.speaker?.kind === 'narrator'
      ? chat?.narrator.avatarPath ?? undefined
      : data.characters?.find((c) => c.id === (message.speaker?.kind === 'character' ? message.speaker.characterId : null))?.avatarPath ?? undefined;

  async function refresh() {
    const [values, narrator] = await Promise.all([
      Promise.all(collections.map((kind) => api(`/${kind}`))),
      api('/narrator'),
    ]);
    setNarratorDefaults(narrator);
    setData(Object.fromEntries(collections.map((kind, index) => [kind, values[index]])));
  }

  async function refreshMessages(id: string) {
    const value = await api(`/conversations/${id}/messages`);
    if (chatRef.current === id) {
      setBranch(value.branch);
      setNodes(value.nodes);
    }
  }

  useEffect(() => {
    void api('/session')
      .then((value) => {
        setSession(value);
        setImportPath(value.defaultImportPath);
        return refresh();
      })
      .catch((err) => {
        setPaired(false);
        setError(err.message);
      });
    return () => streamAbort.current?.abort();
  }, []);

  useEffect(() => {
    setBranch([]);
    setNodes([]);
    setDraft(null);
    setActivity([]);
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
    setText('');
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
        setActivity((old) => [...old.slice(-39), event]);
        if (event.type === 'turn.started') setPhase('选择发言者');
        if (event.type === 'writer.started') {
          setPhase(`Writer · ${p.outputIndex + 1}`);
          setDraft({ speaker: p.speaker, text: '' });
        }
        if (event.type === 'writer.delta') {
          setDraft((old) => ({ speaker: p.speaker, text: (old?.text ?? '') + p.delta }));
        }
        if (event.type === 'message.completed') {
          setDraft(null);
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
        setDraft(null);
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

  async function send(trigger = 'normal', targetMessageId?: string) {
    if (!chat) return;
    setError('');
    setNotice('');
    const target = replyTarget === 'auto'
      ? { mode: 'auto' }
      : { mode: 'explicit', speaker: replyTarget === 'narrator' ? { kind: 'narrator' } : { kind: 'character', characterId: replyTarget } };
    const result = await api('/turns', 'POST', {
      conversationId: chat.id,
      trigger,
      replyTarget: target,
      ...(targetMessageId ? { targetMessageId } : {}),
      ...(trigger === 'normal' ? { input: { voice, text } } : {}),
    });
    setText('');
    await refreshMessages(chat.id);
    await follow(result.id, chat.id);
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

  const edit = (kind: Collection, value: any = defaults[kind]) =>
    setEditor({ kind, value: kind === 'conversations' && !value.id ? { ...value, narrator: narratorDefaults } : value });

  async function save(value: any) {
    if (!editor) return;
    const input = { ...value };
    if (editor.kind === 'connections' && value.id && !input.apiKey) delete input.apiKey;
    const saved = await api(`/${editor.kind}${value.id ? `/${value.id}` : ''}`, value.id ? 'PUT' : 'POST', input);
    await refresh();
    setEditor(null);
    if (editor.kind === 'conversations') await selectChat(saved.id);
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
        setNotice(report.alreadyImported ? '这批文件已导入，没有重复创建。' : '导入完成。请为聊天配置连接。');
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
      connectionId: data.connections?.[0]?.id ?? null,
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
                <small>{c.kind === 'group' ? '群聊' : '单聊'} · {c.plannerEnabled ? 'Planner' : 'Writer'}</small>
              </span>
            </button>
          ))}
          {!data.conversations?.length && <p className="muted" style={{ padding: '4px 8px' }}>暂无故事</p>}
        </nav>

        <div className="nav-label">
          <span>资源管理</span>
        </div>
        <nav className="studio-nav">
          {(['characters', 'personas', 'groups', 'lorebooks', 'connections'] as Collection[]).map((kind) => (
            <button className={page === kind ? 'selected' : ''} key={kind} onClick={() => { setPage(kind); setMobileNav(false); }}>
              {kind === 'groups' ? <Users size={14} /> : kind === 'connections' ? <Settings2 size={14} /> : <Library size={14} />}
              {titles[kind]} <span>{data[kind]?.length ?? 0}</span>
            </button>
          ))}
          <button onClick={() => { setEditNarrator(true); setMobileNav(false); }}>
            <Settings2 size={14} />默认旁白
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
                <button title="聊天设置" aria-label="聊天设置" onClick={() => edit('conversations', chat)}>
                  <Settings2 size={16} />
                </button>
                <button title="记录面板" aria-label="记录面板" onClick={() => setPanel(!panel)}>
                  {panel ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                </button>
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
              <span><i className="dot narrator" />{chat.narrator.name}</span>
              {cast.map((id: string) => (
                <span key={id}><i className="dot" />{data.characters?.find((c) => c.id === id)?.name}</span>
              ))}
              <small>{chat.agencyMode === 'protected' ? '主角保护' : '共同创作'}</small>
            </div>

            <section className="messages" aria-label="聊天记录">
              {!branch.length && (
                <div className="scene-start">
                  <p>输入第一条消息开始对话。</p>
                </div>
              )}
              {branch.map((m) => {
                const swipes = nodes.filter((n) => n.parentId === m.parentId && n.role === m.role);
                const index = swipes.findIndex((n) => n.id === m.id);
                const narrator = m.authorKind === 'narrator' || m.authorKind === 'user_narrator';
                return (
                  <article className={`message ${m.role === 'user' ? 'user' : ''} ${narrator ? 'narration' : ''}`} key={m.id}>
                    <div className="avatar">
                      {avatarFor(m) ? (
                        <img src={avatarFor(m)} alt="" loading="lazy" />
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
                              : data.personas?.find((p) => p.id === chat.personaId)?.name ?? '你'
                            : speakerName(m.speaker)}
                        </strong>
                        <span>{narrator ? '旁白' : m.role === 'user' ? '主角' : 'Writer'}</span>
                      </header>
                      <div className="prose">{m.content}</div>
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
                      <option value="narrator">{chat.narrator.name}</option>
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
                    <button type="submit" className="send primary" aria-label="发送" disabled={!text.trim()}>
                      <Send size={15} />
                    </button>
                  )}
                </div>
              </form>
              <div className="composer-hint">
                <button disabled={!!turn} onClick={() => act(send('auto'))}>让故事继续 →</button>
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
              <div className="resource-list">
                {data[page]?.map((v) => (
                  <article className="resource-item" key={v.id}>
                    <div className="resource-main">
                      {v.avatarPath && <img className="resource-avatar" src={v.avatarPath} alt="" />}
                      <div className="resource-info">
                        <h3 className="resource-title">{v.name ?? v.title}</h3>
                        {(v.model || v.description || v.scenario) && (
                          <p className="resource-desc">{v.model ?? v.description ?? v.scenario}</p>
                        )}
                      </div>
                    </div>
                    <div className="resource-meta">
                      <span>{v.protocol ?? (v.entries ? `${v.entries.length} 个条目` : v.memberIds ? `${v.memberIds.length} 位角色` : '')}</span>
                    </div>
                    <div className="resource-actions">
                      <button onClick={() => edit(page, v)}>编辑</button>
                      {page === 'connections' && (
                        <button onClick={() => act(api(`/connections/${v.id}/test`, 'POST', {}).then(() => setNotice('连接测试通过。')))}>
                          测试连接
                        </button>
                      )}
                      {page === 'characters' && (
                        <button onClick={() => edit('conversations', { ...defaults.conversations, title: `与 ${v.name} 的故事`, characterId: v.id, connectionId: data.connections?.[0]?.id ?? null })}>
                          开始聊天
                        </button>
                      )}
                      <button className="danger" onClick={() => act(remove(page, v))}>删除</button>
                    </div>
                  </article>
                ))}
              </div>
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
          version={recordsVersion}
          activity={activity}
          disabled={!!turn}
          onError={setError}
          onChanged={() => setRecordsVersion((v) => v + 1)}
          onClose={() => setPanel(false)}
        />
      )}

      {editor && (
        <Editor
          key={`${editor.kind}:${editor.value.id ?? 'new'}`}
          kind={editor.kind}
          initial={editor.value}
          data={data}
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}

      {editNarrator && (
        <NarratorSettings
          initial={narratorDefaults}
          onClose={() => setEditNarrator(false)}
          onSave={async (value) => {
            setNarratorDefaults(await api('/narrator', 'PUT', value));
            setEditNarrator(false);
          }}
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
    </div>
  );
}
