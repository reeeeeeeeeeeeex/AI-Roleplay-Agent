import { test, expect, type Page } from '@playwright/test';

async function send(page: Page, text: string, count: number) {
  await page.getByRole('textbox', { name: '输入消息' }).fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(count);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
}
test.beforeEach(async ({ page, request }, info) => {
  const characters = await (await request.get('/api/characters')).json();
  const connections = await (await request.get('/api/connections')).json();
  const chat = await (await request.post('/api/conversations', { data: { title: `Browser ${info.title}`, kind: 'solo', characterId: characters.find((c: any) => c.name === 'Sina').id, connectionId: connections[0].id } })).json();
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(`Browser ${info.title}`) }).click();
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
test('swipe and continue keep alternate branches', async ({ page }) => {
  await send(page, '你好。', 3);
  await page.getByRole('button', { name: '新版本', exact: true }).first().click();
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  await expect(page.getByText('2/2', { exact: true })).toBeVisible();
  const before = await page.locator('article.message .prose').last().textContent();
  await page.getByRole('button', { name: '续写', exact: true }).last().click();
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  await expect.poll(async () => (await page.locator('article.message .prose').last().textContent())?.length ?? 0).toBeGreaterThan(before!.length);
});
test('chat settings, memory and state editing', async ({ page }) => {
  await page.getByRole('button', { name: '聊天设置', exact: true }).click();
  await page.getByRole('combobox', { name: '主角控制', exact: true }).selectOption('coauthor');
  await page.getByLabel('旁白名称', { exact: true }).fill('记录者');
  await page.getByLabel('启用 Planner', { exact: false }).check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('共同创作', { exact: true })).toBeVisible();
  await send(page, '故事开始。', 3);
  await page.getByRole('button', { name: '立即生成 Memory', exact: true }).click();
  await expect(page.locator('.memory-entry')).toHaveCount(1);
  await page.getByRole('button', { name: '主角状态', exact: true }).click();
  await page.getByRole('button', { name: '编辑数据', exact: true }).click();
  const state = JSON.parse(await page.getByLabel('状态 JSON').inputValue());
  state.global_state[0].current_location = '书店';
  await page.getByLabel('状态 JSON').fill(JSON.stringify(state));
  await page.getByRole('button', { name: '验证并保存', exact: true }).click();
  await expect(page.getByLabel('状态 JSON')).toHaveValue(/书店/);
  await page.getByRole('button', { name: '编辑数据', exact: true }).click();
  await expect(page.getByText('书店', { exact: true })).toBeVisible();
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
test('branch picker restores the old second output', async ({ page }) => {
  await send(page, '留下一封信。', 3);
  await page.getByRole('button', { name: '新版本', exact: true }).first().click();
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  await page.getByRole('button', { name: '故事分支', exact: true }).click();
  await page.getByRole('dialog', { name: '故事分支', exact: true }).getByRole('button', { name: /Sina/ }).click();
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(3);
});
test('group Planner preserves narrator and stable cast', async ({ page }) => {
  await page.getByRole('button', { name: '聊天设置', exact: true }).click();
  await page.getByRole('combobox', { name: '聊天类型', exact: true }).selectOption('group');
  await page.getByRole('combobox', { name: '群组', exact: true }).selectOption({ label: '灯塔里的来信' });
  await page.getByLabel('启用 Planner', { exact: false }).check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.cast-strip')).toContainText('旁白');
  await expect(page.locator('.cast-strip')).toContainText('Mara');
  await send(page, '谁知道这封信的来历？', 3);
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Planner → Writer' })).toBeVisible();
  await expect(page.getByText('planner.completed', { exact: true })).toBeVisible();
});
test('creates a connection through the UI with only the supported protocols', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: /^模型连接 \d/ }).click();
  await page.getByRole('button', { name: '创建模型连接', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑模型连接' });
  await dialog.getByRole('textbox', { name: '名称', exact: true }).fill('Browser connection');
  await dialog.getByRole('textbox', { name: '模型 ID', exact: true }).fill('local-test');
  await expect(dialog.getByRole('combobox', { name: 'API 协议', exact: true }).locator('option')).toHaveCount(3);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser connection', exact: true })).toBeVisible();
});
