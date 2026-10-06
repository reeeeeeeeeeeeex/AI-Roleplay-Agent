import { test, expect, type Page } from '@playwright/test';
import { defaultGeneralSettings } from '@new-ai-chat/contracts';

test.use({ serviceWorkers: 'block' });

async function send(page: Page, text: string, count: number) {
  await page.getByRole('textbox', { name: '输入消息' }).fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(count);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
}
test.beforeEach(async ({ page, request }, info) => {
  const characters = await (await request.get('/api/characters')).json();
  const connections = await (await request.get('/api/connections')).json();
  await request.put('/api/settings/general', { data: { ...defaultGeneralSettings, connectionId: connections[0].id, generationMode: 'writer-agent' } });
  const chat = await (await request.post('/api/conversations', { data: { title: `Browser ${info.title}`, kind: 'solo', characterId: characters.find((c: any) => c.name === 'Sina').id } })).json();
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(`Browser ${info.title}`) }).click();
});
test('startup distinguishes missing endpoints from required pairing', async ({ page }) => {
  let status = 404;
  await page.route('**/api/settings/general', route => status
    ? route.fulfill({ status, json: { error: status === 401 ? 'Pair this device first.' : 'Not found.' } })
    : route.continue());
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('页面与服务版本不一致');
  await expect(page.getByRole('textbox', { name: '配对令牌' })).toHaveCount(0);
  status = 401;
  await page.reload();
  await expect(page.getByRole('heading', { name: '连接空间' })).toBeVisible();
  await page.route('**/api/pair', route => {
    status = 0;
    return route.fulfill({ json: { paired: true } });
  });
  await page.getByRole('textbox', { name: '配对令牌' }).fill('browser-test-token');
  await page.getByRole('button', { name: '配对', exact: true }).click();
  await expect(page.getByRole('button', { name: '通用设置', exact: true })).toBeVisible();
});

test('deleting a persona sends no JSON header with an empty body', async ({ page, request }) => {
  const persona = await (await request.post('/api/personas', { data: { name: '待删除主角' } })).json();
  await page.reload();
  await page.locator('.studio-nav button').filter({ hasText: '主角' }).first().click();
  const card = page.locator('.character-card').filter({ hasText: persona.name });
  const deletion = page.waitForRequest(req => req.url().endsWith(`/api/personas/${persona.id}`) && req.method() === 'DELETE');
  page.once('dialog', dialog => dialog.accept());
  await card.getByRole('button', { name: '删除', exact: true }).click();
  expect((await deletion).headers()['content-type']).toBeUndefined();
  await expect(card).toHaveCount(0);
  expect((await (await request.get('/api/personas')).json()).some((item: { id: string }) => item.id === persona.id)).toBe(false);
});

