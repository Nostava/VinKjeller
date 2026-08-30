import React from 'react';
import { createRoot } from 'react-dom/client';
import '@digdir/designsystemet-css';
import '@digdir/designsystemet-css/theme.css'; // color tokens (light/dark/auto via data-color-scheme)
import './theme.css'; // borgund accent overrides (unlayered — wins over the DS @layer's)
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
