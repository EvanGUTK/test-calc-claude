import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ErrorKindDto, ErrorResponse } from './api-types.ts';

export const MAX_BODY_BYTES = 16 * 1024;

export class HttpError extends Error {
  readonly status: number;
  readonly kind: ErrorKindDto;

  constructor(status: number, message: string, kind: ErrorKindDto = 'request') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.kind = kind;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export function errorBody(
  kind: ErrorKindDto,
  message: string,
  span: { start: number; end: number } | null = null,
): ErrorResponse {
  return { error: { kind, message, start: span?.start ?? null, end: span?.end ?? null } };
}

/** Reads a JSON request body, enforcing the content type and a size limit. */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers['content-type'] ?? '';
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, `Request body exceeds ${MAX_BODY_BYTES} bytes`);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}
