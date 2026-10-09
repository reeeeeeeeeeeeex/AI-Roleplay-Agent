import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';
import { defaultGeneralSettings, type MessageNode } from '@new-ai-chat/contracts';

test.use({ serviceWorkers: 'block' });

async function openHistory(page: Page, request: APIRequestContext, limit?: number, avatar?: string) {
  const characters = await (await request.get('/api/characters')).json();
  const connections = await (await request.get('/api/connections')).json();
  await request.put('/api/settings/general', { data: {
    ...defaultGeneralSettings, connectionId: connections[0].id,
    narrator: { ...defaultGeneralSettings.narrator, avatarPath: avatar ?? null },
  } });
  const chat = await (await request.post('/api/conversations', { data: { title: 'Chat display fixture', kind: 'solo', characterId: characters[0].id } })).json();
  const messages: MessageNode[] = Array.from({ length: 120 }, (_, index) => ({
    id: `display-${index}`, conversationId: chat.id, parentId: index ? `display-${index - 1}` : null,
    storyTurnId: null, role: index % 2 ? 'assistant' : 'user', authorKind: index % 2 ? 'narrator' : 'protagonist',
    speaker: index % 2 ? { kind: 'narrator' } : null,
    content: `${index % 2 ? '回复' : '用户消息'} ${Math.floor(index / 2) + 1}` + (avatar ? '' : '\n' + '用于验证长聊天中的阅读位置。\n'.repeat(3)),
    generationInfo: index % 2 && !avatar ? { mode: 'plain', model: 'offline-fixture', streaming: true, requestCount: 1, thinking: '模型返回的可见思考。', usage: null, timing: null } : null,
    providerState: null, legacyPayload: null, createdAt: '2026-09-29T12:00:00.000Z',
  }));
  await page.route(`**/api/conversations/${chat.id}/messages*`, route => route.fulfill({ json: { branch: messages, nodes: messages } }));
  await page.addInitScript(({ chatId, initialLimit }) => {
    localStorage.setItem('selected-chat', chatId);
    if (initialLimit && !localStorage.getItem('chat-message-display-limit')) localStorage.setItem('chat-message-display-limit', String(initialLimit));
  }, { chatId: chat.id, initialLimit: limit });
  await page.goto('/');
  await expect(page.locator('article.message')).toHaveCount(limit ?? 100);
  return messages;
}

function portraitSvg(width: number, height: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#508080"/><path d="M0 0L${width} ${height}M${width} 0L0 ${height}" stroke="white" stroke-width="4"/></svg>`;
}

async function readingStory(page: Page, request: APIRequestContext) {
  const characters = await (await request.get('/api/characters')).json();
  await request.put('/api/settings/general', { data: { ...defaultGeneralSettings, manualInput: true, memoryTurnInterval: 0, stateTurnInterval: 0 } });
  const chat = await (await request.post('/api/conversations', { data: { title: 'Reading appearance fixture', kind: 'solo', characterId: characters[0].id } })).json();
  const user = await (await request.post(`/api/conversations/${chat.id}/manual-messages`, { data: { role: 'user', head: null, input: { voice: 'protagonist', text: '雨停了，我们继续走吧。' } } })).json();
  const body = 'Distant lights reflect on the cobblestones. 远处的灯光映在石板路上。\n'.repeat(8).trim();
  const reply = await request.post(`/api/conversations/${chat.id}/manual-messages`, { data: { role: 'assistant', head: user.message.id, speaker: { kind: 'narrator' }, text: body } });
  expect(reply.ok()).toBe(true);
  await page.addInitScript(id => localStorage.setItem('selected-chat', id), chat.id);
  await page.goto('/');
  await expect(page.locator('article.message')).toHaveCount(2);
  return body;
}

async function readingSettings(page: Page) {
  const navigation = page.getByRole('button', { name: /^(打开导航|Open navigation)$/ });
  if (await navigation.isVisible()) await navigation.click();
  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置 / Settings', exact: true });
  await settings.getByRole('button', { name: /^(外观|Appearance)$/ }).click();
  return settings;
}

async function insideViewport(page: Page, locator: Locator) {
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  const size = page.viewportSize()!;
  expect(rect!.x).toBeGreaterThanOrEqual(-1);
  expect(rect!.y).toBeGreaterThanOrEqual(-1);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(size.width + 1);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(size.height + 1);
}

