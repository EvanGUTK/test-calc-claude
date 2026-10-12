import type { IncomingMessage, ServerResponse } from 'node:http';
import { CalcError } from '../engine/index.ts';
import { CalculatorService, NotFoundError, type CalculatorState } from '../service/calculator-service.ts';
import type {
  AngleModeDto,
  EvaluateResponse,
  StateResponse,
  ValidateResponse,
} from './api-types.ts';
import { HttpError, errorBody, readJsonBody, sendJson } from './http-utils.ts';

interface RouteResult {
  readonly status: number;
  readonly body: unknown;
}

interface RouteContext {
  readonly req: IncomingMessage;
  readonly params: readonly string[];
}

interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly handle: (context: RouteContext) => Promise<RouteResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) throw new HttpError(400, 'Request body must be a JSON object');
  return body;
}

function requireInput(body: Record<string, unknown>): string {
  const input = body['input'];
  if (typeof input !== 'string') throw new HttpError(400, "'input' must be a string");
  return input;
}

function requireAngleMode(body: Record<string, unknown>): AngleModeDto {
  const mode = body['angleMode'];
  if (mode !== 'rad' && mode !== 'deg') throw new HttpError(400, "'angleMode' must be \"rad\" or \"deg\"");
  return mode;
}

function toStateResponse(state: CalculatorState): StateResponse {
  return {
    variables: state.variables.map(({ name, value }) => ({ name, value })),
    history: state.history.map((entry) => ({ ...entry })),
    ans: state.ans,
  };
}

function decodeSegment(segment: string | undefined): string {
  try {
    return decodeURIComponent(segment ?? '');
  } catch {
    throw new HttpError(400, 'Malformed percent-encoding in path');
  }
}

function buildRoutes(service: CalculatorService): readonly Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/health$/,
      handle: () => Promise.resolve({ status: 200, body: { status: 'ok' } }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/state$/,
      handle: async () => ({ status: 200, body: toStateResponse(await service.getState()) }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/validate$/,
      handle: async ({ req }) => {
        const input = requireInput(requireObject(await readJsonBody(req)));
        const analysis = await service.analyze(input);
        const body: ValidateResponse = {
          ok: analysis.ok,
          tokens: analysis.tokens.map(({ kind, start, end }) => ({ kind, start, end })),
          diagnostics: analysis.diagnostics.map((d) => ({ ...d })),
        };
        return { status: 200, body };
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/evaluate$/,
      handle: async ({ req }) => {
        const body = requireObject(await readJsonBody(req));
        const result = await service.submit(requireInput(body), requireAngleMode(body));
        const response: EvaluateResponse = { entry: { ...result.entry }, state: toStateResponse(result.state) };
        return { status: 200, body: response };
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/variables\/([^/]+)$/,
      handle: async ({ params }) => ({
        status: 200,
        body: toStateResponse(await service.deleteVariable(decodeSegment(params[0]))),
      }),
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/history$/,
      handle: async () => ({ status: 200, body: toStateResponse(await service.clearHistory()) }),
    },
  ];
}

function respondWithError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(res, error.status, errorBody(error.kind, error.message));
  } else if (error instanceof CalcError) {
    sendJson(res, 422, errorBody(error.kind, error.message, error.span));
  } else if (error instanceof NotFoundError) {
    sendJson(res, 404, errorBody('not_found', error.message));
  } else {
    console.error('Unhandled error while serving API request:', error);
    sendJson(res, 500, errorBody('internal', 'Internal server error'));
  }
}

/** Returns a handler for `/api/*` requests. */
export function createApiHandler(service: CalculatorService): (req: IncomingMessage, res: ServerResponse, pathname: string) => Promise<void> {
  const routes = buildRoutes(service);

  return async (req, res, pathname) => {
    try {
      const matching = routes.filter((route) => route.pattern.test(pathname));
      if (matching.length === 0) throw new HttpError(404, `No such endpoint: ${pathname}`, 'not_found');
      const route = matching.find((candidate) => candidate.method === req.method);
      if (route === undefined) {
        const allowed = matching.map((candidate) => candidate.method).join(', ');
        sendJson(res, 405, errorBody('request', `Method ${req.method ?? ''} not allowed`), { Allow: allowed });
        return;
      }
      const match = route.pattern.exec(pathname);
      const result = await route.handle({ req, params: match === null ? [] : match.slice(1) });
      sendJson(res, result.status, result.body);
    } catch (error) {
      respondWithError(res, error);
    }
  };
}
