import React from 'react';
import { createRoot } from 'react-dom/client';
import '@digdir/designsystemet-css';
import './theme.css';
import './app.css';
import './i18n';
import App from './App';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
