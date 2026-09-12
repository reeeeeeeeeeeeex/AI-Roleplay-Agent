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
  await request.put('/api/settings/general', { data: { ...defaultGeneralSettings, connectionId: connections[0].id } });
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

test('general settings: all stories share controls and failed drafts survive', async ({ page, request }, info) => {
  const connections = await (await request.get('/api/connections')).json();
  const input = page.getByRole('textbox', { name: '输入消息' });
  const text = '我把这封没能寄出的信收进口袋。';
  await input.fill(text);
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '通用设置', exact: true });
  await expect(settings.locator('.settings-nav button')).toHaveText(['模型', '写作', '提示词', '外观']);
  await expect(settings.getByRole('checkbox', { name: '流式传输' })).toBeChecked();
  await settings.getByLabel('当前模型连接').selectOption('');
  await expect(settings.getByRole('status')).toContainText('模型已保存');
  await settings.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请在左下角通用设置中选择模型连接。');
  await expect(input).toHaveValue(text);

  await page.getByRole('button', { name: '故事资料', exact: true }).click();
  const story = page.getByRole('dialog', { name: '编辑故事资料', exact: true });
  await expect(story.getByRole('combobox')).toHaveCount(3);
  await expect(story.getByText(/生成模式|模型连接|主角控制|旁白名称|自动更新间隔/)).toHaveCount(0);
  await story.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: /灯塔来信 · 单聊/ }).click();
  await page.getByRole('button', { name: new RegExp(`Browser ${info.title}`) }).click();
  await expect(input).toHaveValue(text);

  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await settings.getByLabel('当前模型连接').selectOption(connections[0].id);
  await expect(settings.getByRole('status')).toContainText('模型已保存');
  await settings.getByRole('button', { name: '写作', exact: true }).click();
  await settings.getByRole('combobox', { name: /生成模式/ }).selectOption('plain');
  await settings.getByRole('combobox', { name: /主角控制/ }).selectOption('coauthor');
  await settings.getByLabel('旁白名称', { exact: true }).fill('记录者');
  await settings.getByLabel('Memory 自动更新间隔（0 关闭）').fill('3');
  await settings.getByRole('button', { name: '保存写作设置' }).click();
  await expect(settings.getByRole('status')).toContainText('写作设置已保存');
  await settings.getByRole('button', { name: '关闭设置' }).click();
  await expect(input).toHaveValue(text);
  await expect(page.locator('.cast-strip')).toContainText('记录者');
  await expect(page.locator('.cast-strip')).toContainText('共同创作');
  await send(page, text, 2);
  await expect(input).toHaveValue('');
  await expect(page.locator('.generation-info').last()).toContainText('输入');
  await page.getByRole('button', { name: /灯塔来信 · 单聊/ }).click();
  await expect(page.locator('.cast-strip')).toContainText('记录者');
  await page.reload();
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await expect(settings.getByLabel('当前模型连接')).toHaveValue(connections[0].id);
  await settings.getByRole('button', { name: '写作', exact: true }).click();
  await expect(settings.getByRole('combobox', { name: /生成模式/ })).toHaveValue('plain');
  await expect(settings.getByLabel('旁白名称', { exact: true })).toHaveValue('记录者');
  await expect(settings.getByLabel('Memory 自动更新间隔（0 关闭）')).toHaveValue('3');
});
