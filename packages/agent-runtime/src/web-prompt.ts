import { AppError } from '@new-ai-chat/contracts';
import type { ModelProtocol } from '@new-ai-chat/contracts';

// Format captured plain-writing requests, never provider parameters or Agent tools.
export function formatWebPrompt(requestBody: string, protocol: ModelProtocol): string {
  const body = JSON.parse(requestBody);
  const text = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(part => ['text', 'input_text', 'output_text'].includes(part?.type) && typeof part.text === 'string').map(part => part.text).join('\n\n') : '';
  const blocks: string[] = [];
  const add = (role: string, content: unknown) => {
    const value = text(content);
    if (value.trim()) blocks.push(`## ${role}\n\n${value}`);
  };
  if (protocol === 'anthropic-messages') add('System · 写作要求', body.system);
  if (protocol === 'openai-responses') add('System · 写作要求', body.instructions);
  const messages = protocol === 'openai-responses' ? body.input : body.messages;
  for (const message of messages ?? []) {
    if (message.role === 'system' || message.role === 'developer') add('System · 写作要求', message.content);
    else if (message.role === 'user') add('User · 用户输入与本轮要求', message.content);
    else if (message.role === 'assistant') add('Assistant · 历史回复与上下文资料', message.content);
  }
  if (!blocks.length) throw new AppError("当前请求没有可复制的提示词。");
  return ['以下是一次角色扮演写作任务。请遵循写作要求，参考历史和上下文资料，只输出最后指定发言者接下来的正文；不要复述这些说明、角色标签或调用工具。', ...blocks].join('\n\n');
}