test('story search reveals older messages and navigates saved prose only', async ({ page, request }) => {
  await openHistory(page, request, 10);
  await expect(page.locator('#message-display-0')).toHaveCount(0);
  await page.getByRole('button', { name: '搜索正文', exact: true }).click();
  const search = page.getByRole('searchbox', { name: '搜索当前分支正文' });
  await search.fill('用户消息');
  await expect(page.getByRole('search').getByRole('status')).toHaveText('1 / 60 条消息');
  await expect(page.locator('#message-display-0')).toHaveClass(/search-match/);
  await expect.poll(() => page.locator('#message-display-0').evaluate(element => Math.abs(element.getBoundingClientRect().top - document.querySelector('.messages')!.getBoundingClientRect().top - 12))).toBeLessThan(2);
  await search.press('Enter');
  await expect(page.locator('#message-display-2')).toHaveClass(/search-match/);
  await search.press('Shift+Enter');
  await expect(page.locator('#message-display-0')).toHaveClass(/search-match/);
  await page.getByRole('button', { name: '上一条匹配消息' }).click();
  await expect(page.getByRole('search').getByRole('status')).toHaveText('60 / 60 条消息');
  await search.fill('模型返回的可见思考。');
  await expect(page.getByRole('search').getByRole('status')).toHaveText('0 / 0 条消息');
  await expect(page.getByRole('button', { name: '下一条匹配消息' })).toBeDisabled();
  await expect(page.locator('.search-match')).toHaveCount(0);
});