test('replacing a persona image preserves the original 20 MB file', async ({ page, request }) => {
  const oldImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+tmXcAAAAASUVORK5CYII=';
  const oldUrl = (await (await request.post('/api/assets/upload', { data: { filename: 'old.png', dataUrl: `data:image/png;base64,${oldImage}` } })).json()).url;
  const persona = await (await request.post('/api/personas', { data: { name: '换图测试主角', avatarPath: oldUrl } })).json();
  await page.reload();
  await page.locator('.studio-nav button').filter({ hasText: '主角' }).first().click();
  await page.getByRole('button', { name: persona.name, exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑主角', exact: true });
  await expect(editor.getByRole('button', { name: '更换图片' })).toBeVisible();
  const uploaded = page.waitForResponse(response => response.url().endsWith('/api/assets/upload'));
  const image = Buffer.concat([Buffer.from(oldImage, 'base64'), Buffer.alloc(20_000_000)]);
  await editor.locator('input[type="file"]').setInputFiles({
    name: 'portrait.png', mimeType: 'image/png',
    buffer: image,
  });
  const response = await uploaded;
  expect(response.status()).toBe(200);
  expect(response.request().headers()['content-type']).toBe('application/octet-stream');
  await expect.poll(async () => (await (await request.get(`/api/personas/${persona.id}`)).json()).avatarPath).not.toBe(oldUrl);
  const url = (await (await request.get(`/api/personas/${persona.id}`)).json()).avatarPath;
  await expect(editor.locator('.avatar-field-preview img')).toHaveAttribute('src', url);
  const imageResponse = await request.get(url);
  expect(imageResponse.status()).toBe(200);
  expect((await imageResponse.body()).equals(image)).toBe(true);
});

test('global send count and fixed message start control the raw prompt range', async ({ page }) => {
  await send(page, '仅早期历史包含蓝色车票。', 3);
  await send(page, '现在进入旧书店。', 6);
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '通用设置', exact: true });
  await settings.getByRole('button', { name: '写作', exact: true }).click();
  await settings.getByRole('spinbutton', { name: '发送最近多少条消息（0 不限）', exact: true }).fill('2');
  await settings.getByRole('combobox', { name: '生成模式', exact: true }).selectOption('plain');
  await settings.getByRole('button', { name: '保存写作设置', exact: true }).click();
  await expect(settings.getByRole('status')).toContainText('写作设置已保存');
  await settings.getByRole('button', { name: '关闭设置' }).click();
  const preview = async () => {
    await page.getByRole('button', { name: '发送前预览提示词', exact: true }).click();
    const raw = page.getByRole('region', { name: 'Raw input', exact: true }).locator('pre');
    await expect(raw).toContainText('messages');
    const value = (await raw.textContent())!;
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    return value;
  };
  expect(await preview()).not.toContain('蓝色车票');
  await page.locator('article.message').first().getByRole('button', { name: '从此处开始发送', exact: true }).click();
  await expect(page.locator('.history-start-banner')).toContainText('6 条消息');
  expect(await preview()).toContain('蓝色车票');
  await page.reload();
  await expect(page.locator('.history-start-banner')).toContainText('6 条消息');
  await send(page, '继续沿着走廊向前。', 8);
  await expect(page.locator('.history-start-banner')).toContainText('8 条消息');
  expect(await preview()).toContain('蓝色车票');
  await page.getByRole('button', { name: '取消固定起点', exact: true }).click();
  await expect(page.locator('.history-start-banner')).toHaveCount(0);
  expect(await preview()).not.toContain('蓝色车票');
});

test('prompt presets load drafts and only apply after saving, preserving failed edits', async ({ page, request }) => {
  const active = await (await request.get('/api/settings/prompts')).json();
  const created = await request.post('/api/settings/prompt-presets', { data: { name: '浏览器预设', prompts: { ...active, additionalInstruction: '来自预设的附加指令' } } });
  expect(created.status()).toBe(201);
  const saved = await created.json();
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '通用设置', exact: true });
  await settings.getByRole('button', { name: '提示词', exact: true }).click();
  const select = settings.getByRole('combobox', { name: '提示词预设', exact: true });
  const additional = settings.getByRole('textbox', { name: '附加指令', exact: true });
  await additional.fill('尚未保存的草稿');
  page.once('dialog', dialog => dialog.dismiss());
  await select.selectOption(saved.id);
  await expect(additional).toHaveValue('尚未保存的草稿');
  page.once('dialog', dialog => dialog.accept());
  await select.selectOption(saved.id);
  await expect(additional).toHaveValue('来自预设的附加指令');
  expect(await (await request.get('/api/settings/prompts')).json()).toEqual(active);
  await additional.fill('修改后要应用的内容');
  await page.route('**/api/settings/prompts', route => route.fulfill({ status: 500, json: { error: '测试保存失败' } }));
  await settings.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText('测试保存失败');
  await expect(additional).toHaveValue('修改后要应用的内容');
  await page.unroute('**/api/settings/prompts');
  await settings.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect(settings.getByRole('status')).toContainText('提示词已保存');
  expect((await (await request.get('/api/settings/prompt-presets')).json()).find((item: any) => item.id === saved.id).prompts.additionalInstruction).toBe('来自预设的附加指令');
  await page.reload();
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await settings.getByRole('button', { name: '提示词', exact: true }).click();
  await expect(select).toHaveValue('');
  await expect(additional).toHaveValue('修改后要应用的内容');
});

