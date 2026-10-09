import { test, expect, type Page, type Locator } from '@playwright/test';
import { defaultGeneralSettings } from '@new-ai-chat/contracts';

test.use({ serviceWorkers: 'block' });

async function send(page: Page, text: string, count: number) {
  await page.getByRole('textbox', { name: '输入消息' }).fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(count);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
}

async function dragLeftOutside(page: Page, source: Locator) {
  const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(4, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}
test.beforeEach(async ({ page, request }, info) => {
  const characters = await (await request.get('/api/characters')).json();
  const connections = await (await request.get('/api/connections')).json();
  await request.put('/api/settings/general', { data: { ...defaultGeneralSettings, connectionId: connections[0].id, generationMode: 'writer-agent' } });
  const chat = await (await request.post('/api/conversations', { data: { title: `Browser ${info.title}`, kind: 'solo', characterId: characters.find((c: any) => c.name === 'Sina').id } })).json();
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(`Browser ${info.title}`) }).click();
});

async function languageSettings(page: Page) {
  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  return page.getByRole('dialog', { name: '设置 / Settings', exact: true });
}
async function englishInterface(page: Page) {
  const settings = await languageSettings(page);
  await settings.getByRole('combobox', { name: '语言 / Language', exact: true }).selectOption('en');
  await settings.getByRole('button', { name: '保存 / Save', exact: true }).click();
  await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
}

async function enableUpdateNotification(page: Page) {
  // Simulate a controller change without installing a worker in the test browser.
  await page.addInitScript(() => Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: Object.assign(new EventTarget(), { controller: {}, register: async () => ({}) }),
  }));
  await page.reload();
  await expect(page.getByRole('textbox', { name: '输入消息', exact: true })).toBeVisible();
}

test('connection copy opens a separate editable model without exposing its saved key', async ({ page, request }) => {
  const created = await request.post('/api/connections', { data: {
    name: 'Copy source', protocol: 'openai-chat-completions', baseUrl: 'https://example.invalid/v1',
    model: 'original-model', apiKey: 'offline-copy-key', headers: { Authorization: 'offline-copy-header' },
  } });
  expect(created.ok()).toBe(true);
  const source = await created.json();
  const selected = (await (await request.get('/api/settings/general')).json()).connectionId;
  await page.reload();
  await englishInterface(page);
  const settings = await languageSettings(page);
  await settings.getByRole('button', { name: 'Models', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 700 });
  const item = settings.locator('.resource-item').filter({ has: page.getByRole('heading', { name: 'Copy source', exact: true }) });
  let modelRequests = 0;
  page.on('request', req => { if (req.method() === 'POST' && (/\/connections\/[^/]+\/test$/.test(req.url()) || req.url().endsWith('/api/turns'))) modelRequests++; });
  const duplicate = item.getByRole('button', { name: 'Duplicate connection', exact: true });
  await duplicate.scrollIntoViewIfNeeded();
  const bounds = (await duplicate.boundingBox())!;
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await duplicate.click();
  const editor = page.getByRole('dialog', { name: /Edit .*connection/i });
  await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Copy source (copy)');
  await expect(editor.getByLabel('API key (blank keeps the saved value)', { exact: true })).toHaveValue('');
  await expect(editor.getByRole('textbox', { name: 'Custom headers JSON', exact: true })).toHaveValue(/\[stored\]/);
  await editor.getByRole('textbox', { name: 'Model ID', exact: true }).fill('copy-model');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const connections = await (await request.get('/api/connections')).json();
  expect(connections.find((item: any) => item.id === source.id).model).toBe('original-model');
  expect(connections.find((item: any) => item.name === 'Copy source (copy)')).toMatchObject({ model: 'copy-model', hasApiKey: true });
  expect((await (await request.get('/api/settings/general')).json()).connectionId).toBe(selected);
  expect(modelRequests).toBe(0);
});

test('app update waits for the user and retains the composer through reload', async ({ page }) => {
  await enableUpdateNotification(page);
  const input = page.getByRole('textbox', { name: '输入消息', exact: true });
  await input.fill('刷新后还要继续写的草稿。');
  const settings = await languageSettings(page);
  await settings.getByRole('button', { name: '提示词', exact: true }).click();
  await settings.getByRole('textbox', { name: '附加指令', exact: true }).fill('尚未保存的设置，不应被后台更新丢弃。');
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
  await expect(page.locator('.app-update')).toContainText('新版本已就绪');
  await expect(settings.getByRole('textbox', { name: '附加指令', exact: true })).toHaveValue('尚未保存的设置，不应被后台更新丢弃。');
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  const reloaded = page.waitForResponse(response => response.url().endsWith('/api/session'));
  await page.getByRole('button', { name: '刷新应用', exact: true }).click();
  await reloaded;
  await expect(input).toHaveValue('刷新后还要继续写的草稿。');
  await expect(page.locator('.app-update')).toHaveCount(0);
});

