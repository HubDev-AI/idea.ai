import { defineConfig, loadEnv } from 'vite';

const silenceProxyError = (err: Error, _req: unknown, _res: unknown) => {
  if (['EPIPE', 'ECONNRESET', 'ECONNREFUSED'].includes((err as NodeJS.ErrnoException).code ?? '')) return;
  console.error('[vite proxy]', err.message);
};

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
        },
        '/socket.io': {
          target: proxyTarget,
          changeOrigin: true,
          ws: true,
          configure: (proxy) => {
            proxy.on('error', silenceProxyError);
          }
        }
      }
    },
    preview: {
      port: 4173
    }
  };
});
