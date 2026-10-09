import { getLocale } from './i18n.js';

// UI labels are deliberately separate from model-facing column_labels and storage keys.
const labels: Record<string, readonly [string, string]> = {
  current_location: ['当前地点', 'Current location'], current_time: ['当前时间', 'Current time'],
  previous_scene_time: ['上一个场景的时间', 'Previous scene time'], elapsed_time: ['场景经过时间', 'Elapsed scene time'],
  character_name: ['姓名', 'Name'], gender_age: ['性别／年龄', 'Gender / Age'], appearance: ['外貌', 'Appearance'],
  occupation: ['身份与地位', 'Occupation / Status'], personality: ['性格', 'Personality'], current_outfit: ['当前穿搭', 'Current outfit'],
  past_experience_before_story: ['故事前经历', 'Past experience before the story'], past_experience_in_story: ['故事内经历', 'Experience in this story'],
  name: ['名称', 'Name'], brief_introduction: ['简介', 'Brief introduction'], key_items: ['关键物品', 'Key items'],
  is_dead: ['是否确认死亡', 'Confirmed dead'], past_experience: ['过往经历', 'Past experience'],
  skill_name: ['技能名称', 'Skill name'], skill_type: ['技能类型', 'Skill type'], skill_level: ['等级／阶段', 'Level / Stage'], effect_description: ['效果描述', 'Effect description'],
  item_name: ['物品名称', 'Item name'], quantity: ['数量', 'Quantity'], description: ['描述', 'Description'], category: ['分类', 'Category'],
  quest_name: ['任务名称', 'Quest name'], quest_type: ['任务类型', 'Quest type'], issuer: ['发布者', 'Issuer'], detail_description: ['详细描述', 'Details'],
  current_progress: ['当前进度', 'Current progress'], time_limit: ['时限', 'Time limit'], reward: ['奖励', 'Reward'], penalty: ['惩罚', 'Penalty'], row_id: ['行 ID', 'Row ID'],
};
export const stateLabel = (column: string) => labels[column]?.[getLocale() === 'en' ? 1 : 0] ?? column;
