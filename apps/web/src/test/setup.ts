import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import i18n from '../lib/i18n.ts';
import { MockWebSocket } from './mockWebSocket.ts';

// findBy*/waitFor wait up to 1 s by default: too little when every package tests in parallel.
configure({ asyncUtilTimeout: 5_000 });

// jsdom does not implement scrolling; the router restores scroll positions on navigation.
window.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

// jsdom has no object URLs; the composer uses them for image previews.
URL.createObjectURL = () => 'blob:preview';
URL.revokeObjectURL = () => {};

// Never open real sockets from tests; tests reach the instances through MockWebSocket.
globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

afterEach(async () => {
  cleanup();
  MockWebSocket.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});
