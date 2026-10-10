import { countLabel, generationLabel, phaseLabel } from './ui-labels.js';
import { t, formatDate, formatNumber, diagnosticText, type MessageKey } from './i18n.js';
import { useLanguage } from './LanguageProvider.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, PanelRightClose, PanelRightOpen, Plus, Send, Settings2, Square, Upload, Users, ChevronLeft, ChevronRight, RotateCw, GitFork, PanelLeftClose, PanelLeft, Library, BookOpen, UserCog, FilePenLine, Search, Copy } from 'lucide-react';
import { defaultGeneralSettings, defaultPromptSettings, historyStartIndex } from '@new-ai-chat/contracts/client';
import type { GeneralSettings, Conversation, MessageNode, MessageSummary, SpeakerRef, ImportPreview, PromptSettings, TurnRecord, TurnRequest, UserVoice } from '@new-ai-chat/contracts';
import { api, ApiError, streamTurn } from './api.js';
import Editor, { defaults, titles, type Collection } from './Editor.js';
import PersonaPicker from './PersonaPicker.js';
import Records from './Records.js';
import ContextReport from './ContextReport.js';
import StoryNavigation from './StoryNavigation.js';
import StoryImport from './StoryImport.js';
import InlineEdit from './InlineEdit.js';
import SettingsModal, { type AvatarMode } from './SettingsModal.js';
import MessageNavigation from './MessageNavigation.js';
import MessageSearch from './MessageSearch.js';
import { useChatWindow } from './useChatWindow.js';
import ActionChoices from './ActionChoices.js';
import AutoSaveField from './AutoSaveField.js';
import AuthorNoteEditor from './AuthorNoteEditor.js';
import { flushContentEdits } from './useContentAutosave.js';
import { useBackdropClose } from './useBackdropClose.js';
import { readAppearance, saveAppearance } from './appearance.js';
import { copyText } from './clipboard.js';
import { readComposerDrafts, saveComposerDrafts } from './composer-drafts.js';
import { searchText } from './search-text.js';
import { version as appVersion } from '../../../package.json';
import './branches.css';

const collections: Collection[] = ['conversations', 'characters', 'personas', 'groups', 'lorebooks', 'connections'];
const studioCollections: Collection[] = ['characters', 'personas', 'groups', 'lorebooks'];

function storedValue(key: string): string | null {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function formatTime(isoString?: string) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return formatDate(isoString);
  } catch {
    return isoString;
  }
}

