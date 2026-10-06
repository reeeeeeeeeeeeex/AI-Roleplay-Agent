import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, PanelRightClose, PanelRightOpen, Plus, Send, Settings2, Square, Upload, Users, ChevronLeft, ChevronRight, RotateCw, GitFork, PanelLeftClose, PanelLeft, Library, BookOpen, UserCog } from 'lucide-react';
import { defaultGeneralSettings, defaultPromptSettings, historyStartIndex, type GeneralSettings, type Conversation, type MessageNode, type SpeakerRef, type ImportPreview, type PromptSettings, type TurnRecord } from '@new-ai-chat/contracts';
import { api, ApiError, streamTurn } from './api.js';
import Editor, { defaults, titles, type Collection } from './Editor.js';
import PersonaPicker from './PersonaPicker.js';
import Records from './Records.js';
import ContextReport from './ContextReport.js';
import StoryNavigation from './StoryNavigation.js';
import StoryImport from './StoryImport.js';
import InlineEdit from './InlineEdit.js';
import SettingsModal, { type AvatarMode, type AvatarFit } from './SettingsModal.js';
import MessageNavigation from './MessageNavigation.js';
import { useChatWindow } from './useChatWindow.js';
import ActionChoices from './ActionChoices.js';
import AutoSaveField from './AutoSaveField.js';
import { flushContentEdits } from './useContentAutosave.js';
import './branches.css';

const collections: Collection[] = ['conversations', 'characters', 'personas', 'groups', 'lorebooks', 'connections'];
const studioCollections: Collection[] = ['characters', 'personas', 'groups', 'lorebooks'];

function formatTime(isoString?: string) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return isoString;
  }
}

