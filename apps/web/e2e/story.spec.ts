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

  page.once('dialog', dialog => dialog.accept('Sina 还不知道信中的秘密。'));
  await page.locator('article.message').last().getByRole('button', { name: '固定事实', exact: true }).click();
  const records = page.locator('.records');
  await expect(records.getByText('Sina 还不知道信中的秘密。', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept('拆信之前'));
  await page.locator('article.message').last().getByRole('button', { name: '书签', exact: true }).click();
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
