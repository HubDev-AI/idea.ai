import { defineConfig } from 'vite';

const proxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  root: 'apps/web',
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: proxyTarget,
        changeOrigin: true,
        timeout: 300_000
      }
    }
  },
  preview: {
    port: 4173
  }
});
