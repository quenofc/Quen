import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin, type PreviewServer, type ViteDevServer} from 'vite';

const PUBLIC_ROBINHOOD_RPC = 'https://rpc.mainnet.chain.robinhood.com';

function robinhoodRpcProxy(): Plugin {
  const requests = new Map<string, { count: number; resetAt: number }>();
  const allowedMethods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getBalance', 'eth_getStorageAt', 'eth_gasPrice', 'eth_estimateGas', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
  const install = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use('/robinhood-rpc', async (request, response) => {
      if (request.method !== 'POST') {
        response.statusCode = 405;
        response.end('Method not allowed');
        return;
      }

      const ip = request.socket.remoteAddress ?? 'unknown';
      const now = Date.now();
      const usage = requests.get(ip);
      const nextUsage = !usage || usage.resetAt <= now ? { count: 1, resetAt: now + 60_000 } : { count: usage.count + 1, resetAt: usage.resetAt };
      requests.set(ip, nextUsage);
      if (nextUsage.count > 120) {
        response.statusCode = 429;
        response.end('Rate limit exceeded');
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += Buffer.byteLength(chunk);
        if (size > 256_000) {
          response.statusCode = 413;
          response.end('Request too large');
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      try {
        const payload = JSON.parse(body.toString()) as { method?: string } | { method?: string }[];
        const calls = Array.isArray(payload) ? payload : [payload];
        if (!calls.length || calls.length > 50 || calls.some((call) => !call.method || !allowedMethods.has(call.method))) {
          response.statusCode = 400;
          response.end('Unsupported RPC request');
          return;
        }
      } catch {
        response.statusCode = 400;
        response.end('Invalid JSON');
        return;
      }
      const targets = [process.env.QUICKNODE_ROBINHOOD_RPC_URL, PUBLIC_ROBINHOOD_RPC].filter(
        (target, index, values): target is string => Boolean(target) && values.indexOf(target) === index,
      );

      for (const [index, target] of targets.entries()) {
        try {
          const upstream = await fetch(target, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body,
            signal: AbortSignal.timeout(8_000),
          });
          if ((!upstream.ok || upstream.status === 429) && index < targets.length - 1) continue;
          response.statusCode = upstream.status;
          response.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json');
          response.end(Buffer.from(await upstream.arrayBuffer()));
          return;
        } catch {
          if (index < targets.length - 1) continue;
        }
      }

      response.statusCode = 503;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'RPC temporarily unavailable' } }));
    });
  };

  return {
    name: 'robinhood-rpc-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default defineConfig(() => {
  return {
    plugins: [robinhoodRpcProxy(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5000,
      allowedHosts: true as const,
      strictPort: true,
      // HMR is disabled when DISABLE_HMR is set.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Internal Replit caches contain transient paths that Linux cannot watch.
      watch: process.env.DISABLE_HMR === 'true'
        ? null
        : { ignored: ['**/.local/**', '**/.agents/**', '**/dist/**'] },
    },
  };
});
