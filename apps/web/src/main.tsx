import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createQueryClient } from './api/queries.ts';
import './lib/i18n.ts';
import { registerServiceWorker } from './lib/serviceWorker.ts';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App queryClient={createQueryClient()} />
  </StrictMode>,
);

// The service worker (push notifications, offline page) runs in production builds; set
// VITE_ENABLE_SW=true to try it with the dev server.
if (import.meta.env.PROD || import.meta.env.VITE_ENABLE_SW === 'true') registerServiceWorker();
