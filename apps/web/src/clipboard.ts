import { t } from './i18n.js';

export async function copyText(text: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
  } catch {
    throw new Error(t('剪贴板不可用或未获授权，请选择文字后手动复制。'));
  }
}
