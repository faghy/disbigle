import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Interaction-heavy tests (user-event typing) can be slow when every package tests in parallel.
    testTimeout: 20_000,
  },
});