test('story search is literal, stays inside a narrow screen and preserves the draft', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(() => localStorage.setItem('interface-language', 'en'));
  const messages = await openHistory(page, request, 10);
  messages[0]!.content = 'Beside the [Northern Gate].';
  messages[119]!.content = 'Back to the [northern gate].';
  const chatId = messages[0]!.conversationId;
  await page.route(`**/api/conversations/${chatId}/messages*`, route => route.fulfill({ json: {
    branch: messages, nodes: [...messages, { ...messages[119], id: 'hidden-version', content: 'A hidden [northern gate] version.' }],
  } }));
  await page.reload();
  const input = page.getByRole('textbox', { name: 'Message input', exact: true });
  await input.fill('Keep this unsent draft.');
  let writes = 0;
  page.on('request', req => { if (req.url().includes('/api/') && req.method() !== 'GET') writes++; });
  const before = (await page.locator('.messages-wrap').boundingBox())!.height;
  await page.getByRole('button', { name: 'Search story', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search this branch' });
  await search.fill('[NORTHERN');
  await expect(page.getByRole('search').getByRole('status')).toHaveText('1 / 2 messages');
  await page.getByRole('button', { name: 'Next matching message' }).click();
  await expect(page.locator('#message-display-119')).toHaveClass(/search-match/);
  await insideViewport(page, page.getByRole('search'));
  await insideViewport(page, page.getByRole('button', { name: 'Send', exact: true }));
  await search.press('Escape');
  await expect(page.getByRole('search')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Search story', exact: true })).toBeFocused();
  await expect(input).toHaveValue('Keep this unsent draft.');
  // Restore the same reading position, so the existing back-to-latest control is hidden.
  await page.getByRole('button', { name: 'Back to latest ↓' }).click();
  await expect(page.getByRole('button', { name: 'Back to latest ↓' })).toHaveCount(0);
  expect((await page.locator('.messages-wrap').boundingBox())!.height).toBeCloseTo(before, 0);
  expect(writes).toBe(0);
});

test('reading: saved colors and typography survive reload without changing content', async ({ page, request }, info) => {
  const body = await readingStory(page, request);
  const input = page.getByRole('textbox', { name: '输入消息', exact: true });
  await input.fill('未发送的故事草稿');
  let writes = 0, fonts = 0;
  page.on('request', req => {
    if (req.url().includes('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) writes++;
    if (req.resourceType() === 'font') fonts++;
  });
  const settings = await readingSettings(page);
  await settings.getByRole('combobox', { name: '阅读配色', exact: true }).selectOption('warm');
  await settings.getByRole('combobox', { name: '正文字体', exact: true }).selectOption('serif');
  await settings.getByRole('slider', { name: '正文字号', exact: true }).press('End');
  await expect(page.locator('html')).toHaveAttribute('data-reading-theme', 'graphite');
  await settings.getByRole('button', { name: '保存阅读外观', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-reading-theme', 'warm');
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  const prose = page.locator('article.message .prose textarea').last();
  await expect(prose).toHaveCSS('font-size', '28px');
  await expect(prose).toHaveValue(body);
  expect(await prose.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await expect(input).toHaveValue('未发送的故事草稿');
  expect(writes).toBe(0);
  expect(fonts).toBe(0);
  await page.reload();
  await expect(prose).toHaveCSS('font-size', '28px');
  await expect(page.locator('html')).toHaveAttribute('data-reading-font', 'serif');
  await expect(input).toHaveValue('未发送的故事草稿');
  await page.screenshot({ path: info.outputPath('reading-desktop.png') });
});

test('reading: a failed save keeps the current appearance and selected draft', async ({ page, request }) => {
  await readingStory(page, request);
  const settings = await readingSettings(page);
  await settings.getByRole('combobox', { name: '阅读配色', exact: true }).selectOption('paper');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'reading-appearance') throw new DOMException('Storage blocked', 'SecurityError'); original.call(this, key, value); };
  });
  await settings.getByRole('button', { name: '保存阅读外观', exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText('当前外观未改变');
  await expect(page.locator('html')).toHaveAttribute('data-reading-theme', 'graphite');
  await expect(settings.getByRole('combobox', { name: '阅读配色', exact: true })).toHaveValue('paper');
  expect(await page.evaluate(() => localStorage.getItem('reading-appearance'))).toBeNull();
});

test('reading: all palettes pair readable text with their backgrounds', async ({ page, request }, info) => {
  await readingStory(page, request);
  const settings = await readingSettings(page);
  // One palette invariant, including supporting text and the light-theme hover state.
  for (const theme of ['graphite', 'midnight', 'warm', 'paper']) {
    await settings.getByRole('combobox', { name: '阅读配色', exact: true }).selectOption(theme);
    await settings.getByRole('button', { name: '保存阅读外观', exact: true }).click();
    const ratios = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const light = (key: string) => {
        const hex = style.getPropertyValue(key).trim().slice(1);
        const rgb = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
      };
      return [['--text-prose', '--bg-canvas'], ['--text-narration', '--bg-canvas'], ['--text-dim', '--bg-elevated'], ['--text-muted', '--bg-active'], ['--danger', '--danger-bg'], ['--accent-foreground', '--accent-hover']].map(([fg, bg]) => {
        const a = light(fg!), b = light(bg!);
        return { fg, bg, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
      });
    });
    expect(ratios.filter(pair => !Number.isFinite(pair.ratio) || pair.ratio < 4.5), theme).toEqual([]);
  }
  await expect(settings.getByRole('button', { name: '保存阅读外观', exact: true })).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: info.outputPath('reading-paper-settings.png') });
});

test('reading: tablet navigation and model settings stay within the viewport', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await readingStory(page, request);
  expect((await page.locator('main').boundingBox())!.width).toBe(1024);
  await insideViewport(page, page.locator('.top-actions'));
  const settings = await readingSettings(page);
  await settings.getByRole('button', { name: '模型', exact: true }).click();
  await settings.getByRole('button', { name: '创建模型连接', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑模型连接', exact: true });
  await insideViewport(page, editor);
  const form = editor.locator('form');
  expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await editor.getByRole('button', { name: '保存', exact: true }).scrollIntoViewIfNeeded();
  await insideViewport(page, editor.getByRole('button', { name: '保存', exact: true }));
  await page.screenshot({ path: info.outputPath('reading-tablet.png') });
});

test.describe('reading phone', () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  test('reading: English phone layout can send with the largest story font', async ({ page, request }, info) => {
    await page.addInitScript(() => {
      localStorage.setItem('interface-language', 'en');
      localStorage.setItem('reading-appearance', JSON.stringify({ theme: 'paper', font: 'mono', fontSize: 28 }));
    });
    await readingStory(page, request);
    const input = page.getByRole('textbox', { name: 'Message input', exact: true });
    await input.fill('A new step. 新的一步。');
    await insideViewport(page, page.getByRole('button', { name: 'Send', exact: true }));
    await insideViewport(page, page.locator('.top-actions'));
    expect(await page.locator('.composer').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect((await page.locator('.messages-wrap').boundingBox())!.height).toBeGreaterThan(120);
    let generation = 0;
    page.on('request', req => { if (req.url().endsWith('/api/turns') && req.method() === 'POST') generation++; });
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('article.message')).toHaveCount(3);
    await expect(page.locator('.message .prose textarea').last()).toHaveValue('A new step. 新的一步。');
    expect(generation).toBe(0);
    await page.screenshot({ path: info.outputPath('reading-phone.png') });
  });
});

test('reading: 200-percent-equivalent viewport keeps settings and send reachable', async ({ page, request }, info) => {
  // 1440 × 900 at 200% browser zoom has a 720 × 450 CSS viewport.
  await page.setViewportSize({ width: 720, height: 450 });
  await page.addInitScript(() => {
    localStorage.setItem('interface-language', 'en');
    localStorage.setItem('reading-appearance', JSON.stringify({ theme: 'midnight', font: 'sans', fontSize: 24 }));
  });
  await readingStory(page, request);
  await insideViewport(page, page.getByRole('button', { name: 'Send', exact: true }));
  expect((await page.locator('.messages-wrap').boundingBox())!.height).toBeGreaterThan(90);
  const settings = await readingSettings(page);
  await settings.getByRole('button', { name: 'Save reading appearance', exact: true }).scrollIntoViewIfNeeded();
  await insideViewport(page, settings.getByRole('button', { name: 'Save reading appearance', exact: true }));
  expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('reading-zoom.png') });
});