export default function App() {
  const [data, setData] = useState<Record<string, any[]>>({});
  const [chatId, setChatId] = useState<string | null>(() => localStorage.getItem('selected-chat'));
  const chatRef = useRef(chatId);
  chatRef.current = chatId;

  const [page, setPage] = useState<'chat' | Collection | 'import'>('chat');
  const [branch, setBranch] = useState<MessageNode[]>([]);
  const [nodes, setNodes] = useState<MessageNode[]>([]);
  const editedMessageIds = useRef(new Map<string, string>());
  const [editor, setEditor] = useState<{ kind: Collection; value: any } | null>(null);
  const [messageEdit, setMessageEdit] = useState<{ id: string; action: 'fact' | 'rewrite' | 'bookmark'; initial: string } | null>(null);
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>(() => {
    try { return Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem('story-drafts') ?? '{}')).filter(([, value]) => typeof value === 'string')) as Record<string, string>; }
    catch { return {}; }
  });
  const text = chatId ? inputDrafts[chatId] ?? '' : '';
  const setText = (value: string) => { if (chatId) setInputDrafts(old => ({ ...old, [chatId]: value })); };
  const [sending, setSending] = useState(false);
  const [choicesBusy, setChoicesBusy] = useState(false);
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
  const [drafts, setDrafts] = useState<Record<number, LiveDraft>>({});
  const pendingDraft = useRef<Record<number, LiveDraft>>({});
  const [lastTurn, setLastTurn] = useState<TurnRecord | null>(null);
  const draftFrame = useRef<number | null>(null);
  const [activity, setActivity] = useState<any[]>([]);
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

  // Appearance preferences are local to this browser.
  const [avatarMode, setAvatarMode] = useState<AvatarMode>(() => (localStorage.getItem('avatar-mode') as AvatarMode) || 'large');
  const [avatarFit, setAvatarFit] = useState<AvatarFit>(() => (localStorage.getItem('avatar-fit') as AvatarFit) || 'cover');
  const [messageDisplayLimit, setMessageDisplayLimit] = useState(() => {
    const value = Number(localStorage.getItem('chat-message-display-limit'));
    return Number.isInteger(value) && value >= 1 && value <= 1000 ? value : 100;
  });
  const [plainThinkingExpanded, setPlainThinkingExpanded] = useState(() => localStorage.getItem('plain-thinking-expanded') !== 'false');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const { container: messageContainer, bottom, visibleMessages, userMarkers, activeUserId, awayFromBottom,
    olderCount, loadOlder, onScroll, scrollToLatest, scrollToMessage } = useChatWindow(
    branch, chatId, messageDisplayLimit, drafts, `${page}:${avatarMode}:${avatarFit}:${plainThinkingExpanded}`,
  );
  const streamAbort = useRef<AbortController | null>(null);

  const queueDraft = (next: Record<number, LiveDraft> | ((current: Record<number, LiveDraft>) => Record<number, LiveDraft>)) => {
    pendingDraft.current = typeof next === 'function' ? next(pendingDraft.current) : next;
    if (draftFrame.current !== null) return;
    draftFrame.current = requestAnimationFrame(() => { draftFrame.current = null; setDrafts(pendingDraft.current); });
  };

  const messageIndex = useMemo(() => {
    const siblings = new Map<string, MessageNode[]>();
    const parents = new Set(nodes.map(node => node.parentId));
    for (const node of nodes) {
      const key = `${node.parentId}:${node.role}`;
      const items = siblings.get(key) ?? []; items.push(node); siblings.set(key, items);
    }
    return { siblings, leaves: nodes.filter(node => !parents.has(node.id)) };
  }, [nodes]);

  const wholeTurnTargets = useMemo(() => {
    const replies = new Map<string, string[]>();
    for (const message of branch) {
      if (message.role !== 'assistant' || !message.storyTurnId) continue;
      const ids = replies.get(message.storyTurnId) ?? []; ids.push(message.id); replies.set(message.storyTurnId, ids);
    }
    return new Set([...replies.values()].filter(ids => ids.length > 1).map(ids => ids.at(-1)!));
  }, [branch]);

  const chat = (data.conversations ?? []).find((v) => v.id === chatId) as Conversation | undefined;
  const relatedBranches = (data.conversations ?? []).filter(item => item.id === chatId || (chat?.branchGroupId && item.branchGroupId === chat.branchGroupId));
  const historyStart = nodes.find(message => message.id === chat?.historyStartMessageId);
  const historyStartPosition = historyStart ? historyStartIndex(branch, historyStart) : -1;
  const activePersona = data.personas?.find(p => p.id === (chat?.personaId ?? generalSettings.defaultPersonaId));
  useEffect(() => { setMessageEdit(null); }, [chatId, chat?.headMessageId]);
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
    const [value, latest] = await Promise.all([api(`/conversations/${id}/messages`), api(`/conversations/${id}/last-turn`)]);
    if (chatRef.current === id) {
      setBranch(value.branch);
      setNodes(value.nodes);
      setLastTurn(latest);
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
    setDrafts({});
    pendingDraft.current = {};
    setLastTurn(null);
    setActivity([]);
    setReplyTarget('auto');
    if (chatId) { localStorage.setItem('selected-chat', chatId); act(refreshMessages(chatId)); }
  }, [chatId]);

  useEffect(() => {
    try { localStorage.setItem('story-drafts', JSON.stringify(inputDrafts)); }
    catch { setNotice('浏览器无法保存草稿，请在关闭页面前复制输入。'); }
  }, [inputDrafts]);

  async function selectChat(id: string, flush = true) {
    if (flush) await flushContentEdits();
    editedMessageIds.current.clear();
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
        if (event.type === 'turn.started') { setPhase(generalSettings.generationMode === 'plain' ? '普通写作 · 准备上下文' : generalSettings.generationMode === 'planner' ? 'Planner · 规划' : 'Writer Agent · 选择发言者'); }
        if (event.type === 'agent.phase') setPhase(p.phase === 'selection' ? 'Writer Agent · 选择发言者' : 'Writer Agent · 写作');
        if (event.type === 'agent.thinking') setPhase('Writer Agent · 思考');
        if (event.type === 'writer.started') {
          setPhase(`Writer · ${p.outputIndex + 1}`);
          queueDraft(old => ({ ...old, [p.outputIndex]: { speaker: p.speaker, outputIndex: p.outputIndex, text: '', thinking: '' } }));
        }
        if (event.type === 'writer.delta') {
          queueDraft(old => ({ ...old, [p.outputIndex]: { speaker: p.speaker, outputIndex: p.outputIndex, text: (old[p.outputIndex]?.text ?? '') + p.delta, thinking: old[p.outputIndex]?.thinking ?? '' } }));
        }
        if (event.type === 'thinking.delta') {
          if (generalSettings.generationMode === 'plain') queueDraft(old => old[p.outputIndex] ? { ...old, [p.outputIndex]: { ...old[p.outputIndex]!, thinking: old[p.outputIndex]!.thinking + p.delta } } : old);
          setPhase(generalSettings.generationMode === 'plain' ? '普通写作 · 思考' : 'Writer Agent · 思考');
        }
        if (event.type === 'writer.snapshot') {
          queueDraft(Object.fromEntries((p.outputs ?? []).map((output: LiveDraft) => [output.outputIndex, output])));
        }
        if (event.type === 'message.completed') {
          queueDraft(old => { const next = { ...old }; delete next[p.outputIndex]; return next; });
          const message = p.message as MessageNode;
          setBranch(old => old.some(node => node.id === message.id) ? old : [...old.slice(0, old.findIndex(node => node.id === message.parentId) + 1), message]);
          setNodes(old => old.some(node => node.id === message.id) ? old : [...old, message]);
        }
        if (event.type === 'records.started') setPhase('正文已完成 · 更新记录');
        if (event.type === 'turn.failed' || event.type === 'turn.partial' || event.type === 'records.failed') {
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
        queueDraft({});
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

  function savedMessageId(id?: string) {
    while (id && editedMessageIds.current.has(id)) id = editedMessageIds.current.get(id)!;
    return id;
  }
  function messageRenderKey(id: string) {
    // Keep action buttons mounted while blur replaces an immutable message node.
    for (const [previous, current] of [...editedMessageIds.current].reverse()) if (id === current) id = previous;
    return id;
  }

  async function send(trigger: 'normal' | 'auto' | 'regenerate' | 'continue' = 'normal', targetMessageId?: string, choiceText?: string) {
    if (!chat || turn || sendPending.current || messageEdit) return;
    sendPending.current = true;
    setError('');
    setNotice('');
    try {
      await flushContentEdits();
      setSending(true);
      const payload = turnPayload(trigger, savedMessageId(targetMessageId));
      const result = await api('/turns', 'POST', choiceText === undefined ? payload : { ...payload, input: { voice: 'protagonist', text: choiceText } });
      // Clear only the accepted draft, never newer typing or another chat's input.
      if (trigger === 'normal' && choiceText === undefined) setInputDrafts(old => old[chat.id] === text ? { ...old, [chat.id]: '' } : old);
      if (chatRef.current !== chat.id) return;
      await refreshMessages(chat.id);
      await follow(result.id, chat.id);
    } finally {
      sendPending.current = false;
      setSending(false);
    }
  }

  async function swipe(message: MessageNode, instruction?: string) {
    await flushContentEdits();
    const result = await api(`/messages/${savedMessageId(message.id)}/swipe`, 'POST', instruction ? { instruction } : {});
    await follow(result.id, message.conversationId);
  }

  async function saveMessageEdit(message: MessageNode, action: 'fact' | 'rewrite' | 'bookmark', value: string) {
    if (action === 'rewrite') {
      await flushContentEdits();
      const result = await api(`/messages/${savedMessageId(message.id)}/swipe`, 'POST', { instruction: value });
      setMessageEdit(null);
      act(follow(result.id, message.conversationId));
      return;
    }
    if (action === 'fact') {
      await api(`/conversations/${message.conversationId}/facts`, 'POST', { content: value, sourceMessageId: message.id });
    } else {
      await api(`/conversations/${message.conversationId}/bookmarks`, 'POST', { name: value, messageId: message.id });
    }
    setRecordsVersion(version => version + 1);
    setMessageEdit(null);
  }

  async function retryRemaining() {
    if (!lastTurn || turn || sendPending.current) return;
    sendPending.current = true; setError('');
    try { await flushContentEdits(); setSending(true); const next = await api(`/turns/${lastTurn.id}/retry`, 'POST', {}); await follow(next.id, lastTurn.conversationId); }
    finally { sendPending.current = false; setSending(false); }
  }

  async function setHead(messageId: string | null) {
    await flushContentEdits();
    await api(`/conversations/${chatId}/head`, 'POST', { messageId });
    editedMessageIds.current.clear();
    scrollToLatest();
    await refreshMessages(chatId!);
    await refresh();
    setRecordsVersion((v) => v + 1);
  }
  async function forkFrom(messageId: string) {
    if (!chat || turn || sendPending.current) return;
    sendPending.current = true; setSending(true); setError('');
    try {
      await flushContentEdits();
      const copy = await api<Conversation>(`/conversations/${chat.id}/branches`, 'POST', {
        messageId: savedMessageId(messageId), head: savedMessageId(chat.headMessageId ?? undefined) ?? null,
      });
      await refresh();
      await selectChat(copy.id, false);
      setShowBranches(false); setPromptPreview(null);
    } finally { sendPending.current = false; setSending(false); }
  }
  async function jumpToBookmark(messageId: string) {
    await flushContentEdits();
    const savedId = savedMessageId(messageId)!;
    if (branch.some(message => message.id === savedId)) { scrollToMessage(savedId); return; }
    if (window.confirm('这个书签位于其他历史走向，是否从该消息创建独立分支并打开？')) await forkFrom(savedId);
  }
  async function setHistoryStart(messageId: string | null) {
    if (!chatId) return;
    await flushContentEdits();
    const updated = await api<Conversation>(`/conversations/${chatId}/history-start`, 'POST', { messageId: savedMessageId(messageId ?? undefined) ?? null });
    setData(old => ({ ...old, conversations: old.conversations!.map(item => item.id === updated.id ? updated : item) }));
    setPromptPreview(null);
  }

  async function showPromptPreview() {
    if (!chat) return;
    const trigger = text.trim() ? 'normal' : 'auto';
    const { conversationId: _conversationId, ...payload } = turnPayload(trigger);
    try { await flushContentEdits(); setPromptPreview(await api(`/conversations/${chat.id}/prompt-preview`, 'POST', payload)); }
    catch (err: any) { setError(err.message || '预览失败'); }
  }

  const edit = (kind: Collection, value: any = defaults[kind]) =>
    setEditor({ kind, value });

  async function save(value: any) {
    if (!editor) return;
    const input = { ...value };
    if (editor.kind === 'connections' && value.id && !input.apiKey) delete input.apiKey;
    const saved = await api(`/${editor.kind}${value.id ? `/${value.id}` : ''}`, value.id ? 'PUT' : 'POST', input, { keepalive: editor.kind !== 'connections' });
    // Persistence has succeeded even if refreshing the surrounding view fails.
    await refresh().catch(error => setError(error.message));
    if (editor.kind === 'connections') setEditor(null);
    if (editor.kind === 'conversations' && !value.id) await selectChat(saved.id, false).catch(error => setError(error.message));
    if (editor.kind === 'personas' && personaCreateTarget) {
      if (personaCreateTarget === 'global') {
        await savePersona(saved.id, true).catch(error => setError(error.message));
      } else if (personaCreateTarget === 'chat') {
        await savePersona(saved.id, false).catch(error => setError(error.message));
      }
      setPersonaCreateTarget(null);
    }
    return saved;
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

        <button
          type="button"
          className={`nav-label-btn ${page === 'conversations' ? 'selected' : ''}`}
          onClick={() => { setPage('conversations'); setMobileNav(false); }}
          title="查看全部故事卡片"
        >
          <span className="nav-label-title"><MessageSquare size={13} /> 故事列表</span>
          <span className="nav-label-count">{data.conversations?.length ?? 0}</span>
        </button>
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
            <Upload size={14} />导入故事
          </button>
        </nav>

        <div className="local-status">
          <i /> 本地 {session?.fakeModel ? '离线演示' : 'v0.2'}
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
            <h1>{page === 'chat' ? chat?.title ?? '新故事' : page === 'import' ? '导入故事' : page === 'conversations' ? '故事列表' : titles[page]}</h1>
          </div>
          <div className="top-actions">
            {chat && page === 'chat' && (
              <>
                {chat.kind === 'group' ? (
                  <button
                    title="编辑当前群聊"
                    aria-label="编辑当前群聊"
                    onClick={() => {
                      const grp = data.groups?.find((g) => g.id === chat.groupId);
                      if (grp) edit('groups', grp);
                    }}
                  >
                    <Users size={14} />
                    <span>群聊资料</span>
                  </button>
                ) : (
                  <button
                    title="编辑当前角色"
                    aria-label="编辑当前角色"
                    onClick={() => {
                      const char = data.characters?.find((c) => c.id === chat.characterId);
                      if (char) edit('characters', char);
                    }}
                  >
                    <UserCog size={14} />
                    <span>角色资料</span>
                  </button>
                )}
                <button title="故事分支" aria-label="故事分支" onClick={() => setShowBranches(true)}>
                  <GitFork size={14} />
                  <span>故事分支</span>
                </button>
                <button title="故事资料" aria-label="故事资料" onClick={() => edit('conversations', chat)}>
                  <BookOpen size={14} />
                  <span>故事资料</span>
                </button>
                <button title="记录面板" aria-label="记录面板" onClick={() => setPanel(!panel)}>
                  {panel ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
                  <span>记录</span>
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
                <button className="content-link" key={id} onClick={() => edit('characters', data.characters?.find(c => c.id === id))}><i className="dot" />{data.characters?.find((c) => c.id === id)?.name}</button>
              ))}
              <small>{{ protected: '主角保护', coauthor: '共同创作', none: '主角控制：无' }[generalSettings.agencyMode]}</small>
            </div>

            <StoryNavigation key={chat.id} chatId={chat.id} head={chat.headMessageId} version={recordsVersion} disabled={!!turn || sending} onJump={jumpToBookmark} onChanged={() => { setRecordsVersion(value => value + 1); act(refresh()); }} onError={setError} />
            {chat.historyStartMessageId && <div className="history-start-banner" role="status">
              <span>{historyStartPosition < 0 ? '固定发送起点不在当前分支，请重新选择或取消。' : `已固定发送起点 · 从此处起 ${branch.slice(historyStartPosition).filter(message => message.role !== 'system').length} 条消息，后续持续追加`}</span>
              {historyStartPosition >= 0 && branch[historyStartPosition] && <button onClick={() => scrollToMessage(branch[historyStartPosition]!.id)}>查看起点</button>}
              <button disabled={!!turn || sending} onClick={() => act(setHistoryStart(null))}>取消固定起点</button>
            </div>}
            <div className="messages-wrap">
            <section ref={messageContainer} className={`messages avatar-${avatarMode} avatar-fit-${avatarFit}`} aria-label="聊天记录"
              onScroll={onScroll} onWheel={event => { if (event.deltaY < 0 && event.currentTarget.scrollTop < 100) loadOlder(); }}>
              {olderCount > 0 && <button className="messages-older" onClick={loadOlder}>显示更早的消息（还有 {olderCount} 条）</button>}
              {!branch.length && (
                <div className="scene-start">
                  <p>输入第一条消息开始对话。</p>
                </div>
              )}
              {visibleMessages.map((m) => {
                const swipes = messageIndex.siblings.get(`${m.parentId}:${m.role}`) ?? [];
                const index = swipes.findIndex((n) => n.id === m.id);
                const narrator = m.authorKind === 'narrator' || m.authorKind === 'user_narrator';
                const avatar = avatarFor(m);
                const info = m.generationInfo;
                const editing = messageEdit?.id === m.id ? messageEdit : null;
                const inlineEditor = editing && (editing.action === 'rewrite'
                  ? <InlineEdit key={`${m.id}:rewrite`} initial={editing.initial} label="改写要求" disabled={!!turn || sending} saveLabel="开始改写"
                      onCancel={() => setMessageEdit(null)} onSave={value => saveMessageEdit(m, 'rewrite', value)} />
                  : <><AutoSaveField key={`${m.id}:${editing.action}`} draftKey={`${m.id}:new-${editing.action}`} initial="" label={editing.action === 'bookmark' ? '书签名称' : '摘录固定事实'} singleLine={editing.action === 'bookmark'} autoFocus disabled={!!turn || sending} lockWhileSaving
                      onError={setError} onSave={value => saveMessageEdit(m, editing.action, value)} /><button onClick={() => setMessageEdit(null)}>关闭</button></>);
                const totalInput = info?.usage ? info.usage.input + info.usage.cacheRead + info.usage.cacheWrite : null;
                const cacheRate = totalInput && info?.usage ? Math.round(info.usage.cacheRead / totalInput * 100) : 0;
                return (
                  <article className={`message ${m.role === 'user' ? 'user' : ''} ${narrator ? 'narration' : ''}`} key={messageRenderKey(m.id)} id={`message-${m.id}`} data-message-id={m.id}>
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
                      {m.role === 'assistant' && info?.mode === 'plain' && <details className="message-thinking" open={plainThinkingExpanded}>
                        <summary>模型思考</summary>
                        <pre>{info.thinking || '模型未返回可见思考内容。'}</pre>
                      </details>}
                      <div className="prose"><AutoSaveField key={m.id} draftKey={`message:${m.id}`} initial={m.content} label={m.role === 'assistant' ? 'AI 回复正文' : m.role === 'user' ? '用户消息正文' : '消息正文'} disabled={!!turn || sending} lockWhileSaving onError={setError}
                        onSave={async (content, previous) => {
                          const saved = await api<MessageNode>(`/messages/${m.id}/edit`, 'POST', { content, previous, head: chat.headMessageId }, { keepalive: true });
                          if (saved.id !== m.id) editedMessageIds.current.set(m.id, saved.id);
                          await refreshMessages(m.conversationId).catch(error => setError(error.message));
                          await refresh().catch(error => setError(error.message)); setRecordsVersion(version => version + 1);
                        }} /></div>
                      {editing && <div className="message-inline-action">
                        <small>{{ fact: '固定事实 · 保存到当前分支', rewrite: '一次性改写要求 · 不作为剧情输入', bookmark: '给这条消息命名书签' }[editing.action]}</small>
                        {inlineEditor}
                      </div>}
                      {m.role === 'assistant' && <small className="generation-info">{info
                        ? `${info.model} · 输入 ${totalInput ?? '未返回'} · 输出 ${info.usage?.output ?? '未返回'} · 缓存 ${info.usage?.cacheRead ?? '未返回'}${info.usage ? ` (${cacheRate}%)` : ''}`
                        : '生成信息不可用（旧消息）'}</small>}
                      {!editing && <div className="message-actions" onMouseDown={event => {
                        // Run the click before blur can move or replace the message controls.
                        if (document.activeElement?.closest('.prose')) event.preventDefault();
                      }}>
                        {m.role !== 'system' && <button className={branch[historyStartPosition]?.id === m.id ? 'active' : ''} disabled={!!turn || sending}
                          title="包含本条及后续消息，覆盖通用设置的发送条数；固定范围超出上下文时提示调整"
                          onClick={() => act(setHistoryStart(branch[historyStartPosition]?.id === m.id ? null : m.id))}>
                          {branch[historyStartPosition]?.id === m.id ? '发送起点 · 取消' : '从此处开始发送'}
                        </button>}
                        <button disabled={!!turn || sending} onClick={event => {
                          const body = event.currentTarget.closest('article')?.querySelector<HTMLTextAreaElement>('.prose textarea');
                          const selected = body?.value.slice(body.selectionStart, body.selectionEnd).trim();
                          const content = selected || body?.value || m.content;
                          act(flushContentEdits().then(() => saveMessageEdit({ ...m, id: savedMessageId(m.id)! }, 'fact', content)));
                        }}>固定事实</button>
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
                            <button disabled={!!turn} title="只重新生成这一条，保持当前发言者；原文保留为其他版本" onClick={() => act(swipe(m))}>
                              <RotateCw size={12} />新版本
                            </button>
                            {wholeTurnTargets.has(m.id) && <button disabled={!!turn} title="重新生成本轮的两条回复；按当前模式和回复目标重新决定输出，旧分支保留" onClick={() => act(send('regenerate', m.id))}>重做整轮（2 条）</button>}
                            <button disabled={!!turn} onClick={() => act(send('continue', m.id))}>续写</button>
                            <button disabled={!!turn || sending} onClick={() => act(flushContentEdits().then(() => setMessageEdit({ id: savedMessageId(m.id)!, action: 'rewrite', initial: '' })))}>按要求改写</button>
                          </>
                        )}
                        <button disabled={!!turn || sending} onClick={() => act(flushContentEdits().then(() => setMessageEdit({ id: savedMessageId(m.id)!, action: 'bookmark', initial: '' })))}>书签</button>
                        <button disabled={!!turn || sending} title="保留至本条消息，创建独立聊天；原聊天不变" onClick={() => act(forkFrom(m.id))}>
                          <GitFork size={12} />从此处分支
                        </button>
                      </div>}
                    </div>
                  </article>
                );
              })}
              {Object.values(drafts).map(draft => (
                <article className="message streaming" key={draft.outputIndex}>
                  <div className="avatar">...</div>
                  <div className="message-body">
                    <header>
                      <strong>{speakerName(draft.speaker)}</strong>
                      <span>Writing</span>
                    </header>
                    {generalSettings.generationMode === 'plain' && <details className="message-thinking" open={plainThinkingExpanded}>
                      <summary>模型思考</summary><pre>{draft.thinking || '模型尚未返回可见思考内容。'}</pre>
                    </details>}
                    <div className="prose">{draft.text}<span className="caret">▍</span></div>
                  </div>
                </article>
              ))}
              <div ref={bottom} />
            </section>
            <MessageNavigation markers={userMarkers} activeId={activeUserId} onJump={scrollToMessage} />
            </div>

            <div className="composer-wrap">
              <ActionChoices key={`${chat.id}:${chat.headMessageId ?? ''}`} chatId={chat.id} head={chat.headMessageId} disabled={sending || !!turn || !!messageEdit}
                onSend={value => send('normal', undefined, value)} onBusy={setChoicesBusy} onChanged={() => setRecordsVersion(version => version + 1)} />
              {awayFromBottom && <button onClick={scrollToLatest}>回到最新 ↓</button>}
              {!turn && lastTurn && ['partial', 'failed', 'cancelled'].includes(lastTurn.status) && <div className="turn-recovery">
                <strong>{lastTurn.status === 'partial' ? '本轮部分完成，已完成回复已保留。' : '本轮未完成，用户消息已保留。'}</strong>
                {lastTurn.progress && <button disabled={sending} onClick={() => act(retryRemaining())}>重试剩余回复</button>}
                {lastTurn.progress?.interruptedOutputs.map(output => <details key={output.outputIndex}>
                  <summary>{speakerName(output.speaker)} · 未完成片段（不参与剧情）</summary>
                  <pre>{output.text}</pre>
                  {output.thinking && <details><summary>已返回的思考</summary><pre>{output.thinking}</pre></details>}
                  <button onClick={() => act(navigator.clipboard.writeText(output.text))}>复制片段</button>
                </details>)}
              </div>}
              {!turn && lastTurn?.status === 'completed' && ['failed', 'cancelled'].includes(lastTurn.recordsStatus) && <small>正文已完成；记录更新{lastTurn.recordsStatus === 'failed' ? '失败' : '已取消'}，可在 Memory／状态面板重试。</small>}
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
                    <button type="submit" className="send primary" aria-label="发送" disabled={sending || !!messageEdit || !text.trim()}>
                      <Send size={15} />
                    </button>
                  )}
                </div>
              </form>
              <div className="composer-hint">
                <button disabled={sending || !!turn || !!messageEdit} onClick={() => act(send('auto'))}>让故事继续 →</button>
              </div>
            </div>
          </>
        )}

        {page !== 'chat' && page !== 'import' && (
          <section className="management">
            <header>
              <button className="primary" onClick={() => (page === 'conversations' ? newChat() : edit(page))}>
                <Plus size={14} />{page === 'conversations' ? '开启新故事' : `创建${titles[page]}`}
              </button>
            </header>
            <div className="management-content">
              {page === 'characters' || page === 'personas' || page === 'groups' || page === 'conversations' ? (
                <div className="character-grid">
                  {page === 'conversations' ? (
                    data.conversations?.map((c) => {
                      const isGroup = c.kind === 'group';
                      const grp = isGroup ? (data.groups ?? []).find((g) => g.id === c.groupId) : null;
                      const char = !isGroup ? (data.characters ?? []).find((ch) => ch.id === c.characterId) : null;
                      const cover = isGroup
                        ? (grp?.avatarPath || (data.characters ?? []).find((ch) => grp?.memberIds?.includes(ch.id) && ch.avatarPath)?.avatarPath)
                        : char?.avatarPath;
                      const memberNames = isGroup
                        ? (grp?.memberIds ?? []).map((mid: string) => (data.characters ?? []).find((ch) => ch.id === mid)?.name).filter(Boolean).join('、')
                        : null;
                      return (
                        <article className="character-card" key={c.id}>
                          <div
                            className="character-card-image-wrap"
                            onClick={() => { if (cover) setPreviewImage(cover); }}
                            title={cover ? '点击查看高清原图' : undefined}
                          >
                            {cover ? (
                              <>
                                <img className="character-card-bg-blur" src={cover} alt="" aria-hidden="true" />
                                <img className="character-card-img" src={cover} alt={c.title} loading="lazy" />
                              </>
                            ) : (
                              <div className="character-card-placeholder">
                                {isGroup ? <Users size={28} /> : (c.title?.slice(0, 1) || '话')}
                              </div>
                            )}
                          </div>
                          <div className="character-card-body">
                            <h3 className="character-card-title"><button className="content-link" onClick={() => edit('conversations', c)}>{c.title}</button></h3>
                            <div className="character-card-meta">
                              <span className="badge">{isGroup ? `群聊 · ${grp?.name ?? '群组'}` : `单聊 · ${char?.name ?? '角色'}`}</span>
                              <small className="time">{formatTime(c.updatedAt || c.createdAt)}</small>
                            </div>
                            <button className="character-card-desc content-link" onClick={() => edit('conversations', c)}>
                              {c.scenario || (isGroup ? (memberNames ? `成员：${memberNames}` : grp?.scenario) : char?.description) || '暂无描述'}
                            </button>
                            <div className="character-card-footer">
                              <button
                                className="primary"
                                onClick={() => {
                                  void selectChat(c.id);
                                  setPage('chat');
                                }}
                              >
                                进入故事
                              </button>
                              <button className="danger" onClick={() => act(remove('conversations', c))}>删除</button>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  ) : page === 'groups' ? (
                    data.groups?.map((v) => {
                      const memberNames = (v.memberIds ?? []).map((mid: string) => (data.characters ?? []).find((ch) => ch.id === mid)?.name).filter(Boolean).join('、');
                      return (
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
                                <Users size={28} />
                              </div>
                            )}
                          </div>
                          <div className="character-card-body">
                            <h3 className="character-card-title"><button className="content-link" onClick={() => edit('groups', v)}>{v.name}</button></h3>
                            <div className="character-card-meta">
                              <span className="badge">{v.memberIds?.length ?? 0} 位成员</span>
                              <small className="time">{formatTime(v.updatedAt || v.createdAt)}</small>
                            </div>
                            <button className="character-card-desc content-link" onClick={() => edit('groups', v)}>
                              {memberNames ? `成员：${memberNames}。` : ''}{v.scenario || '暂无群聊场景描述'}
                            </button>
                            <div className="character-card-footer">
                              <button
                                className="primary"
                                onClick={() => edit('conversations', {
                                  ...defaults.conversations,
                                  title: `${v.name} 的故事`,
                                  kind: 'group',
                                  groupId: v.id,
                                })}
                              >
                                开启群聊
                              </button>
                              <button className="danger" onClick={() => act(remove('groups', v))}>删除</button>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    data[page]?.map((v) => (
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
                          <h3 className="character-card-title"><button className="content-link" onClick={() => edit(page, v)}>{v.name}</button></h3>
                          <div className="character-card-meta">
                            <span className="badge">{page === 'characters' ? '角色' : '主角'}</span>
                            <small className="time">{formatTime(v.updatedAt || v.createdAt)}</small>
                          </div>
                          <button className="character-card-desc content-link" onClick={() => edit(page, v)}>{v.description || v.scenario || '暂无描述'}</button>
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
                            <button className="danger" onClick={() => act(remove(page, v))}>删除</button>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              ) : (
                <div className="resource-list">
                  {data[page]?.map((v) => (
                    <article className="resource-item" key={v.id}>
                      <div className="resource-main">
                        <div className="resource-info">
                          <h3 className="resource-title">{page === 'lorebooks' ? <button className="lorebook-title" onClick={() => edit(page, v)}>{v.name}</button> : v.name ?? v.title}</h3>
                          {(v.model || v.description || v.scenario) && (
                            <button className="resource-desc content-link" onClick={() => edit(page, v)}>{v.model ?? v.description ?? v.scenario}</button>
                          )}
                        </div>
                      </div>
                      <div className="resource-meta">
                        <span>{v.protocol ?? (v.entries ? `${v.entries.length} 个条目` : v.memberIds ? `${v.memberIds.length} 位成员` : '')}</span>
                      </div>
                      <div className="resource-actions">
                        {page === 'connections' && <button onClick={() => edit(page, v)}>编辑</button>}
                        <button className="danger" onClick={() => act(remove(page, v))}>删除</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {!data[page]?.length && <div className="empty">暂无{page === 'conversations' ? '故事' : titles[page]}。点击右上角按钮创建。</div>}
            </div>
          </section>
        )}

        {page === 'import' && (
          <section className="import-page">
            <StoryImport disabled={!!turn || sending || importBusy} onError={setError} onImported={async id => { await refresh(); await selectChat(id); }} />
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
              key={`${chat.id}:${chat.headMessageId}`}
              onSource={scrollToMessage}
          chat={chat}
          generationMode={generalSettings.generationMode}
          version={recordsVersion}
          activity={activity}
          activeTurnId={turn?.id ?? (choicesBusy ? 'action-choices' : null)}
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
        messageDisplayLimit={messageDisplayLimit}
        setMessageDisplayLimit={value => { setMessageDisplayLimit(value); localStorage.setItem('chat-message-display-limit', String(value)); }}
        plainThinkingExpanded={plainThinkingExpanded}
        setPlainThinkingExpanded={value => { setPlainThinkingExpanded(value); localStorage.setItem('plain-thinking-expanded', String(value)); }}
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
            setData(old => ({ ...old, personas: [...(old.personas ?? []).filter(persona => persona.id !== newPersona.id), newPersona] }));
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
              <p className="muted" style={{ marginBottom: 12 }}>每个分支都是独立聊天，也可从左侧故事列表打开；切换时保留各自进度和记录。</p>
              {relatedBranches.map(item => <button key={item.id} disabled={!!turn || sending} onClick={() => act(selectChat(item.id).then(() => setShowBranches(false)))}>
                <GitFork size={15} /><span>{item.id === chat.id ? '当前分支 · ' : ''}{item.title}</span>
              </button>)}
              {messageIndex.leaves.some(node => !branch.some(message => message.id === node.id)) && <details>
                <summary>历史消息版本</summary>
                <p className="muted">旧走向和消息版本仍保留，可另存为独立分支继续。</p>
                {messageIndex.leaves.filter(node => !branch.some(message => message.id === node.id)).map((node) => (
                <button key={node.id} disabled={!!turn || sending} onClick={() => act(forkFrom(node.id))}>
                  <GitFork size={15} />
                  <span>
                    另存为分支 · {node.role === 'user' ? '用户' : speakerName(node.speaker)}
                    <small>{node.content.slice(0, 100)}</small>
                  </span>
                </button>
                ))}
              </details>}
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
            <header><h2>发送提示词预览 · Raw input</h2><button aria-label="关闭" onClick={() => setPromptPreview(null)}>✕</button></header>
            <div className="prompt-preview-body">
              <p className="muted">动作：{promptPreview.action === 'auto' ? '自动继续' : '普通发送'} · 模式：{promptPreview.generationMode} · 阶段：{promptPreview.phase} · 协议：{promptPreview.protocol}</p>
              {promptPreview.action === 'auto' && <p className="muted">草稿为空，正在预览自动继续；自动继续不重复上一轮用户输入。输入草稿后预览可查看本轮输入锚点。</p>}
              <p className="muted">身份：{promptPreview.pendingSelection ? '待选择' : promptPreview.speaker?.kind === 'narrator' ? generalSettings.narrator.name : speakerName(promptPreview.speaker)} · 主角：{promptPreview.personaName ?? '未选择（请求使用 User）'}{promptPreview.clipped ? ' · 已按上下文预算裁剪' : ''}</p>
              <p className="muted">以下是发送边界捕获的首请求原始 JSON Body，未发送、未重新格式化。修改草稿、设置或聊天内容后请重新预览；Agent 后续请求可在 Trace 中查看。</p>
              <section className="prompt-json" aria-label="Raw input">
                <header><strong>Raw input · 首请求 Body</strong><button onClick={() => act(navigator.clipboard.writeText(promptPreview.requestBody))}>复制原始 Body</button></header>
                <pre tabIndex={0}>{promptPreview.requestBody}</pre>
              </section>
              <ContextReport report={promptPreview.contextReport} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
