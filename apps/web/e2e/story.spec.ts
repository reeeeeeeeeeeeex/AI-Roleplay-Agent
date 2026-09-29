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
  await persona.getByRole('button', { name: '保存', exact: true }).click();
  await expect(persona).toHaveCount(0);
  await story.locator('.persona-picker-trigger').click();
  await expect(story.getByRole('option', { name: /回信人$/ })).toHaveCount(1);
  await story.getByRole('option', { name: /回信人$/ }).click();
  await story.getByRole('button', { name: '保存', exact: true }).click();
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
  await page.getByRole('textbox', { name: '摘录固定事实' }).fill('Sina 还不知道信中的秘密。');
  await page.locator('article.message').last().getByRole('button', { name: '保存', exact: true }).click();
  const records = page.locator('.records');
  await expect(records.getByText('Sina 还不知道信中的秘密。', { exact: true })).toBeVisible();
  await page.locator('article.message').last().getByRole('button', { name: '书签', exact: true }).click();
  await page.getByRole('textbox', { name: '书签名称', exact: true }).fill('拆信之前');
  await page.getByRole('textbox', { name: '书签名称', exact: true }).press('Enter');
  await page.locator('.story-navigation summary').click();
  await expect(page.getByRole('button', { name: '☆ 拆信之前', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '新版本', exact: true }).first().click();
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  await expect(records.getByText('Sina 还不知道信中的秘密。', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '☆ 拆信之前', exact: true }).click();
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(5);
  await expect(records.getByText('Sina 还不知道信中的秘密。', { exact: true })).toBeVisible();
  await page.reload();
  await expect(input).toHaveValue('');
  await expect(records.getByText('Sina 还不知道信中的秘密。', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('inline message edit keeps its position and survives a failed save', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.getByLabel('回复者').selectOption('narrator');
  await send(page, '打开信。', 2);
  await expect(page.getByRole('button', { name: /重做整轮/ })).toHaveCount(0);
  const reply = page.locator('article.message').last();
  const original = await reply.locator('.prose').innerText();
  const before = await reply.locator('.prose').boundingBox();
  await reply.getByRole('button', { name: '编辑', exact: true }).click();
  const input = page.getByRole('textbox', { name: '编辑正文', exact: true });
  const after = await input.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(2);
  expect(Math.abs(after!.width - before!.width)).toBeLessThan(2);
  await input.fill('取消这次更改'); await input.press('Escape');
  await expect(reply.locator('.prose')).toHaveText(original);
  await reply.getByRole('button', { name: '编辑', exact: true }).click();
  const revised = '信纸上只有一句话。\n\n“明天见。”\n末尾保留换行。\n';
  await input.fill(revised);
  let fail = true;
  await page.route('**/api/messages/*/edit', route => fail ? route.fulfill({ status: 400, json: { error: '暂时无法保存' } }) : route.continue());
  await input.press('Control+Enter');
  await expect(reply.getByRole('alert')).toHaveText('暂时无法保存');
  await expect(input).toHaveValue(revised);
  fail = false; await reply.getByRole('button', { name: '保存', exact: true }).click();
  await expect(input).toHaveCount(0);
  await expect(reply.locator('.prose')).toHaveText(revised);
  await page.reload();
  await expect(reply.locator('.prose')).toHaveText(revised);
  expect(dialogs).toEqual([]);
});

test('inline facts bookmarks and rewrite controls stay beside their content', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await send(page, '留下这封信。', 3);
  await expect(page.getByRole('button', { name: '重做整轮（2 条）', exact: true })).toHaveCount(1);
  const reply = page.locator('article.message').last();
  await reply.getByRole('button', { name: '固定事实', exact: true }).click();
  await reply.getByRole('textbox', { name: '摘录固定事实' }).fill('信还未拆开。');
  await reply.getByRole('button', { name: '保存', exact: true }).click();
  const fact = page.locator('.records .memory-entry').first();
  await fact.getByRole('button', { name: '修改', exact: true }).click();
  await fact.getByRole('textbox', { name: '编辑固定事实' }).fill('信封没有署名。');
  await fact.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.records')).toContainText('信封没有署名。');
  await reply.getByRole('button', { name: '书签', exact: true }).click();
  await reply.getByRole('textbox', { name: '书签名称' }).fill('收到信');
  await reply.getByRole('textbox', { name: '书签名称' }).press('Enter');
  await page.locator('.story-navigation summary').click();
  await page.locator('.story-navigation').getByRole('button', { name: '重命名' }).click();
  await page.getByRole('textbox', { name: '重命名书签' }).fill('未拆封的信');
  await page.getByRole('textbox', { name: '重命名书签' }).press('Enter');
  await expect(page.getByRole('button', { name: '☆ 未拆封的信' })).toBeVisible();
  await reply.getByRole('button', { name: '按要求改写' }).click();
  await reply.getByRole('textbox', { name: '改写要求' }).fill('减少解释，保留信封。');
  const accepted = page.waitForResponse(response => response.url().endsWith('/swipe') && response.request().method() === 'POST');
  await reply.getByRole('button', { name: '开始改写' }).click();
  expect((await accepted).request().postDataJSON()).toEqual({ instruction: '减少解释，保留信封。' });
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '改写要求' })).toHaveCount(0);
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(3);
  expect(dialogs).toEqual([]);
});
