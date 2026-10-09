import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { LanguageProvider } from './LanguageProvider.js';
import { getLocale } from './i18n.js';
import { applyAppearance, readAppearance } from './appearance.js';
import './style.css';
import './reading.css';
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
}
document.documentElement.lang = getLocale();
applyAppearance(readAppearance());
createRoot(document.getElementById('root')!).render(<React.StrictMode><LanguageProvider><App/></LanguageProvider></React.StrictMode>);
