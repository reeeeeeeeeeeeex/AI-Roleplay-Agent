import { AppError } from '@new-ai-chat/contracts';
import { connectionInputSchema } from '@new-ai-chat/contracts';
import { z } from 'zod';

export const modelListInputSchema = z.object({
  protocol: connectionInputSchema.shape.protocol, baseUrl: connectionInputSchema.shape.baseUrl,
  apiKey: connectionInputSchema.shape.apiKey, headers: connectionInputSchema.shape.headers,
  connectionId: z.string().optional(),
});

export async function listModels(input: z.infer<typeof modelListInputSchema>): Promise<string[]> {
  const url = new URL(input.baseUrl);
  const anthropic = input.protocol === 'anthropic-messages';
  let path = url.pathname.replace(/\/+$/u, '').replace(/\/(chat\/completions|responses|messages)$/u, '');
  if (!path && (anthropic || url.hostname === 'api.openai.com')) path = '/v1';
  url.pathname = `${path}/models`;
  const signal = AbortSignal.timeout(15_000);
  const models = new Set<string>();
  if (anthropic) url.searchParams.set('limit', '1000');
  try {
    const headers = new Headers({ Accept: 'application/json' });
    if (anthropic) headers.set('anthropic-version', '2023-06-01');
    if (input.apiKey) headers.set(anthropic ? 'x-api-key' : 'Authorization', anthropic ? input.apiKey : `Bearer ${input.apiKey}`);
    for (const [key, value] of Object.entries(input.headers)) headers.set(key, value);
    for (;;) {
      // Do not forward credentials to a redirected host or reflect upstream error bodies.
      const response = await fetch(url, { headers, signal, redirect: 'error' });
      if (!response.ok) throw new AppError("获取模型失败（HTTP {0}），请检查 Base URL、API Key 和模型列表接口支持。", response.status);
      const body = await response.json() as { data?: Array<{ id?: unknown }>; has_more?: boolean; last_id?: string };
      if (!Array.isArray(body.data)) throw new AppError("服务未返回有效模型列表，请手动填写模型 ID。");
      for (const model of body.data) if (typeof model?.id === 'string' && model.id.trim()) models.add(model.id);
      if (!anthropic || !body.has_more) break;
      if (!body.last_id || body.last_id === url.searchParams.get('after_id')) throw new AppError("模型列表分页异常，请手动填写模型 ID。");
      url.searchParams.set('after_id', body.last_id);
    }
  } catch (error) {
    if (signal.aborted) throw new AppError("获取模型超时，请重试或手动填写模型 ID。");
    if (error instanceof Error && /^(获取模型失败|服务未返回|模型列表分页)/u.test(error.message)) throw error;
    throw new AppError("无法获取模型列表，请检查连接地址与网络，或手动填写模型 ID。");
  }
  return [...models].sort();
}
