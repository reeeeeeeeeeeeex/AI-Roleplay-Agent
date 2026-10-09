import { t, type MessageKey } from './i18n.js';

const counts: Record<string, MessageKey> = {
  messages: '导入数量：消息', memories: '导入数量：记忆', states: '导入数量：状态', characters: '导入数量：角色', images: '导入数量：图片',
  personas: '导入数量：主角', lorebooks: '导入数量：世界书', groups: '导入数量：群组', chats: '导入数量：聊天', conversations: '导入数量：聊天',
};
export const countLabel = (key: string) => counts[key] ? t(counts[key]!).replace(/^导入数量：/, '') : key;
const reasoning: Record<string, MessageKey> = { off: '选项关闭', minimal: '推理：最低', low: '推理：低', medium: '推理：中', high: '推理：高', xhigh: '推理：很高', max: '推理：最高' };
export const reasoningLabel = (key: string) => reasoning[key] ? t(reasoning[key]!).replace(/^(选项|推理：)/, '') : key;

export const generationLabel = (key: string) => key === 'plain' ? t('普通写作') : key === 'planner' ? 'Planner + Writer' : key === 'writer-agent' ? 'Writer Agent' : key;
const phases: Record<string, MessageKey> = { selection: '选择发言者', planning: '规划', writing: '写作', records: '记录更新', plain: '普通写作', choices: '行动选项' };
export const phaseLabel = (key: string) => phases[key] ? t(phases[key]!) : key;
const proposals: Record<string, MessageKey> = { pending: '待处理', applied: '已应用', rejected: '已拒绝', undone: '已撤销', expired: '已过期' };
export const proposalLabel = (key: string) => proposals[key] ? t(proposals[key]!) : key;
const sources: Record<string, MessageKey> = { system: '系统指令', history: '历史消息', lore: '世界书资料', memory: 'Memory', state: '主角状态', control: '控制指令' };
export const sourceLabel = (key: string) => sources[key] ? t(sources[key]!) : key;