test('reading: invalid stored choices fall back to safe defaults', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('reading-appearance', JSON.stringify({ theme: 'unknown', font: 'url(invalid)', fontSize: 1000 })));
  await readingStory(page, request);
  await expect(page.locator('html')).toHaveAttribute('data-reading-theme', 'graphite');
  await expect(page.locator('html')).toHaveAttribute('data-reading-font', 'sans');
  await expect(page.locator('.prose textarea').last()).toHaveCSS('font-size', '16px');
});

test('chat avatar keeps square framing despite legacy cropping and opens the original', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('avatar-fit', 'cover'));
  await page.route('**/square-avatar.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: portraitSvg(400, 400) }));
  await openHistory(page, request, 20, '/square-avatar.svg');
  const avatar = page.locator('.message.narration .avatar').last();
  await expect(avatar.locator('img')).toHaveJSProperty('naturalWidth', 400);
  const box = (await avatar.boundingBox())!;
  expect(box.width).toBe(58);
  expect(box.height).toBe(box.width);
  await avatar.hover();
  await expect(avatar.locator('img')).toHaveCSS('transform', 'none');
  await avatar.click();
  await expect(page.getByAltText('角色大图立绘')).toHaveAttribute('src', '/square-avatar.svg');
  await page.locator('.lightbox-modal').click();
  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置 / Settings' });
  await settings.getByRole('button', { name: '外观', exact: true }).click();
  await expect(settings.getByLabel('图片裁剪方式')).toHaveCount(0);
  await expect(settings.getByLabel('头像尺寸')).toHaveValue('large');
});

test('chat avatar bounds a tall portrait without distorting or circularly cropping it', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('avatar-mode', 'full'));
  await page.route('**/tall-avatar.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: portraitSvg(200, 2000) }));
  await openHistory(page, request, 20, '/tall-avatar.svg');
  const avatar = page.locator('.message.narration .avatar').last();
  const image = avatar.locator('img');
  await expect(image).toHaveJSProperty('naturalHeight', 2000);
  const imageBox = (await image.boundingBox())!;
  const frame = (await avatar.boundingBox())!;
  const column = (await page.locator('.message.narration .avatar-column').last().boundingBox())!;
  expect(imageBox.width / imageBox.height).toBeCloseTo(0.1, 2);
  expect(frame.height).toBe(112);
  expect(frame.width).toBeLessThan(80);
  expect(frame.x + frame.width / 2).toBeCloseTo(column.x + column.width / 2, 1);
  expect(await avatar.evaluate(element => getComputedStyle(element).borderRadius)).not.toBe('50%');
});

