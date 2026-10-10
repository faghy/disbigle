import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = 'http://127.0.0.1:3000';
const proxiedPaths = [
  '/api',
  '/health',
  '/users',
  '/inbox',
  '/receive',
  '/.well-known',
  '/nodeinfo',
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(proxiedPaths.map((path) => [path, { target: apiTarget }])),
  },
  build: {
    rolldownOptions: {
      output: {
        // Keep rarely-changing libraries in their own long-cached chunks.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  preview: { port: 4173 },
});
