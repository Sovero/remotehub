import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useApp } from './store';
import './styles/global.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Маркер для smoke-теста: React смонтировался без исключений.
(window as unknown as Record<string, unknown>).__RH_READY__ = true;

// Хук для smoke-тестов: переключение темы/акцента из main-процесса (RH_SMOKE_CONTRAST).
(window as unknown as { __RH_STORE__?: unknown }).__RH_STORE__ = useApp;

window.addEventListener('error', (e) => {
  (window as unknown as Record<string, unknown>).__RH_ERROR__ = e.message;
  console.error('[rh-global-error]', e.error && e.error.stack ? e.error.stack.split('\n').slice(0, 8).join(' | ') : e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  (window as unknown as Record<string, unknown>).__RH_ERROR__ = String(e.reason);
});