test('writing settings preserve agency prompts in none mode and omit control from the request preview', async ({ page }) => {
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '通用设置', exact: true });
  await settings.getByRole('button', { name: '写作', exact: true }).click();
  const protectedPrompt = settings.getByRole('textbox', { name: '保护主角提示词', exact: true });
  const coauthorPrompt = settings.getByRole('textbox', { name: '共同创作提示词', exact: true });
  await expect(protectedPrompt).toHaveValue(/Never invent User’s dialogue/u);
  await expect(coauthorPrompt).toHaveValue(/You may write User’s dialogue/u);
  await protectedPrompt.fill('Wait for User to choose.');
  await coauthorPrompt.fill('Collaborate with User on actions and dialogue.');
  await settings.getByRole('combobox', { name: '主角控制', exact: true }).selectOption('none');
  await settings.getByRole('combobox', { name: '生成模式', exact: true }).selectOption('plain');
  await settings.getByRole('button', { name: '保存写作设置', exact: true }).click();
  await expect(settings.getByRole('status')).toContainText('写作设置已保存');
  await page.reload();
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await settings.getByRole('button', { name: '写作', exact: true }).click();
  await expect(protectedPrompt).toHaveValue('Wait for User to choose.');
  await expect(coauthorPrompt).toHaveValue('Collaborate with User on actions and dialogue.');
  await expect(settings.getByRole('combobox', { name: '主角控制', exact: true })).toHaveValue('none');
  await settings.getByRole('button', { name: '关闭设置' }).click();
  await expect(page.getByText('主角控制：无', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '输入消息' }).fill('推开门。');
  await page.getByRole('button', { name: '发送前预览提示词', exact: true }).click();
  const raw = page.getByRole('region', { name: 'Raw input', exact: true }).locator('pre');
  await expect(raw).not.toContainText('[User Agency]');
  await expect(raw).not.toContainText('Collaborate with User on actions and dialogue.');
  await expect(raw).not.toContainText('Wait for User to choose.');
});

test('record fields save directly on blur and when the drawer closes', async ({ page, request }, info) => {
  const chats = await (await request.get('/api/conversations')).json();
  const chat = chats.find((item: any) => item.title === `Browser ${info.title}`);
  await request.post(`/api/conversations/${chat.id}/memory`, { data: { content: '原来的记忆' } });
  await page.reload();
  if (!await page.getByRole('button', { name: '关闭记录面板' }).isVisible()) await page.getByRole('button', { name: '记录面板', exact: true }).click();
  const memory = page.getByRole('textbox', { name: 'Memory Stage 1', exact: true });
  await memory.fill('修订后的记忆\n保留换行。');
  await page.getByRole('button', { name: '主角状态', exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/conversations/${chat.id}/memory`)).json())[0].content).toBe('修订后的记忆\n保留换行。');
  await expect(page.getByRole('button', { name: '编辑数据', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: '全局状态 1 current_location', exact: true }).fill('旧书店');
  await page.getByRole('textbox', { name: '全局状态 1 current_time', exact: true }).fill('午夜');
  await page.getByRole('button', { name: '关闭记录面板' }).click();
  await expect.poll(async () => (await (await request.get(`/api/conversations/${chat.id}/state`)).json()).tables.global_state[0]).toMatchObject({ current_location: '旧书店', current_time: '午夜' });
  await page.reload();
  if (!await page.getByRole('button', { name: '关闭记录面板' }).isVisible()) await page.getByRole('button', { name: '记录面板', exact: true }).click();
  await expect(memory).toHaveValue('修订后的记忆\n保留换行。');
  await page.getByRole('button', { name: '主角状态', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '全局状态 1 current_location', exact: true })).toHaveValue('旧书店');
});

test('collection rows edit together and delete invalid drafts without saving them', async ({ page, request }, info) => {
  const chats = await (await request.get('/api/conversations')).json();
  const chat = chats.find((item: any) => item.title === `Browser ${info.title}`);
  await request.post(`/api/conversations/${chat.id}/state`, { data: { tables: {
    inventory: [{ row_id: 1, item_name: '', quantity: '', category: '贵重品', description: '资金' }],
    important_characters: [{ row_id: 1, name: 'Sina', gender_age: 'adult', is_absent: '是' }],
  } } });
  await page.reload();
  if (!await page.getByRole('button', { name: '关闭记录面板' }).isVisible()) await page.getByRole('button', { name: '记录面板', exact: true }).click();
  await page.getByRole('button', { name: '主角状态', exact: true }).click();
  await page.locator('summary').filter({ hasText: '背包物品' }).click();
  const row = page.locator('.state-row[data-table="inventory"]');
  await expect(row.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
  await row.getByRole('textbox', { name: 'item_name', exact: true }).fill('金币');
  await row.getByRole('textbox', { name: 'quantity', exact: true }).fill('50');
  expect((await (await request.get(`/api/conversations/${chat.id}/state`)).json()).tables.inventory[0].item_name).toBe('');
  await page.getByRole('heading', { name: '故事记录', exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/conversations/${chat.id}/state`)).json()).tables.inventory[0]).toMatchObject({ item_name: '金币', quantity: '50' });
  await expect(row.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
  await row.getByRole('textbox', { name: 'item_name', exact: true }).fill('');
  await row.getByRole('button', { name: '删除', exact: true }).click();
  await row.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.locator('summary').filter({ hasText: '重要角色' }).click();
  const character = page.locator('.state-row[data-table="important_characters"]');
  await expect(character.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
  await expect(character.getByRole('combobox', { name: 'is_dead' })).toHaveValue('');
  await character.getByRole('button', { name: '删除', exact: true }).click();
  await character.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(character).toHaveCount(0);
  await page.reload();
  expect((await (await request.get(`/api/conversations/${chat.id}/state`)).json()).tables.inventory).toEqual([]);
});

