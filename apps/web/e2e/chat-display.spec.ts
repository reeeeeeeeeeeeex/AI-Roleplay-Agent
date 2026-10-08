import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
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
  await page.route(`**/api/conversations/${chat.id}/messages`, route => route.fulfill({ json: { branch: messages, nodes: messages } }));
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
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '通用设置' });
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
  const historyResponse = page.waitForResponse(/\/api\/conversations\/[^/]+\/messages$/);
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
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '通用设置' });
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
  await page.getByRole('button', { name: '让故事继续 →' }).click();
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
