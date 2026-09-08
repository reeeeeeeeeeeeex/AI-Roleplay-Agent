import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './style.css';
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