test('collection row save failure retains the whole draft for retry', async ({ page, request }, info) => {
  const chats = await (await request.get('/api/conversations')).json();
  const chat = chats.find((item: any) => item.title === `Browser ${info.title}`);
  await request.post(`/api/conversations/${chat.id}/state`, { data: { tables: { protagonist_skills: [{ row_id: 1, skill_name: '飞行', skill_type: '魔法' }] } } });
  await page.reload();
  if (!await page.getByRole('button', { name: '关闭记录面板' }).isVisible()) await page.getByRole('button', { name: '记录面板', exact: true }).click();
  await page.getByRole('button', { name: '主角状态', exact: true }).click();
  await page.locator('summary').filter({ hasText: '主角技能' }).click();
  const row = page.locator('.state-row[data-table="protagonist_skills"]');
  await expect(row.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
  await row.getByRole('textbox', { name: 'effect_description', exact: true }).fill('暂时悬浮');
  await page.route('**/api/conversations/*/state/row', route => route.fulfill({ status: 500, json: { error: '测试保存失败' } }));
  await page.getByRole('heading', { name: '故事记录', exact: true }).click();
  await expect(row.getByRole('alert')).toContainText('草稿已保留');
  await expect(row.getByRole('textbox', { name: 'effect_description', exact: true })).toHaveValue('暂时悬浮');
  await page.unroute('**/api/conversations/*/state/row');
  await row.getByRole('textbox', { name: 'effect_description', exact: true }).focus();
  await page.getByRole('heading', { name: '故事记录', exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/conversations/${chat.id}/state`)).json()).tables.protagonist_skills[0].effect_description).toBe('暂时悬浮');
});

test('failed record autosave keeps the draft after leaving the drawer', async ({ page, request }, info) => {
  const chats = await (await request.get('/api/conversations')).json();
  const chat = chats.find((item: any) => item.title === `Browser ${info.title}`);
  await request.post(`/api/conversations/${chat.id}/memory`, { data: { content: '旧内容' } });
  await page.reload();
  if (!await page.getByRole('button', { name: '关闭记录面板' }).isVisible()) await page.getByRole('button', { name: '记录面板', exact: true }).click();
  let fail = true;
  await page.route('**/api/conversations/*/memory/*', route => fail ? route.fulfill({ status: 500, json: { error: '测试保存失败' } }) : route.continue());
  const memory = page.getByRole('textbox', { name: 'Memory Stage 1', exact: true });
  await memory.fill('仍然保留的草稿');
  await page.getByRole('button', { name: '关闭记录面板' }).click();
  await expect(page.getByRole('alert')).toContainText('测试保存失败');
  fail = false;
  await page.getByRole('button', { name: '记录面板', exact: true }).click();
  await expect(memory).toHaveValue('仍然保留的草稿');
  await memory.focus();
  await page.getByRole('heading', { name: '故事记录', exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/conversations/${chat.id}/memory`)).json())[0].content).toBe('仍然保留的草稿');
});

