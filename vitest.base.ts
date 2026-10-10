import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: [fileURLToPath(new URL('./scripts/load-env.ts', import.meta.url))],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