test('app update keeps a failed message edit and does not reload', async ({ page }) => {
  await page.getByLabel('回复者').selectOption('narrator');
  await send(page, '先保存一条消息。', 2);
  await enableUpdateNotification(page);
  await page.route('**/api/messages/*/edit', route => route.fulfill({ status: 500, json: { error: '保存暂时失败' } }));
  const body = page.getByRole('textbox', { name: '用户消息正文', exact: true });
  await body.fill('必须保留这份未保存的修改。');
  let reloads = 0;
  page.on('request', req => { if (req.url().endsWith('/api/session')) reloads++; });
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
  await page.getByRole('button', { name: '刷新应用', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '内容尚未保存' })).toBeVisible();
  await expect(body).toHaveValue('必须保留这份未保存的修改。');
  expect(reloads).toBe(0);
});

test('browser storage: blocked reads do not prevent opening and writing a story', async ({ page }, info) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
    Storage.prototype.removeItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  await page.locator('.story-list button').filter({ hasText: `Browser ${info.title}` }).click();
  const manual = page.getByRole('checkbox', { name: '单人创作／网页聊天手动输入', exact: true });
  await manual.click();
  await expect(manual).toBeChecked();
  await send(page, '本地存储不可用时仍能保存故事。', 1);
  await expect(page.getByRole('textbox', { name: '用户消息正文' })).toHaveValue('本地存储不可用时仍能保存故事。');
  expect(errors).toEqual([]);
});

test('browser drafts: two windows keep their separate story drafts after reload', async ({ page, request }, info) => {
  const chats = await (await request.get('/api/conversations')).json();
  const chat = chats.find((item: any) => item.title === `Browser ${info.title}`);
  const other = await (await request.post('/api/conversations', { data: { title: 'Second window story', kind: 'solo', characterId: chat.characterId } })).json();
  const second = await page.context().newPage();
  try {
    await second.goto('/');
    await second.locator('.story-list button').filter({ hasText: other.title }).click();
    await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('第一个窗口的草稿。');
    await second.getByRole('textbox', { name: '输入消息', exact: true }).fill('第二个窗口的草稿。');
    await page.reload();
    await page.locator('.story-list button').filter({ hasText: chat.title }).click();
    await expect(page.getByRole('textbox', { name: '输入消息', exact: true })).toHaveValue('第一个窗口的草稿。');
    await second.reload();
    await second.locator('.story-list button').filter({ hasText: other.title }).click();
    await expect(second.getByRole('textbox', { name: '输入消息', exact: true })).toHaveValue('第二个窗口的草稿。');
  } finally { await second.close(); }
});

test('browser drafts: legacy drafts load and an accepted message stays cleared after reload', async ({ page, request }, info) => {
  const chats = await (await request.get('/api/conversations')).json();
  const chat = chats.find((item: any) => item.title === `Browser ${info.title}`);
  await page.evaluate(id => localStorage.setItem('story-drafts', JSON.stringify({ [id]: '旧版保留的用户草稿。', [`${id}:assistant`]: '旧版保留的角色草稿。' })), chat.id);
  await page.reload();
  const input = page.getByRole('textbox', { name: '输入消息', exact: true });
  await expect(input).toHaveValue('旧版保留的用户草稿。');
  await page.locator('.voice-switch').getByRole('button', { name: '角色', exact: true }).click();
  await expect(input).toHaveValue('旧版保留的角色草稿。');
  await page.locator('.voice-switch').getByRole('button', { name: '主角', exact: true }).click();
  const manual = page.getByRole('checkbox', { name: '单人创作／网页聊天手动输入', exact: true });
  await manual.click(); await expect(manual).toBeChecked();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('article.message')).toHaveCount(1);
  await expect(input).toHaveValue('');
  await page.reload();
  await expect(input).toHaveValue('');
  await page.locator('.voice-switch').getByRole('button', { name: '角色', exact: true }).click();
  await expect(input).toHaveValue('旧版保留的角色草稿。');
});

test('browser drafts: failed storage keeps the composer and prevents an update reload', async ({ page }) => {
  await enableUpdateNotification(page);
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('story-draft:')) throw new DOMException('Storage full', 'QuotaExceededError');
      set.call(this, key, value);
    };
  });
  const input = page.getByRole('textbox', { name: '输入消息', exact: true });
  await input.fill('存储失败时仍须保留的草稿。');
  await expect(page.locator('.banner').filter({ hasText: '浏览器无法保存草稿' })).toBeVisible();
  let reloads = 0;
  page.on('request', req => { if (req.url().endsWith('/api/session')) reloads++; });
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
  await page.getByRole('button', { name: '刷新应用', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '无法保留输入草稿' })).toBeVisible();
  await expect(input).toHaveValue('存储失败时仍须保留的草稿。');
  expect(reloads).toBe(0);
});

test('browser storage: failed recovery markers do not interrupt live replies', async ({ page }) => {
  await page.evaluate(() => {
    const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'active-turn') throw new DOMException('Storage full', 'QuotaExceededError');
      set.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (key === 'active-turn') throw new DOMException('Storage blocked', 'SecurityError');
      remove.call(this, key);
    };
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByLabel('回复者').selectOption('narrator');
  await send(page, '等待完整的离线回复。', 2);
  await expect(page.locator('.banner').filter({ hasText: '浏览器无法保存本地状态' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '输入消息', exact: true })).toHaveValue('');
  expect(errors).toEqual([]);
});