test('story author note and global additional instruction persist into raw System prompts', async ({ page, request }) => {
  const note = '本段故事保持悬疑气氛。\n不要提前揭示信件来源。';
  const additional = '多用对白，避免重复已有描写。';
  await page.getByRole('button', { name: '故事资料', exact: true }).click();
  const story = page.getByRole('dialog', { name: '编辑故事资料', exact: true });
  await story.getByRole('textbox', { name: '作者注释', exact: true }).fill(note);
  await story.getByRole('button', { name: '关闭', exact: true }).last().click();
  await expect(story).toHaveCount(0);
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '通用设置', exact: true });
  await settings.getByRole('button', { name: '提示词', exact: true }).click();
  const main = await settings.getByRole('textbox', { name: '写作主指令', exact: true }).inputValue();
  await settings.getByRole('textbox', { name: '附加指令', exact: true }).fill(additional);
  await settings.getByRole('textbox', { name: '附加指令', exact: true }).blur();
  expect((await (await request.get('/api/settings/prompts')).json()).additionalInstruction).not.toBe(additional);
  await settings.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect(settings.getByRole('status')).toContainText('提示词已保存');
  await settings.getByRole('button', { name: '关闭设置' }).click();
  await page.reload();
  await page.getByRole('button', { name: '故事资料', exact: true }).click();
  await expect(story.getByRole('textbox', { name: '作者注释', exact: true })).toHaveValue(note);
  await story.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await settings.getByRole('button', { name: '提示词', exact: true }).click();
  await expect(settings.getByRole('textbox', { name: '写作主指令', exact: true })).toHaveValue(main);
  await expect(settings.getByRole('textbox', { name: '附加指令', exact: true })).toHaveValue(additional);
  await settings.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '发送前预览提示词', exact: true }).click();
  const raw = page.getByRole('region', { name: 'Raw input', exact: true }).locator('pre');
  await expect(raw).toContainText(additional);
  const body = JSON.parse((await raw.textContent())!);
  expect(body.messages[0].content).toContain(`[Additional Instruction]\n${additional}`);
  expect(body.messages.at(-2)).toMatchObject({ role: 'system', content: `[Author's Note]\n${note}` });
  expect(body.messages.at(-1).role).toBe('user');
});

test('developer Trace viewer shows live thinking, tool results and exact raw input', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const raw = '{\n  "model": "trace-test", "messages": [{"role":"user","content":"测试原文"}]\n}';
  const at = '2026-09-29T12:00:00.000Z';
  const base = { conversationId: 'chat', turnId: 'trace-turn', model: 'trace-test', phase: 'writing', speaker: { kind: 'narrator' }, createdAt: at, completedAt: at, timing: null, usage: null, error: null, request: raw, response: 'data: {"text":"工具响应"}\n\ndata: [DONE]\n\n', thinking: null, tools: [], contextReport: null };
  const done = { ...base, id: 'trace-tools', requestIndex: 0, status: 'completed', events: [
    { type: 'message_end', at, data: { message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'thinking', thinking: '先检查记忆。' }, { type: 'text', text: '准备读取记忆。' }, { type: 'toolCall', id: 'call', name: 'read_memory', arguments: { limit: 2 } }] } } },
    { type: 'tool_execution_start', at, data: { toolCallId: 'call', toolName: 'read_memory', args: { limit: 2 } } },
    { type: 'tool_execution_end', at, data: { toolCallId: 'call', toolName: 'read_memory', isError: false, result: { content: [{ type: 'text', text: '工具返回的完整记忆。' }] } } },
  ] };
  const live = { ...base, id: 'trace-live', requestIndex: 1, status: 'running', completedAt: null };
  let reads = 0;
  await page.route(/\/api\/conversations\/[^/]+\/traces\?view=summary$/, route => route.fulfill({ json: [live, done].map(({ request, response, thinking, tools, contextReport, ...row }) => row) }));
  await page.route('**/api/traces/**', route => {
    if (route.request().url().includes('trace-tools')) return route.fulfill({ json: done });
    const events = [{ type: 'message_update', at, data: { type: 'thinking_delta', contentIndex: 0, delta: ++reads > 1 ? '正在思考，继续检查。' : '正在思考' } }];
    return route.fulfill({ json: { ...live, events } });
  });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).__traceClipboard = text; } } }));
  if (!await page.getByRole('button', { name: '关闭记录面板' }).isVisible()) await page.getByRole('button', { name: '记录面板', exact: true }).click();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.locator('.trace-thinking pre')).toContainText('正在思考，继续检查。');
  await page.getByRole('button', { name: '放大 Trace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent Trace' });
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(1100);
  await dialog.getByRole('button', { name: /1\. Writer/ }).click();
  await expect(dialog.locator('.trace-tool')).toContainText('工具返回的完整记忆。');
  await expect(dialog.locator('.trace-text')).toContainText('准备读取记忆。');
  await dialog.getByText('Raw input · 实际请求 Body', { exact: true }).click();
  await dialog.getByRole('button', { name: '复制原文', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__traceClipboard)).toBe(raw);
  await dialog.getByText('Raw output · 原始响应 / SSE 流', { exact: true }).click();
  await expect(dialog.locator('.trace-raw').filter({ hasText: 'Raw output' }).locator('pre')).toHaveText(done.response);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('native narrator and user narration', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await send(page, '我推开旧书店的门。', 3);
  await expect(page.locator('article.message.narration')).toHaveCount(1);
  await page.getByRole('button', { name: '用户旁白', exact: true }).click();
  await page.getByLabel('回复者').selectOption('narrator');
  await send(page, '窗外突然下起雨，街上的行人都停下了脚步。', 5);
  await expect(page.getByText('你 · 旁白', { exact: true })).toBeVisible();
  await expect(page.locator('article.message').last()).toHaveClass(/narration/);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('story-desktop.png'), fullPage: true });
});
test('mobile layout and forced character', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const close = page.getByRole('button', { name: '关闭记录面板' });
  if (await close.isVisible()) await close.click();
  await page.getByLabel('回复者').selectOption({ label: 'Sina' });
  await send(page, '雨什么时候会停？', 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('story-mobile.png'), fullPage: true });
});
test('creates a connection through the UI with only the supported protocols', async ({ page }) => {
  await page.route('**/api/connections/models', route => route.fulfill({ json: { models: ['local-test', 'other-test'] } }));
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await page.getByRole('button', { name: '创建模型连接', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑模型连接' });
  await dialog.getByRole('textbox', { name: '名称', exact: true }).fill('Browser connection');
  await dialog.getByRole('textbox', { name: 'Base URL', exact: true }).fill('https://example.invalid');
  await dialog.getByRole('button', { name: '自动获取', exact: true }).click();
  await dialog.getByRole('combobox', { name: '可用模型', exact: true }).selectOption('local-test');
  await expect(dialog.getByRole('textbox', { name: '模型 ID', exact: true })).toHaveValue('local-test');
  await expect(dialog.getByRole('combobox', { name: 'API 协议', exact: true }).locator('option')).toHaveCount(3);
  const temperature = dialog.getByRole('spinbutton', { name: /温度/ });
  await expect(temperature).toHaveAttribute('min', '0');
  await expect(temperature).toHaveAttribute('max', '2');
  await temperature.fill('2.1');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'API 协议', exact: true }).selectOption('anthropic-messages');
  await expect(temperature).toHaveAttribute('max', '1');
  await temperature.fill('1');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser connection', exact: true })).toBeVisible();
});

