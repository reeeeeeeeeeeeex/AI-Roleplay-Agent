import { test, expect } from '@playwright/test';
import { defaultGeneralSettings } from '@new-ai-chat/contracts';

test.use({ serviceWorkers: 'block' });

test('action bubbles reuse saved groups, edit on blur, and send without replacing the input draft', async ({ page, request }) => {
  const characters = await (await request.get('/api/characters')).json();
  const connections = await (await request.get('/api/connections')).json();
  await request.put('/api/settings/general', { data: { ...defaultGeneralSettings, connectionId: connections[0].id, actionChoices: { ...defaultGeneralSettings.actionChoices, count: 2 } } });
  const chat = await (await request.post('/api/conversations', { data: { title: 'Action bubbles', kind: 'solo', characterId: characters[0].id } })).json();
  await page.addInitScript(id => localStorage.setItem('selected-chat', id), chat.id);
  let generations = 0, rejectEdit = true;
  await page.route(`**/api/conversations/${chat.id}/action-choices`, async route => {
    if (route.request().method() === 'POST') generations++;
    if (route.request().method() === 'PATCH' && rejectEdit) { rejectEdit = false; return route.fulfill({ status: 503, json: { error: '模拟保存失败' } }); }
    return route.continue();
  });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '输入消息' });
  await input.fill('保留这份未发送草稿');
  const panel = page.getByRole('region', { name: '行动选项' });
  const toggle = panel.getByRole('button', { name: '行动选项', exact: true });
  await toggle.click();
  await expect(panel.locator('.action-choice-bubble')).toHaveCount(2);
  await panel.getByRole('button', { name: '编辑选项 1' }).click();
  const edit = panel.getByRole('textbox', { name: '编辑选项 1' });
  await edit.fill('我走到门口，仔细查看信封。');
  await input.click();
  await expect(panel.getByRole('alert')).toContainText('模拟保存失败');
  await expect(edit).toHaveValue('我走到门口，仔细查看信封。');
  await edit.focus(); await input.click();
  await expect(panel.getByRole('button', { name: '我走到门口，仔细查看信封。', exact: true })).toBeVisible();
  await toggle.click(); await toggle.click();
  expect(generations).toBe(1);

  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '通用设置' });
  await settings.getByRole('button', { name: '行动选项', exact: true }).click();
  await expect(settings.getByLabel('选项数量').locator('option')).toHaveText(['1 个', '2 个', '3 个', '4 个']);
  await settings.getByLabel('选项数量').selectOption('4');
  await settings.getByRole('button', { name: '保存行动选项设置' }).click();
  await expect(settings.getByRole('status')).toContainText('下次生成时生效');
  await settings.getByRole('button', { name: '关闭设置' }).click();
  await panel.getByRole('button', { name: '生成新一组选项' }).click();
  await expect(panel.locator('.action-choice-bubble')).toHaveCount(4);
  await panel.getByRole('button', { name: '上一组选项' }).click();
  await expect(panel.locator('.action-choice-bubble')).toHaveCount(2);
  await page.reload(); await toggle.click();
  await expect(panel.getByRole('button', { name: '我走到门口，仔细查看信封。', exact: true })).toBeVisible();
  expect(generations).toBe(2);
  await page.getByRole('button', { name: '用户旁白', exact: true }).click();
  const sending = page.waitForRequest(req => req.url().endsWith('/api/turns') && req.method() === 'POST');
  await panel.getByRole('button', { name: '我走到门口，仔细查看信封。', exact: true }).click();
  expect((await sending).postDataJSON().input).toEqual({ voice: 'protagonist', text: '我走到门口，仔细查看信封。' });
  await expect(page.locator('article.message:not(.streaming)')).toHaveCount(2);
  await expect(input).toHaveValue('保留这份未发送草稿');
  expect(generations).toBe(2);
});
