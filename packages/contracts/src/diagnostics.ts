import { diagnosticMessages } from './diagnostic-messages.js';

export type UiText = { key: keyof typeof diagnosticMessages; params?: Array<string | number> };
export type UiDiagnostic = { error: string; errorText?: UiText };

export function uiText(key: UiText['key'], ...params: Array<string | number>): UiText {
  return params.length ? { key, params } : { key };
}
export function formatUiText(text: UiText, language: 'original' | 'zh' | 'en', fallback: string = text.key): string {
  const template = diagnosticMessages[text.key]?.[language];
  if (!template) return fallback;
  return template.replace(/\{(\d+)\}/g, (match, index: string) => text.params?.[Number(index)] == null ? match : String(text.params[Number(index)]));
}
export class AppError extends Error {
  readonly uiText: UiText;
  constructor(key: UiText['key'], ...params: Array<string | number>) {
    const text = uiText(key, ...params);
    super(formatUiText(text, 'original'));
    this.uiText = text;
  }
}

// Only explicitly marked application errors get translated. Upstream errors stay verbatim.
export function errorText(error: unknown): UiText | undefined {
  return error instanceof AppError ? error.uiText : undefined;
}

export function appendWarning(target: { warnings: string[]; warningTexts?: Array<UiText | null> }, key: UiText['key'], ...params: Array<string | number>): void {
  const text = uiText(key, ...params);
  target.warningTexts ??= target.warnings.map(() => null);
  target.warnings.push(formatUiText(text, 'original'));
  target.warningTexts.push(text);
}
