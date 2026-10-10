import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import i18n from '../lib/i18n.ts';

// jsdom does not implement scrolling; the router restores scroll positions on navigation.
window.scrollTo = () => {};

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});
