import { STATUS_CODES } from 'node:http';

/** One entry per error route. The reporter walks this list; the tests assert against it. */
export interface ErrorRoute {
  /** Stable identifier, also the last path segment and the issue title suffix. */
  readonly name: string;
  readonly path: string;
  /** HTTP status the route always responds with. */
  readonly status: number;
  readonly summary: string;
}

export const ROUTE_PREFIX = '/errors';

export const HTTP_STATUS_ROUTES = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503] as const;

const route = (name: string, status: number, summary: string): ErrorRoute => ({
  name,
  path: `${ROUTE_PREFIX}/${name}`,
  status,
  summary,
});

export const ERROR_ROUTES: readonly ErrorRoute[] = [
  route('unhandled-exception', 500, 'Throws a plain Error from a synchronous handler'),
  route('null-reference', 500, 'Reads a property of null'),
  route('type-error', 500, 'Calls a number as if it were a function'),
  route('index-out-of-range', 500, 'Reads past the end of a 4-byte buffer'),
  route('request-timeout', 408, 'Waits 1000 ms for a dependency that never answers'),
  ...HTTP_STATUS_ROUTES.map((status) =>
    route(`http-${status}`, status, `Responds with HTTP ${status} ${STATUS_CODES[status] ?? ''}`),
  ),
  route('unhandled-rejection', 500, 'Rejects a promise that nothing awaits or catches'),
  route(
    'out-of-memory',
    500,
    'Allocates a 64 MiB buffer, then fails as if the heap were exhausted',
  ),
];

export class HttpError extends Error {
  constructor(
    readonly status: number,
    name: string,
    message: string,
  ) {
    super(message);
    this.name = name;
  }
}

/** Shape of every error response the service produces. */
export interface ErrorResponse {
  error: {
    name: string;
    message: string;
    status: number;
    stack: string;
  };
}

export function findRoute(name: string): ErrorRoute | undefined {
  return ERROR_ROUTES.find((entry) => entry.name === name);
}
