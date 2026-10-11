import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = 'http://127.0.0.1:3000';
const proxiedPaths = [
  '/api',
  '/oauth',
  '/health',
  '/media',
  '/users',
  '/inbox',
  '/receive',
  '/.well-known',
  '/nodeinfo',
];

// The streaming WebSocket must come before `/api`: the first matching prefix wins.
const proxy = {
  '/api/v1/streaming': { target: apiTarget, ws: true },
  ...Object.fromEntries(proxiedPaths.map((path) => [path, { target: apiTarget }])),
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy,
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
