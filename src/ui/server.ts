import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { CalculatorService } from '../service/calculator-service.ts';
import { createApiHandler } from './api.ts';
import { HttpError, errorBody, sendJson } from './http-utils.ts';

export interface AppServerOptions {
  readonly service: CalculatorService;
  /** Directory containing index.html, styles.css and assets/. */
  readonly publicDir: string;
}

const API_PREFIX = '/api/';
const INDEX_PATH = '/index.html';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

function resolveStaticPath(publicDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname === '/' ? INDEX_PATH : pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const root = resolve(publicDir);
  const target = resolve(root, `.${decoded}`);
  return target.startsWith(root + sep) ? target : null;
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, publicDir: string, pathname: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, errorBody('request', `Method ${req.method ?? ''} not allowed`), { Allow: 'GET, HEAD' });
    return;
  }
  const filePath = resolveStaticPath(publicDir, pathname);
  const contentType = filePath === null ? undefined : CONTENT_TYPES[extname(filePath)];
  if (filePath === null || contentType === undefined) {
    sendJson(res, 404, errorBody('not_found', 'Not found'));
    return;
  }
  let content: Buffer;
  try {
    content = await readFile(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR') {
      sendJson(res, 404, errorBody('not_found', 'Not found'));
      return;
    }
    throw error;
  }
  res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': content.length, 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : content);
}

/** Creates (but does not start) the HTTP server for the dashboard and its JSON API. */
export function createAppServer(options: AppServerOptions): Server {
  const handleApi = createApiHandler(options.service);

  return createServer((req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const handled = pathname.startsWith(API_PREFIX)
      ? handleApi(req, res, pathname)
      : serveStatic(req, res, options.publicDir, pathname);

    handled.catch((error: unknown) => {
      console.error(`Unhandled error for ${req.method ?? '?'} ${pathname}:`, error);
      if (!res.headersSent) {
        const status = error instanceof HttpError ? error.status : 500;
        sendJson(res, status, errorBody('internal', 'Internal server error'));
      } else {
        res.destroy();
      }
    });
  });
}
