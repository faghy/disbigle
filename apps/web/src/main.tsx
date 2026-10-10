import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createQueryClient } from './api/queries.ts';
import './lib/i18n.ts';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App queryClient={createQueryClient()} />
  </StrictMode>,
);