test('v0.2 drafts, persona creation, reading position and bookmarked branch records', async ({ page, request }, info) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const connections = await (await request.get('/api/connections')).json();
  const input = page.getByRole('textbox', { name: '输入消息' });
  const text = '我把这封没能寄出的信收进口袋。\n' + '窗外的灯光映在路面上。\n'.repeat(35);
  await input.fill(text);
  await page.reload();
  await expect(input).toHaveValue(text);

  await page.getByRole('button', { name: '故事资料', exact: true }).click();
  const story = page.getByRole('dialog', { name: '编辑故事资料', exact: true });
  await story.locator('.persona-picker-trigger').click();
  await story.getByRole('button', { name: '新建主角', exact: true }).click();
  const persona = page.getByRole('dialog', { name: '编辑主角', exact: true });
  await persona.getByRole('textbox', { name: '名称', exact: true }).fill('回信人');
  await persona.getByRole('button', { name: '关闭', exact: true }).last().click();
  await expect(persona).toHaveCount(0);
  await story.locator('.persona-picker-trigger').click();
  await expect(story.getByRole('option', { name: /回信人$/ })).toHaveCount(1);
  await story.getByRole('option', { name: /回信人$/ }).click();
  await story.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByRole('button', { name: /灯塔来信 · 单聊/ }).click();
  await page.getByRole('button', { name: new RegExp(`Browser ${info.title}`) }).click();
  await expect(input).toHaveValue(text);

  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '通用设置', exact: true });
  await settings.getByLabel('当前模型连接').selectOption('');
  await expect(settings.getByRole('status')).toContainText('模型已保存');
  await settings.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请在左下角通用设置中选择模型连接。');
  await expect(input).toHaveValue(text);

  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await settings.getByLabel('当前模型连接').selectOption(connections[0].id);
  await expect(settings.getByRole('status')).toContainText('模型已保存');
  await settings.getByRole('button', { name: '关闭设置' }).click();
  await send(page, text, 3);
  await expect(input).toHaveValue('');

  const messages = page.getByRole('region', { name: '聊天记录' });
  await messages.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await expect(page.getByRole('button', { name: '回到最新 ↓' })).toBeVisible();
  await page.getByRole('button', { name: '让故事继续 →' }).click();
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(5);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  expect(await messages.evaluate(element => element.scrollTop)).toBeLessThan(10);
  await page.getByRole('button', { name: '回到最新 ↓' }).click();

  await page.locator('article.message').last().getByRole('button', { name: '固定事实', exact: true }).click();
  await page.getByRole('textbox', { name: '固定事实内容' }).fill('Sina 还不知道信中的秘密。');
  await page.getByRole('textbox', { name: '固定事实内容' }).blur();
  const records = page.locator('.records');
  await expect(records.getByRole('textbox', { name: '固定事实内容' })).toBeVisible();
  await page.locator('article.message').last().getByRole('button', { name: '书签', exact: true }).click();
  await page.getByRole('textbox', { name: '书签名称', exact: true }).fill('拆信之前');
  await page.getByRole('textbox', { name: '书签名称', exact: true }).press('Enter');
  await page.locator('.story-navigation summary').click();
  await expect(page.getByRole('button', { name: '跳转到书签 拆信之前', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '新版本', exact: true }).first().click();
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  await expect(records.getByRole('textbox', { name: '固定事实内容' })).toHaveCount(0);
  await page.getByRole('button', { name: '跳转到书签 拆信之前', exact: true }).click();
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(5);
  await expect(records.getByRole('textbox', { name: '固定事实内容' })).toBeVisible();
  await page.reload();
  await expect(input).toHaveValue('');
  await expect(records.getByRole('textbox', { name: '固定事实内容' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('inline message autosave keeps drafts on failure and saves before continuing', async ({ page, request }, info) => {
  await page.getByLabel('回复者').selectOption('narrator');
  await send(page, '打开信。', 2);
  const reply = page.locator('article.message').last();
  const input = reply.getByRole('textbox', { name: 'AI 回复正文' });
  const original = await input.inputValue();
  const originalId = await reply.getAttribute('data-message-id');
  await expect(reply.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
  const revised = '信纸上只有一句话。\n\n“明天见。”\n末尾保留换行。\n';
  let fail = true;
  await page.route('**/api/messages/*/edit', route => fail ? route.fulfill({ status: 400, json: { error: '暂时无法保存' } }) : route.continue());
  await input.fill(revised); await input.blur();
  await expect(reply.getByRole('alert')).toContainText('暂时无法保存');
  await expect(input).toHaveValue(revised);
  await page.reload();
  await expect(input).toHaveValue(revised);
  fail = false;
  await input.focus(); await input.blur();
  await expect(reply).not.toHaveAttribute('data-message-id', originalId!);
  await page.reload();
  await expect(input).toHaveValue(revised);
  const chats = await (await request.get('/api/conversations')).json();
  const chat = chats.find((item: any) => item.title === `Browser ${info.title}`);
  const messages = await (await request.get(`/api/conversations/${chat.id}/messages`)).json();
  expect(messages.nodes.find((message: any) => message.id === originalId).content).toBe(original);
  await input.fill('这一版在继续故事前保存。');
  const continuation = page.waitForResponse(response => response.url().endsWith('/api/turns') && response.request().method() === 'POST');
  await reply.getByRole('button', { name: '续写', exact: true }).click();
  expect((await continuation).request().postDataJSON().trigger).toBe('continue');
  await expect(input).toHaveValue(/^这一版在继续故事前保存。.+/s);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  const saved = await (await request.get(`/api/conversations/${chat.id}/messages`)).json();
  expect(saved.branch[1].content).toMatch(/^这一版在继续故事前保存。.+/s);
});

test('inline facts bookmarks scene and rewrite controls stay beside their content', async ({ page, request }, info) => {
  await send(page, '留下这封信。', 3);
  const reply = page.locator('article.message').last();
  await reply.getByRole('button', { name: '固定事实', exact: true }).click();
  const fact = page.getByRole('textbox', { name: '固定事实内容' }).first();
  await fact.fill('  信封没有署名。  '); await fact.blur();
  await expect(fact).toHaveValue('信封没有署名。');
  await fact.fill('信封没有署名，尚未拆开。'); await fact.blur();
  await reply.getByRole('button', { name: '书签', exact: true }).click();
  await reply.getByRole('textbox', { name: '书签名称' }).fill('收到信');
  await reply.getByRole('textbox', { name: '书签名称' }).press('Enter');
  await page.locator('.story-navigation summary').click();
  const navigation = page.locator('.story-navigation');
  await navigation.getByRole('textbox', { name: '书签名称' }).fill('未拆封的信');
  await navigation.getByRole('textbox', { name: '书签名称' }).press('Enter');
  await expect(page.getByRole('button', { name: '跳转到书签 未拆封的信' })).toBeVisible();
  await navigation.getByRole('textbox', { name: '当前场景' }).fill('雨夜的书店。');
  await navigation.getByRole('textbox', { name: '当前时间' }).fill('午夜');
  await navigation.getByRole('textbox', { name: '当前地点' }).fill('书店');
  await navigation.getByRole('textbox', { name: '当前地点' }).blur();
  const chats = await (await request.get('/api/conversations')).json();
  const chat = chats.find((item: any) => item.title === `Browser ${info.title}`);
  await expect.poll(async () => (await (await request.get(`/api/conversations/${chat.id}/navigation`)).json()).scene).toMatchObject({ scenario: '雨夜的书店。', time: '午夜', location: '书店' });
  await expect.poll(async () => (await (await request.get(`/api/conversations/${chat.id}/facts`)).json())[0].content).toBe('信封没有署名，尚未拆开。');
  await reply.getByRole('button', { name: '按要求改写' }).click();
  await reply.getByRole('textbox', { name: '改写要求' }).fill('减少解释，保留信封。');
  const accepted = page.waitForResponse(response => response.url().endsWith('/swipe') && response.request().method() === 'POST');
  await reply.getByRole('button', { name: '开始改写' }).click();
  expect((await accepted).request().postDataJSON()).toEqual({ instruction: '减少解释，保留信封。' });
  await expect(page.getByRole('textbox', { name: '改写要求' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
});

test('content cards and nested persona creation save on leaving their fields', async ({ page, request }) => {
  await page.locator('.studio-nav').getByRole('button', { name: /^角色 \d/ }).click();
  await page.getByRole('button', { name: 'Sina', exact: true }).click();
  const character = page.getByRole('dialog', { name: '编辑角色', exact: true });
  await expect(character.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  await character.getByRole('textbox', { name: '性格', exact: true }).fill('沉稳，善于观察。');
  await character.getByRole('button', { name: '关闭', exact: true }).last().click();
  expect((await (await request.get('/api/characters')).json()).find((item: any) => item.name === 'Sina').personality).toBe('沉稳，善于观察。');
  await page.locator('.studio-nav').getByRole('button', { name: /^群组 \d/ }).click();
  await page.getByRole('button', { name: '创建群组', exact: true }).click();
  const group = page.getByRole('dialog', { name: '编辑群组', exact: true });
  await group.getByRole('textbox', { name: '名称', exact: true }).fill('自动保存小组');
  await group.getByRole('checkbox', { name: 'Sina', exact: true }).check();
  await group.getByRole('textbox', { name: '群聊场景' }).fill('海岸车站');
  await group.getByRole('button', { name: '关闭', exact: true }).last().click();
  expect((await (await request.get('/api/groups')).json()).filter((item: any) => item.name === '自动保存小组')).toEqual([expect.objectContaining({ scenario: '海岸车站', memberIds: expect.any(Array) })]);
  await page.locator('.story-list button').first().click();
  await page.getByRole('button', { name: '故事资料', exact: true }).click();
  const story = page.getByRole('dialog', { name: '编辑故事资料', exact: true });
  await story.locator('.persona-picker-trigger').click();
  await story.getByRole('button', { name: '新建主角', exact: true }).click();
  const persona = page.getByRole('dialog', { name: '编辑主角', exact: true });
  await persona.getByRole('textbox', { name: '名称', exact: true }).fill('自动保存主角');
  await persona.getByRole('textbox', { name: '描述', exact: true }).fill('手里带着一封信。');
  await persona.getByRole('button', { name: '关闭', exact: true }).last().click();
  await expect(story.locator('.persona-picker-trigger')).toContainText('自动保存主角');
  await story.getByRole('textbox', { name: '故事标题', exact: true }).fill('自动保存故事');
  await story.getByRole('button', { name: '关闭', exact: true }).last().click();
  const savedPersona = (await (await request.get('/api/personas')).json()).filter((item: any) => item.name === '自动保存主角');
  expect(savedPersona).toHaveLength(1);
  expect(savedPersona[0].description).toBe('手里带着一封信。');
  expect((await (await request.get('/api/conversations')).json()).find((item: any) => item.title === '自动保存故事').personaId).toBe(savedPersona[0].id);
});
