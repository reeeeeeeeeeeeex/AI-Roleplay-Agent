import type { ReactNode } from 'react';
import { t } from './i18n.js';

export default function Notice({ children, onDismiss, className = 'banner', role = 'status' }: {
  children: ReactNode; onDismiss: () => void; className?: string; role?: 'status' | 'alert';
}) {
  return <div className={`${className} dismissible-notice`} role={role}>
    <div className="notice-content">{children}</div>
    <button type="button" className="notice-close" aria-label={t('关闭提示')} title={t('关闭提示')} onClick={onDismiss}>✕</button>
  </div>;
}