test('browser storage: display preferences keep the applied value when saving fails', async ({ page }) => {
  const settings = await languageSettings(page);
  await settings.getByRole('button', { name: '外观', exact: true }).click();
  const avatar = settings.getByRole('combobox', { name: '头像尺寸', exact: true });
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'avatar-mode') throw new DOMException('Storage blocked', 'SecurityError');
      set.call(this, key, value);
    };
  });
  await avatar.selectOption('compact');
  await expect(settings.getByRole('alert')).toContainText('当前设置未改变');
  await expect(avatar).toHaveValue('large');
  await expect(page.locator('.messages')).toHaveClass(/avatar-large/);
});

test('language: defaults to Chinese and persists with bilingual discovery', async ({ page }, info) => {
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  const settings = await languageSettings(page);
  await expect(settings.getByRole('button', { name: '语言 / Language', exact: true })).toHaveClass('active');
  await expect(settings.getByRole('combobox', { name: '语言 / Language', exact: true })).toHaveValue('zh-CN');
  await settings.getByRole('combobox', { name: '语言 / Language', exact: true }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await settings.getByRole('button', { name: '保存 / Save', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await settings.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Create model connection', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('english-settings.png') });
  await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await languageSettings(page);
  await expect(settings.getByRole('button', { name: '语言 / Language', exact: true })).toHaveClass('active');
  await expect(settings.getByRole('combobox', { name: '语言 / Language', exact: true })).toHaveValue('en');
});

test('language: changing labels preserves composer and prompt drafts', async ({ page }) => {
  let writes = 0;
  page.on('request', req => { if (req.url().includes('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) writes++; });
  await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('尚未发送的故事草稿');
  const settings = await languageSettings(page);
  await settings.getByRole('button', { name: '提示词', exact: true }).click();
  await settings.getByLabel('附加指令', { exact: true }).fill('自定义 System 草稿，不应被翻译');
  await settings.getByRole('button', { name: '语言 / Language', exact: true }).click();
  await settings.getByRole('combobox', { name: '语言 / Language', exact: true }).selectOption('en');
  await settings.getByRole('button', { name: '保存 / Save', exact: true }).click();
  await settings.getByRole('button', { name: 'Prompts', exact: true }).click();
  await expect(settings.getByRole('textbox', { name: 'Additional instructions', exact: true })).toHaveValue('自定义 System 草稿，不应被翻译');
  await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message input', exact: true })).toHaveValue('尚未发送的故事草稿');
  expect(writes).toBe(0);
});

test('language: storage failure keeps active language and selected draft', async ({ page }) => {
  const settings = await languageSettings(page);
  await settings.getByRole('combobox', { name: '语言 / Language', exact: true }).selectOption('en');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'interface-language') throw new DOMException('Storage blocked', 'SecurityError'); original.call(this, key, value); };
  });
  await settings.getByRole('button', { name: '保存 / Save', exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText('当前语言未改变');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(settings.getByRole('combobox', { name: '语言 / Language', exact: true })).toHaveValue('en');
  expect(await page.evaluate(() => localStorage.getItem('interface-language'))).toBeNull();
});

test('language: English manual sending fits a narrow screen', async ({ page }, info) => {
  await englishInterface(page);
  await page.getByRole('button', { name: 'Close records panel', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  let proseRequests = 0;
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/turns')) proseRequests++; });
  await page.getByRole('checkbox', { name: 'Solo writing / manual web chat', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message input', exact: true });
  await input.fill('中文剧情内容原样保留。');
  const sendButton = page.getByRole('button', { name: 'Send', exact: true });
  const bounds = await sendButton.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await sendButton.click();
  await expect(page.locator('article.message')).toHaveCount(1);
  await expect(page.locator('article.message .prose')).toHaveText('中文剧情内容原样保留。');
  expect(proseRequests).toBe(0);
  expect(await page.locator('.composer').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('english-narrow.png') });
});

test('language: application errors translate and provider errors stay verbatim', async ({ page }) => {
  await englishInterface(page);
  const settings = await languageSettings(page);
  await settings.getByRole('button', { name: 'Models', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Current model connection', exact: true }).selectOption('');
  await expect(settings.getByRole('status')).toContainText('Model saved');
  await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message input', exact: true }).fill('Keep this draft');
  const failed = page.waitForResponse(res => res.url().endsWith('/api/turns') && res.status() === 400);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  expect((await (await failed).json()).errorText.key).toBe('请在左下角通用设置中选择模型连接。');
  await expect(page.getByRole('alert')).toContainText('Select a model connection in Settings');
  const original = '供应商原始诊断: upstream Connection error. code=E123';
  await page.route('**/api/turns', route => route.fulfill({ status: 502, json: { error: original } }));
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert').locator('span')).toHaveText(original);
  await expect(page.getByRole('textbox', { name: 'Message input', exact: true })).toHaveValue('Keep this draft');
});

test('language: Gateway preview and web prompt remain identical', async ({ page, request }) => {
  const general = await (await request.get('/api/settings/general')).json();
  await request.put('/api/settings/general', { data: { ...general, generationMode: 'plain' } });
  await page.reload();
  await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('在石桥下寻找线索。');
  await page.getByRole('button', { name: '发送前预览提示词', exact: true }).click();
  const body = await page.getByRole('region', { name: 'Raw input', exact: true }).locator('pre').textContent();
  const prompt = await page.getByRole('region', { name: '网页提示词', exact: true }).locator('pre').textContent();
  await page.getByRole('dialog', { name: '提示词预览', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await englishInterface(page);
  await page.getByRole('button', { name: 'Preview prompt before sending', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Raw input', exact: true }).locator('pre')).toHaveText(body!);
  await expect(page.getByRole('region', { name: 'Web prompt', exact: true }).locator('pre')).toHaveText(prompt!);
  await expect(page.getByRole('dialog', { name: 'Prompt preview', exact: true })).toContainText('Context report');
});
test('message copy uses current edited text without saving or generating', async ({ page }) => {
  await page.getByLabel('回复者').selectOption('narrator');
  await send(page, '这封信留在桌上。', 2);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (text: string) => { (window as any).__copiedMessage = text; },
  } }));
  const message = page.locator('article.message').last();
  const body = message.getByRole('textbox', { name: 'AI 回复正文', exact: true });
  const revised = '尚未保存的修改，包含换行。\nCopy only the visible prose.';
  await body.fill(revised);
  let writes = 0;
  page.on('request', req => { if (req.url().includes('/api/') && req.method() !== 'GET') writes++; });
  await message.getByRole('button', { name: '复制正文', exact: true }).click();
  await expect(page.locator('.banner').filter({ hasText: '正文已复制。' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__copiedMessage)).toBe(revised);
  await expect(body).toHaveValue(revised);
  expect(writes).toBe(0);
});

test('web copy without clipboard access keeps its draft and creates no User', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
  const input = page.getByRole('textbox', { name: '输入消息', exact: true });
  await input.fill('复制失败时仍保留这份输入。');
  await page.getByRole('button', { name: '发送前预览提示词', exact: true }).click();
  let writes = 0;
  page.on('request', req => { if (req.url().includes('/api/') && req.method() !== 'GET') writes++; });
  const web = page.getByRole('region', { name: '网页提示词', exact: true });
  await web.getByRole('button', { name: '复制网页提示词并保存 User 输入', exact: true }).click();
  await expect(web.getByRole('alert')).toContainText('请选择文字后手动复制');
  await expect(page.locator('article.message')).toHaveCount(0);
  await expect(input).toHaveValue('复制失败时仍保留这份输入。');
  expect(writes).toBe(0);
});

test('web copy saves User and manual Assistant replies reappear in the next prompt', async ({ page, request }) => {
  const manualToggle = page.getByRole('checkbox', { name: '单人创作／网页聊天手动输入', exact: true });
  await manualToggle.click();
  await expect(manualToggle).toBeChecked();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).__copiedPrompt = text; } } }));
  let proseRequests = 0;
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/turns')) proseRequests++; });
  const input = page.getByRole('textbox', { name: '输入消息' });
  await input.fill('走进网页端的旧书店。');
  await page.getByRole('button', { name: '发送前预览提示词', exact: true }).click();
  const web = page.getByRole('region', { name: '网页提示词', exact: true });
  await expect(web.locator('pre')).toContainText('走进网页端的旧书店。');
  const savedUser = page.waitForResponse(res => res.request().method() === 'POST' && res.url().endsWith('/manual-messages'));
  await web.getByRole('button', { name: '复制网页提示词并保存 User 输入', exact: true }).click();
  const user = (await (await savedUser).json()).message;
  await expect(page.locator('article.message')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '角色', exact: true })).toHaveClass('active');
  expect(await page.evaluate(() => (window as any).__copiedPrompt)).toContain('走进网页端的旧书店。');
  await page.getByRole('button', { name: '发送前预览提示词', exact: true }).click();
  await web.getByRole('button', { name: '复制网页提示词', exact: true }).click();
  await expect(page.getByRole('region', { name: '网页提示词', exact: true })).toHaveCount(0);
  expect((await (await request.get(`/api/conversations/${user.conversationId}/messages`)).json()).branch).toHaveLength(1);
  await input.fill('她推开书柜，露出一扇暗门。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('article.message')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  await input.fill('暗门内传来细微的翻书声。');
  await input.press('Enter');
  await expect(page.locator('article.message')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  const history = (await (await request.get(`/api/conversations/${user.conversationId}/messages`)).json()).branch;
  expect(history.map((message: any) => message.role)).toEqual(['user', 'assistant', 'assistant']);
  expect(history[1].storyTurnId).toBe(history[0].storyTurnId);
  expect(history[1].speaker).toEqual(history[2].speaker);
  await page.getByRole('button', { name: '发送前预览提示词', exact: true }).click();
  await expect(web.locator('pre')).toContainText('她推开书柜，露出一扇暗门。');
  await expect(web.locator('pre')).toContainText('暗门内传来细微的翻书声。');
  expect(proseRequests).toBe(0);
});

test('manual reply save failure preserves separate User and Assistant drafts', async ({ page }) => {
  const manualToggle = page.getByRole('checkbox', { name: '单人创作／网页聊天手动输入', exact: true });
  await manualToggle.click();
  await expect(manualToggle).toBeChecked();
  const input = page.getByRole('textbox', { name: '输入消息' });
  await input.fill('尚未发送的主角草稿');
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await expect(input).toHaveValue('');
  await input.fill('尚未保存的网页回复');
  await page.route('**/api/conversations/*/manual-messages', route => route.fulfill({ status: 500, json: { error: '手动回复保存失败' } }));
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('手动回复保存失败');
  await expect(input).toHaveValue('尚未保存的网页回复');
  await expect(page.locator('article.message')).toHaveCount(0);
  await page.locator('.voice-switch').getByRole('button', { name: '主角', exact: true }).click();
  await expect(input).toHaveValue('尚未发送的主角草稿');
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await expect(input).toHaveValue('尚未保存的网页回复');
});

test('manual input accepts consecutive voices and uses the compact global toolbar', async ({ page, request }, info) => {
  const toggle = page.getByRole('checkbox', { name: '单人创作／网页聊天手动输入', exact: true });
  const input = page.getByRole('textbox', { name: '输入消息' });
  let proseRequests = 0;
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/turns')) proseRequests++; });
  await expect(toggle).not.toBeChecked();
  await input.fill('主角第一条');
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(input).toHaveValue('主角第一条');
  let count = 0;
  for (const voice of ['主角', '用户旁白', '角色']) {
    await page.locator('.voice-switch').getByRole('button', { name: voice, exact: true }).click();
    for (const index of [1, 2]) {
      await input.fill(`${voice}第${index}条`);
      if (index === 1) await page.getByRole('button', { name: '发送', exact: true }).click();
      else await input.press('Enter');
      await expect(page.locator('article.message')).toHaveCount(++count);
      await expect(input).toHaveValue('');
      await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
    }
  }
  await page.locator('.voice-switch').getByRole('button', { name: '主角', exact: true }).click();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  await input.press('Enter');
  expect(proseRequests).toBe(0);
  const chats = await (await request.get('/api/conversations')).json();
  const chat = chats.find((item: any) => item.title === `Browser ${info.title}`);
  const history = (await (await request.get(`/api/conversations/${chat.id}/messages`)).json()).branch;
  expect(history.map((message: any) => message.authorKind)).toEqual(['protagonist', 'protagonist', 'user_narrator', 'user_narrator', 'character', 'character']);
  expect(new Set(history.slice(0, 5).map((message: any) => message.storyTurnId)).size).toBe(1);
  expect(history[5].storyTurnId).not.toBe(history[4].storyTurnId);
  await expect(page.locator('.composer-hint')).toHaveCount(0);
  await expect(page.locator('.composer-wrap > :last-child')).toHaveClass('composer');
  const row = await page.locator('.action-choice-toolbar').boundingBox();
  const control = await page.locator('.manual-input-switch').boundingBox();
  expect(control!.y + control!.height).toBeLessThanOrEqual(row!.y + row!.height + 1);
  await page.setViewportSize({ width: 390, height: 844 });
  const action = await page.getByRole('button', { name: '行动选项', exact: true }).boundingBox();
  const compact = await page.locator('.manual-input-switch').boundingBox();
  expect(Math.abs(action!.y + action!.height / 2 - compact!.y - compact!.height / 2)).toBeLessThan(2);
  expect(compact!.x + compact!.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await request.post('/api/conversations', { data: { title: 'Manual global sibling', kind: 'solo', characterId: chat.characterId } });
  await page.reload();
  await expect(toggle).toBeChecked();
  await page.getByRole('button', { name: /Manual global sibling/ }).click();
  await expect(toggle).toBeChecked();
});

test('manual input toggle failure keeps its original mode and draft', async ({ page }) => {
  const toggle = page.getByRole('checkbox', { name: '单人创作／网页聊天手动输入', exact: true });
  const input = page.getByRole('textbox', { name: '输入消息' });
  await input.fill('切换失败也保留的输入');
  await page.route('**/api/settings/general', route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 500, json: { error: '模式保存失败' } }) : route.continue());
  await toggle.click();
  await expect(page.getByRole('alert')).toContainText('模式保存失败');
  await expect(toggle).not.toBeChecked();
  await expect(input).toHaveValue('切换失败也保留的输入');
  await expect(page.locator('article.message')).toHaveCount(0);
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
  await expect(page.getByRole('button', { name: '设置 / Settings', exact: true })).toBeVisible();
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

test('returning to a story ignores an older history response that arrives last', async ({ page, request }, info) => {
  const chats = await (await request.get('/api/conversations')).json();
  const chat = chats.find((item: any) => item.title === `Browser ${info.title}`);
  const first = await (await request.post(`/api/conversations/${chat.id}/manual-messages`, { data: { role: 'user', head: null, input: { voice: 'protagonist', text: '早先的正文。' } } })).json();
  const other = await (await request.post('/api/conversations', { data: { title: 'Another story while history loads', kind: 'solo', characterId: chat.characterId } })).json();
  let release!: () => void, captured!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { captured = resolve; });
  let delay = true;
  await page.route(`**/api/conversations/${chat.id}/messages*`, async route => {
    if (!delay) return route.continue();
    delay = false;
    const response = await route.fetch();
    captured();
    await waiting;
    await route.fulfill({ response });
  });
  try {
    await page.reload();
    await ready;
    await page.locator('.story-list button').filter({ hasText: other.title }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(other.title);
    const appended = await request.post(`/api/conversations/${chat.id}/manual-messages`, { data: { role: 'user', head: first.message.id, input: { voice: 'narrator', text: '之后保存的新正文。' } } });
    expect(appended.status()).toBe(201);
    await page.locator('.story-list button').filter({ hasText: chat.title }).click();
    await expect(page.locator('article.message')).toHaveCount(2);
    const late = page.waitForResponse(response => response.url().includes(`/conversations/${chat.id}/messages?`));
    release();
    await (await late).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator('article.message')).toHaveCount(2);
    await expect(page.locator('article.message textarea').last()).toHaveValue('之后保存的新正文。');
  } finally { release(); }
});

test('switching versions reloads complete prose from compact navigation', async ({ page, request }, info) => {
  const chats = await (await request.get('/api/conversations')).json();
  const chat = chats.find((item: any) => item.title === `Browser ${info.title}`);
  const original = '原本的完整正文。'.repeat(40) + '原文末尾。';
  const replacement = '修改后的完整正文。'.repeat(40) + '修改后的末尾。';
  const saved = await request.post(`/api/conversations/${chat.id}/manual-messages`, { data: { role: 'assistant', head: null, speaker: { kind: 'narrator' }, text: original } });
  expect(saved.status()).toBe(201);
  const { message } = await saved.json();
  const edited = await request.post(`/api/messages/${message.id}/edit`, { data: { content: replacement, previous: original, head: message.id } });
  expect(edited.ok()).toBe(true);
  await page.reload();
  const body = page.locator('article.message textarea');
  await expect(body).toHaveValue(replacement);
  await page.getByTitle('上一个版本', { exact: true }).click();
  await expect(body).toHaveValue(original);
  await page.getByTitle('下一个版本', { exact: true }).click();
  await expect(body).toHaveValue(replacement);
});

test('global send count and fixed message start control the raw prompt range', async ({ page }) => {
  await send(page, '仅早期历史包含蓝色车票。', 3);
  await send(page, '现在进入旧书店。', 6);
  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置 / Settings', exact: true });
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
  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置 / Settings', exact: true });
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
  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  await settings.getByRole('button', { name: '提示词', exact: true }).click();
  await expect(select).toHaveValue('');
  await expect(additional).toHaveValue('修改后要应用的内容');
});

test('independent branches appear in both story list and branch switcher', async ({ page }) => {
  const originalTitle = await page.getByRole('heading', { level: 1 }).textContent();
  await send(page, '第一条选择', 3);
  await page.locator('article.message').first().getByRole('button', { name: '从此处分支', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${originalTitle} · 分支 2`);
  await expect(page.locator('article.message')).toHaveCount(1);
  await expect(page.locator('.story-list').getByRole('button').filter({ hasText: `${originalTitle} · 分支 2` })).toBeVisible();
  await page.getByRole('button', { name: '故事分支', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '故事分支', exact: true });
  await picker.getByRole('button', { name: originalTitle!, exact: true }).click();
  await expect(page.locator('article.message')).toHaveCount(3);
  await page.reload();
  await page.getByRole('button', { name: '故事分支', exact: true }).click();
  await picker.getByRole('button', { name: `${originalTitle} · 分支 2`, exact: true }).click();
  await expect(page.locator('article.message')).toHaveCount(1);
});

test('delete story tail confirms deletion and keeps bookmark jumps non-destructive', async ({ page, request }, info) => {
  await send(page, '保留的第一回合', 3);
  await send(page, '将删除的第二回合', 6);
  const chats = await (await request.get('/api/conversations')).json();
  const chat = chats.find((item: any) => item.title === `Browser ${info.title}`);
  const history = (await (await request.get(`/api/conversations/${chat.id}/messages`)).json()).branch;
  await request.post(`/api/conversations/${chat.id}/bookmarks`, { data: { name: '第一回合', messageId: history[2].id } });
  await page.reload();
  await page.getByText('场景与书签', { exact: true }).click();
  await page.getByRole('button', { name: '跳转到书签 第一回合', exact: true }).click();
  await expect(page.locator('article.message')).toHaveCount(6);
  const remove = page.locator('article.message').nth(3).getByRole('button', { name: '删除', exact: true });
  page.once('dialog', dialog => dialog.dismiss()); await remove.click();
  await expect(page.locator('article.message')).toHaveCount(6);
  page.once('dialog', dialog => dialog.accept()); await remove.click();
  await expect(page.locator('article.message')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('article.message')).toHaveCount(3);
  const latest = (await (await request.get(`/api/conversations/${chat.id}/messages`)).json()).nodes;
  expect(latest).toHaveLength(3);
});

test('writing settings preserve agency prompts in none mode and omit control from the request preview', async ({ page }) => {
  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置 / Settings', exact: true });
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
  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
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
  await expect(story.getByRole('textbox', { name: '作者注释', exact: true })).toHaveCount(0);
  await story.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByRole('button', { name: '作者注释', exact: true }).click();
  const authorNote = page.getByRole('dialog', { name: '作者注释', exact: true });
  await authorNote.getByRole('textbox', { name: '作者注释', exact: true }).fill(note);
  await authorNote.getByRole('button', { name: '关闭作者注释' }).click();
  await expect(authorNote).toHaveCount(0);
  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置 / Settings', exact: true });
  await settings.getByRole('button', { name: '提示词', exact: true }).click();
  const main = await settings.getByRole('textbox', { name: '写作主指令', exact: true }).inputValue();
  await settings.getByRole('textbox', { name: '附加指令', exact: true }).fill(additional);
  await settings.getByRole('textbox', { name: '附加指令', exact: true }).blur();
  expect((await (await request.get('/api/settings/prompts')).json()).additionalInstruction).not.toBe(additional);
  await settings.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect(settings.getByRole('status')).toContainText('提示词已保存');
  await settings.getByRole('button', { name: '关闭设置' }).click();
  await page.reload();
  await page.getByRole('button', { name: '作者注释', exact: true }).click();
  await expect(authorNote.getByRole('textbox', { name: '作者注释', exact: true })).toHaveValue(note);
  await authorNote.getByRole('button', { name: '关闭作者注释' }).click();
  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  await settings.getByRole('button', { name: '提示词', exact: true }).click();
  await expect(settings.getByRole('textbox', { name: '写作主指令', exact: true })).toHaveValue(main);
  await expect(settings.getByRole('textbox', { name: '附加指令', exact: true })).toHaveValue(additional);
  await settings.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '发送前预览提示词', exact: true }).click();
  const raw = page.getByRole('region', { name: 'Raw input', exact: true }).locator('pre');
  await expect(raw).toContainText(additional);
  const body = JSON.parse((await raw.textContent())!);
  expect(body.messages[0].content).toContain(`[Additional Instruction]\n${additional}`);
  expect(body.messages[0].role).toBe('system');
  expect(body.messages[0].content.startsWith(`[Author's Note]\n${note}`)).toBe(true);
  expect(JSON.stringify(body.messages.slice(1))).not.toContain(note);
  expect(body.messages.at(-1).role).toBe('user');

  const chats = await (await request.get('/api/conversations')).json();
  const chat = chats.find((item: any) => item.authorNote === note);
  const other = await (await request.post('/api/conversations', { data: { title: '同角色的另一聊天', kind: 'solo', characterId: chat.characterId } })).json();
  await page.reload();
  await page.getByRole('button', { name: other.title }).click();
  await page.getByRole('button', { name: '作者注释', exact: true }).click();
  await expect(authorNote.getByRole('textbox', { name: '作者注释', exact: true })).toHaveValue('');
  expect((await (await request.get(`/api/conversations/${chat.id}`)).json()).authorNote).toBe(note);
});

test('author note save failure keeps the editor and draft until retry succeeds', async ({ page }) => {
  await page.getByRole('button', { name: '作者注释', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '作者注释', exact: true });
  const field = editor.getByRole('textbox', { name: '作者注释', exact: true });
  let fail = true;
  await page.route('**/api/conversations/*', route => route.request().method() === 'PUT' && fail
    ? route.fulfill({ status: 500, json: { error: '测试保存失败' } }) : route.continue());
  await field.fill('保留这段重要指令。');
  await editor.getByRole('button', { name: '关闭作者注释' }).click();
  await expect(editor.getByRole('alert')).toContainText('测试保存失败');
  await expect(field).toHaveValue('保留这段重要指令。');
  fail = false;
  await editor.getByRole('button', { name: '关闭作者注释' }).click();
  await expect(editor).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '作者注释', exact: true }).click();
  await expect(field).toHaveValue('保留这段重要指令。');
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
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
  if (!await page.getByRole('button', { name: '关闭记录面板' }).isVisible()) await page.getByRole('button', { name: '记录面板', exact: true }).click();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.locator('.trace-thinking pre')).toContainText('正在思考，继续检查。');
  await page.getByRole('button', { name: '展开记录窗口', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '故事记录窗口', exact: true });
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(1100);
  await dialog.getByRole('button', { name: /1\. Writer/ }).click();
  await expect(dialog.locator('.trace-tool')).toContainText('工具返回的完整记忆。');
  await expect(dialog.locator('.trace-text')).toContainText('准备读取记忆。');
  await dialog.getByText('Raw input · 实际请求 Body', { exact: true }).click();
  await dialog.getByRole('button', { name: '复制原文', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '剪贴板不可用或未获授权' })).toBeVisible();
  await expect(dialog.locator('.trace-raw').filter({ hasText: 'Raw input' }).locator('pre')).toHaveText(raw);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).__traceClipboard = text; } } }));
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
test('modal drag: connection draft survives dragging left outside and only its own backdrop closes it', async ({ page }) => {
  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置 / Settings', exact: true });
  await page.getByRole('dialog', { name: '设置 / Settings', exact: true }).getByRole('button', { name: '模型', exact: true }).click();
  await settings.getByRole('button', { name: '创建模型连接', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑模型连接', exact: true });
  const name = dialog.getByRole('textbox', { name: '名称', exact: true });
  await name.fill('保留未保存的连接草稿');
  await dragLeftOutside(page, name);
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue('保留未保存的连接草稿');
  const box = (await name.boundingBox())!;
  await page.mouse.move(4, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 10, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, box.y + box.height / 2);
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeVisible();
});

test('modal drag: selecting raw prompt text outside the preview does not dismiss it', async ({ page }) => {
  await page.getByRole('button', { name: '发送前预览提示词', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '提示词预览', exact: true });
  const raw = dialog.getByRole('region', { name: 'Raw input', exact: true }).locator('pre');
  await expect(raw).toContainText('messages');
  const original = await raw.textContent();
  await dragLeftOutside(page, raw);
  await expect(dialog).toBeVisible();
  await expect(raw).toHaveText(original!);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('creates a connection through the UI with only the supported protocols', async ({ page }) => {
  await page.route('**/api/connections/models', route => route.fulfill({ json: { models: ['local-test', 'other-test'] } }));
  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  await page.getByRole('dialog', { name: '设置 / Settings', exact: true }).getByRole('button', { name: '模型', exact: true }).click();
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

  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置 / Settings', exact: true });
  await settings.getByRole('button', { name: '模型', exact: true }).click();
  await settings.getByLabel('当前模型连接').selectOption('');
  await expect(settings.getByRole('status')).toContainText('模型已保存');
  await settings.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请在左下角通用设置中选择模型连接。');
  await expect(input).toHaveValue(text);

  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  await settings.getByRole('button', { name: '模型', exact: true }).click();
  await settings.getByLabel('当前模型连接').selectOption(connections[0].id);
  await expect(settings.getByRole('status')).toContainText('模型已保存');
  await settings.getByRole('button', { name: '关闭设置' }).click();
  await send(page, text, 3);
  await expect(input).toHaveValue('');

  const messages = page.getByRole('region', { name: '聊天记录' });
  await messages.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await expect(page.getByRole('button', { name: '回到最新 ↓' })).toBeVisible();
  await page.getByRole('button', { name: '发送', exact: true }).click();
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

test('empty send replies after deleting and editing, then Enter adds an assistant reply', async ({ page, request }, info) => {
  await page.getByLabel('回复者').selectOption('narrator');
  await send(page, '打开信。', 2);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('article.message').last().getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.locator('article.message')).toHaveCount(1);
  const user = page.locator('article.message').first();
  const previousId = await user.getAttribute('data-message-id');
  const revised = '先看看信封的署名。\n等她解释后再拆开。';
  await user.getByRole('textbox', { name: '用户消息正文' }).fill(revised);
  const edited = page.waitForResponse(response => /\/api\/messages\/[^/]+\/edit$/.test(response.url()));
  const sent = page.waitForResponse(response => response.url().endsWith('/api/turns') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const savedUser = await (await edited).json();
  const sentRequest = (await sent).request().postDataJSON();
  expect(savedUser.id).not.toBe(previousId);
  expect(sentRequest).toMatchObject({ trigger: 'normal', targetMessageId: savedUser.id });
  expect(sentRequest).not.toHaveProperty('input');
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  await expect(user.getByRole('textbox', { name: '用户消息正文' })).toHaveValue(revised);
  const replyId = await page.locator('article.message').last().getAttribute('data-message-id');
  const continued = page.waitForResponse(response => response.url().endsWith('/api/turns') && response.request().method() === 'POST');
  await page.getByRole('textbox', { name: '输入消息' }).press('Enter');
  expect((await continued).request().postDataJSON().trigger).toBe('auto');
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  await expect(page.locator('article.message').nth(1)).toHaveAttribute('data-message-id', replyId!);
  const chats = await (await request.get('/api/conversations')).json();
  const chat = chats.find((item: any) => item.title === `Browser ${info.title}`);
  const saved = await (await request.get(`/api/conversations/${chat.id}/messages`)).json();
  expect(saved.branch.filter((message: any) => message.role === 'user').map((message: any) => message.id)).toEqual([savedUser.id]);
});

test('empty send preserves a failed user edit and does not request generation', async ({ page }) => {
  await page.getByLabel('回复者').selectOption('narrator');
  await send(page, '打开信。', 2);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('article.message').last().getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.locator('article.message')).toHaveCount(1);
  const input = page.getByRole('textbox', { name: '用户消息正文' });
  const revised = '这份编辑必须保留下来。';
  await page.route('**/api/messages/*/edit', route => route.fulfill({ status: 400, json: { error: '暂时无法保存' } }));
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/turns') && request.method() === 'POST') requests++; });
  await input.fill(revised);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '内容尚未保存' })).toBeVisible();
  await expect(input).toHaveValue(revised);
  expect(requests).toBe(0);
  await page.reload();
  await expect(input).toHaveValue(revised);
  await expect(page.locator('article.message')).toHaveCount(1);
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

test('story filter stays usable in English on a narrow screen and opens the matching story', async ({ page, request }) => {
  const characters = await (await request.get('/api/characters')).json();
  const title = 'Shelved story · 原始标题';
  expect((await request.post('/api/conversations', { data: { title, kind: 'solo', characterId: characters[0].id } })).status()).toBe(201);
  await page.reload();
  await englishInterface(page);
  await page.getByRole('button', { name: 'Close records panel', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: /^Story list/ }).click();
  const filter = page.getByRole('searchbox', { name: 'Filter by name or title', exact: true });
  await filter.fill('sHELVED');
  await expect(page.locator('.management .character-card')).toHaveCount(1);
  for (const control of [filter, page.locator('.management').getByRole('button', { name: 'Start a new story', exact: true })]) {
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  await page.getByRole('button', { name: 'Open story', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.getByRole('textbox', { name: 'Message input', exact: true })).toBeVisible();
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