test('chat avatar preserves a wide image and aligned message columns on a narrow screen', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('avatar-mode', 'compact'));
  await page.route('**/wide-avatar.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: portraitSvg(800, 200) }));
  await openHistory(page, request, 20, '/wide-avatar.svg');
  const avatar = page.locator('.message.narration .avatar').last();
  await expect(avatar.locator('img')).toHaveJSProperty('naturalWidth', 800);
  const image = (await avatar.locator('img').boundingBox())!;
  expect(image.width / image.height).toBeCloseTo(4, 2);
  expect((await avatar.boundingBox())!.width).toBe(30);
  const assistantBody = (await page.locator('.message.narration .message-body').last().boundingBox())!;
  const userBody = (await page.locator('.message.user .message-body').last().boundingBox())!;
  expect(assistantBody.x).toBe(userBody.x);
  const region = page.getByRole('region', { name: '聊天记录' });
  expect(await region.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('chat avatar delayed loading follows the latest message without interrupting earlier reading', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('avatar-mode', 'full'));
  let release!: () => void;
  let ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/delayed-avatar.svg', async route => {
    await ready;
    await route.fulfill({ contentType: 'image/svg+xml', body: portraitSvg(200, 2000) });
  });
  try {
    await openHistory(page, request, 20, '/delayed-avatar.svg');
    const region = page.getByRole('region', { name: '聊天记录' });
    const distanceFromBottom = () => region.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight);
    await expect.poll(distanceFromBottom).toBeLessThan(2);
    const beforeHeight = await region.evaluate(element => element.scrollHeight);
    release();
    await expect(page.locator('.message.narration .avatar img').last()).toHaveJSProperty('naturalHeight', 2000);
    await expect.poll(() => region.evaluate(element => element.scrollHeight)).toBeGreaterThan(beforeHeight);
    await expect.poll(distanceFromBottom).toBeLessThan(2);

    ready = new Promise<void>(resolve => { release = resolve; });
    await page.reload();
    await expect(page.locator('article.message')).toHaveCount(20);
    await page.getByRole('navigation', { name: '最近 20 条用户消息' }).getByRole('button', { name: '跳转到用户消息 52', exact: true }).click();
    await expect(page.getByRole('button', { name: '回到最新 ↓' })).toBeVisible();
    const anchor = page.locator('#message-display-102');
    const beforeTop = (await anchor.boundingBox())!.y;
    release();
    await expect(page.locator('.message.narration .avatar img').first()).toHaveJSProperty('naturalHeight', 2000);
    // Scroll offsets round to pixels while element geometry retains fractions.
    await expect.poll(async () => Math.abs((await anchor.boundingBox())!.y - beforeTop)).toBeLessThan(1);
    await expect(page.getByRole('button', { name: '回到最新 ↓' })).toBeVisible();
  } finally {
    release();
  }
});

test('opening and reentering a conversation starts at its latest message', async ({ page, request }) => {
  let releaseSettings!: () => void;
  const settingsReady = new Promise<void>(resolve => { releaseSettings = resolve; });
  await page.route('**/api/settings/general', async route => {
    const response = await route.fetch();
    await settingsReady;
    await route.fulfill({ response });
  });
  // History can arrive before the conversation data mounts the scroll container.
  const historyResponse = page.waitForResponse(/\/api\/conversations\/[^/]+\/messages(?:\?|$)/);
  const opening = openHistory(page, request, 20);
  await (await historyResponse).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  releaseSettings();
  await opening;
  const region = page.getByRole('region', { name: '聊天记录' });
  const distanceFromBottom = () => region.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight);
  await expect.poll(distanceFromBottom).toBeLessThan(2);

  await page.getByRole('navigation', { name: '最近 20 条用户消息' }).getByRole('button').first().click();
  await expect(page.getByRole('button', { name: '回到最新 ↓' })).toBeVisible();
  await page.getByRole('button', { name: /^故事列表/ }).click();
  await expect(region).toHaveCount(0);
  await page.locator('.story-list').getByRole('button', { name: /Chat display fixture/ }).first().click();
  await expect(page.locator('article.message')).toHaveCount(20);
  await expect.poll(distanceFromBottom).toBeLessThan(2);
});

