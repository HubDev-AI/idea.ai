import { defineConfig, loadEnv, type Plugin } from 'vite';

/** Vite logs EPIPE/ECONNRESET on the raw socket when the API isn't ready yet.
 *  There's no way to prevent it via the proxy `configure` callback because Vite
 *  attaches its own handler directly on the socket in the `upgrade` listener.
 *  Filter these harmless messages at the logger level instead. */
const silenceWsProxyErrors = (): Plugin => ({
  name: 'silence-ws-proxy-errors',
  configureServer(server) {
    const { logger } = server.config;
    const origError = logger.error.bind(logger);
    logger.error = (msg, opts) => {
      if (typeof msg === 'string' && msg.includes('ws proxy socket error')) return;
      origError(msg, opts);
    };
  }
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = env.PORT || '3000';
  const proxyTarget = env.VITE_API_PROXY_TARGET || `http://127.0.0.1:${port}`;

  return {
    root: 'apps/web',
    plugins: [silenceWsProxyErrors()],
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
          ws: true
        }
      }
    },
    preview: {
      port: 4173
    }
  };
});
