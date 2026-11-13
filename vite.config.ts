import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './worker/index';
import { INVENTORY_BODY_LIMIT } from './worker/inventory';
import type { Env } from './worker/types';

// Explicit local troubleshooting mode. Production still uses the Cloudflare Worker.
// The same Hono app and owner/session checks run in Node, where the owner's
// configured HTTPS proxy is supported. No credentials enter browser code.
export function localNodeApiMiddleware(env: Env, app = createApp()) {
  const origin = new URL(env.APP_ORIGIN || 'http://localhost:5173');
  if (env.APP_ENV !== 'local' || origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
    throw new Error('Local Node API requires local mode and a loopback HTTP origin.');
  }
  const bindings: Env = { ...env, ASSETS: { fetch: async () => new Response(null, { status: 204, headers: { 'x-emessa-vite-next': '1' } }) } };
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const target = new URL(req.url || '/', origin);
    const peer = req.socket.remoteAddress;
    if (target.origin !== origin.origin || req.headers.host !== origin.host || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer || '')) {
      res.writeHead(403, { 'cache-control': 'no-store' }); res.end('Use the configured localhost address.'); return;
    }
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.set(name, value);
      }
      const bodyLimit = target.pathname === '/api/v1/inventory/assets' ? INVENTORY_BODY_LIMIT : 65536;
      const parts: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk); bytes += buffer.length;
        if (bytes > bodyLimit) { res.writeHead(413, { 'cache-control': 'no-store' }); res.end('Request too large.'); return; }
        parts.push(buffer);
      }
      const method = req.method || 'GET';
      const request = new Request(target, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : Buffer.concat(parts) });
      const response = await app.fetch(request, bindings);
      if (response.headers.get('x-emessa-vite-next') === '1') {
        response.headers.forEach((value, name) => { if (name !== 'x-emessa-vite-next') res.setHeader(name, value); });
        return next();
      }
      res.statusCode = response.status;
      res.setHeader('x-emessa-local-runtime', 'node');
      response.headers.forEach((value, name) => { if (name !== 'set-cookie') res.setHeader(name, value); });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader('set-cookie', cookies);
      res.end(method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch {
      console.warn('[EMESSA local API] LOCAL_ADAPTER_FAILED');
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end('The local API could not complete this request.');
    }
  };
}
export function localNodeApiPlugin(): Plugin {
  return {
    name: 'emessa-local-node-api', enforce: 'pre',
    configureServer(server) {
      if (process.env.EMESSA_NODE_API !== '1') return;
      const values = parseEnv(readFileSync('.dev.vars', 'utf8'));
      const env = { ...values, ASSETS: { fetch: async () => new Response('Use the Vite page handler.', { status: 404 }) } } as Env;
      const handler = localNodeApiMiddleware(env);
      server.middlewares.use(handler);
      console.info('[EMESSA local API] Node handles auth/API routes with the configured network proxy.');
    },
  };
}
export default defineConfig(({ command }) => {
  const localNode = command === 'serve' && process.env.EMESSA_NODE_API === '1';
  return {
    plugins: [localNode ? localNodeApiPlugin() : cloudflare({ viteEnvironment: { name: 'worker' } }), react(), tailwindcss()],
    server: {
      host: localNode ? '127.0.0.1' : '0.0.0.0', port: Number(process.env.PORT || 5173), strictPort: true, allowedHosts: true,
      fs: { deny: ['**/.env', '**/.env.*', '**/.dev.vars', '**/.dev.vars.*', '**/.oauth-local/**', '**/client_secret*.json', '**/.git/**', '**/*.{crt,pem,key}'] },
    },
    environments: { worker: { build: { sourcemap: false } } },
    build: { sourcemap: false },
  };
});