test('chat window prepends without moving text and horizontal bars jump to older user messages', async ({ page, request }, info) => {
  await openHistory(page, request, 20);
  const region = page.getByRole('region', { name: '聊天记录' });
  const navigation = page.getByRole('navigation', { name: '最近 20 条用户消息' });
  await expect(navigation.getByRole('button')).toHaveCount(20);
  await expect(navigation).toHaveText('');
  await expect(navigation.getByRole('button').first()).toHaveAccessibleName('跳转到用户消息 41');
  await region.evaluate(element => { element.scrollTop = 120; element.dispatchEvent(new Event('scroll')); });
  const anchor = page.locator('#message-display-100');
  const top = (await anchor.boundingBox())!.y;
  // Cross the loading threshold and retain the previous message's viewport position.
  await region.evaluate(element => { element.scrollTop = 80; });
  await expect(page.locator('article.message')).toHaveCount(40);
  await expect.poll(async () => (await anchor.boundingBox())!.y).toBeCloseTo(top + 40, 0);

  await page.getByRole('button', { name: '回到最新 ↓' }).click();
  await expect(page.locator('article.message')).toHaveCount(20);
  await navigation.getByRole('button').first().click();
  await expect(page.locator('article.message')).toHaveCount(40);
  const target = page.locator('#message-display-80');
  await expect.poll(async () => (await target.boundingBox())!.y - (await region.boundingBox())!.y).toBeCloseTo(12, 0);
  await expect(navigation.getByRole('button').first()).toHaveAttribute('aria-current', 'location');
  await page.screenshot({ path: info.outputPath('message-bars.png') });
});

test('appearance saves the display limit and plain thinking default across reloads', async ({ page, request }) => {
  await openHistory(page, request);
  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置 / Settings' });
  await settings.getByRole('button', { name: '外观', exact: true }).click();
  await expect(settings.getByLabel('聊天显示条数')).toHaveValue('100');
  await settings.getByLabel('聊天显示条数').fill('12');
  await settings.getByLabel('普通模式默认展开思考（CoT）').uncheck();
  await settings.getByRole('button', { name: '关闭设置' }).click();
  await expect(page.locator('article.message')).toHaveCount(12);
  await expect(page.locator('.message-thinking[open]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('article.message')).toHaveCount(12);
  await expect(page.locator('.message-thinking[open]')).toHaveCount(0);
  await page.locator('.message-thinking summary').last().click();
  await expect(page.locator('.message-thinking[open]')).toHaveCount(1);
});

test('streaming respects collapsed thinking and keeps the message being read in place', async ({ page, request }) => {
  await page.addInitScript(() => {
    localStorage.setItem('plain-thinking-expanded', 'false');
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (String(input).includes('/api/turns/display-stream/events')) {
        return new Response(new ReadableStream({ start(controller) {
          let id = 0;
          (window as any).emitChatEvent = (type: string, payload: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id: ++id, type, payload })}\n\n`));
        } }), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      return nativeFetch(input, init);
    };
  });
  const messages = await openHistory(page, request, 20);
  await page.route('**/api/turns', route => route.fulfill({ json: { id: 'display-stream' } }));
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() => typeof (window as any).emitChatEvent === 'function');
  await page.evaluate(() => {
    (window as any).emitChatEvent('writer.started', { outputIndex: 0, speaker: { kind: 'narrator' } });
    (window as any).emitChatEvent('thinking.delta', { outputIndex: 0, delta: '流式思考。' });
    (window as any).emitChatEvent('writer.delta', { outputIndex: 0, speaker: { kind: 'narrator' }, delta: '正在写作。' });
  });
  await expect(page.locator('.streaming .message-thinking pre')).toHaveText('流式思考。');
  await expect(page.locator('.streaming .message-thinking')).not.toHaveAttribute('open');
  const region = page.getByRole('region', { name: '聊天记录' });
  await region.evaluate(element => { element.scrollTop = 200; element.dispatchEvent(new Event('scroll')); });
  await expect(page.getByRole('button', { name: '回到最新 ↓' })).toBeVisible();
  const anchor = page.locator('#message-display-102');
  const before = (await anchor.boundingBox())!.y;
  const completed = { ...messages.at(-1)!, id: 'display-new', parentId: messages.at(-1)!.id, content: '完整回复。' };
  messages.push(completed);
  await page.evaluate(message => {
    (window as any).emitChatEvent('writer.delta', { outputIndex: 0, speaker: { kind: 'narrator' }, delta: '新内容。\n'.repeat(50) });
    (window as any).emitChatEvent('message.completed', { outputIndex: 0, message });
  }, completed);
  await expect(page.locator('article.message')).toHaveCount(21);
  await expect.poll(async () => (await anchor.boundingBox())!.y).toBeCloseTo(before, 0);
  await page.evaluate(() => (window as any).emitChatEvent('turn.completed', {}));
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
});
