import { SERVICE_WORKER_URL } from './push.ts';

/** Registers `/sw.js` once the page has loaded, so it never competes with the first render. */
export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: '/' })
      .catch((error: unknown) => console.warn('Service worker registration failed', error));
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
