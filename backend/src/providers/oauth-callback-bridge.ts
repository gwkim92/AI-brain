import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { FastifyBaseLogger } from 'fastify';

import type { AppEnv } from '../config/env';

type OauthBridgeController = {
  stop: () => Promise<void>;
};

type CallbackBridgeConfig = {
  provider: 'openai' | 'gemini';
  port: number;
  path: string;
};

const CALLBACK_BRIDGES: CallbackBridgeConfig[] = [
  { provider: 'openai', port: 1455, path: '/auth/callback' },
  { provider: 'gemini', port: 8085, path: '/oauth2callback' }
];

function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function renderBridgeHtml(input: {
  payload: {
    type: 'jarvis_oauth_callback';
    provider: 'openai' | 'gemini';
    code: string | null;
    state: string | null;
    error: string | null;
  };
  targetOrigins: string[];
}): string {
  const payload = jsonForInlineScript(input.payload);
  const targetOrigins = jsonForInlineScript(input.targetOrigins);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OAuth callback</title>
  <style>
    body { background: #0a0a0a; color: #e5e7eb; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; padding: 24px; }
    .box { max-width: 640px; margin: 0 auto; border: 1px solid #2b2b2b; border-radius: 8px; padding: 16px; background: #111; }
    .ok { color: #34d399; }
    .err { color: #f87171; }
  </style>
</head>
<body>
  <div class="box">
    <h1>OAuth Callback</h1>
    <p id="status">Finalizing authorization...</p>
  </div>
  <script>
    (function () {
      const payload = ${payload};
      const targetOrigins = ${targetOrigins};
      const statusEl = document.getElementById('status');
      let delivered = false;

      if (window.opener && !window.opener.closed) {
        for (const origin of targetOrigins) {
          try {
            window.opener.postMessage(payload, origin);
            delivered = true;
          } catch {}
        }
      }

      if (statusEl) {
        if (payload.error) {
          statusEl.textContent = 'Authorization failed: ' + payload.error;
          statusEl.className = 'err';
        } else if (delivered) {
          statusEl.textContent = 'Authorization completed. This window will close.';
          statusEl.className = 'ok';
        } else {
          statusEl.textContent = 'Authorization completed. Return to the app window.';
        }
      }

      window.setTimeout(function () { window.close(); }, 650);
    })();
  </script>
</body>
</html>`;
}

function callbackPayloadFromRequest(
  req: IncomingMessage,
  config: CallbackBridgeConfig
): {
  type: 'jarvis_oauth_callback';
  provider: 'openai' | 'gemini';
  code: string | null;
  state: string | null;
  error: string | null;
} {
  const base = `http://localhost:${config.port}`;
  const url = new URL(req.url ?? '/', base);
  return {
    type: 'jarvis_oauth_callback',
    provider: config.provider,
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    error: url.searchParams.get('error') ?? url.searchParams.get('error_description')
  };
}

function handleBridgeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: CallbackBridgeConfig,
  env: AppEnv
): void {
  const base = `http://localhost:${config.port}`;
  const url = new URL(req.url ?? '/', base);
  if (url.pathname !== config.path) {
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('not found');
    return;
  }

  const targetOrigins = Array.from(new Set(env.allowedOrigins));
  const html = renderBridgeHtml({
    payload: callbackPayloadFromRequest(req, config),
    targetOrigins
  });
  res.statusCode = 200;
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html);
}

async function listenBridgeServer(
  config: CallbackBridgeConfig,
  env: AppEnv,
  logger: FastifyBaseLogger
): Promise<import('node:http').Server | null> {
  const server = createServer((req, res) => {
    handleBridgeRequest(req, res, config, env);
  });

  const listened = await new Promise<boolean>((resolve) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (error.code === 'EADDRINUSE') {
        logger.warn({ port: config.port, provider: config.provider }, 'oauth callback bridge port is already in use; skipping');
        resolve(false);
        return;
      }
      logger.warn(
        { port: config.port, provider: config.provider, code: error.code, message: error.message },
        'oauth callback bridge failed to start'
      );
      resolve(false);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(config.port, '127.0.0.1');
  });

  if (!listened) {
    server.close();
    return null;
  }

  logger.info({ port: config.port, provider: config.provider }, 'oauth callback bridge listening');
  return server;
}

export async function startOauthCallbackBridge(input: {
  env: AppEnv;
  logger: FastifyBaseLogger;
}): Promise<OauthBridgeController | null> {
  if (!input.env.PROVIDER_OAUTH_PUBLIC_CLIENT_FALLBACK) {
    return null;
  }

  const servers = (await Promise.all(
    CALLBACK_BRIDGES.map((config) => listenBridgeServer(config, input.env, input.logger))
  )).filter((server): server is import('node:http').Server => Boolean(server));

  if (servers.length === 0) {
    return null;
  }

  return {
    stop: async () => {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => resolve());
            })
        )
      );
    }
  };
}
