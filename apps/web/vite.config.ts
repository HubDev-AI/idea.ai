import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = env.PORT || '3000';
  const proxyTarget = env.VITE_API_PROXY_TARGET || `http://127.0.0.1:${port}`;

  return {
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
  };
});
