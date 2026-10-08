import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const dialog = (page: Page) => page.getByRole('dialog', { name: '编辑世界书', exact: true });
const entries = (page: Page) => dialog(page).locator('.lore-entry');
async function openLibrary(page: Page) {
  await page.goto('/');
  await page.locator('.studio-nav').getByRole('button', { name: /^世界书/ }).click();
}
async function openFixture(page: Page, request: APIRequestContext, name: string) {
  const result = await request.post('/api/lorebooks', { data: { name, description: '测试世界', legacyPayload: { original: true }, entries: [
    { title: '灯塔', keys: ['海岸'], secondaryKeys: ['夜晚'], content: '灯塔的旧正文。', order: 10, position: 'after', depth: 3, legacyPayload: { comment: '旧标题', probability: 75 } },
    { title: '森林', keys: ['树木'], content: '森林的旧正文。', order: 20 },
  ] } });
  expect(result.ok()).toBeTruthy();
  const book = await result.json();
  await openLibrary(page); await page.getByRole('button', { name, exact: true }).click();
  return book;
}

test('lorebook creates readable entries and reopens on a narrow screen with keyboard controls', async ({ page, request }) => {
  await openLibrary(page);
  await page.getByRole('button', { name: '创建世界书', exact: true }).click();
  const editor = dialog(page);
  await expect(editor.getByText('条目 JSON', { exact: true })).toHaveCount(0);
  await editor.getByLabel('名称', { exact: true }).fill('表单新建世界');
  await editor.getByRole('button', { name: '新建条目', exact: true }).click();
  await expect(editor.getByLabel('条目标题', { exact: true })).toBeFocused();
  await editor.getByLabel('条目标题', { exact: true }).fill('海岸灯塔');
  await editor.getByRole('textbox', { name: '正文', exact: true }).fill('守塔人住在这里。\n夜晚灯火通明。');
  await editor.getByLabel('关键词', { exact: true }).fill('海岸');
  await editor.getByLabel('关键词', { exact: true }).press('Enter');
  await editor.getByLabel('辅助关键词', { exact: true }).fill('夜晚');
  await editor.getByRole('button', { name: '关闭', exact: true }).last().click();
  await expect(editor).toHaveCount(0);
  const book = (await (await request.get('/api/lorebooks')).json()).find((item: any) => item.name === '表单新建世界');
  expect(book.entries[0]).toMatchObject({ title: '海岸灯塔', keys: ['海岸'], secondaryKeys: ['夜晚'], enabled: true, constant: false });
  await page.getByRole('button', { name: book.name, exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const toggle = editor.locator('.lore-entry-toggle');
  await toggle.focus(); await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(editor.getByRole('textbox', { name: '正文', exact: true })).toHaveValue('守塔人住在这里。\n夜晚灯火通明。');
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  await expect(editor.getByRole('button', { name: '关闭', exact: true }).last()).toBeInViewport();
});

test('lorebook search and collapsing keep hidden drafts in the saved book', async ({ page, request }) => {
  const book = await openFixture(page, request, '搜索草稿世界');
  const editor = dialog(page);
  await editor.getByRole('button', { name: '全部展开', exact: true }).click();
  await entries(page).first().getByRole('textbox', { name: '正文', exact: true }).fill('灯塔的新正文。');
  await editor.getByRole('button', { name: '全部收起', exact: true }).click();
  await editor.getByRole('searchbox', { name: '搜索条目' }).fill('树木');
  await expect(entries(page)).toHaveCount(1);
  await entries(page).first().locator('.lore-entry-toggle').click();
  await entries(page).first().getByRole('textbox', { name: '正文', exact: true }).fill('森林的新正文。');
  await editor.getByRole('button', { name: '关闭', exact: true }).last().click();
  await expect(editor).toHaveCount(0);
  const saved = await (await request.get(`/api/lorebooks/${book.id}`)).json();
  expect(saved.entries.map((entry: any) => entry.content)).toEqual(['灯塔的新正文。', '森林的新正文。']);
  expect(saved.entries[0]).toMatchObject({ position: 'after', depth: 3, legacyPayload: { comment: '旧标题', probability: 75 } });
  expect(saved.legacyPayload).toEqual({ original: true });
});

test('lorebook copies, toggles and deletes the selected entry without shifting drafts', async ({ page, request }) => {
  const book = await openFixture(page, request, '条目操作世界');
  const editor = dialog(page);
  await editor.getByRole('searchbox', { name: '搜索条目' }).fill('灯塔');
  await entries(page).first().locator('.lore-entry-toggle').click();
  await entries(page).first().getByRole('button', { name: '复制条目' }).click();
  await expect(editor.getByRole('searchbox', { name: '搜索条目' })).toHaveValue('');
  const copy = editor.getByRole('article', { name: '灯塔（副本）', exact: true });
  await expect(copy.getByLabel('条目标题', { exact: true })).toBeFocused();
  await copy.getByRole('textbox', { name: '正文', exact: true }).fill('复制条目的独立正文。');
  await copy.getByLabel('触发方式').selectOption('constant');
  const original = editor.getByRole('article', { name: '灯塔', exact: true });
  await original.getByRole('checkbox').uncheck();
  const forest = editor.getByRole('article', { name: '森林', exact: true });
  await forest.locator('.lore-entry-toggle').click();
  await forest.getByRole('button', { name: '删除条目' }).click();
  await forest.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(copy.getByRole('textbox', { name: '正文', exact: true })).toHaveValue('复制条目的独立正文。');
  await editor.getByRole('button', { name: '关闭', exact: true }).last().click();
  await expect(editor).toHaveCount(0);
  const saved = await (await request.get(`/api/lorebooks/${book.id}`)).json();
  expect(saved.entries).toHaveLength(2);
  expect(saved.entries[0]).toMatchObject({ title: '灯塔', content: '灯塔的旧正文。', enabled: false });
  expect(saved.entries[1]).toMatchObject({ title: '灯塔（副本）', content: '复制条目的独立正文。', constant: true, order: 21 });
});

test('lorebook autosave retains failed drafts through reload and retries on blur', async ({ page, request }) => {
  const book = await openFixture(page, request, '失败保留世界');
  const editor = dialog(page);
  let fail = true;
  await page.route(`**/api/lorebooks/${book.id}`, route => route.request().method() === 'PUT' && fail ? route.fulfill({ status: 500, json: { error: '测试保存失败' } }) : route.continue());
  await editor.getByRole('button', { name: '全部展开', exact: true }).click();
  const body = entries(page).first().getByRole('textbox', { name: '正文', exact: true });
  await body.fill('尚未保存的正文。');
  await editor.getByRole('button', { name: '关闭', exact: true }).last().click();
  await expect(editor.getByRole('alert')).toContainText('测试保存失败');
  await expect(body).toHaveValue('尚未保存的正文。');
  expect((await (await request.get(`/api/lorebooks/${book.id}`)).json()).entries[0].content).toBe('灯塔的旧正文。');
  await page.reload();
  await page.locator('.studio-nav').getByRole('button', { name: /^世界书/ }).click();
  await page.getByRole('button', { name: book.name, exact: true }).click();
  await editor.getByRole('button', { name: '全部展开', exact: true }).click();
  await expect(body).toHaveValue('尚未保存的正文。');
  fail = false;
  await body.focus(); await body.blur();
  await expect.poll(async () => (await (await request.get(`/api/lorebooks/${book.id}`)).json()).entries[0].content).toBe('尚未保存的正文。');
  await body.fill('第二次编辑仍使用最新版本。'); await body.blur();
  await expect.poll(async () => (await (await request.get(`/api/lorebooks/${book.id}`)).json()).entries[0].content).toBe('第二次编辑仍使用最新版本。');
  const box = (await body.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(4, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  await expect(editor).toBeVisible();
  await expect(body).toHaveValue('第二次编辑仍使用最新版本。');
  await editor.getByRole('button', { name: '关闭', exact: true }).last().click();
  await expect(editor).toHaveCount(0);
});