export default function App() {
  useLanguage(); // Re-render labels without replacing the story/editor component tree.
  const [data, setData] = useState<Record<string, any[]>>({});
  const refreshVersions = useRef({ data: 0, general: 0, prompts: 0 });
  const [chatId, setChatId] = useState<string | null>(() => storedValue('selected-chat'));
  const chatRef = useRef(chatId);
  chatRef.current = chatId;

  const [page, setPage] = useState<'chat' | Collection | 'import'>('chat');
  const [resourceSearch, setResourceSearch] = useState('');
  const resourceFilter = useRef<HTMLInputElement>(null);
  useEffect(() => { setResourceSearch(''); }, [page]);
  const filteredResources = useMemo(() => {
    const query = searchText(resourceSearch.trim());
    const items = data[page] ?? [];
    return query ? items.filter(item => searchText(String(item.name ?? item.title ?? '')).includes(query)) : items;
  }, [data, page, resourceSearch]);
  const [branch, setBranch] = useState<MessageNode[]>([]);
  const [nodes, setNodes] = useState<MessageSummary[]>([]);
  const historyRequest = useRef(0);
  const editedMessageIds = useRef(new Map<string, string>());
  const [editor, setEditor] = useState<{ kind: Collection; value: any } | null>(null);
  const [copyingProfile, setCopyingProfile] = useState(false);
  const [messageEdit, setMessageEdit] = useState<{ id: string; action: 'fact' | 'rewrite' | 'bookmark'; initial: string } | null>(null);
  const [inputDrafts, setInputDrafts] = useState(readComposerDrafts);
  const savedInputDrafts = useRef({ ...inputDrafts });
  const inputDraftsRef = useRef(inputDrafts);
  inputDraftsRef.current = inputDrafts;
  const [voice, setVoice] = useState<UserVoice | 'assistant'>('protagonist');
  const draftKey = chatId ? voice === 'assistant' ? `${chatId}:assistant` : chatId : '';
  const text = inputDrafts[draftKey] ?? '';
  const setText = (value: string) => { if (draftKey) setInputDrafts(old => ({ ...old, [draftKey]: value })); };
  const [sending, setSending] = useState(false);
  const [choicesBusy, setChoicesBusy] = useState(false);
  const sendPending = useRef(false);
  const [replyTarget, setReplyTarget] = useState('auto');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [updateReady, setUpdateReady] = useState(false);
  const [refreshingApp, setRefreshingApp] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    const ready = () => setUpdateReady(true);
    navigator.serviceWorker.addEventListener('controllerchange', ready);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', ready);
  }, []);
  const [panel, setPanel] = useState(() => window.matchMedia('(min-width: 1121px)').matches);
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [turn, setTurn] = useState<{ id: string; chatId: string } | null>(null);
  type LiveDraft = { speaker: SpeakerRef; outputIndex: number; text: string; thinking: string };
  const [drafts, setDrafts] = useState<Record<number, LiveDraft>>({});
  const pendingDraft = useRef<Record<number, LiveDraft>>({});
  const [lastTurn, setLastTurn] = useState<TurnRecord | null>(null);
  const draftFrame = useRef<number | null>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [phase, setPhase] = useState<{ key: MessageKey; values?: unknown[] } | null>(null);
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
  const personaBackdrop = useBackdropClose(() => setShowPersona(false));
  const promptBackdrop = useBackdropClose(() => setPromptPreview(null));
  const [personaSaving, setPersonaSaving] = useState(false);
  const [personaCreateTarget, setPersonaCreateTarget] = useState<'global' | 'chat' | null>(null);
  const [showBranches, setShowBranches] = useState(false);
  const [showAuthorNote, setShowAuthorNote] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchMatchId, setSearchMatchId] = useState<string | null>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setShowSearch(false); setSearchMatchId(null); }, [chatId]);
  function closeSearch() {
    setShowSearch(false); setSearchMatchId(null); searchButton.current?.focus();
  }

  // Appearance preferences are local to this browser.
  const [readingAppearance, setReadingAppearance] = useState(readAppearance);
  const [avatarMode, setAvatarMode] = useState<AvatarMode>(() => {
    const saved = storedValue('avatar-mode');
    return saved === 'compact' || saved === 'full' ? saved : 'large';
  });
  const [messageDisplayLimit, setMessageDisplayLimit] = useState(() => {
    const value = Number(storedValue('chat-message-display-limit'));
    return Number.isInteger(value) && value >= 1 && value <= 1000 ? value : 100;
  });
  const [plainThinkingExpanded, setPlainThinkingExpanded] = useState(() => storedValue('plain-thinking-expanded') !== 'false');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const { container: messageContainer, bottom, visibleMessages, userMarkers, activeUserId, awayFromBottom,
    olderCount, loadOlder, onScroll, onAvatarLoad, scrollToLatest, scrollToMessage } = useChatWindow(
    branch, chatId, messageDisplayLimit, drafts, `${page}:${avatarMode}:${plainThinkingExpanded}:${readingAppearance.font}:${readingAppearance.fontSize}`,
  );
  const streamAbort = useRef<AbortController | null>(null);

  const queueDraft = (next: Record<number, LiveDraft> | ((current: Record<number, LiveDraft>) => Record<number, LiveDraft>)) => {
    pendingDraft.current = typeof next === 'function' ? next(pendingDraft.current) : next;
    if (draftFrame.current !== null) return;
    draftFrame.current = requestAnimationFrame(() => { draftFrame.current = null; setDrafts(pendingDraft.current); });
  };

  const messageIndex = useMemo(() => {
    const siblings = new Map<string, MessageSummary[]>();
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
  useEffect(() => {
    if (page !== 'chat' || !chat) return;
    const find = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key.toLowerCase() !== 'f' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      // Keep browser Find available in settings, previews, and record editors.
      if (document.querySelector('[aria-modal="true"]') || document.activeElement?.closest('.records')) return;
      event.preventDefault();
      setShowSearch(true);
      searchInput.current?.focus(); searchInput.current?.select();
    };
    window.addEventListener('keydown', find);
    return () => window.removeEventListener('keydown', find);
  }, [page, chat?.id]);
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
      ? generalSettings.narrator.name ?? t("旁白")
      : (data.characters ?? []).find((c) => c.id === (speaker?.kind === 'character' ? speaker.characterId : ''))?.name ?? t("角色");

  const act = (promise: Promise<unknown>) => {
    setError('');
    void promise.catch((err: Error) => setError(err.message));
  };

  function rememberSession(key: 'selected-chat' | 'active-turn', value: string | null) {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
    catch { setNotice(t('浏览器无法保存本地状态。当前仍可使用，刷新后可能无法自动恢复；关闭前请复制未发送草稿。')); }
  }

  async function refreshUpdatedApp() {
    if (turn || choicesBusy || sendPending.current) return;
    sendPending.current = true; setRefreshingApp(true);
    try {
      await flushContentEdits();
      try { saveComposerDrafts(inputDraftsRef.current, savedInputDrafts.current); }
      catch { throw new Error(t('无法保留输入草稿，暂未刷新。请先复制草稿，再检查浏览器存储权限。')); }
      window.location.reload();
    } finally { sendPending.current = false; setRefreshingApp(false); }
  }

  const avatarFor = (message: MessageNode): string | undefined =>
    message.role === 'user'
      ? activePersona?.avatarPath ?? undefined
      : message.speaker?.kind === 'narrator'
      ? generalSettings.narrator.avatarPath ?? undefined
      : data.characters?.find((c) => c.id === (message.speaker?.kind === 'character' ? message.speaker.characterId : null))?.avatarPath ?? undefined;

  function updateData(value: Parameters<typeof setData>[0]) {
    refreshVersions.current.data++;
    setData(value);
  }

  function applyGeneralSettings(value: GeneralSettings) {
    refreshVersions.current.general++;
    setGeneralSettings(value);
  }

  function applyPromptSettings(value: PromptSettings) {
    refreshVersions.current.prompts++;
    setPromptSettings(value);
  }

  async function refresh() {
    const version = {
      data: ++refreshVersions.current.data,
      general: ++refreshVersions.current.general,
      prompts: ++refreshVersions.current.prompts,
    };
    const [values, general, prompts] = await Promise.all([
      Promise.all(collections.map((kind) => api(`/${kind}`))),
      api('/settings/general'),
      api('/settings/prompts'),
    ]);
    // A delayed read must not replace a newer refresh or an already saved change.
    if (version.general === refreshVersions.current.general) setGeneralSettings(general);
    if (version.prompts === refreshVersions.current.prompts) setPromptSettings(prompts);
    if (version.data === refreshVersions.current.data) setData(Object.fromEntries(collections.map((kind, index) => [kind, values[index]])));
  }

  async function refreshMessages(id: string) {
    if (chatRef.current !== id) return;
    const request = ++historyRequest.current;
    const current = () => chatRef.current === id && historyRequest.current === request;
    try {
      const [value, latest] = await Promise.all([
        api<{ branch: MessageNode[]; nodes: MessageSummary[] }>(`/conversations/${id}/messages?view=chat`),
        api(`/conversations/${id}/last-turn`),
      ]);
      if (current()) {
        setBranch(value.branch);
        setNodes(value.nodes);
        setLastTurn(latest);
      }
    } catch (error) {
      if (current()) throw error;
    }
  }

  async function savePersona(personaId: string | null, global: boolean) {
    setPersonaSaving(true);
    try {
      if (global) applyGeneralSettings(await api('/settings/general', 'PUT', { ...generalSettings, defaultPersonaId: personaId }));
      else if (chat) {
        const updated = await api(`/conversations/${chat.id}`, 'PUT', { ...chat, personaId });
        updateData(old => ({ ...old, conversations: old.conversations!.map(c => c.id === updated.id ? updated : c) }));
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
          ? t("页面与服务版本不一致，请按 Ctrl+F5 刷新；若仍失败，请更新后重启。")
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
    setVoice(current => current === 'assistant' ? 'protagonist' : current);
    if (chatId) { rememberSession('selected-chat', chatId); act(refreshMessages(chatId)); }
    return () => { historyRequest.current++; };
  }, [chatId]);

  useEffect(() => {
    try { saveComposerDrafts(inputDrafts, savedInputDrafts.current); }
    catch { setNotice(t("浏览器无法保存草稿，请在关闭页面前复制输入。")); }
  }, [inputDrafts]);

  async function selectPage(next: typeof page) {
    await flushContentEdits();
    setPage(next);
    setMobileNav(false);
  }

  async function closeRecords() {
    await flushContentEdits();
    setPanel(false);
  }

  async function showRecordSource(messageId: string) {
    await flushContentEdits();
    scrollToMessage(messageId);
  }

  async function selectChat(id: string, flush = true) {
    if (flush) await flushContentEdits();
    if (id !== chatRef.current) {
      editedMessageIds.current.clear();
      if (turn) {
        await api(`/turns/${turn.id}/cancel`, 'POST', {});
        streamAbort.current?.abort();
        setTurn(null);
      }
      setChatId(id);
    }
    setPage('chat');
    setMobileNav(false);
  }

  async function follow(id: string, currentChat: string) {
    // A turn may start while its request is still in flight after leaving the story.
    if (chatRef.current !== currentChat) {
      await api(`/turns/${id}/cancel`, 'POST', {});
      await refresh();
      return;
    }
    const controller = new AbortController();
    streamAbort.current?.abort();
    streamAbort.current = controller;
    setTurn({ id, chatId: currentChat });
    rememberSession('active-turn', JSON.stringify({ id, chatId: currentChat }));
    let finished = false;
    try {
      await streamTurn(id, (event) => {
        if (chatRef.current !== currentChat) return;
        const p = event.payload;
        if (!['writer.delta', 'thinking.delta', 'writer.snapshot'].includes(event.type)) setActivity((old) => [...old.slice(-79), event]);
        if (event.type === 'turn.started') { setPhase(generalSettings.generationMode === 'plain' ? { key: "普通写作 · 准备上下文" } : generalSettings.generationMode === 'planner' ? { key: "Planner · 规划" } : { key: "Writer Agent · 选择发言者" }); }
        if (event.type === 'agent.phase') setPhase(p.phase === 'selection' ? { key: "Writer Agent · 选择发言者" } : { key: "Writer Agent · 写作" });
        if (event.type === 'agent.thinking') setPhase({ key: "Writer Agent · 思考" });
        if (event.type === 'writer.started') {
          setPhase({ key: "Writer · {0}", values: [p.outputIndex + 1] });
          queueDraft(old => ({ ...old, [p.outputIndex]: { speaker: p.speaker, outputIndex: p.outputIndex, text: '', thinking: '' } }));
        }
        if (event.type === 'writer.delta') {
          queueDraft(old => ({ ...old, [p.outputIndex]: { speaker: p.speaker, outputIndex: p.outputIndex, text: (old[p.outputIndex]?.text ?? '') + p.delta, thinking: old[p.outputIndex]?.thinking ?? '' } }));
        }
        if (event.type === 'thinking.delta') {
          if (generalSettings.generationMode === 'plain') queueDraft(old => old[p.outputIndex] ? { ...old, [p.outputIndex]: { ...old[p.outputIndex]!, thinking: old[p.outputIndex]!.thinking + p.delta } } : old);
          setPhase(generalSettings.generationMode === 'plain' ? { key: "普通写作 · 思考" } : { key: "Writer Agent · 思考" });
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
        if (event.type === 'records.started') setPhase({ key: "正文已完成 · 更新记录" });
        if (event.type === 'turn.failed' || event.type === 'turn.partial' || event.type === 'records.failed') {
          setError(diagnosticText(p.errorText, p.error ?? t("生成失败")));
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
        setPhase(null);
        if (finished || controller.signal.aborted) rememberSession('active-turn', null);
      }
    }
  }

  useEffect(() => {
    if (!Object.keys(data).length || turn) return;
    const saved = storedValue('active-turn');
    if (!saved) return;
    try {
      const pending = JSON.parse(saved);
      chatRef.current = pending.chatId;
      setChatId(pending.chatId);
      act(follow(pending.id, pending.chatId));
    } catch {
      rememberSession('active-turn', null);
    }
  }, [Object.keys(data).length]);

  async function turnPayload(trigger: TurnRequest['trigger'], targetMessageId?: string, choiceText?: string): Promise<TurnRequest> {
    const draft = choiceText ?? (voice === 'assistant' ? '' : text);
    if (trigger === 'normal' && !draft.trim()) {
      // Read after autosave: editing a message can replace the branch head.
      const { branch: current } = await api<{ branch: MessageNode[] }>(`/conversations/${chat!.id}/messages?view=chat`);
      const last = current.at(-1);
      if (last?.role === 'user') targetMessageId = last.id;
      else trigger = 'auto';
    }
    const replyTargetValue = replyTarget === 'auto'
      ? { mode: 'auto' as const }
      : { mode: 'explicit' as const, speaker: replyTarget === 'narrator' ? { kind: 'narrator' as const } : { kind: 'character' as const, characterId: replyTarget } };
    return {
      conversationId: chat!.id,
      trigger,
      replyTarget: replyTargetValue,
      ...(targetMessageId ? { targetMessageId } : {}),
      ...(trigger === 'normal' && !targetMessageId ? { input: { voice: choiceText === undefined && voice === 'narrator' ? 'narrator' : 'protagonist', text: draft } } : {}),
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

  async function send(trigger: TurnRequest['trigger'] = 'normal', targetMessageId?: string, choiceText?: string) {
    if (!chat || turn || sendPending.current || messageEdit) return;
    const manual = trigger === 'normal' && !targetMessageId && (generalSettings.manualInput || (voice === 'assistant' && choiceText === undefined));
    const manualAssistant = voice === 'assistant' && choiceText === undefined;
    const manualText = choiceText ?? text;
    if (manual && !manualText.trim()) return;
    sendPending.current = true;
    setError('');
    setNotice('');
    try {
      await flushContentEdits();
      setSending(true);
      if (manual) {
        if (chatRef.current !== chat.id) return;
        if (manualAssistant && replyTarget === 'auto') throw new Error(t("请先选择录入回复的角色。"));
        const result = await api(`/conversations/${chat.id}/manual-messages`, 'POST', {
          head: savedMessageId(chat.headMessageId ?? undefined) ?? null,
          ...(manualAssistant ? { role: 'assistant', text: manualText,
            speaker: replyTarget === 'narrator' ? { kind: 'narrator' } : { kind: 'character', characterId: replyTarget },
          } : { role: 'user', input: { voice: choiceText === undefined && voice === 'narrator' ? 'narrator' : 'protagonist', text: manualText } }),
        });
        if (choiceText === undefined) setInputDrafts(old => old[draftKey] === text ? { ...old, [draftKey]: '' } : old);
        updateData(old => ({ ...old, conversations: old.conversations!.map(item => item.id === chat.id ? result.conversation : item) }));
        if (chatRef.current !== chat.id) {
          if (result.turn) await follow(result.turn.id, chat.id);
          return;
        }
        setPromptPreview(null);
        await refreshMessages(chat.id);
        if (result.turn) await follow(result.turn.id, chat.id);
        else setRecordsVersion(version => version + 1);
        return;
      }
      const payload = await turnPayload(trigger, savedMessageId(targetMessageId), choiceText);
      if (chatRef.current !== chat.id) return;
      const result = await api('/turns', 'POST', payload);
      // Clear only the accepted draft, never newer typing or another chat's input.
      if (payload.input && choiceText === undefined) setInputDrafts(old => old[chat.id] === text ? { ...old, [chat.id]: '' } : old);
      await refreshMessages(chat.id);
      await follow(result.id, chat.id);
    } finally {
      sendPending.current = false;
      setSending(false);
    }
  }

  async function changeManualInput(manualInput: boolean) {
    if (turn || sendPending.current || choicesBusy) return;
    sendPending.current = true; setSending(true); setError('');
    try {
      await flushContentEdits();
      applyGeneralSettings(await api('/settings/general', 'PATCH', { manualInput }));
    } finally { sendPending.current = false; setSending(false); }
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
    if (window.confirm(t("这个书签位于其他历史走向，是否从该消息创建独立分支并打开？"))) await forkFrom(savedId);
  }
  async function deleteFrom(messageId: string) {
    if (!chat || turn || sendPending.current) return;
    if (!window.confirm(t("永久删除当前聊天从这个位置起的全部消息，包括旧走向中这个位置及之后的版本？Memory 和主角状态将恢复到保留消息对应的记录；其他独立聊天不受影响。删除后无法恢复。"))) return;
    sendPending.current = true; setSending(true); setError('');
    try {
      await flushContentEdits();
      await api(`/conversations/${chat.id}/messages/${savedMessageId(messageId)}`, 'DELETE', { head: savedMessageId(chat.headMessageId ?? undefined) ?? null });
      editedMessageIds.current.clear(); setMessageEdit(null); setPromptPreview(null); scrollToLatest();
      await refreshMessages(chat.id); await refresh();
      setRecordsVersion(version => version + 1);
    } finally { sendPending.current = false; setSending(false); }
  }
  async function setHistoryStart(messageId: string | null) {
    if (!chatId) return;
    await flushContentEdits();
    const updated = await api<Conversation>(`/conversations/${chatId}/history-start`, 'POST', { messageId: savedMessageId(messageId ?? undefined) ?? null });
    updateData(old => ({ ...old, conversations: old.conversations!.map(item => item.id === updated.id ? updated : item) }));
    setPromptPreview(null);
  }

  async function showPromptPreview() {
    if (!chat) return;
    try {
      await flushContentEdits();
      const { conversationId: _conversationId, ...payload } = await turnPayload('normal');
      if (chatRef.current !== chat.id) return;
      const preview = await api(`/conversations/${chat.id}/prompt-preview`, 'POST', payload);
      if (chatRef.current === chat.id) setPromptPreview({ ...preview, conversationId: chat.id, input: payload.input, draftText: text, existingUserInput: Boolean(payload.targetMessageId) });
    }
    catch (err: any) { setError(err.message || t("预览失败")); }
  }

  async function copyWebPrompt() {
    if (!chat || !promptPreview || turn || sendPending.current) return;
    const preview = promptPreview;
    sendPending.current = true; setSending(true);
    let copied = false;
    try {
      await flushContentEdits();
      if (chatRef.current !== preview.conversationId) throw new Error(t("聊天已切换，请重新预览。"));
      await copyText(preview.webPrompt);
      copied = true;
      if (preview.input) {
        const result = await api(`/conversations/${chat.id}/manual-messages`, 'POST', { role: 'user', input: preview.input, head: preview.headMessageId });
        setInputDrafts(old => old[chat.id] === preview.draftText ? { ...old, [chat.id]: '' } : old);
        if (chatRef.current !== chat.id) return;
        updateData(old => ({ ...old, conversations: old.conversations!.map(item => item.id === chat.id ? result.conversation : item) }));
        // Clear this input before any refresh, so a retry never appends it twice.
        setPromptPreview((old: any) => old ? { ...old, input: undefined, headMessageId: result.message.id, existingUserInput: true } : old);
        await refreshMessages(chat.id);
        setRecordsVersion(version => version + 1);
      } else {
        const current = await api<Conversation>(`/conversations/${chat.id}`);
        if (current.headMessageId !== preview.headMessageId) throw new Error(t("消息位置已变化，请重新预览。"));
      }
      if (chatRef.current !== chat.id) return;
      setReplyTarget(preview.webSpeaker.kind === 'narrator' ? 'narrator' : preview.webSpeaker.characterId);
      setVoice('assistant'); setPromptPreview(null);
      setNotice(t("网页提示词已复制。粘贴到 AI 网页后，把回复填入“角色”模式保存。"));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("复制失败");
      setPromptPreview((old: any) => old ? { ...old, copyError: t("{0}{1} 草稿已保留。", copied ? t("提示词已复制，但本地保存或位置校验未完成。") : '', message) } : old);
    } finally { sendPending.current = false; setSending(false); }
  }

  const edit = (kind: Collection, value: any = defaults[kind]) =>
    setEditor({ kind, value });

  function copyName(kind: 'connections' | 'characters' | 'personas', sourceName: string, maxLength: number) {
    const names = new Set((data[kind] ?? []).map(item => item.name));
    let name = '', number = 1;
    do {
      const suffix = number === 1 ? t('（副本）') : t('（副本 {0}）', number);
      name = sourceName.slice(0, maxLength - suffix.length) + suffix;
      number++;
    } while (names.has(name));
    return name;
  }

  async function copyConnection(source: { id: string; name: string }) {
    const copied = await api(`/connections/${source.id}/copy`, 'POST', { name: copyName('connections', source.name, 100) });
    updateData(old => ({ ...old, connections: [...(old.connections ?? []), copied] }));
    edit('connections', copied);
  }

  async function copyProfile(kind: 'characters' | 'personas', sourceId: string) {
    if (copyingProfile) return;
    setCopyingProfile(true);
    try {
      await flushContentEdits();
      const { id, createdAt, updatedAt, ...original } = await api(`/${kind}/${sourceId}`);
      const copied = await api(`/${kind}`, 'POST', { ...original, name: copyName(kind, original.name, 200) });
      updateData(old => ({ ...old, [kind]: [...(old[kind] ?? []), copied] }));
      edit(kind, copied);
    } finally { setCopyingProfile(false); }
  }

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
    if (!window.confirm(t("删除「{0}」？", value.name ?? value.title))) return;
    await api(`/${kind}/${value.id}`, 'DELETE');
    await refresh();
    if (chatId === value.id) setChatId(null);
  }

  async function runImport(execute = false) {
    setImportBusy(true);
    try {
      if (execute && preview) {
        const report = await api('/imports/execute', 'POST', { sourcePath: preview.sourcePath, sourceHash: preview.sourceHash });
        setNotice(report.alreadyImported ? t("这批文件已导入，没有重复创建。") : t("导入完成。所有聊天统一使用通用设置中的模型。"));
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
        <h1>{t("连接空间")}</h1>
        <p>{t("请输入后端配置的配对令牌。")}</p>
        <form onSubmit={(e) => {
          e.preventDefault();
          act(api('/pair', 'POST', { token }).then(async () => {
            await refresh();
            setPaired(true);
            setError('');
          }));
        }}>
          <input aria-label={t("配对令牌")} type="password" value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="primary">{t("配对")}</button>
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
            <span>AI Roleplay Agent</span>
          </div>
          <button className="sidebar-toggle-btn" title={t("收起侧栏")} aria-label={t("收起侧栏")} onClick={() => setSidebarOpen(false)}>
            <PanelLeftClose size={15} />
          </button>
          <button className="mobile-only" aria-label={t('关闭导航')} onClick={() => setMobileNav(false)}>✕</button>
        </div>

        <button className="new-story primary" onClick={newChat}>
          <Plus size={15} />{t("开启新故事")}</button>

        <button
          type="button"
          className={`nav-label-btn ${page === 'conversations' ? 'selected' : ''}`}
          onClick={() => act(selectPage('conversations'))}
          title={t("查看全部故事卡片")}
        >
          <span className="nav-label-title"><MessageSquare size={13} />  {t("故事列表")}</span>
          <span className="nav-label-count">{data.conversations?.length ?? 0}</span>
        </button>
        <nav className="story-list">
          {data.conversations?.map((c) => (
            <button className={page === 'chat' && c.id === chatId ? 'selected' : ''} key={c.id} onClick={() => act(selectChat(c.id))}>
              <MessageSquare size={14} />
              <span>
                {c.title}
                <small>{c.kind === 'group' ? t("群聊") : t("单聊")} · {{ plain: t("普通写作"), 'writer-agent': 'Writer Agent', planner: 'Planner＋Writer' }[generalSettings.generationMode]}</small>
              </span>
              {(inputDrafts[c.id]?.trim() || inputDrafts[`${c.id}:assistant`]?.trim()) && <small className="story-draft-indicator" title={t("有未发送草稿")} aria-label={t("有未发送草稿")}>{t("草稿")}</small>}
            </button>
          ))}
          {!data.conversations?.length && <p className="muted" style={{ padding: '4px 8px' }}>{t("暂无故事")}</p>}
        </nav>

        <div className="nav-label">
          <span>{t("资源管理")}</span>
        </div>
        <nav className="studio-nav">
          {studioCollections.map((kind) => (
            <button className={page === kind ? 'selected' : ''} key={kind} onClick={() => act(selectPage(kind))}>
              {kind === 'groups' ? <Users size={14} /> : <Library size={14} />}
              {titles[kind]} <span>{data[kind]?.length ?? 0}</span>
            </button>
          ))}
          <button onClick={() => { setShowSettings(true); setMobileNav(false); }}>
            <Settings2 size={14} />设置 / Settings</button>
          <button onClick={() => { setShowPersona(true); setMobileNav(false); }}>
            <Users size={14} />{t("主角：")}{activePersona?.name ?? t("未选择")}
          </button>
          <button className={page === 'import' ? 'selected' : ''} onClick={() => act(selectPage('import'))}>
            <Upload size={14} />{t("导入故事")}</button>
        </nav>

        <div className="local-status">
          <i />  {t("本地")} {session?.fakeModel ? t("离线演示") : `v${appVersion}`}
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="topbar-left">
            {!sidebarOpen && (
              <button className="sidebar-toggle-btn" title={t("展开侧栏")} aria-label={t("展开侧栏")} onClick={() => setSidebarOpen(true)}>
                <PanelLeft size={16} />
              </button>
            )}
            <button className="mobile-only" aria-label={t("打开导航")} onClick={() => setMobileNav(true)}>☰</button>
            <h1>{page === 'chat' ? chat?.title ?? t("新故事") : page === 'import' ? t("导入故事") : page === 'conversations' ? t("故事列表") : titles[page]}</h1>
          </div>
          <div className="top-actions">
            {chat && page === 'chat' && (
              <>
                <button title={t("作者注释")} aria-label={t("作者注释")} onClick={() => setShowAuthorNote(true)}>
                  <FilePenLine size={14} />
                  <span>{t("作者注释")}</span>
                </button>
                {chat.kind === 'group' ? (
                  <button
                    title={t("编辑当前群聊")}
                    aria-label={t("编辑当前群聊")}
                    onClick={() => {
                      const grp = data.groups?.find((g) => g.id === chat.groupId);
                      if (grp) edit('groups', grp);
                    }}
                  >
                    <Users size={14} />
                    <span>{t("群聊资料")}</span>
                  </button>
                ) : (
                  <button
                    title={t("编辑当前角色")}
                    aria-label={t("编辑当前角色")}
                    onClick={() => {
                      const char = data.characters?.find((c) => c.id === chat.characterId);
                      if (char) edit('characters', char);
                    }}
                  >
                    <UserCog size={14} />
                    <span>{t("角色资料")}</span>
                  </button>
                )}
                <button title={t("故事分支")} aria-label={t("故事分支")} onClick={() => setShowBranches(true)}>
                  <GitFork size={14} />
                  <span>{t("故事分支")}</span>
                </button>
                <button title={t("故事资料")} aria-label={t("故事资料")} onClick={() => edit('conversations', chat)}>
                  <BookOpen size={14} />
                  <span>{t("故事资料")}</span>
                </button>
                <button ref={searchButton} title={t('搜索正文（Ctrl / ⌘ + F）')} aria-label={t('搜索正文')} aria-keyshortcuts="Control+f Meta+f" aria-expanded={showSearch}
                  onClick={() => showSearch ? closeSearch() : setShowSearch(true)}><Search size={14} /></button>
                <button title={t("发送前预览提示词")} aria-label={t("发送前预览提示词")} onClick={() => act(showPromptPreview())}>{t("预览")}</button>
                <button title={t("记录面板")} aria-label={t("记录面板")} onClick={() => panel ? act(closeRecords()) : setPanel(true)}>
                  {panel ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
                  <span>{t("记录")}</span>
                </button>
              </>
            )}
          </div>
        </header>

        {updateReady && <div className="banner app-update" role="status">
          <span>{t('新版本已就绪，可在完成当前编辑后刷新。')}</span>
          <button disabled={!!turn || sending || choicesBusy || refreshingApp} onClick={() => act(refreshUpdatedApp())}>{refreshingApp ? t('保存中…') : t('刷新应用')}</button>
        </div>}
        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <button aria-label={t('关闭提示')} onClick={() => setError('')}>✕</button>
          </div>
        )}
        {notice && (
          <div className="banner">
            <span>{notice}</span>
            <button aria-label={t('关闭提示')} onClick={() => setNotice('')}>✕</button>
          </div>
        )}

        {page === 'chat' && !chat && (
          <section className="welcome">
            <h2>{t("开启一段新故事")}</h2>
            <div className="welcome-actions">
              <button className="primary" onClick={newChat}>
                <Plus size={15} />  {t("开启新故事")}</button>
              <button onClick={() => act(selectPage('import'))}>
                <Upload size={15} />  {t("导入旧故事")}</button>
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
              <small>{{ protected: t("主角保护"), coauthor: t("共同创作"), none: t("主角控制：无") }[generalSettings.agencyMode]}</small>
            </div>

            <StoryNavigation key={chat.id} chatId={chat.id} title={chat.title} head={chat.headMessageId} version={recordsVersion} disabled={!!turn || sending} onJump={jumpToBookmark} onChanged={() => { setRecordsVersion(value => value + 1); act(refresh()); }} onError={setError} />
            {showSearch && <MessageSearch key={chat.id} inputRef={searchInput} messages={branch} onClose={closeSearch}
              onMatch={id => { setSearchMatchId(id); if (id) scrollToMessage(id); }} />}
            {chat.historyStartMessageId && <div className="history-start-banner" role="status">
              <span>{historyStartPosition < 0 ? t("固定发送起点不在当前分支，请重新选择或取消。") : t("已固定发送起点 · 从此处起 {0} 条消息，后续持续追加", branch.slice(historyStartPosition).filter(message => message.role !== 'system').length)}</span>
              {historyStartPosition >= 0 && branch[historyStartPosition] && <button onClick={() => scrollToMessage(branch[historyStartPosition]!.id)}>{t("查看起点")}</button>}
              <button disabled={!!turn || sending} onClick={() => act(setHistoryStart(null))}>{t("取消固定起点")}</button>
            </div>}
            <div className="messages-wrap">
            <section ref={messageContainer} className={`messages avatar-${avatarMode}`} aria-label={t("聊天记录")}
              onScroll={onScroll} onWheel={event => { if (event.deltaY < 0 && event.currentTarget.scrollTop < 100) loadOlder(); }}>
              {olderCount > 0 && <button className="messages-older" onClick={loadOlder}>{t("显示更早的消息（还有")} {olderCount}  {t("条）")}</button>}
              {!branch.length && (
                <div className="scene-start">
                  <p>{t("输入第一条消息开始对话。")}</p>
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
                  ? <InlineEdit key={`${m.id}:rewrite`} initial={editing.initial} label={t("改写要求")} disabled={!!turn || sending} saveLabel={t("开始改写")}
                      onCancel={() => setMessageEdit(null)} onSave={value => saveMessageEdit(m, 'rewrite', value)} />
                  : <><AutoSaveField key={`${m.id}:${editing.action}`} draftKey={`${m.id}:new-${editing.action}`} initial="" label={editing.action === 'bookmark' ? t("书签名称") : t("摘录固定事实")} singleLine={editing.action === 'bookmark'} autoFocus disabled={!!turn || sending} lockWhileSaving
                      onError={setError} onSave={value => saveMessageEdit(m, editing.action, value)} /><button onClick={() => setMessageEdit(null)}>{t("关闭窗口")}</button></>);
                const totalInput = info?.usage ? info.usage.input + info.usage.cacheRead + info.usage.cacheWrite : null;
                const cacheRate = totalInput && info?.usage ? Math.round(info.usage.cacheRead / totalInput * 100) : 0;
                return (
                  <article className={`message ${m.role === 'user' ? 'user' : ''} ${narrator ? 'narration' : ''} ${m.id === searchMatchId ? 'search-match' : ''}`} key={messageRenderKey(m.id)} id={`message-${m.id}`} data-message-id={m.id}>
                    <div className="avatar-column"><div
                      className={`avatar ${avatar ? 'clickable' : ''}`}
                      onClick={() => { if (avatar) setPreviewImage(avatar); }}
                      title={avatar ? t("点击查看大图立绘") : undefined}
                    >
                      {avatar ? (
                        <img src={avatar} alt="" loading="lazy" onLoad={onAvatarLoad} />
                      ) : narrator ? (
                        t("旁")
                      ) : m.role === 'user' ? (
                        t("你")
                      ) : (
                        speakerName(m.speaker).slice(0, 1)
                      )}
                    </div></div>
                    <div className="message-body">
                      <header>
                        <strong>
                          {m.role === 'user'
                            ? m.authorKind === 'user_narrator'
                              ? t("你 · 旁白")
                              : activePersona?.name ?? t("你")
                            : speakerName(m.speaker)}
                        </strong>
                        <span>{info?.mode === 'manual' ? t("手动录入") : narrator ? t("旁白") : m.role === 'user' ? t("主角") : 'Writer'}</span>
                      </header>
                      {m.role === 'assistant' && info?.mode === 'plain' && <details className="message-thinking" open={plainThinkingExpanded}>
                        <summary>{t("模型思考")}</summary>
                        <pre>{info.thinking || t("模型未返回可见思考内容。")}</pre>
                      </details>}
                      <div className="prose"><AutoSaveField key={m.id} draftKey={`message:${m.id}`} initial={m.content} label={m.role === 'assistant' ? t("AI 回复正文") : m.role === 'user' ? t("用户消息正文") : t("消息正文")} disabled={!!turn || sending} lockWhileSaving onError={setError} layoutKey={`${readingAppearance.font}:${readingAppearance.fontSize}`}
                        onSave={async (content, previous) => {
                          const saved = await api<MessageNode>(`/messages/${m.id}/edit`, 'POST', { content, previous, head: chat.headMessageId }, { keepalive: true });
                          if (saved.id !== m.id) editedMessageIds.current.set(m.id, saved.id);
                          await refreshMessages(m.conversationId).catch(error => setError(error.message));
                          await refresh().catch(error => setError(error.message)); setRecordsVersion(version => version + 1);
                        }} /></div>
                      {editing && <div className="message-inline-action">
                        <small>{{ fact: t("固定事实 · 保存到当前分支"), rewrite: t("一次性改写要求 · 不作为剧情输入"), bookmark: t("给这条消息命名书签") }[editing.action]}</small>
                        {inlineEditor}
                      </div>}
                      {m.role === 'assistant' && <small className="generation-info">{info?.mode === 'manual' ? t("手动录入 · 未调用正文模型") : info
                        ? t("{0} · 输入 {1} · 输出 {2} · 缓存 {3}{4}", info.model, totalInput ?? t("未返回"), info.usage?.output ?? t("未返回"), info.usage?.cacheRead ?? t("未返回"), info.usage ? ` (${cacheRate}%)` : '')
                        : t("生成信息不可用（旧消息）")}</small>}
                      {!editing && <div className="message-actions" onMouseDown={event => {
                        // Run the click before blur can move or replace the message controls.
                        if (document.activeElement?.closest('.prose')) event.preventDefault();
                      }}>
                        <button onClick={event => {
                          const body = event.currentTarget.closest('article')?.querySelector<HTMLTextAreaElement>('.prose textarea');
                          act(copyText(body?.value ?? m.content).then(() => setNotice(t('正文已复制。'))));
                        }}><Copy size={12} />{t('复制正文')}</button>
                        {m.role !== 'system' && <button className={branch[historyStartPosition]?.id === m.id ? 'active' : ''} disabled={!!turn || sending}
                          title={t("包含本条及后续消息，覆盖通用设置的发送条数；固定范围超出上下文时提示调整")}
                          onClick={() => act(setHistoryStart(branch[historyStartPosition]?.id === m.id ? null : m.id))}>
                          {branch[historyStartPosition]?.id === m.id ? t("发送起点 · 取消") : t("从此处开始发送")}
                        </button>}
                        <button disabled={!!turn || sending} onClick={event => {
                          const body = event.currentTarget.closest('article')?.querySelector<HTMLTextAreaElement>('.prose textarea');
                          const selected = body?.value.slice(body.selectionStart, body.selectionEnd).trim();
                          const content = selected || body?.value || m.content;
                          act(flushContentEdits().then(() => saveMessageEdit({ ...m, id: savedMessageId(m.id)! }, 'fact', content)));
                        }}>{t("固定事实")}</button>
                        {swipes.length > 1 && (
                          <>
                            <button title={t("上一个版本")} disabled={!!turn || index <= 0} onClick={() => act(setHead(swipes[index - 1]!.id))}>
                              <ChevronLeft size={13} />
                            </button>
                            <small>{index + 1}/{swipes.length}</small>
                            <button title={t("下一个版本")} disabled={!!turn || index >= swipes.length - 1} onClick={() => act(setHead(swipes[index + 1]!.id))}>
                              <ChevronRight size={13} />
                            </button>
                          </>
                        )}
                        {m.role === 'assistant' && (
                          <>
                            <button disabled={!!turn} title={t("只重新生成这一条，保持当前发言者；原文保留为其他版本")} onClick={() => act(swipe(m))}>
                              <RotateCw size={12} />{t("新版本")}</button>
                            {wholeTurnTargets.has(m.id) && <button disabled={!!turn} title={t("重新生成本轮的两条回复；按当前模式和回复目标重新决定输出，旧分支保留")} onClick={() => act(send('regenerate', m.id))}>{t("重做整轮（2 条）")}</button>}
                            <button disabled={!!turn} onClick={() => act(send('continue', m.id))}>{t("续写")}</button>
                            <button disabled={!!turn || sending} onClick={() => act(flushContentEdits().then(() => setMessageEdit({ id: savedMessageId(m.id)!, action: 'rewrite', initial: '' })))}>{t("按要求改写")}</button>
                          </>
                        )}
                        <button disabled={!!turn || sending} onClick={() => act(flushContentEdits().then(() => setMessageEdit({ id: savedMessageId(m.id)!, action: 'bookmark', initial: '' })))}>{t("书签")}</button>
                        <button disabled={!!turn || sending} title={t("保留至本条消息，创建独立聊天；原聊天不变")} onClick={() => act(forkFrom(m.id))}>
                          <GitFork size={12} />{t("从此处分支")}</button>
                        <button className="danger" disabled={!!turn || sending} title={t("删除本条及其后的所有消息")} onClick={() => act(deleteFrom(m.id))}>{t("删除")}</button>
                      </div>}
                    </div>
                  </article>
                );
              })}
              {Object.values(drafts).map(draft => (
                <article className="message streaming" key={draft.outputIndex}>
                  <div className="avatar-column"><div className="avatar">...</div></div>
                  <div className="message-body">
                    <header>
                      <strong>{speakerName(draft.speaker)}</strong>
                      <span>{t("正在写作")}</span>
                    </header>
                    {generalSettings.generationMode === 'plain' && <details className="message-thinking" open={plainThinkingExpanded}>
                      <summary>{t("模型思考")}</summary><pre>{draft.thinking || t("模型尚未返回可见思考内容。")}</pre>
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
                onSend={value => send('normal', undefined, value)} onBusy={setChoicesBusy} onChanged={() => setRecordsVersion(version => version + 1)}
                toolbarEnd={<label className="manual-input-switch" title={t("仅改变消息发送；主动生成与记录更新仍可能调用 API。角色回复保存后，Memory／状态按现有间隔更新。")}>
                  <input type="checkbox" aria-label={t("单人创作／网页聊天手动输入")} checked={generalSettings.manualInput} disabled={sending || !!turn || choicesBusy || !!messageEdit}
                    onChange={event => act(changeManualInput(event.target.checked))} />
                  <span>{t("单人创作／网页聊天手动输入")}</span><small>{t("全局")}</small>
                </label>} />
              {awayFromBottom && <button onClick={scrollToLatest}>{t("回到最新 ↓")}</button>}
              {!turn && lastTurn && ['partial', 'failed', 'cancelled'].includes(lastTurn.status) && <div className="turn-recovery">
                <strong>{lastTurn.status === 'partial' ? t("本轮部分完成，已完成回复已保留。") : t("本轮未完成，用户消息已保留。")}</strong>
                {lastTurn.progress && <button disabled={sending} onClick={() => act(retryRemaining())}>{t("重试剩余回复")}</button>}
                {lastTurn.progress?.interruptedOutputs.map(output => <details key={output.outputIndex}>
                  <summary>{speakerName(output.speaker)}  {t("· 未完成片段（不参与剧情）")}</summary>
                  <pre>{output.text}</pre>
                  {output.thinking && <details><summary>{t("已返回的思考")}</summary><pre>{output.thinking}</pre></details>}
                  <button onClick={() => act(copyText(output.text))}>{t("复制片段")}</button>
                </details>)}
              </div>}
              {!turn && lastTurn?.status === 'completed' && ['failed', 'cancelled'].includes(lastTurn.recordsStatus) && <small>{t("正文已完成；记录更新")}{lastTurn.recordsStatus === 'failed' ? t("失败") : t("已取消")}{t("，可在 Memory／状态面板重试。")}</small>}
              {turn && <div className="generation-status"><i />{phase ? t(phase.key, ...(phase.values ?? [])) : t("正在生成…")}</div>}
              <form className="composer" onSubmit={(e) => {
                e.preventDefault();
                act(send());
              }}>
                <textarea
                  aria-label={t("输入消息")}
                  placeholder={voice === 'assistant' ? t("粘贴或输入角色的回复，发送后直接保存为 Assistant 消息…") : voice === 'narrator' ? t("以旁白推动场景或描写事件…") : t("输入主角的行动或对白…")}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (!turn) act(send());
                    }
                  }}
                />
                <div className="composer-controls">
                  <div className="voice-switch">
                    <button type="button" className={voice === 'protagonist' ? 'active' : ''} onClick={() => setVoice('protagonist')}>
                      {t("主角")}</button>
                    <button type="button" className={voice === 'narrator' ? 'active' : ''} onClick={() => setVoice('narrator')}>
                      {t("用户旁白")}</button>
                    <button type="button" className={voice === 'assistant' ? 'active' : ''} onClick={() => {
                      setVoice('assistant'); if (replyTarget === 'auto') setReplyTarget(cast[0] ?? 'narrator');
                    }}>{t("角色")}</button>
                  </div>
                  <label className="reply-select">
                    {voice === 'assistant' ? t("录入为") : generalSettings.manualInput ? t("网页回复者") : t("由谁回复")}
                    <select aria-label={t("回复者")} value={replyTarget} onChange={(e) => setReplyTarget(e.target.value)}>
                      {voice !== 'assistant' && <option value="auto">{t("自动选择")}</option>}
                      <option value="narrator">{generalSettings.narrator.name}</option>
                      {cast.map((id: string) => (
                        <option value={id} key={id}>{data.characters?.find((c) => c.id === id)?.name}</option>
                      ))}
                    </select>
                  </label>
                  {turn ? (
                    <button type="button" className="send stop" aria-label={t("停止生成")} onClick={() => act(api(`/turns/${turn.id}/cancel`, 'POST', {}))}>
                      <Square size={14} />
                    </button>
                  ) : (
                    <button type="submit" className="send primary" aria-label={t("发送")} title={voice === 'assistant' ? t("保存角色回复") : generalSettings.manualInput ? t("保存消息") : t("发送")} disabled={sending || !!messageEdit || ((generalSettings.manualInput || voice === 'assistant') && !text.trim())}>
                      <Send size={15} />
                    </button>
                  )}
                </div>
              </form>
            </div>
          </>
        )}

        {page !== 'chat' && page !== 'import' && (
          <section className="management">
            <header>
              <div className="management-filter">
                <Search size={15} aria-hidden="true" />
                <input ref={resourceFilter} type="search" aria-label={t('按名称或标题筛选')} placeholder={t('按名称或标题筛选')} value={resourceSearch}
                  onChange={event => setResourceSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) setResourceSearch(''); }} />
                {resourceSearch && <button type="button" aria-label={t('清除筛选')} onClick={() => { setResourceSearch(''); resourceFilter.current?.focus(); }}>×</button>}
              </div>
              <button className="primary" onClick={() => (page === 'conversations' ? newChat() : edit(page))}>
                <Plus size={14} />{page === 'conversations' ? t("开启新故事") : t("创建{0}", titles[page])}
              </button>
            </header>
            <div className="management-content">
              {page === 'characters' || page === 'personas' || page === 'groups' || page === 'conversations' ? (
                <div className="character-grid">
                  {page === 'conversations' ? (
                    filteredResources.map((c) => {
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
                            title={cover ? t("点击查看高清原图") : undefined}
                          >
                            {cover ? (
                              <>
                                <img className="character-card-bg-blur" src={cover} alt="" aria-hidden="true" loading="lazy" />
                                <img className="character-card-img" src={cover} alt={c.title} loading="lazy" />
                              </>
                            ) : (
                              <div className="character-card-placeholder">
                                {isGroup ? <Users size={28} /> : (c.title?.slice(0, 1) || t("话"))}
                              </div>
                            )}
                          </div>
                          <div className="character-card-body">
                            <h3 className="character-card-title"><button className="content-link" onClick={() => edit('conversations', c)}>{c.title}</button></h3>
                            <div className="character-card-meta">
                              <span className="badge">{isGroup ? t("群聊 · {0}", grp?.name ?? t("群组")) : t("单聊 · {0}", char?.name ?? t("角色"))}</span>
                              <small className="time">{formatTime(c.updatedAt || c.createdAt)}</small>
                            </div>
                            <button className="character-card-desc content-link" onClick={() => edit('conversations', c)}>
                              {c.scenario || (isGroup ? (memberNames ? t("成员：{0}", memberNames) : grp?.scenario) : char?.description) || t("暂无描述")}
                            </button>
                            <div className="character-card-footer">
                              <button
                                className="primary"
                                onClick={() => act(selectChat(c.id))}
                              >
                                {t("进入故事")}</button>
                              <button className="danger" onClick={() => act(remove('conversations', c))}>{t("删除")}</button>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  ) : page === 'groups' ? (
                    filteredResources.map((v) => {
                      const memberNames = (v.memberIds ?? []).map((mid: string) => (data.characters ?? []).find((ch) => ch.id === mid)?.name).filter(Boolean).join('、');
                      return (
                        <article className="character-card" key={v.id}>
                          <div
                            className="character-card-image-wrap"
                            onClick={() => { if (v.avatarPath) setPreviewImage(v.avatarPath); }}
                            title={v.avatarPath ? t("点击查看高清原图") : undefined}
                          >
                            {v.avatarPath ? (
                              <>
                                <img className="character-card-bg-blur" src={v.avatarPath} alt="" aria-hidden="true" loading="lazy" />
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
                              <span className="badge">{v.memberIds?.length ?? 0}  {t("位成员")}</span>
                              <small className="time">{formatTime(v.updatedAt || v.createdAt)}</small>
                            </div>
                            <button className="character-card-desc content-link" onClick={() => edit('groups', v)}>
                              {memberNames ? t("成员：{0}。", memberNames) : ''}{v.scenario || t("暂无群聊场景描述")}
                            </button>
                            <div className="character-card-footer">
                              <button
                                className="primary"
                                onClick={() => edit('conversations', {
                                  ...defaults.conversations,
                                  title: t("{0} 的故事", v.name),
                                  kind: 'group',
                                  groupId: v.id,
                                })}
                              >
                                {t("开启群聊")}</button>
                              <button className="danger" onClick={() => act(remove('groups', v))}>{t("删除")}</button>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    filteredResources.map((v) => (
                      <article className="character-card" key={v.id}>
                        <div
                          className="character-card-image-wrap"
                          onClick={() => { if (v.avatarPath) setPreviewImage(v.avatarPath); }}
                          title={v.avatarPath ? t("点击查看高清原图") : undefined}
                        >
                          {v.avatarPath ? (
                            <>
                              <img className="character-card-bg-blur" src={v.avatarPath} alt="" aria-hidden="true" loading="lazy" />
                              <img className="character-card-img" src={v.avatarPath} alt={v.name} loading="lazy" />
                            </>
                          ) : (
                            <div className="character-card-placeholder">
                              {v.name?.slice(0, 1) || t("卡")}
                            </div>
                          )}
                        </div>
                        <div className="character-card-body">
                          <h3 className="character-card-title"><button className="content-link" onClick={() => edit(page, v)}>{v.name}</button></h3>
                          <div className="character-card-meta">
                            <span className="badge">{page === 'characters' ? t("角色") : t("主角")}</span>
                            <small className="time">{formatTime(v.updatedAt || v.createdAt)}</small>
                          </div>
                          <button className="character-card-desc content-link" onClick={() => edit(page, v)}>{v.description || v.scenario || t("暂无描述")}</button>
                          <div className="character-card-footer">
                            {page === 'characters' && (
                              <button
                                className="primary"
                                onClick={() => edit('conversations', {
                                  ...defaults.conversations,
                                  title: t("与 {0} 的故事", v.name),
                                  characterId: v.id,
                                })}
                              >
                                {t("开始聊天")}</button>
                            )}
                            <button disabled={copyingProfile} aria-label={page === 'characters' ? t("复制角色") : t("复制主角")} title={page === 'characters' ? t("复制角色") : t("复制主角")}
                              onClick={() => act(copyProfile(page, v.id))}><Copy size={14} /></button>
                            <button className="danger" onClick={() => act(remove(page, v))}>{t("删除")}</button>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              ) : (
                <div className="resource-list">
                  {filteredResources.map((v) => (
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
                        <span>{v.protocol ?? (v.entries ? t("{0} 个条目", v.entries.length) : v.memberIds ? t("{0} 位成员", v.memberIds.length) : '')}</span>
                      </div>
                      <div className="resource-actions">
                        {page === 'connections' && <button onClick={() => edit(page, v)}>{t("编辑")}</button>}
                        <button className="danger" onClick={() => act(remove(page, v))}>{t("删除")}</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {!data[page]?.length && <div className="empty">{t("暂无{0}。点击右上角按钮创建。", page === 'conversations' ? t("故事") : titles[page])}</div>}
              {!!data[page]?.length && !filteredResources.length && <p className="empty" role="status">{t('没有匹配的名称或标题。')}</p>}
            </div>
          </section>
        )}

        {page === 'import' && (
          <section className="import-page">
            <StoryImport disabled={!!turn || sending || importBusy} onError={setError} onImported={async id => { await refresh(); await selectChat(id); }} />
            <h2>{t("导入 SillyTavern 数据")}</h2>
            <p className="muted">{t("扫描角色卡、世界书、聊天、群组、Memory 与主角状态。不会修改源文件。")}</p>
            <label>
              {t("SillyTavern 用户数据目录")}<input value={importPath} onChange={(e) => { setImportPath(e.target.value); setPreview(null); }} />
            </label>
            <button className="primary" disabled={importBusy} onClick={() => act(runImport())}>
              {importBusy ? t("处理中…") : t("扫描并预览")}
            </button>
            {preview && (
              <div className="import-preview">
                <h3>{t("导入预览")}</h3>
                <div className="count-grid">
                  {Object.entries(preview.counts).map(([key, value]) => (
                    <span key={key}><b>{formatNumber(value)}</b>{countLabel(key)}</span>
                  ))}
                </div>
                {preview.warnings.map((warning, i) => (
                  <p className="warning" key={i}>{diagnosticText(preview.warningTexts?.[i], warning)}</p>
                ))}
                <button className="primary" disabled={importBusy} onClick={() => act(runImport(true))}>
                  {t("确认导入")}</button>
              </div>
            )}
          </section>
        )}
      </main>

      {page === 'chat' && chat && (
            <Records
              key={chat.id}
              visible={panel}
              onSource={id => act(showRecordSource(id))}
          chat={chat}
          generationMode={generalSettings.generationMode}
          version={recordsVersion}
          activity={activity}
          activeTurnId={turn?.id ?? (choicesBusy ? 'action-choices' : null)}
          disabled={!!turn}
          onError={setError}
          onChanged={() => setRecordsVersion((v) => v + 1)}
          onClose={() => act(closeRecords())}
        />
      )}

      {showSettings && <SettingsModal
        readingAppearance={readingAppearance}
        onSaveAppearance={value => { saveAppearance(value); setReadingAppearance(value); }}
        onClose={() => setShowSettings(false)}
        generalSettings={generalSettings}
        onSaveGeneral={async value => { applyGeneralSettings(await api('/settings/general', 'PUT', value)); }}
        generationActive={sending || !!turn}
        connections={data.connections ?? []}
        onEditConnection={(conn) => edit('connections', conn ?? defaults.connections)}
        onCopyConnection={copyConnection}
        onDeleteConnection={(conn) => remove('connections', conn)}
        onTestConnection={async (id) => {
          await api(`/connections/${id}/test`, 'POST', {});
        }}
        avatarMode={avatarMode}
        setAvatarMode={value => { localStorage.setItem('avatar-mode', value); setAvatarMode(value); }}
        messageDisplayLimit={messageDisplayLimit}
        setMessageDisplayLimit={value => { localStorage.setItem('chat-message-display-limit', String(value)); setMessageDisplayLimit(value); }}
        plainThinkingExpanded={plainThinkingExpanded}
        setPlainThinkingExpanded={value => { localStorage.setItem('plain-thinking-expanded', String(value)); setPlainThinkingExpanded(value); }}
        promptSettings={promptSettings}
        onSavePrompts={async value => { applyPromptSettings(await api('/settings/prompts', 'PUT', value)); }}
      />}

      {showAuthorNote && chat && <AuthorNoteEditor key={chat.id} chat={chat} disabled={sending || !!turn || choicesBusy}
        onClose={() => setShowAuthorNote(false)} onSaved={saved => {
          updateData(old => ({ ...old, conversations: old.conversations!.map(item => item.id === saved.id ? saved : item) }));
          setPromptPreview(null);
        }} />}

      {editor && (
        <Editor
          key={`${editor.kind}:${editor.value.id ?? 'new'}`}
          kind={editor.kind}
          initial={editor.value}
          data={data}
          defaultPersonaId={generalSettings.defaultPersonaId}
          onPersonaCreated={(newPersona) => {
            updateData(old => ({ ...old, personas: [...(old.personas ?? []).filter(persona => persona.id !== newPersona.id), newPersona] }));
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
          <section className="modal" role="dialog" aria-modal="true" aria-label={t("故事分支")}>
            <header>
              <h2>{t("故事分支")}</h2>
              <button aria-label={t("关闭窗口")} onClick={() => setShowBranches(false)}>✕</button>
            </header>
            <div className="branch-picker">
              <p className="muted" style={{ marginBottom: 12 }}>{t("每个分支都是独立聊天，也可从左侧故事列表打开；切换时保留各自进度和记录。")}</p>
              {relatedBranches.map(item => <button key={item.id} disabled={!!turn || sending} onClick={() => act(selectChat(item.id).then(() => setShowBranches(false)))}>
                <GitFork size={15} /><span>{item.id === chat.id ? t("当前分支 · ") : ''}{item.title}</span>
              </button>)}
              {messageIndex.leaves.some(node => !branch.some(message => message.id === node.id)) && <details>
                <summary>{t("历史消息版本")}</summary>
                <p className="muted">{t("旧走向和消息版本仍保留，可另存为独立分支继续。")}</p>
                {messageIndex.leaves.filter(node => !branch.some(message => message.id === node.id)).map((node) => (
                <button key={node.id} disabled={!!turn || sending} onClick={() => act(forkFrom(node.id))}>
                  <GitFork size={15} />
                  <span>
                    {t("另存为分支 ·")} {node.role === 'user' ? t("用户") : speakerName(node.speaker)}
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
        <div className="lightbox-modal" onClick={() => setPreviewImage(null)} title={t("点击关闭大图")}>
          <img className="lightbox-content" src={previewImage} alt={t("角色大图立绘")} />
        </div>
      )}
      {showPersona && <div className="modal-shade" {...personaBackdrop}>
        <section className="modal" role="dialog" aria-modal="true" aria-label={t("主角身份")} onClick={e => e.stopPropagation()}>
          <header><h2>{t("主角身份")}</h2><button aria-label={t("关闭主角身份")} onClick={() => setShowPersona(false)}>✕</button></header>
          <div className="settings-content settings-section">
            <label>{t("全局默认主角")}<PersonaPicker
                value={generalSettings.defaultPersonaId ?? null}
                personas={data.personas ?? []}
                emptyLabel={t("未选择")}
                disabled={!!turn || sending || personaSaving}
                onChange={(id) => act(savePersona(id, true))}
                onCreatePersona={() => {
                  setShowPersona(false);
                  setPersonaCreateTarget('global');
                  edit('personas');
                }}
              />
            </label>
            {chat && <label>{t("当前故事：")}{chat.title}
              <PersonaPicker
                value={chat.personaId ?? null}
                personas={data.personas ?? []}
                emptyLabel={t("跟随全局默认")}
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
            <p className="muted">{t("新故事和未绑定的故事使用全局默认主角；绑定后切换故事会恢复各自的身份。")}</p>
            {error && <p className="banner error" role="alert">{error}</p>}
          </div>
        </section>
      </div>}

      {promptPreview && (
        <div className="modal-shade" style={{ zIndex: 130 }} {...promptBackdrop}>
          <section className="modal prompt-preview" role="dialog" aria-modal="true" aria-label={t("提示词预览")} onClick={e => e.stopPropagation()}>
            <header><h2>{t("发送提示词预览 · Raw input")}</h2><button aria-label={t("关闭窗口")} onClick={() => setPromptPreview(null)}>✕</button></header>
            <div className="prompt-preview-body">
              <p className="muted">{t("动作：")}{promptPreview.action === 'auto' ? t("自动继续") : promptPreview.existingUserInput ? t("回复已有 User 消息") : t("普通发送")}  {t("· 模式：")}{generationLabel(promptPreview.generationMode)}  {t("· 阶段：")}{phaseLabel(promptPreview.phase)}  {t("· 协议：")}{promptPreview.protocol}</p>
              {promptPreview.action === 'auto' && <p className="muted">{t("草稿为空，末尾没有待回复的 User 消息，正在预览自动继续；不重复上一轮用户输入。")}</p>}
              <p className="muted">{t("身份：")}{promptPreview.pendingSelection ? t("待选择") : promptPreview.speaker?.kind === 'narrator' ? generalSettings.narrator.name : speakerName(promptPreview.speaker)}  {t("· 主角：")}{promptPreview.personaName ?? t("未选择（请求使用 User）")}{promptPreview.clipped ? t(" · 已按上下文预算裁剪") : ''}</p>
              <p className="muted">{t("以下是发送边界捕获的首请求原始 JSON Body，未发送、未重新格式化。修改草稿、设置或聊天内容后请重新预览；Agent 后续请求可在 Trace 中查看。")}</p>
              <section className="prompt-json" aria-label="Raw input">
                <header><strong>{t("Raw input · 首请求 Body")}</strong><button onClick={() => act(copyText(promptPreview.requestBody))}>{t("复制原始 Body")}</button></header>
                <pre tabIndex={0}>{promptPreview.requestBody}</pre>
              </section>
              <section className="prompt-json" aria-label={t("网页提示词")}>
                <header><strong>{t("网页提示词 ·")} {speakerName(promptPreview.webSpeaker)}</strong>
                  <button disabled={sending || !!turn} onClick={() => void copyWebPrompt()}>{promptPreview.input ? t("复制网页提示词并保存 User 输入") : t("复制网页提示词")}</button></header>
                <p className="muted">{t("适用于手动粘贴到 Gemini、ChatGPT、Claude 等网页。整理为普通写作的单条文本，角色标签不等于网页端真正的 System 消息。建议在新对话中粘贴。")}</p>
                {promptPreview.input && <p className="muted">{t("复制成功后同步保存本轮主角／用户旁白内容，不调用正文模型。")}</p>}
                {promptPreview.copyError && <p className="error" role="alert">{promptPreview.copyError}</p>}
                <pre tabIndex={0}>{promptPreview.webPrompt}</pre>
              </section>
              <ContextReport report={promptPreview.contextReport} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
